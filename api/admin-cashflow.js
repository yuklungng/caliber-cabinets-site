/* global process */
import { createClient } from '@supabase/supabase-js';
import { batchGetDealStages, getAllPipelineDeals } from './_lib/hubspot.js';
import { checkAuth } from './_lib/auth.js';

// ─── Cashflow tracking for Closed Won deals ────────────────────────────────────
// Deliberately independent of admin-leads.js: reads from `leads` and HubSpot
// read-only, never writes back to either. Payments live in their own table
// (`deal_payments`, keyed by hubspot_deal_id, no FK constraint) so nothing here
// can affect the Leads pipeline, stage sync, or HubSpot deal data.

function supabaseClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const CLOSED_WON_STAGE_ID = 'closedwon';

function dealDisplayName(lead) {
  const f = lead.fields ?? {};
  const contactName = [f.firstName, f.lastName].filter(Boolean).join(' ');
  const clientName  = [f.clientFirstName, f.clientLastName].filter(Boolean).join(' ');
  if (lead.form_type === 'trade-estimate' && clientName) return `${clientName} (${contactName || 'Unknown'})`;
  return contactName || f.dealName || '(no name)';
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });
  // No role check here on purpose — Cashflow is the one view every role
  // (staff, bookkeeper, super admin) is allowed to see.

  const supabase = supabaseClient();

  // ── GET — list Closed Won deals enriched with payment totals ───────────────
  if (req.method === 'GET') {
    try {
      // 1. All Supabase leads linked to a HubSpot deal. hs_stage_id/label are the
      //    only stage columns Supabase actually has, and they're only refreshed
      //    when someone loads the Leads view — so they can be stale. We treat them
      //    as a fallback only; live HubSpot stage (fetched below) is authoritative.
      const { data: supabaseLeads, error } = await supabase
        .from('leads')
        .select('id, created_at, form_type, fields, hubspot_deal_id, hs_stage_id')
        .not('hubspot_deal_id', 'is', null);
      if (error) throw error;

      // 2. Live stage/date/URL for those deals straight from HubSpot (same helper
      //    admin-leads.js uses) — this is what actually determines Closed Won status.
      let hsStages = {};
      if (process.env.HUBSPOT_ACCESS_TOKEN && (supabaseLeads ?? []).length > 0) {
        try {
          const dealIds = (supabaseLeads ?? []).map((l) => l.hubspot_deal_id).filter(Boolean);
          hsStages = await batchGetDealStages(dealIds);
        } catch (hsErr) {
          console.error('[admin-cashflow] batchGetDealStages error (non-fatal):', hsErr.message);
        }
      }

      const closedWonSupabaseLeads = (supabaseLeads ?? []).filter((l) => {
        const liveStageId = hsStages[l.hubspot_deal_id]?.stageId ?? l.hs_stage_id;
        return liveStageId === CLOSED_WON_STAGE_ID;
      });

      // 3. HubSpot-only deals (no Supabase row at all) — reuses the existing, already-tested helper
      let hsOnlyDeals = [];
      if (process.env.HUBSPOT_ACCESS_TOKEN) {
        try {
          const allHsDeals = await getAllPipelineDeals();
          const supabaseDealIds = new Set((supabaseLeads ?? []).map((l) => l.hubspot_deal_id).filter(Boolean));
          hsOnlyDeals = allHsDeals.filter((d) => d.hs_stage_id === CLOSED_WON_STAGE_ID && !supabaseDealIds.has(d.hubspot_deal_id));
        } catch (hsErr) {
          console.error('[admin-cashflow] HubSpot fetch error (non-fatal):', hsErr.message);
        }
      }

      const deals = [
        ...closedWonSupabaseLeads.map((l) => {
          const hs = hsStages[l.hubspot_deal_id] ?? null;
          return {
            hubspot_deal_id: l.hubspot_deal_id,
            name: dealDisplayName(l),
            contract_amount: Number(l.fields?.quote_amount) || 0,
            closed_at: hs?.dateEnteredClosedWon ?? hs?.stageDate ?? l.created_at,
            hs_deal_url: hs?.dealUrl ?? null,
          };
        }),
        ...hsOnlyDeals.map((d) => ({
          hubspot_deal_id: d.hubspot_deal_id,
          name: dealDisplayName(d),
          contract_amount: Number(d.fields?.quote_amount) || 0,
          closed_at: d.hs_date_entered_closed_won ?? d.hs_stage_date ?? d.created_at,
          hs_deal_url: d.hs_deal_url ?? null,
        })),
      ];

      // 4. Payment totals per deal
      const dealIds = deals.map((d) => d.hubspot_deal_id);
      let payments = [];
      if (dealIds.length > 0) {
        const { data: pData, error: pErr } = await supabase
          .from('deal_payments')
          .select('*')
          .in('hubspot_deal_id', dealIds)
          .order('payment_date', { ascending: false });
        if (pErr) throw pErr;
        payments = pData ?? [];
      }

      const paymentsByDeal = {};
      for (const p of payments) {
        (paymentsByDeal[p.hubspot_deal_id] ??= []).push(p);
      }

      const result = deals.map((d) => {
        const list = paymentsByDeal[d.hubspot_deal_id] ?? [];
        const received = list.reduce((sum, p) => sum + Number(p.amount), 0);
        return {
          ...d,
          received,
          balance: d.contract_amount - received,
          payments: list,
        };
      }).sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));

      return res.status(200).json({ deals: result });
    } catch (err) {
      console.error('[admin-cashflow] GET error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST — log a payment ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { hubspot_deal_id, amount, payment_date, method, note } = req.body ?? {};
    if (!hubspot_deal_id || !amount || !payment_date) {
      return res.status(400).json({ error: 'hubspot_deal_id, amount, and payment_date are required' });
    }
    if (Number(amount) <= 0 || Number.isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Amount must be a number greater than zero' });
    }
    try {
      const created_by = auth.user?.name ?? auth.user?.email ?? 'Unknown';
      const { data, error } = await supabase
        .from('deal_payments')
        .insert({
          hubspot_deal_id,
          amount: Number(amount),
          payment_date,
          method: method || null,
          note: note || null,
          created_by,
        })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ payment: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE — remove a payment entry (correction) ────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const { error } = await supabase.from('deal_payments').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
