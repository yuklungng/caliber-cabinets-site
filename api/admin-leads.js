/* global process */
import { createClient } from '@supabase/supabase-js';
import { batchGetDealStages } from './hubspot.js';
import { checkAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

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
        hs_stage_id: hs?.stageId ?? null,
        hs_stage_date: hs?.stageDate ?? null,
        hs_deal_url: hs?.dealUrl ?? null,
      };
    });

    return res.status(200).json({ leads: enriched });
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
