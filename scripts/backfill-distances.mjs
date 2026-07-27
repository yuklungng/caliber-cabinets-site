#!/usr/bin/env node
/**
 * One-time migration: backfill distance_miles (and distance_rough) for leads
 * that were submitted before the rough-distance feature was added.
 *
 * Run from the project root:
 *   node scripts/backfill-distances.mjs
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local (or .env).
 * Geocodes via the free US Census API — no API key required.
 * Rate-limited to one request per 250 ms to avoid hammering the endpoint.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// ── Load env vars from .env.local / .env ─────────────────────────────────────
function loadEnvFile(path) {
  try {
    // Strip BOM and normalise CRLF → LF before parsing
    const content = readFileSync(path, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
    for (const line of content.split('\n')) {
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* file absent — skip */ }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

// ── Distance helpers (same logic as api/lead-submit.js) ──────────────────────
const CALIBER_LAT = 37.6977;
const CALIBER_LON = -121.7308;

function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Census geocoder — accurate for full street addresses
async function geocodeCensus(addressStr) {
  const url =
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
    `?address=${encodeURIComponent(addressStr)}&benchmark=Public_AR_Current&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  return match ? { lat: match.coordinates.y, lon: match.coordinates.x } : null;
}

// Nominatim (OpenStreetMap) — handles city/state and ZIP lookups
// Policy: 1 req/sec max, User-Agent required
async function geocodeNominatim(addressStr) {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(addressStr)}&format=json&limit=1&countrycodes=us`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CaliberCabinets-backfill/1.0 (mike@calibercabinetshop.com)' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

/**
 * If projectAddress looks like a duplicated/concatenated mess (more than 4 commas),
 * trim it down to just the first recognisable city/state/zip segment.
 * e.g. "Antioch, CA 94509, Antioch, CA , California, 94509" → "Antioch, CA 94509"
 */
function cleanAddress(addr) {
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 4 ? parts.slice(0, 3).join(', ') : addr;
}

async function geocodeAddress(addressStr, isRough) {
  const cleaned = cleanAddress(addressStr);

  if (isRough) {
    // Rough tier — Nominatim handles city/state and ZIP well
    return geocodeNominatim(cleaned);
  }

  // Exact tier — try Census first, fall back to Nominatim
  const result = await geocodeCensus(cleaned);
  if (result) return result;
  return geocodeNominatim(cleaned);
}

/** Mirror of the tiered logic in lead-submit.js */
function resolveAddress(fields) {
  const hasStreet = !!fields.streetAddress;
  const hasCity   = !!fields.city;
  const hasState  = !!fields.state;
  const hasZip    = !!fields.zipCode;

  if (fields.projectAddress) {
    return { addrStr: fields.projectAddress, isRough: false };
  }
  if (hasStreet && (hasCity || hasZip)) {
    return {
      addrStr: [fields.streetAddress, fields.city, fields.state, fields.zipCode].filter(Boolean).join(', '),
      isRough: false,
    };
  }
  if (hasCity && hasState) {
    return { addrStr: `${fields.city}, ${fields.state}`, isRough: true };
  }
  if (hasZip) {
    return { addrStr: fields.zipCode, isRough: true };
  }
  return { addrStr: null, isRough: false };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch every lead where distance_miles is absent from the fields JSONB
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, fields, form_type, created_at')
    .filter('fields->>distance_miles', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch leads:', error.message);
    process.exit(1);
  }

  console.log(`Found ${leads.length} lead(s) without distance_miles\n`);

  let updated = 0;
  let skipped = 0;
  let failed  = 0;

  for (const lead of leads) {
    const f = lead.fields ?? {};
    const { addrStr, isRough } = resolveAddress(f);

    if (!addrStr) {
      console.log(`SKIP  #${lead.id} — no geocodeable address`);
      skipped++;
      continue;
    }

    // Nominatim enforces 1 req/sec; Census is more lenient but we use the same delay
    await sleep(1100);

    let coords;
    try {
      coords = await geocodeAddress(addrStr, isRough);
    } catch (err) {
      console.error(`ERROR #${lead.id} — geocode threw: ${err.message}`);
      failed++;
      continue;
    }

    if (!coords) {
      console.log(`MISS  #${lead.id} — no geocode match for: "${addrStr}"`);
      skipped++;
      continue;
    }

    const distanceMiles =
      Math.round(haversineDistanceMiles(CALIBER_LAT, CALIBER_LON, coords.lat, coords.lon) * 10) / 10;

    const newFields = {
      ...f,
      distance_miles: distanceMiles,
      ...(isRough ? { distance_rough: true } : {}),
    };

    const { error: updateError } = await supabase
      .from('leads')
      .update({ fields: newFields })
      .eq('id', lead.id);

    if (updateError) {
      console.error(`ERROR #${lead.id} — update failed: ${updateError.message}`);
      failed++;
    } else {
      const label = isRough ? `roughly ${distanceMiles} mi` : `${distanceMiles} mi`;
      console.log(`OK    #${lead.id} — ${label}  (${addrStr})`);
      updated++;
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`Updated : ${updated}`);
  console.log(`Skipped : ${skipped}  (no usable address or no geocode match)`);
  console.log(`Failed  : ${failed}   (Supabase or network error)`);
}

main();
