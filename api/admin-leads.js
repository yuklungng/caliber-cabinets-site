/* global process */
import { createClient } from '@supabase/supabase-js';
import { batchGetDealStages, getAllPipelineDeals, getPipelineStages, updateDealStage } from './hubspot.js';
import { checkAuth } from './_lib/auth.js';

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
    const { id, activities } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const { error } = await supabase.from('leads').update({ activities }).eq('id', id);
    if (error) {
      console.error('[admin-leads] activities update error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ success: true });
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
