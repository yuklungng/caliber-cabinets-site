/* global process */
import { createClient } from '@supabase/supabase-js';
import { batchGetDealStages, createDealNote, getAllPipelineDeals } from './_lib/hubspot.js';
import { checkAuth } from './_lib/auth.js';
import { startConnect, completeConnect, getConnectionStatus, disconnect as qbDisconnect, qbQuery, qbGetInvoice, qbGetPaymentsForCustomer } from './_lib/quickbooks.js';

// QuickBooks connection actions (qb-status/qb-connect/qb-disconnect) and the
// OAuth callback (?qbcallback=1) live in this file rather than their own
// api/admin-quickbooks*.js files — Vercel Hobby caps a deployment at 12
// Serverless Functions, and this project is already at that ceiling. Folding
// QuickBooks in here follows the same pattern as admin-backup.js already
// combining JSON snapshots and git/SQL dumps into one function. It also fits
// thematically: QuickBooks exists to reconcile against this file's own
// payment_schedule data.

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

// QBO's query language embeds string literals directly in the query string
// (no parameterization), so single quotes must be doubled per SQL convention.
function qbEscape(s) {
  return String(s).replace(/'/g, "''");
}

// Brianna's mental model: one QuickBooks invoice per deal, or per room/split
// once a deal has been split — never one invoice per stage. So every action
// below operates on the whole group of stage rows sharing a
// (hubspot_deal_id, room) pair, not a single row id.
function scopeToRoomGroup(query, room) {
  return room ? query.eq('room', room) : query.is('room', null);
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

function formatNoteDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  if (!y) return null;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Compute the display label for a schedule row from its stage + optional room split. */
function stageLabel(stage, room) {
  const base = STAGE_LABELS[stage] ?? stage;
  return room ? `${room} — ${base}` : base;
}

/** Build a HubSpot deal note summarizing an invoice_date/paid_date change on a schedule row. Returns null if neither changed. */
function buildScheduleActivityNote(oldRow, newRow) {
  const lines = [];
  const label = newRow.label ?? stageLabel(newRow.stage, newRow.room);
  const amountStr = `$${(Number(newRow.amount) || 0).toLocaleString('en-US')}`;
  if (oldRow.invoice_date !== newRow.invoice_date) {
    lines.push(newRow.invoice_date
      ? `🧾 ${label} (${amountStr}) invoiced on ${formatNoteDate(newRow.invoice_date)}.`
      : `🧾 ${label} invoice date cleared.`);
  }
  if (oldRow.paid_date !== newRow.paid_date) {
    lines.push(newRow.paid_date
      ? `✅ ${label} (${amountStr}) marked paid on ${formatNoteDate(newRow.paid_date)}.`
      : `✅ ${label} paid date cleared.`);
  }
  return lines.length > 0 ? `Financial Management update:\n${lines.join('\n')}` : null;
}

/**
 * QBO is the source of truth once a deal/room group is linked to an invoice.
 * Pulls the invoice's total + date and every Payment applied against it, then
 * writes amount/invoice_date/paid_date back onto the group's stage rows.
 *
 * Amounts are rescaled proportionally so the stages still sum exactly to the
 * real invoice total, while preserving whatever split ratio was already set
 * (default 50/45/5, or a manual override) — or falling back to the
 * configured default percentages if the group has never been priced at all.
 *
 * Payments are allocated to stages in order (deposit → production → final)
 * via a running-threshold waterfall: a single invoice doesn't tell us which
 * specific stage a given payment was "for," but Brianna's actual billing
 * model is one invoice per split, paid down against those three milestones
 * in sequence (the customer can pay ahead of schedule, which this still
 * handles correctly — an early lump payment just clears multiple stages at
 * once, dated to whichever payment crossed each threshold).
 *
 * Throws on failure — callers decide whether that should surface to the user
 * (link/refresh) or just get logged and skipped (page-load auto-sync).
 */
async function syncRoomGroupFromQbo(supabase, { hubspot_deal_id, room, qb_invoice_id }) {
  const invoice = await qbGetInvoice(qb_invoice_id);
  if (!invoice) throw new Error('QuickBooks invoice not found — it may have been deleted.');

  const customerId = invoice.CustomerRef?.value;
  const payments = [];
  if (customerId) {
    const allPayments = await qbGetPaymentsForCustomer(customerId);
    for (const p of allPayments) {
      const matchingLines = (p.Line ?? []).filter((line) =>
        (line.LinkedTxn ?? []).some((lt) => lt.TxnId === invoice.Id && lt.TxnType === 'Invoice')
      );
      if (matchingLines.length === 0) continue;
      const amount = matchingLines.reduce((sum, l) => sum + (Number(l.Amount) || 0), 0);
      if (amount > 0) payments.push({ date: p.TxnDate, amount });
    }
    payments.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  const { data: rows, error: rowsErr } = await scopeToRoomGroup(
    supabase.from('payment_schedule').select('*').eq('hubspot_deal_id', hubspot_deal_id),
    room,
  );
  if (rowsErr) throw rowsErr;
  const orderedRows = (rows ?? []).slice().sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  if (orderedRows.length === 0) throw new Error('No payment schedule rows found for that deal/room.');

  const qbTotal = Number(invoice.TotalAmt) || 0;
  const currentTotal = orderedRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  let newAmounts;
  if (currentTotal > 0) {
    const ratio = qbTotal / currentTotal;
    newAmounts = orderedRows.map((r) => Math.round((Number(r.amount) || 0) * ratio * 100) / 100);
  } else {
    const { data: settingsRows } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'payment_schedule_defaults')
      .limit(1);
    const s = { ...DEFAULT_SCHEDULE_SETTINGS, ...(settingsRows?.[0]?.value ?? {}) };
    const pctByStage = {
      initial_deposit: s.initialDepositPct,
      production_payment: s.productionPaymentPct,
      final_payment: s.finalPaymentPct,
    };
    newAmounts = orderedRows.map((r) => Math.round(qbTotal * (Number(pctByStage[r.stage]) || 0)) / 100);
  }
  // Force the last row to absorb the rounding remainder so the stages still
  // sum to exactly qbTotal rather than drifting a cent or two.
  const roundedSum = newAmounts.slice(0, -1).reduce((sum, a) => sum + a, 0);
  newAmounts[newAmounts.length - 1] = Math.round((qbTotal - roundedSum) * 100) / 100;

  // Waterfall: cumulative payments against each stage's running threshold —
  // this decides paid_date (the stage is only "Paid" once fully covered).
  let cumulativeThreshold = 0;
  const paidDates = newAmounts.map((amt) => {
    cumulativeThreshold += amt;
    let running = 0;
    for (const p of payments) {
      running += p.amount;
      if (running >= cumulativeThreshold - 0.01) return p.date; // epsilon for float rounding
    }
    return null;
  });

  // Separately, allocate the REAL total received across stages in the same
  // nominal-amount order to get qb_paid_amount per stage — how much of THIS
  // stage's nominal amount has actually been collected. This agrees with
  // paid_date when payments land stage-by-stage, but diverges on an
  // overpayment: e.g. a deposit payment bigger than the deposit's nominal
  // amount. Without this, that overpayment was invisible (not credited
  // anywhere) until the NEXT stage's full threshold was ALSO crossed —
  // understating "Received" and overstating the forecast in the meantime.
  const totalReceived = payments.reduce((sum, p) => sum + p.amount, 0);
  let remainingReceived = totalReceived;
  const paidAmounts = newAmounts.map((amt) => {
    const covered = Math.max(0, Math.min(amt, remainingReceived));
    remainingReceived -= covered;
    return Math.round(covered * 100) / 100;
  });

  const invoiceDate = invoice.TxnDate ?? null;
  const syncedAt = new Date().toISOString();
  const updates = orderedRows.map((r, i) => ({
    id: r.id,
    amount: newAmounts[i],
    invoice_date: invoiceDate,
    paid_date: paidDates[i],
    qb_paid_amount: paidAmounts[i],
    qb_invoice_number: invoice.DocNumber ?? null,
    qb_total: qbTotal,
    qb_balance: Number(invoice.Balance) || 0,
    qb_synced_at: syncedAt,
  }));

  const results = await Promise.all(
    updates.map(({ id, ...patch }) =>
      supabase.from('payment_schedule').update(patch).eq('id', id).select().single()
    )
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
  return results.map((r) => r.data);
}

function dealDisplayName(lead) {
  const f = lead.fields ?? {};
  const contactName = [f.firstName, f.lastName].filter(Boolean).join(' ');
  const clientName  = [f.clientFirstName, f.clientLastName].filter(Boolean).join(' ');
  if (lead.form_type === 'trade-estimate' && clientName) return `${clientName} (${contactName || 'Unknown'})`;
  return contactName || f.dealName || '(no name)';
}

/** Compute the 3 default stage rows for a deal given its close date, contract amount, and settings.
 *  Initial Deposit is always invoiced the day the deal closes — Caliber sends that invoice
 *  immediately on signing, there's no separate "send invoice" step for it like the other two stages. */
function computeDefaultStages(closedAt, contractAmount, s) {
  const closedDateStr  = addDays(closedAt, 0); // normalize whatever closedAt format to YYYY-MM-DD
  const depositDate    = addDays(closedAt, s.initialDepositDaysAfterClose);
  const productionDate = addDays(depositDate, (Number(s.productionPaymentWeeksAfterDeposit) || 0) * 7);
  const finalDate      = addDays(productionDate, (Number(s.finalPaymentWeeksAfterProduction) || 0) * 7);
  const pctAmount = (pct) => Math.round((Number(contractAmount) || 0) * (Number(pct) || 0)) / 100;
  return {
    initial_deposit:    { est_date: depositDate,    amount: pctAmount(s.initialDepositPct),    invoice_date: closedDateStr },
    production_payment: { est_date: productionDate, amount: pctAmount(s.productionPaymentPct), invoice_date: null },
    final_payment:      { est_date: finalDate,      amount: pctAmount(s.finalPaymentPct),      invoice_date: null },
  };
}

/** Convert an array of flat objects to a CSV string. */
function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');
}

/** Build the full Closed Won deal list with each deal's 3-stage payment schedule, auto-creating any missing rows. */
async function getDealsWithSchedule(supabase, { syncQbo = false } = {}) {
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

  if (deals.length === 0) return [];

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

  // A deal can now have more than 3 rows (e.g. a room-by-room split), so this
  // groups by deal only — rowsByDeal[dealId] is an array, not one row per stage.
  const rowsByDeal = {};
  for (const row of existingRows ?? []) {
    (rowsByDeal[row.hubspot_deal_id] ??= []).push(row);
  }

  // 6. Auto-create the 3 default stage rows, but only for a deal that has NO
  //    schedule rows at all yet. This intentionally moved from a per-stage
  //    check to a per-deal one: once any row exists — whether auto-generated
  //    or a manually added room split — we never re-seed, so deleting a
  //    default row (e.g. to replace it with per-room rows) sticks.
  const toInsert = [];
  for (const d of deals) {
    if ((rowsByDeal[d.hubspot_deal_id] ?? []).length > 0) continue;
    const defaults = computeDefaultStages(d.closed_at, d.contract_amount, scheduleDefaults);
    STAGE_ORDER.forEach((stage, i) => {
      toInsert.push({
        hubspot_deal_id: d.hubspot_deal_id,
        stage,
        room: null,
        label: STAGE_LABELS[stage],
        sort_order: i,
        amount: defaults[stage].amount,
        est_date: defaults[stage].est_date,
        invoice_date: defaults[stage].invoice_date,
      });
    });
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
        (rowsByDeal[row.hubspot_deal_id] ??= []).push(row);
      }
    }
  }

  // 6.5. Backfill invoice_date on any Initial Deposit row(s) created before this
  //      rule existed — the deposit is always invoiced the day the deal closes.
  //      Handles every initial_deposit row per deal now (a room split could mean
  //      more than one). Never touches production_payment/final_payment (those
  //      really are invoiced manually) or any row that already has an invoice_date.
  const depositFixes = [];
  for (const d of deals) {
    const depositRows = (rowsByDeal[d.hubspot_deal_id] ?? []).filter((r) => r.stage === 'initial_deposit' && !r.invoice_date);
    for (const depositRow of depositRows) {
      const invoiceDate = addDays(d.closed_at, 0);
      depositFixes.push({ id: depositRow.id, invoice_date: invoiceDate });
      depositRow.invoice_date = invoiceDate; // keep in-memory copy in sync for step 7
    }
  }
  if (depositFixes.length > 0) {
    const results = await Promise.allSettled(
      depositFixes.map((fix) =>
        supabase.from('payment_schedule').update({ invoice_date: fix.invoice_date }).eq('id', fix.id)
      )
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) console.error(`[admin-cashflow] ${failed} deposit invoice_date backfill(s) failed (non-fatal)`);
  }

  // 6.75. Auto-refresh every QBO-linked room group from QuickBooks. Mike and
  //       Brianna should never be looking at stale invoice data just because
  //       nobody clicked Refresh — visiting the Financial Management page IS
  //       the refresh trigger (still page-visit-triggered/"on-demand", not a
  //       background poller, matching what was disclosed to Intuit's App
  //       Assessment Questionnaire).
  //
  //       Two throttles keep this from burning Vercel's Hobby-tier Active CPU
  //       budget (a 60s window let every page load re-hit QBO for every
  //       linked invoice, which ran the project over its monthly CPU
  //       allowance within days of going live):
  //         - `syncQbo` — only the Financial Management page passes this;
  //           the Performance dashboard also calls this endpoint but doesn't
  //           need invoice-level freshness, so it just reads whatever's
  //           already stored.
  //         - STALE_MS — a group only re-syncs once per 24h regardless of
  //           how many times the page is visited that day.
  //       Never let one group's failure (expired token, deleted invoice,
  //       etc.) block the page — it just falls back to the last-known values.
  if (syncQbo && process.env.QUICKBOOKS_CLIENT_ID) {
    const groups = new Map();
    for (const rowsForDeal of Object.values(rowsByDeal)) {
      for (const row of rowsForDeal) {
        if (!row.qb_invoice_id) continue;
        const key = `${row.hubspot_deal_id} ${row.room ?? ''}`;
        if (!groups.has(key)) {
          groups.set(key, { hubspot_deal_id: row.hubspot_deal_id, room: row.room ?? null, qb_invoice_id: row.qb_invoice_id, qb_synced_at: row.qb_synced_at });
        }
      }
    }
    const STALE_MS = 24 * 60 * 60 * 1000; // one auto-sync per group per day
    const now = Date.now();
    const toSync = [...groups.values()].filter((g) => !g.qb_synced_at || (now - new Date(g.qb_synced_at).getTime()) > STALE_MS);
    if (toSync.length > 0) {
      const results = await Promise.allSettled(toSync.map((g) => syncRoomGroupFromQbo(supabase, g)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          for (const updatedRow of r.value) {
            const list = rowsByDeal[updatedRow.hubspot_deal_id] ?? [];
            const idx = list.findIndex((x) => x.id === updatedRow.id);
            if (idx !== -1) list[idx] = updatedRow;
          }
        } else {
          console.error(`[admin-cashflow] QBO auto-sync failed for deal ${toSync[i].hubspot_deal_id} room ${toSync[i].room ?? '(default)'} (non-fatal):`, r.reason?.message);
        }
      });
    }
  }

  // 7. Assemble result — rows ordered by stage (deposit → production → final),
  //    then alphabetically by room within the same stage.
  return deals.map((d) => {
    const rows = (rowsByDeal[d.hubspot_deal_id] ?? []).slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.room ?? '').localeCompare(b.room ?? ''));
    const stages = rows.map((row) => ({
      id: row.id,
      stage: row.stage,
      room: row.room ?? null,
      label: row.label ?? stageLabel(row.stage, row.room),
      amount: Number(row.amount) || 0,
      est_date: row.est_date ?? null,
      invoice_date: row.invoice_date ?? null,
      paid_date: row.paid_date ?? null,
      note: row.note ?? '',
      // One QBO invoice per deal/room group — identical across every stage
      // row in that group (see the migration note on payment_schedule).
      qb_invoice_id: row.qb_invoice_id ?? null,
      qb_invoice_number: row.qb_invoice_number ?? null,
      qb_total: row.qb_total != null ? Number(row.qb_total) : null,
      qb_balance: row.qb_balance != null ? Number(row.qb_balance) : null,
      qb_paid_amount: row.qb_paid_amount != null ? Number(row.qb_paid_amount) : null,
      qb_synced_at: row.qb_synced_at ?? null,
    }));
    const invoiced = stages.filter((s) => s.invoice_date).reduce((sum, s) => sum + s.amount, 0);
    // Credit qb_paid_amount (the real, waterfall-allocated received portion)
    // when present — falls back to the old paid_date/nominal-amount logic
    // for rows never synced from QBO, where `amount` already IS the real
    // amount (manually typed in when marking the row paid).
    const received = stages.reduce((sum, s) => {
      if (s.qb_paid_amount != null) return sum + s.qb_paid_amount;
      return sum + (s.paid_date ? s.amount : 0);
    }, 0);
    return {
      ...d,
      stages,
      invoiced,
      received,
      balance: d.contract_amount - received,
    };
  }).sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
}

export default async function handler(req, res) {
  // ── QuickBooks OAuth callback — Intuit redirects the admin's browser here
  // directly after consent, so this can't carry our Bearer session token.
  // Must run before checkAuth. CSRF protection comes from the `state` param
  // (generated + persisted by qb-connect below, verified inside
  // completeConnect) rather than our normal session auth.
  if (req.method === 'GET' && req.query?.qbcallback === '1') {
    const { code, state, realmId, error } = req.query;
    const adminUrl = `${process.env.SITE_URL}/admin`;
    if (error) {
      return res.redirect(302, `${adminUrl}?qb=error&msg=${encodeURIComponent(error)}`);
    }
    if (!code || !state || !realmId) {
      return res.redirect(302, `${adminUrl}?qb=error&msg=${encodeURIComponent('Missing code/state/realmId from QuickBooks redirect.')}`);
    }
    try {
      await completeConnect({ code, state, realmId });
      return res.redirect(302, `${adminUrl}?qb=connected`);
    } catch (err) {
      return res.redirect(302, `${adminUrl}?qb=error&msg=${encodeURIComponent(err.message)}`);
    }
  }

  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });
  // No role check here on purpose — Financial is the one view every role
  // (staff, bookkeeper, super admin) is allowed to see.

  const supabase = supabaseClient();
  const action = req.query?.action;

  // ── QuickBooks connection management — super-admin only, since connecting/
  // disconnecting is an account-level action ──────────────────────────────
  if (req.method === 'GET' && action === 'qb-status') {
    if (!auth.isSuperAdmin) return res.status(403).json({ error: 'Super admin required' });
    try {
      return res.status(200).json(await getConnectionStatus());
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  if (req.method === 'POST' && action === 'qb-connect') {
    if (!auth.isSuperAdmin) return res.status(403).json({ error: 'Super admin required' });
    try {
      const authorizeUrl = await startConnect();
      return res.status(200).json({ authorizeUrl });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  if (req.method === 'POST' && action === 'qb-disconnect') {
    if (!auth.isSuperAdmin) return res.status(403).json({ error: 'Super admin required' });
    try {
      await qbDisconnect();
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── QuickBooks invoice linking — open to every Financial-view role (not just
  // super admin), since this is Brianna's day-to-day bookkeeping task, not an
  // account-level connection change. One invoice per deal/room group; see
  // scopeToRoomGroup above. ──────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'qb-search-invoices') {
    const q = (req.query?.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'Missing search query' });
    try {
      const esc = qbEscape(q);
      const [byDocNumber, matchingCustomers] = await Promise.all([
        qbQuery(`SELECT * FROM Invoice WHERE DocNumber LIKE '%${esc}%' ORDERBY TxnDate DESC MAXRESULTS 20`, 'Invoice'),
        qbQuery(`SELECT * FROM Customer WHERE DisplayName LIKE '%${esc}%' MAXRESULTS 10`, 'Customer'),
      ]);
      let byCustomer = [];
      if (matchingCustomers.length > 0) {
        const perCustomer = await Promise.all(
          matchingCustomers.map((c) =>
            qbQuery(`SELECT * FROM Invoice WHERE CustomerRef = '${c.Id}' ORDERBY TxnDate DESC MAXRESULTS 20`, 'Invoice')
          )
        );
        byCustomer = perCustomer.flat();
      }
      const merged = new Map();
      for (const inv of [...byDocNumber, ...byCustomer]) merged.set(inv.Id, inv);
      const invoices = [...merged.values()]
        .sort((a, b) => new Date(b.TxnDate || 0) - new Date(a.TxnDate || 0))
        .slice(0, 25)
        .map((inv) => ({
          id: inv.Id,
          docNumber: inv.DocNumber ?? null,
          customerName: inv.CustomerRef?.name ?? null,
          txnDate: inv.TxnDate ?? null,
          totalAmt: inv.TotalAmt ?? 0,
          balance: inv.Balance ?? 0,
        }));
      return res.status(200).json({ invoices });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'link-invoice') {
    const { hubspot_deal_id, room, qb_invoice_id } = req.body ?? {};
    if (!hubspot_deal_id) return res.status(400).json({ error: 'Missing hubspot_deal_id' });
    if (!qb_invoice_id) return res.status(400).json({ error: 'Missing qb_invoice_id' });
    try {
      // Snapshot each row's current amount/invoice_date/paid_date into
      // pre_qb_* columns BEFORE the sync below overwrites them, so
      // unlink-invoice can restore exactly what was there rather than
      // guessing or blanking to zero. Also stamps qb_invoice_id in this same
      // per-row write so the group is marked "linked" even if the fuller
      // sync below throws partway through (e.g. a transient QBO error) —
      // the user can retry via Refresh instead of losing the link entirely.
      const { data: preLinkRows, error: preLinkErr } = await scopeToRoomGroup(
        supabase.from('payment_schedule').select('id, amount, invoice_date, paid_date').eq('hubspot_deal_id', hubspot_deal_id),
        room,
      );
      if (preLinkErr) throw preLinkErr;
      const stampResults = await Promise.all((preLinkRows ?? []).map((r) =>
        supabase.from('payment_schedule').update({
          pre_qb_amount: r.amount,
          pre_qb_invoice_date: r.invoice_date,
          pre_qb_paid_date: r.paid_date,
          qb_invoice_id,
        }).eq('id', r.id)
      ));
      const stampErr = stampResults.find((r) => r.error)?.error;
      if (stampErr) throw stampErr;

      const rows = await syncRoomGroupFromQbo(supabase, { hubspot_deal_id, room, qb_invoice_id });
      return res.status(200).json({ rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'unlink-invoice') {
    const { hubspot_deal_id, room } = req.body ?? {};
    if (!hubspot_deal_id) return res.status(400).json({ error: 'Missing hubspot_deal_id' });
    try {
      // Restore each row's pre-link snapshot (captured in link-invoice)
      // instead of blanking to 0/null — those fields were overwritten from
      // QBO while linked (that's the whole point of the lock), so leaving
      // them in place after unlinking (e.g. linked to the wrong invoice by
      // mistake) would silently keep wrong numbers around as regular,
      // now-editable values. Falls back to 0/null only for rows linked
      // before this snapshot existed (no pre_qb_* data to restore from).
      const { data: rowsToRestore, error: lookupErr } = await scopeToRoomGroup(
        supabase.from('payment_schedule').select('id, pre_qb_amount, pre_qb_invoice_date, pre_qb_paid_date').eq('hubspot_deal_id', hubspot_deal_id),
        room,
      );
      if (lookupErr) throw lookupErr;

      const restored = await Promise.all((rowsToRestore ?? []).map(async (r) => {
        const { data, error } = await supabase.from('payment_schedule').update({
          qb_invoice_id: null, qb_invoice_number: null, qb_total: null, qb_balance: null, qb_synced_at: null,
          amount: r.pre_qb_amount ?? 0,
          invoice_date: r.pre_qb_invoice_date ?? null,
          paid_date: r.pre_qb_paid_date ?? null,
          pre_qb_amount: null, pre_qb_invoice_date: null, pre_qb_paid_date: null,
        }).eq('id', r.id).select().single();
        if (error) throw error;
        return data;
      }));
      return res.status(200).json({ rows: restored });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'qb-refresh-invoice') {
    const { hubspot_deal_id, room } = req.body ?? {};
    if (!hubspot_deal_id) return res.status(400).json({ error: 'Missing hubspot_deal_id' });
    try {
      const { data: existing, error: lookupErr } = await scopeToRoomGroup(
        supabase.from('payment_schedule').select('qb_invoice_id').eq('hubspot_deal_id', hubspot_deal_id).not('qb_invoice_id', 'is', null).limit(1),
        room,
      ).maybeSingle();
      if (lookupErr) throw lookupErr;
      if (!existing?.qb_invoice_id) return res.status(400).json({ error: 'No linked invoice to refresh' });

      const rows = await syncRoomGroupFromQbo(supabase, { hubspot_deal_id, room, qb_invoice_id: existing.qb_invoice_id });
      return res.status(200).json({ rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET ?action=export-csv — one row per stage, across all Closed Won deals ──
  if (req.method === 'GET' && action === 'export-csv') {
    try {
      const deals = await getDealsWithSchedule(supabase);
      const rows = [];
      for (const d of deals) {
        for (const s of d.stages) {
          rows.push({
            deal_name: d.name,
            contract_amount: d.contract_amount,
            closed_date: d.closed_at ? String(d.closed_at).slice(0, 10) : '',
            stage: s.label,
            amount: s.amount,
            paid_amount: s.qb_paid_amount ?? (s.paid_date ? s.amount : ''),
            est_date: s.est_date ?? '',
            invoice_date: s.invoice_date ?? '',
            paid_date: s.paid_date ?? '',
            status: s.paid_date ? 'Paid' : (s.qb_paid_amount > 0 ? 'Partially Paid' : (s.invoice_date ? 'Invoiced' : 'Pending')),
          });
        }
      }
      const csv = toCSV(rows);
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="caliber-financial-${date}.csv"`);
      return res.status(200).send(csv);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET — list Closed Won deals with their 3-stage payment schedule ────────
  if (req.method === 'GET') {
    try {
      // Only the Financial Management page (?syncQbo=1) triggers the QBO
      // auto-refresh — see the 6.75 comment in getDealsWithSchedule for why.
      const result = await getDealsWithSchedule(supabase, { syncQbo: req.query?.syncQbo === '1' });
      return res.status(200).json({ deals: result });
    } catch (err) {
      console.error('[admin-cashflow] GET error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ?action=add-room — split a deal's schedule with a whole new
  //    room/segment: its own Initial Deposit + Production Payment + Final
  //    Payment set, so Caliber can invoice a kitchen/bathroom/office etc.
  //    separately with its own timing. This is the primary way splits get
  //    created now — add-row below still exists for adding a single stray
  //    stage row, but the UI drives everything through add-room. ─────────
  if (req.method === 'POST' && action === 'add-room') {
    const { hubspot_deal_id, room } = req.body ?? {};
    if (!hubspot_deal_id) return res.status(400).json({ error: 'Missing hubspot_deal_id' });
    if (!room || !room.trim()) return res.status(400).json({ error: 'Room/split name is required' });
    try {
      const rows = STAGE_ORDER.map((stage, i) => ({
        hubspot_deal_id,
        stage,
        room: room.trim(),
        label: stageLabel(stage, room.trim()),
        sort_order: i,
        amount: 0,
        est_date: null,
      }));
      const { data, error } = await supabase.from('payment_schedule').insert(rows).select();
      if (error) throw error;
      return res.status(200).json({ rows: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ?action=add-row — split a deal's schedule with an extra invoice row
  //    (e.g. a second Initial Deposit/Production/Final set for a specific room) ──
  if (req.method === 'POST' && action === 'add-row') {
    const { hubspot_deal_id, stage, room, amount, est_date } = req.body ?? {};
    if (!hubspot_deal_id) return res.status(400).json({ error: 'Missing hubspot_deal_id' });
    if (!STAGE_ORDER.includes(stage)) return res.status(400).json({ error: `stage must be one of ${STAGE_ORDER.join(', ')}` });
    try {
      const { data, error } = await supabase
        .from('payment_schedule')
        .insert({
          hubspot_deal_id,
          stage,
          room: room || null,
          label: stageLabel(stage, room || null),
          sort_order: STAGE_ORDER.indexOf(stage),
          amount: Number(amount) || 0,
          est_date: est_date || null,
        })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ row: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ?action=delete-row — remove a single invoice row from a deal's schedule ──
  if (req.method === 'POST' && action === 'delete-row') {
    const { id } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const { error } = await supabase.from('payment_schedule').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ?action=delete-room — remove every row in a room/split at once.
  //    add-room creates all 3 stage rows in one step; this is the matching
  //    bulk delete so undoing a split doesn't mean deleting each row by hand. ──
  if (req.method === 'POST' && action === 'delete-room') {
    const { hubspot_deal_id, room } = req.body ?? {};
    if (!hubspot_deal_id) return res.status(400).json({ error: 'Missing hubspot_deal_id' });
    try {
      const { data, error } = await scopeToRoomGroup(
        supabase.from('payment_schedule').delete().eq('hubspot_deal_id', hubspot_deal_id),
        room,
      ).select('id');
      if (error) throw error;
      return res.status(200).json({ ok: true, deletedIds: (data ?? []).map((r) => r.id) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — edit one stage row (amount, est_date, invoice_date, paid_date, note, room) ──
  if (req.method === 'PATCH') {
    const { id, amount, est_date, invoice_date, paid_date, note, room } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      // Fetch the pre-update row first — needed both to guard fields that are
      // now synced from QuickBooks, and (below) to tell whether
      // invoice_date/paid_date actually changed (not just resubmitted)
      // before logging a HubSpot note, and so a room-only edit can recompute
      // label from the row's own stage.
      const { data: before, error: beforeErr } = await supabase
        .from('payment_schedule')
        .select('*')
        .eq('id', id)
        .single();
      if (beforeErr) throw beforeErr;

      // Once a deal/room group is linked to a QuickBooks invoice, QBO owns
      // amount/invoice_date/paid_date — locked in the UI, and guarded here
      // too rather than relying on the UI alone.
      if (before?.qb_invoice_id && (amount !== undefined || invoice_date !== undefined || paid_date !== undefined)) {
        return res.status(400).json({ error: 'Amount, Invoice Date, and Paid Date are synced from QuickBooks for this row — unlink the invoice first to edit them manually.' });
      }

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
      if (room !== undefined) {
        update.room = room || null;
        update.label = stageLabel(before?.stage, room || null);
      }

      const { data, error } = await supabase
        .from('payment_schedule')
        .update(update)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      // Log a note on the HubSpot deal when invoice/paid date changed — this is
      // the one thing in Financial Management that's worth surfacing on the deal
      // itself, so sales/ops can see payment status without opening this panel.
      if (before && process.env.HUBSPOT_ACCESS_TOKEN && data.hubspot_deal_id) {
        const noteBody = buildScheduleActivityNote(before, data);
        if (noteBody) {
          try {
            await createDealNote(data.hubspot_deal_id, noteBody);
          } catch (noteErr) {
            console.error('[admin-cashflow] createDealNote error (non-fatal):', noteErr.message);
          }
        }
      }

      return res.status(200).json({ row: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
