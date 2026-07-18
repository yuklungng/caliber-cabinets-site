/* global process */

import { createClient } from '@supabase/supabase-js';
import { upsertContact, createDeal, buildHubSpotObjects } from './hubspot.js';
import { checkAuth } from './_lib/auth.js';

// ─── Distance helpers (same as lead-submit.js) ────────────────────────────────
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

async function geocodeExact(addressStr) {
  // US Census Geocoder — best for full street addresses
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(addressStr)}&benchmark=Public_AR_Current&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  return match ? { lat: match.coordinates.y, lon: match.coordinates.x } : null;
}

async function geocodeRough(queryStr) {
  // Nominatim (OpenStreetMap) — used for city/state or ZIP centroid lookups
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryStr)}&countrycodes=us&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CaliberCabinets/1.0 (mike@calibercabinetshop.com)' } });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
}
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { formType, fields } = req.body ?? {};
  if (!formType || !fields) {
    return res.status(400).json({ error: 'Missing formType or fields' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // ── Geocode address ───────────────────────────────────────────────────────
  let distanceMiles = null;
  let distanceIsRough = false;
  try {
    const hasStreet = !!fields.streetAddress;
    const hasCity   = !!fields.city;
    const hasState  = !!fields.state;
    const hasZip    = !!fields.zipCode;

    let leadAddrStr = null;
    let useRoughGeocoder = false;

    if (fields.projectAddress) {
      leadAddrStr = fields.projectAddress;
      distanceIsRough = false;
    } else if (hasStreet && (hasCity || hasZip)) {
      leadAddrStr = [fields.streetAddress, fields.city, fields.state, fields.zipCode].filter(Boolean).join(', ');
      distanceIsRough = false;
    } else if (hasCity && hasState) {
      leadAddrStr = `${fields.city}, ${fields.state}`;
      distanceIsRough = true;
      useRoughGeocoder = true;
    } else if (hasZip) {
      leadAddrStr = fields.zipCode;
      distanceIsRough = true;
      useRoughGeocoder = true;
    }

    if (leadAddrStr) {
      const coords = useRoughGeocoder
        ? await geocodeRough(leadAddrStr)
        : await geocodeExact(leadAddrStr);
      if (coords) {
        distanceMiles =
          Math.round(haversineDistanceMiles(CALIBER_LAT, CALIBER_LON, coords.lat, coords.lon) * 10) / 10;
      }
    }
  } catch (geoErr) {
    console.warn('[admin-add-lead] Geocoding failed (non-fatal):', geoErr.message);
  }

  const enrichedFields = {
    ...fields,
    manual_entry: true,
    ...(distanceMiles !== null ? { distance_miles: distanceMiles } : {}),
    ...(distanceMiles !== null && distanceIsRough ? { distance_rough: true } : {}),
  };

  // ── Save to Supabase ──────────────────────────────────────────────────────
  const { data: insertData, error: dbError } = await supabase
    .from('leads')
    .insert({ form_type: formType, fields: enrichedFields, status: 'new' })
    .select('*')
    .single();

  if (dbError) {
    console.error('[admin-add-lead] Supabase insert error:', dbError.message);
    return res.status(500).json({ error: dbError.message });
  }

  console.log('[admin-add-lead] Lead saved to Supabase:', formType, insertData.id);

  // ── Push to HubSpot ───────────────────────────────────────────────────────
  let hubspotDealId = null;
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    try {
      const { contactProperties, dealProperties } = buildHubSpotObjects(formType, enrichedFields, {});
      const contactId = await upsertContact(contactProperties);
      hubspotDealId = await createDeal(dealProperties, contactId);
      console.log('[admin-add-lead] HubSpot deal created:', hubspotDealId);

      if (hubspotDealId && insertData?.id) {
        await supabase
          .from('leads')
          .update({ hubspot_deal_id: hubspotDealId })
          .eq('id', insertData.id);
      }
    } catch (hsError) {
      console.error('[admin-add-lead] HubSpot error (non-fatal):', hsError.message);
    }
  }

  return res.status(200).json({
    success: true,
    lead: {
      ...insertData,
      hubspot_deal_id: hubspotDealId ?? insertData.hubspot_deal_id ?? null,
      // HubSpot stage fields default null for new leads
      hs_stage_label: null,
      hs_stage_id:    null,
      hs_stage_date:  null,
      hs_deal_url:    null,
      hs_date_entered_new_request:   null,
      hs_date_entered_qualified:     null,
      hs_date_entered_quote_sent:    null,
      hs_date_entered_contract_sent: null,
      hs_date_entered_closed_won:    null,
      hs_date_entered_closed_lost:   null,
    },
  });
}
