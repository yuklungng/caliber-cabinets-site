/* global process */
import { createClient } from '@supabase/supabase-js';
import { batchGetDealStages, buildHubSpotObjects, createDeal, createDealNote, getAllPipelineDeals, getPipelineStages, updateDealProperties, updateDealStage, upsertContact } from './hubspot.js';
import { checkAuth } from './_lib/auth.js';

// ─── Distance helpers (for POST ?action=add-lead) ─────────────────────────────
const CALIBER_LAT = 37.6977;
const CALIBER_LON = -121.7308;

function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function geocodeExact(addressStr) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(addressStr)}&benchmark=Public_AR_Current&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  return match ? { lat: match.coordinates.y, lon: match.coordinates.x } : null;
}
async function geocodeRough(queryStr) {
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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // GET ?action=pipeline-stages — return all pipeline stages for the stage picker
  if (req.method === 'GET' && req.query?.action === 'pipeline-stages') {
    try {
      const stages = await getPipelineStages();
      return res.status(200).json({ stages });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH ?action=activities — update activity checklist for a Supabase-backed lead
  if (req.method === 'PATCH' && req.query?.action === 'activities') {
    const { id, activities, change } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data: leadRow, error } = await supabase
      .from('leads')
      .update({ activities })
      .eq('id', id)
      .select('hubspot_deal_id')
      .single();
    if (error) {
      console.error('[admin-leads] activities update error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    // Post a HubSpot note when an activity is checked on (does NOT change deal stage)
    if (change?.done && leadRow?.hubspot_deal_id && process.env.HUBSPOT_ACCESS_TOKEN) {
      const ACTIVITY_LABELS = {
        appt_scheduled: 'Appointment Scheduled',
        appt_completed: 'Appointment Completed',
      };
      const label   = ACTIVITY_LABELS[change.key] ?? change.key;
      const dateStr = new Date(change.at ?? Date.now()).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      try {
        await createDealNote(leadRow.hubspot_deal_id, `✓ ${label} — ${dateStr}`);
      } catch (hsErr) {
        console.error('[admin-leads] HubSpot note error:', hsErr.message);
        // Non-fatal — Supabase already saved
      }
    }

    return res.status(200).json({ success: true });
  }

  // PATCH ?action=probability — save per-deal win probability override to Supabase
  if (req.method === 'PATCH' && req.query?.action === 'probability') {
    const { id, probability } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data: current, error: fetchErr } = await supabase
      .from('leads').select('fields').eq('id', id).single();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const updatedFields = { ...current.fields };
    if (probability != null) {
      updatedFields.probability = probability;
    } else {
      delete updatedFields.probability;
    }

    const { error: updateErr } = await supabase
      .from('leads').update({ fields: updatedFields }).eq('id', id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.status(200).json({ success: true });
  }

  // PATCH ?action=quote-amount — save quote amount to Supabase and sync to HubSpot deal `amount`
  if (req.method === 'PATCH' && req.query?.action === 'quote-amount') {
    const { id, hubspot_deal_id, quote_amount } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Fetch current fields and merge
    const { data: current, error: fetchErr } = await supabase
      .from('leads').select('fields').eq('id', id).single();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const updatedFields = { ...current.fields };
    if (quote_amount != null) {
      updatedFields.quote_amount = quote_amount;
    } else {
      delete updatedFields.quote_amount;
    }

    const { error: updateErr } = await supabase
      .from('leads').update({ fields: updatedFields }).eq('id', id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // Sync to HubSpot deal `amount` (non-fatal — used as forecast amount and deal revenue at won)
    if (hubspot_deal_id && process.env.HUBSPOT_ACCESS_TOKEN) {
      try {
        await updateDealProperties(hubspot_deal_id, {
          amount: quote_amount != null ? String(quote_amount) : '',
        });
      } catch (hsErr) {
        console.error('[admin-leads/quote-amount] HubSpot error (non-fatal):', hsErr.message);
      }
    }

    return res.status(200).json({ success: true });
  }

  // PATCH ?action=lead-source — update leadSource inside the fields JSONB for a Supabase lead
  if (req.method === 'PATCH' && req.query?.action === 'lead-source') {
    const { id, leadSource } = req.body ?? {};
    if (!id || !leadSource) return res.status(400).json({ error: 'Missing id or leadSource' });

    // Fetch current fields, merge, and write back
    const { data: current, error: fetchErr } = await supabase
      .from('leads')
      .select('fields')
      .eq('id', id)
      .single();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const { error: updateErr } = await supabase
      .from('leads')
      .update({ fields: { ...current.fields, leadSource } })
      .eq('id', id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.status(200).json({ success: true });
  }

  // POST ?action=add-lead — manually add a lead from the admin panel (skips Turnstile + email)
  if (req.method === 'POST' && req.query?.action === 'add-lead') {
    const { formType, fields } = req.body ?? {};
    if (!formType || !fields) return res.status(400).json({ error: 'Missing formType or fields' });

    // Geocode address (same tiered logic as lead-submit.js)
    let distanceMiles = null;
    let distanceIsRough = false;
    try {
      const hasStreet = !!fields.streetAddress;
      const hasCity   = !!fields.city;
      const hasState  = !!fields.state;
      const hasZip    = !!fields.zipCode;
      let leadAddrStr = null;
      let useRough = false;
      if (fields.projectAddress) {
        leadAddrStr = fields.projectAddress;
      } else if (hasStreet && (hasCity || hasZip)) {
        leadAddrStr = [fields.streetAddress, fields.city, fields.state, fields.zipCode].filter(Boolean).join(', ');
      } else if (hasCity && hasState) {
        leadAddrStr = `${fields.city}, ${fields.state}`; distanceIsRough = true; useRough = true;
      } else if (hasZip) {
        leadAddrStr = fields.zipCode; distanceIsRough = true; useRough = true;
      }
      if (leadAddrStr) {
        const coords = useRough ? await geocodeRough(leadAddrStr) : await geocodeExact(leadAddrStr);
        if (coords) {
          distanceMiles = Math.round(haversineDistanceMiles(CALIBER_LAT, CALIBER_LON, coords.lat, coords.lon) * 10) / 10;
        }
      }
    } catch (geoErr) {
      console.warn('[admin-leads/add-lead] Geocoding failed (non-fatal):', geoErr.message);
    }

    const enrichedFields = {
      ...fields,
      manual_entry: true,
      ...(distanceMiles !== null ? { distance_miles: distanceMiles } : {}),
      ...(distanceMiles !== null && distanceIsRough ? { distance_rough: true } : {}),
    };

    const { data: insertData, error: dbError } = await supabase
      .from('leads').insert({ form_type: formType, fields: enrichedFields, status: 'new' }).select('*').single();
    if (dbError) return res.status(500).json({ error: dbError.message });

    // Push to HubSpot (non-fatal)
    let hubspotDealId = null;
    if (process.env.HUBSPOT_ACCESS_TOKEN) {
      try {
        const { contactProperties, dealProperties } = buildHubSpotObjects(formType, enrichedFields, {});
        const contactId = await upsertContact(contactProperties);
        hubspotDealId = await createDeal(dealProperties, contactId);
        if (hubspotDealId && insertData?.id) {
          await supabase.from('leads').update({ hubspot_deal_id: hubspotDealId }).eq('id', insertData.id);
        }
      } catch (hsErr) {
        console.error('[admin-leads/add-lead] HubSpot error (non-fatal):', hsErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      lead: {
        ...insertData,
        hubspot_deal_id: hubspotDealId ?? null,
        hs_stage_label: null, hs_stage_id: null, hs_stage_date: null, hs_deal_url: null,
        hs_date_entered_new_request: null, hs_date_entered_qualified: null,
        hs_date_entered_quote_sent: null, hs_date_entered_contract_sent: null,
        hs_date_entered_closed_won: null, hs_date_entered_closed_lost: null,
      },
    });
  }

  // PATCH — update deal stage in HubSpot
  if (req.method === 'PATCH') {
    const { dealId, stageId } = req.body ?? {};
    if (!dealId || !stageId) return res.status(400).json({ error: 'Missing dealId or stageId' });
    try {
      await updateDealStage(dealId, stageId);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[admin-leads] HubSpot update stage error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // GET — list all leads, newest first, enriched with HubSpot deal stage
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[admin-leads] Supabase select error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    // Batch-fetch HubSpot deal stages for leads that have a deal ID
    let hsStages = {};
    if (process.env.HUBSPOT_ACCESS_TOKEN) {
      const dealIds = data.map((l) => l.hubspot_deal_id).filter(Boolean);
      if (dealIds.length > 0) {
        try {
          hsStages = await batchGetDealStages(dealIds);
        } catch (hsErr) {
          console.error('[admin-leads] HubSpot stage fetch error:', hsErr.message);
        }
      }
    }

    const enriched = data.map((lead) => {
      const hs = lead.hubspot_deal_id ? (hsStages[lead.hubspot_deal_id] ?? null) : null;
      return {
        ...lead,
        hs_stage_label: hs?.stageLabel ?? null,
        hs_stage_id:    hs?.stageId   ?? null,
        hs_stage_date:  hs?.stageDate ?? null,
        hs_deal_url:    hs?.dealUrl   ?? null,
        // Stage-entry timestamps for operational metrics
        hs_date_entered_new_request:   hs?.dateEnteredNewRequest   ?? null,
        hs_date_entered_qualified:     hs?.dateEnteredQualified    ?? null,
        hs_date_entered_quote_sent:    hs?.dateEnteredQuoteSent    ?? null,
        hs_date_entered_contract_sent: hs?.dateEnteredContractSent ?? null,
        hs_date_entered_closed_won:    hs?.dateEnteredClosedWon    ?? null,
        hs_date_entered_closed_lost:   hs?.dateEnteredClosedLost   ?? null,
      };
    });

    // Merge in HubSpot-only deals (deals that exist in HubSpot but not from a web form)
    let hsOnlyDeals = [];
    if (process.env.HUBSPOT_ACCESS_TOKEN) {
      try {
        const allHsDeals = await getAllPipelineDeals();
        const supabaseDealIds = new Set(data.map((l) => l.hubspot_deal_id).filter(Boolean));
        hsOnlyDeals = allHsDeals.filter((d) => !supabaseDealIds.has(d.hubspot_deal_id));
      } catch (hsErr) {
        console.error('[admin-leads] HubSpot-only deals fetch error:', hsErr.message);
      }
    }

    const combined = [...enriched, ...hsOnlyDeals].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    return res.status(200).json({ leads: combined });
  }

  // DELETE — permanently remove a lead
  if (req.method === 'DELETE') {
    const { id } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) {
      console.error('[admin-leads] Supabase delete error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
