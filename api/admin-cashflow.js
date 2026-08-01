/* global process */
import { createClient } from '@supabase/supabase-js';
import { batchGetDealStages, getAllPipelineDeals } from './_lib/hubspot.js';
import { checkAuth } from './_lib/auth.js';

// ─── Financial Management: 3-stage payment schedule for Closed Won deals ──────
// Deliberately independent of admin-leads.js: reads from `leads` and HubSpot
// read-only, never writes back to either. Schedule rows live in their own
// table (`payment_schedule`, keyed by hubspot_deal_id + stage, no FK
// constraint) so nothing here can affect the Leads pipeline, stage sync, or
// HubSpot deal data.
//
// Stage terms mirror the Master Cabinetry Construction Agreement (Section
// 7.2–7.3): Initial Deposit 50%, Production Payment 45%, Final Payment 5%.
// Default percentages and estimated-date offsets are configurable in
// Settings > Financial (admin_settings key `payment_schedule_defaults`).
// Once a stage row exists for a deal, defaults are never applied again —
// est_date/amount become fully user-editable from that point on.

function supabaseClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const CLOSED_WON_STAGE_ID = 'closedwon';

const STAGE_ORDER = ['initial_deposit', 'production_payment', 'final_payment'];
const STAGE_LABELS = {
  initial_deposit: 'Initial Deposit',
  production_payment: 'Production Payment',
  final_payment: 'Final Payment',
};

const DEFAULT_SCHEDULE_SETTINGS = {
  initialDepositPct: 50,
  productionPaymentPct: 45,
  finalPaymentPct: 5,
  initialDepositDaysAfterClose: 3,
  productionPaymentWeeksAfterDeposit: 8,
  finalPaymentWeeksAfterProduction: 2,
};

function addDays(dateInput, days) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(d.getTime())) d.setTime(Date.now());
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

function dealDisplayName(lead) {
  const f = lead.fields ?? {};
  const contactName = [f.firstName, f.lastName].filter(Boolean).join(' ');
  const clientName  = [f.clientFirstName, f.clientLastName].filter(Boolean).join(' ');
  if (lead.form_type === 'trade-estimate' && clientName) return `${clientName} (${contactName || 'Unknown'})`;
  return contactName || f.dealName || '(no name)';
}

/** Compute the 3 default stage rows for a deal given its close date, contract amount, and settings. */
function computeDefaultStages(closedAt, contractAmount, s) {
  const depositDate    = addDays(closedAt, s.initialDepositDaysAfterClose);
  const productionDate = addDays(depositDate, (Number(s.productionPaymentWeeksAfterDeposit) || 0) * 7);
  const finalDate      = addDays(productionDate, (Number(s.finalPaymentWeeksAfterProduction) || 0) * 7);
  const pctAmount = (pct) => Math.round((Number(contractAmount) || 0) * (Number(pct) || 0)) / 100;
  return {
    initial_deposit:    { est_date: depositDate,    amount: pctAmount(s.initialDepositPct) },
    production_payment: { est_date: productionDate, amount: pctAmount(s.productionPaymentPct) },
    final_payment:      { est_date: finalDate,      amount: pctAmount(s.finalPaymentPct) },
  };
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });
  // No role check here on purpose — Financial is the one view every role
  // (staff, bookkeeper, super admin) is allowed to see.

  const supabase = supabaseClient();

  // ── GET — list Closed Won deals with their 3-stage payment schedule ────────
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

      if (deals.length === 0) return res.status(200).json({ deals: [] });

      // 4. Default settings for auto-generating missing stage rows
      const { data: settingsRows } = await supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'payment_schedule_defaults')
        .limit(1);
      const scheduleDefaults = { ...DEFAULT_SCHEDULE_SETTINGS, ...(settingsRows?.[0]?.value ?? {}) };

      // 5. Existing schedule rows for these deals
      const dealIds = deals.map((d) => d.hubspot_deal_id);
      const { data: existingRows, error: schedErr } = await supabase
        .from('payment_schedule')
        .select('*')
        .in('hubspot_deal_id', dealIds);
      if (schedErr) throw schedErr;

      const rowsByDeal = {};
      for (const row of existingRows ?? []) {
        (rowsByDeal[row.hubspot_deal_id] ??= {})[row.stage] = row;
      }

      // 6. Auto-create any missing stage rows (never overwrites an existing row —
      //    once a bookkeeper edits est_date/amount, it's theirs from then on)
      const toInsert = [];
      for (const d of deals) {
        const have = rowsByDeal[d.hubspot_deal_id] ?? {};
        const defaults = computeDefaultStages(d.closed_at, d.contract_amount, scheduleDefaults);
        for (const stage of STAGE_ORDER) {
          if (!have[stage]) {
            toInsert.push({
              hubspot_deal_id: d.hubspot_deal_id,
              stage,
              amount: defaults[stage].amount,
              est_date: defaults[stage].est_date,
            });
          }
        }
      }
      if (toInsert.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from('payment_schedule')
          .insert(toInsert)
          .select();
        if (insErr) {
          console.error('[admin-cashflow] Failed to auto-create schedule rows (non-fatal):', insErr.message);
        } else {
          for (const row of inserted ?? []) {
            (rowsByDeal[row.hubspot_deal_id] ??= {})[row.stage] = row;
          }
        }
      }

      // 7. Assemble response
      const result = deals.map((d) => {
        const have = rowsByDeal[d.hubspot_deal_id] ?? {};
        const stages = STAGE_ORDER.map((stage) => {
          const row = have[stage] ?? {};
          return {
            id: row.id ?? null,
            stage,
            label: STAGE_LABELS[stage],
            amount: Number(row.amount) || 0,
            est_date: row.est_date ?? null,
            invoice_date: row.invoice_date ?? null,
            paid_date: row.paid_date ?? null,
            note: row.note ?? '',
          };
        });
        const invoiced = stages.filter((s) => s.invoice_date).reduce((sum, s) => sum + s.amount, 0);
        const received = stages.filter((s) => s.paid_date).reduce((sum, s) => sum + s.amount, 0);
        return {
          ...d,
          stages,
          invoiced,
          received,
          balance: d.contract_amount - received,
        };
      }).sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));

      return res.status(200).json({ deals: result });
    } catch (err) {
      console.error('[admin-cashflow] GET error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — edit one stage row (amount, est_date, invoice_date, paid_date, note) ──
  if (req.method === 'PATCH') {
    const { id, amount, est_date, invoice_date, paid_date, note } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const update = { updated_at: new Date().toISOString() };
    if (amount !== undefined) {
      if (amount !== null && (Number.isNaN(Number(amount)) || Number(amount) < 0)) {
        return res.status(400).json({ error: 'Amount must be a non-negative number' });
      }
      update.amount = amount === null ? 0 : Number(amount);
    }
    if (est_date !== undefined)     update.est_date     = est_date || null;
    if (invoice_date !== undefined) update.invoice_date = invoice_date || null;
    if (paid_date !== undefined)    update.paid_date    = paid_date || null;
    if (note !== undefined)         update.note         = note || null;
    try {
      const { data, error } = await supabase
        .from('payment_schedule')
        .update(update)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ row: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
