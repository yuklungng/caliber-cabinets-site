/* global process */
import { createClient } from '@supabase/supabase-js';
import { batchGetContactIdsByDealIds, batchGetContactProperties, batchGetDealStages, buildHubSpotObjects, createDeal, createDealNote, ensureDeclinedReasonProperties, ensureLostReasonProperties, getAllPipelineDeals, getPipelineStages, updateDealProperties, updateDealStage, upsertContact } from './_lib/hubspot.js';
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

// ─── Declined-stage constants — shared by the stage-change PATCH handler and ─
// ─── the standalone declined-reason correction PATCH handler below.         ─
const DECLINED_STAGE_ID = '3945178857';
const DECLINED_REASONS = new Set(['Out of Service Area', 'Out of Scope', 'Duplicated', 'Other']);

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

  // PATCH ?action=probability — save per-deal win probability override to Supabase.
  // HubSpot-only leads (id starts with "hs-") have no Supabase row; skip gracefully.
  if (req.method === 'PATCH' && req.query?.action === 'probability') {
    const { id, probability } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    if (String(id).startsWith('hs-')) {
      // No Supabase row for HubSpot-only leads — probability overrides are unsupported for now
      return res.status(200).json({ success: true });
    }

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
      .from('leads').update({
        fields: updatedFields,
        last_modified_by: auth.user?.name ?? auth.user?.email ?? 'Admin',
        last_modified_at: new Date().toISOString(),
      }).eq('id', id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.status(200).json({ success: true });
  }

  // PATCH ?action=quote-amount — save quote amount to Supabase (Supabase-backed leads) and/or
  // sync to HubSpot deal `amount` (all leads). For HubSpot-only leads (id starts with "hs-"),
  // HubSpot is the source of truth and getAllPipelineDeals now fetches `amount` back on every load.
  if (req.method === 'PATCH' && req.query?.action === 'quote-amount') {
    const { id, hubspot_deal_id, quote_amount } = req.body ?? {};
    if (!id && !hubspot_deal_id) return res.status(400).json({ error: 'Missing id' });

    const isHsOnly = !id || String(id).startsWith('hs-');

    if (!isHsOnly) {
      // Supabase-backed lead — persist to fields.quote_amount
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
        .from('leads').update({
          fields: updatedFields,
          last_modified_by: auth.user?.name ?? auth.user?.email ?? 'Admin',
          last_modified_at: new Date().toISOString(),
        }).eq('id', id);
      if (updateErr) return res.status(500).json({ error: updateErr.message });
    }

    // Sync to HubSpot deal `amount` for all leads (Supabase-backed and HubSpot-only).
    // For HubSpot-only leads this is the sole persistence — getAllPipelineDeals reads it back.
    if (hubspot_deal_id && process.env.HUBSPOT_ACCESS_TOKEN) {
      const actor = auth.user?.name ?? auth.user?.email ?? 'Admin';
      try {
        await updateDealProperties(hubspot_deal_id, {
          amount: quote_amount != null ? String(quote_amount) : '',
        });
        const amtLabel = quote_amount != null
          ? `$${Number(quote_amount).toLocaleString()}`
          : '(cleared)';
        await createDealNote(hubspot_deal_id,
          `Quote amount set to ${amtLabel} by ${actor}`);
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

  // PATCH ?action=declined-reason — correct a Declined lead's reason after the
  // fact (in case the wrong option was picked, e.g. "Other" by mistake).
  // Deliberately lighter-weight than the general stage-change PATCH below: it
  // does NOT call updateDealStage (the lead is already Declined) and logs a
  // "reason corrected" note instead of a generic "Stage changed" one.
  if (req.method === 'PATCH' && req.query?.action === 'declined-reason') {
    const { dealId, declinedReason, declinedReasonDetail } = req.body ?? {};
    if (!dealId) return res.status(400).json({ error: 'Missing dealId' });
    if (!declinedReason || !DECLINED_REASONS.has(declinedReason)) {
      return res.status(400).json({ error: 'A decline reason (Out of Service Area, Out of Scope, Duplicated, or Other) is required.' });
    }
    if (declinedReason === 'Other' && !declinedReasonDetail?.trim()) {
      return res.status(400).json({ error: 'Please describe the reason when selecting "Other".' });
    }

    const actor = auth.user?.name ?? auth.user?.email ?? 'Admin';
    const detail = declinedReasonDetail?.trim() || null;

    // Push to HubSpot (non-fatal — Supabase remains the source of truth)
    try {
      await ensureDeclinedReasonProperties();
      await updateDealProperties(dealId, {
        declined_reason: declinedReason,
        ...(detail ? { declined_reason_detail: detail } : {}),
      });
    } catch (declinedErr) {
      console.error('[admin-leads] HubSpot declined-reason property error (non-fatal):', declinedErr.message);
    }
    try {
      await createDealNote(dealId, `Declined reason corrected to "${declinedReason}"${detail ? ` (${detail})` : ''} by ${actor}`);
    } catch (noteErr) {
      console.error('[admin-leads] HubSpot note error (non-fatal):', noteErr.message);
    }

    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        declined_reason: declinedReason,
        declined_reason_detail: detail,
        last_modified_by: actor,
        last_modified_at: new Date().toISOString(),
      })
      .eq('hubspot_deal_id', dealId);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.status(200).json({ success: true, declined_reason: declinedReason, declined_reason_detail: detail });
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
          await supabase.from('leads').update({
            hubspot_deal_id:    hubspotDealId,
            hubspot_contact_id: contactId ?? null,
          }).eq('id', insertData.id);
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

  // PATCH — update deal stage in HubSpot and persist to Supabase
  if (req.method === 'PATCH') {
    const { dealId, stageId, stageLabel, lostReason, lostReasonDetail, declinedReason, declinedReasonDetail } = req.body ?? {};
    if (!dealId || !stageId) return res.status(400).json({ error: 'Missing dealId or stageId' });

    // Lost Deal requires a reason — Competitor / Pricing / Value / Other.
    // "Other" requires the free-text detail to actually say something.
    const LOST_REASONS = new Set(['Competitor', 'Pricing', 'Value', 'Other']);
    if (stageId === 'closedlost') {
      if (!lostReason || !LOST_REASONS.has(lostReason)) {
        return res.status(400).json({ error: 'A lost reason (Competitor, Pricing, Value, or Other) is required to close a deal as lost.' });
      }
      if (lostReason === 'Other' && !lostReasonDetail?.trim()) {
        return res.status(400).json({ error: 'Please describe the reason when selecting "Other".' });
      }
    }

    // Declined requires a reason too — Out of Service Area / Out of Scope /
    // Duplicated / Other. Same "Other" free-text requirement as Lost Deal, but
    // a different category set since Declined is not a competitive loss.
    if (stageId === DECLINED_STAGE_ID) {
      if (!declinedReason || !DECLINED_REASONS.has(declinedReason)) {
        return res.status(400).json({ error: 'A decline reason (Out of Service Area, Out of Scope, Duplicated, or Other) is required to decline a deal.' });
      }
      if (declinedReason === 'Other' && !declinedReasonDetail?.trim()) {
        return res.status(400).json({ error: 'Please describe the reason when selecting "Other".' });
      }
    }

    const actor = auth.user?.name ?? auth.user?.email ?? 'Admin';
    try {
      await updateDealStage(dealId, stageId);

      // Lost Deal — push the reason to HubSpot as custom deal properties.
      // Non-fatal: Supabase remains the source of truth even if this fails.
      if (stageId === 'closedlost' && lostReason) {
        try {
          await ensureLostReasonProperties();
          await updateDealProperties(dealId, {
            lost_reason: lostReason,
            ...(lostReasonDetail?.trim() ? { lost_reason_detail: lostReasonDetail.trim() } : {}),
          });
        } catch (lostErr) {
          console.error('[admin-leads] HubSpot lost-reason property error (non-fatal):', lostErr.message);
        }
      }

      // Declined — same idea, different property pair.
      if (stageId === DECLINED_STAGE_ID && declinedReason) {
        try {
          await ensureDeclinedReasonProperties();
          await updateDealProperties(dealId, {
            declined_reason: declinedReason,
            ...(declinedReasonDetail?.trim() ? { declined_reason_detail: declinedReasonDetail.trim() } : {}),
          });
        } catch (declinedErr) {
          console.error('[admin-leads] HubSpot declined-reason property error (non-fatal):', declinedErr.message);
        }
      }

      // Add a HubSpot note recording who made the stage change
      try {
        const reasonNote = stageId === 'closedlost' && lostReason
          ? ` — Reason: ${lostReason}${lostReasonDetail?.trim() ? ` (${lostReasonDetail.trim()})` : ''}`
          : stageId === DECLINED_STAGE_ID && declinedReason
          ? ` — Reason: ${declinedReason}${declinedReasonDetail?.trim() ? ` (${declinedReasonDetail.trim()})` : ''}`
          : '';
        await createDealNote(dealId,
          `Stage changed to "${stageLabel ?? stageId}" by ${actor}${reasonNote}`);
      } catch (noteErr) {
        console.error('[admin-leads] HubSpot note error (non-fatal):', noteErr.message);
      }

      // Persist stage to Supabase (non-fatal — HubSpot is source of truth but Supabase mirrors it)
      const stageUpdate = {
        hs_stage_id: stageId,
        last_modified_by: actor,
        last_modified_at: new Date().toISOString(),
      };
      if (stageLabel) stageUpdate.hs_stage_label = stageLabel;
      if (stageId === 'closedlost' && lostReason) {
        stageUpdate.lost_reason = lostReason;
        stageUpdate.lost_reason_detail = lostReasonDetail?.trim() || null;
      }
      if (stageId === DECLINED_STAGE_ID && declinedReason) {
        stageUpdate.declined_reason = declinedReason;
        stageUpdate.declined_reason_detail = declinedReasonDetail?.trim() || null;
      }
      const { error: stageErr } = await supabase
        .from('leads')
        .update(stageUpdate)
        .eq('hubspot_deal_id', dealId);
      if (stageErr) console.error('[admin-leads] Supabase stage sync error (non-fatal):', stageErr.message);

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

    // ── Live contact sync from HubSpot ────────────────────────────────────────
    // For every Supabase lead linked to HubSpot, fetch fresh contact properties
    // so edits made in HubSpot (name, email, phone) are always reflected here.
    let contactProps = {}; // hubspot_contact_id → { firstName, lastName, email, phone }
    if (process.env.HUBSPOT_ACCESS_TOKEN) {
      try {
        // Leads already have a contact ID stored — use them directly
        const leadsWithContact  = data.filter((l) => l.hubspot_contact_id);
        // Leads with a deal ID but no contact ID yet — resolve via association (self-healing backfill)
        const leadsNeedingLookup = data.filter((l) => l.hubspot_deal_id && !l.hubspot_contact_id);

        let resolvedMap = {}; // dealId → contactId
        if (leadsNeedingLookup.length > 0) {
          resolvedMap = await batchGetContactIdsByDealIds(leadsNeedingLookup.map((l) => l.hubspot_deal_id));
          // Persist resolved contact IDs so we don't need to look them up again
          await Promise.allSettled(
            leadsNeedingLookup
              .filter((l) => resolvedMap[l.hubspot_deal_id])
              .map((l) => supabase.from('leads')
                .update({ hubspot_contact_id: resolvedMap[l.hubspot_deal_id] })
                .eq('id', l.id))
          );
          // Attach resolved IDs to the in-memory objects so enriched map can use them
          for (const l of leadsNeedingLookup) {
            if (resolvedMap[l.hubspot_deal_id]) l.hubspot_contact_id = resolvedMap[l.hubspot_deal_id];
          }
        }

        const allContactIds = [
          ...leadsWithContact.map((l) => l.hubspot_contact_id),
          ...Object.values(resolvedMap),
        ].filter(Boolean);

        if (allContactIds.length > 0) {
          contactProps = await batchGetContactProperties(allContactIds);
        }
      } catch (contactErr) {
        console.error('[admin-leads] Contact sync error (non-fatal):', contactErr.message);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const enriched = data.map((lead) => {
      const hs = lead.hubspot_deal_id ? (hsStages[lead.hubspot_deal_id] ?? null) : null;
      // Overlay live HubSpot contact data onto fields so admin always sees current values
      const freshContact = lead.hubspot_contact_id ? (contactProps[lead.hubspot_contact_id] ?? null) : null;
      return {
        ...lead,
        fields: freshContact ? { ...lead.fields, ...freshContact } : lead.fields,
        hs_stage_label: hs?.stageLabel ?? null,
        hs_stage_id:    hs?.stageId   ?? null,
        hs_stage_date:  hs?.stageDate ?? null,
        hs_last_activity_date: hs?.lastActivityDate ?? null,
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

    // Batch-sync HubSpot stages back to Supabase so the DB mirrors current pipeline state.
    // Awaited so Vercel doesn't terminate the function before the writes complete.
    const toSync = enriched.filter((l) => l.id && l.hs_stage_id);
    if (toSync.length > 0) {
      await Promise.allSettled(
        toSync.map((l) =>
          supabase.from('leads').update({
            hs_stage_id:    l.hs_stage_id,
            hs_stage_label: l.hs_stage_label ?? null,
          }).eq('id', l.id)
        )
      );
    }

    // Discover deals created directly in HubSpot (not via a web form) and
    // persist any new ones into Supabase as normal leads — same shape a form
    // submission gets (lead-submit.js). Once persisted they're picked up by
    // the plain Supabase query above on every future load, so this scan
    // itself only needs to run occasionally, not on every request.
    //
    // Staff are instructed to create leads only through the admin's Add Lead
    // form, so a HubSpot-direct deal should be rare — this is a safety net,
    // not the expected path. Throttled to once/24h via admin_settings
    // (rather than running on every 30s Leads-view poll) because
    // getAllPipelineDeals() re-fetches and reconstitutes the entire pipeline
    // (deal search + stage history + contact associations), which is
    // expensive enough that running it every 30s was a major driver of the
    // project going over Vercel's Hobby-tier Active CPU quota.
    let newlyDiscovered = [];
    if (process.env.HUBSPOT_ACCESS_TOKEN) {
      try {
        const DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;
        const { data: lastRunRow } = await supabase
          .from('admin_settings')
          .select('value')
          .eq('key', 'hubspot_discovery_last_run')
          .maybeSingle();
        const lastRun = lastRunRow?.value ? new Date(lastRunRow.value).getTime() : 0;

        if (Date.now() - lastRun > DISCOVERY_INTERVAL_MS) {
          const allHsDeals = await getAllPipelineDeals();
          const supabaseDealIds = new Set(data.map((l) => l.hubspot_deal_id).filter(Boolean));
          const newDeals = allHsDeals.filter((d) => !supabaseDealIds.has(d.hubspot_deal_id));

          if (newDeals.length > 0) {
            const toInsert = newDeals.map((d) => ({
              form_type: 'hubspot_direct',
              // leadSource marks these non-'Website' so the marketing-stats
              // web-source filter (PerformanceView) correctly excludes them.
              fields: { ...d.fields, leadSource: 'HubSpot (Direct)' },
              status: 'new',
              hubspot_deal_id: d.hubspot_deal_id,
              hubspot_contact_id: d.hubspot_contact_id,
              hs_stage_id: d.hs_stage_id,
              hs_stage_label: d.hs_stage_label,
              lost_reason: d.lost_reason,
              lost_reason_detail: d.lost_reason_detail,
              declined_reason: d.declined_reason,
              declined_reason_detail: d.declined_reason_detail,
              created_at: d.created_at,
            }));
            const { data: inserted, error: insErr } = await supabase
              .from('leads')
              .insert(toInsert)
              .select();
            if (insErr) {
              console.error('[admin-leads] Failed to persist HubSpot-direct deal(s) (non-fatal):', insErr.message);
            } else {
              // hs_deal_url / stage-entry dates aren't stored columns — they're
              // recomputed live from HubSpot on every load like any other lead
              // (see the `enriched` map above). For this one response, carry
              // them over from the discovery data so the new lead renders
              // fully immediately instead of waiting for the next load.
              newlyDiscovered = (inserted ?? []).map((row) => {
                const src = newDeals.find((d) => d.hubspot_deal_id === row.hubspot_deal_id);
                return {
                  ...row,
                  hs_deal_url: src?.hs_deal_url ?? null,
                  hs_date_entered_new_request:   src?.hs_date_entered_new_request   ?? null,
                  hs_date_entered_qualified:     src?.hs_date_entered_qualified     ?? null,
                  hs_date_entered_quote_sent:    src?.hs_date_entered_quote_sent    ?? null,
                  hs_date_entered_contract_sent: src?.hs_date_entered_contract_sent ?? null,
                  hs_date_entered_closed_won:    src?.hs_date_entered_closed_won    ?? null,
                  hs_date_entered_closed_lost:   src?.hs_date_entered_closed_lost   ?? null,
                };
              });
              console.log(`[admin-leads] Persisted ${newlyDiscovered.length} HubSpot-direct deal(s) to Supabase`);
            }
          }

          await supabase.from('admin_settings').upsert(
            { key: 'hubspot_discovery_last_run', value: new Date().toISOString() },
            { onConflict: 'key' },
          );
        }
      } catch (hsErr) {
        console.error('[admin-leads] HubSpot discovery error (non-fatal):', hsErr.message);
      }
    }

    const combined = [...enriched, ...newlyDiscovered].sort(
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
