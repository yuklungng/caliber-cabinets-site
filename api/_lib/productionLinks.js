/**
 * Linking Production jobs to HubSpot deals (and through the deal, to its QuickBooks invoice and payment
 * status in Financial Management). Pure functions; the reads and the one write live in production.js.
 *
 * How a job gets its deal:
 *   - linked:    a confirmed row in dev_job_links (system 'hubspot_deal').
 *   - suggested: the job number is a QuickBooks invoice number that Financial Management has already
 *                attached to a deal (payment_schedule.qb_invoice_number), and nobody has said "not this one".
 *   - unlinked:  everything else. Old jobs from before the portal mostly stay here, and that is fine.
 * Nothing is linked without a person confirming it; a suggestion is only a suggestion.
 *
 * Payment status is shown as stage labels only (Paid / Partially Paid / Invoiced / Pending, the same
 * rules as Financial Management). No amounts, so the Production screen never becomes a money screen.
 */

export const DEAL_SYSTEM = 'hubspot_deal';

const STAGE_LABELS = { initial_deposit: 'Initial Deposit', production_payment: 'Production Payment', final_payment: 'Final Payment' };
const STAGE_ORDER = ['initial_deposit', 'production_payment', 'final_payment'];

/** Same rules as stagePaymentStatus in AdminPage.jsx (FinancialView). */
export function stageStatus(row) {
  if (row.paid_date) return 'Paid';
  if (Number(row.qb_paid_amount) > 0) return 'Partially Paid';
  if (row.invoice_date) return 'Invoiced';
  return 'Pending';
}

const groupKey = (dealId, room) => `${dealId}|${room ?? ''}`;

/**
 * payment_schedule rows -> Map of `${deal}|${room}` -> { dealId, room, invoiceNumber, stages }.
 * One deal can have several room groups, each with its own invoice.
 */
export function scheduleGroups(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.hubspot_deal_id) continue;
    const key = groupKey(r.hubspot_deal_id, r.room);
    let g = groups.get(key);
    if (!g) {
      g = { dealId: r.hubspot_deal_id, room: r.room ?? null, invoiceNumber: null, stages: [] };
      groups.set(key, g);
    }
    if (r.qb_invoice_number && !g.invoiceNumber) g.invoiceNumber = String(r.qb_invoice_number);
    g.stages.push({ stage: r.stage, label: STAGE_LABELS[r.stage] ?? r.label ?? r.stage, status: stageStatus(r) });
  }
  for (const g of groups.values()) {
    g.stages.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  }
  return groups;
}

/** Invoice number -> group, for the "matched by invoice number" suggestions. */
export function groupsByInvoice(groups) {
  const m = new Map();
  for (const g of groups.values()) if (g.invoiceNumber) m.set(g.invoiceNumber, g);
  return m;
}

const jobNumberOf = (job) => (job.isTemp ? null : String(job.jobRef).replace(/^#/, ''));

/**
 * The link shown on each job. jobs: buildJobList output. links: dev_job_links rows.
 * names: Map dealId -> display name. Returns Map jobRef -> link.
 */
export function resolveLinks(jobs, { links, groups, names = new Map() }) {
  const byInvoice = groupsByInvoice(groups);
  const rowsByRef = new Map();
  for (const l of links) {
    if (l.system !== DEAL_SYSTEM) continue;
    const list = rowsByRef.get(l.job_ref);
    if (list) list.push(l); else rowsByRef.set(l.job_ref, [l]);
  }
  const describe = (dealId, room) => {
    const g = groups.get(groupKey(dealId, room))
      // A link made before the deal had a room split still finds the deal's only group.
      ?? (room == null ? [...groups.values()].find((x) => x.dealId === dealId) : null);
    return {
      dealId,
      room: room ?? null,
      name: names.get(dealId) ?? null,
      invoiceNumber: g?.invoiceNumber ?? null,
      stages: g?.stages ?? [],
    };
  };

  const out = new Map();
  for (const job of jobs) {
    const rows = rowsByRef.get(job.jobRef) ?? [];
    const confirmed = rows.filter((r) => r.status === 'confirmed')
      .sort((a, b) => String(b.decided_at ?? '').localeCompare(String(a.decided_at ?? '')))[0];
    if (confirmed) {
      out.set(job.jobRef, {
        state: 'linked', ...describe(confirmed.external_id, confirmed.room),
        basis: confirmed.basis ?? null, decidedBy: confirmed.decided_by ?? null, decidedAt: confirmed.decided_at ?? null,
      });
      continue;
    }
    const num = jobNumberOf(job);
    const g = num ? byInvoice.get(num) : null;
    const rejected = g && rows.some((r) => r.status === 'rejected' && r.external_id === g.dealId);
    if (g && !rejected) {
      out.set(job.jobRef, { state: 'suggested', ...describe(g.dealId, g.room), basis: 'invoice number' });
      continue;
    }
    out.set(job.jobRef, { state: 'unlinked' });
  }
  return out;
}

/** Deal ids the job list needs names for. */
export function dealIdsToName(linkMap) {
  return [...new Set([...linkMap.values()].map((l) => l.dealId).filter(Boolean))];
}

/**
 * Picker options: closed-won deals (from HubSpot), newest first, one option per deal with the invoice numbers
 * of its room groups (so the picker can be searched by any of them). A job links to the whole deal; which of its
 * invoices belong to the job is kept in dev_job_invoices.
 */
export function candidateOptions(deals, groups) {
  const groupsByDeal = new Map();
  for (const g of groups.values()) {
    const list = groupsByDeal.get(g.dealId);
    if (list) list.push(g); else groupsByDeal.set(g.dealId, [g]);
  }
  return [...deals].sort((a, b) => String(b.closed_at ?? '').localeCompare(String(a.closed_at ?? ''))).map((d) => {
    const gs = [...(groupsByDeal.get(d.hubspot_deal_id) ?? [])].sort((a, b) => (a.room ?? '').localeCompare(b.room ?? ''));
    return {
      dealId: d.hubspot_deal_id,
      name: d.name,
      room: null,
      rooms: gs.map((g) => g.room).filter(Boolean),
      invoiceNumbers: gs.map((g) => g.invoiceNumber).filter(Boolean),
      closedAt: d.closed_at ?? null,
    };
  });
}

// ---- Several invoices per job (dev_job_invoices) ----------------------------------------------------------------
//
// A split-room job (one PO, one delivery and install) has an invoice per room plus any change orders. One of them is
// the primary: the number the job is known by. A job with no rows in dev_job_invoices has one invoice, its own sheet
// number. The office adds the others; nothing is added automatically.

export const INVOICE_SOURCES = ['sheet', 'deal', 'manual'];

const liveInvoiceRows = (rows) => (rows ?? []).filter((r) => !r.removed_at);

/**
 * Secondary invoice refs that roll up into another job: Map '#1235' -> '#1234'. Install, hardware and other rows the
 * sheets file under '#1235' then show on the '#1234' job. A number that is itself a live job's ref is never redirected
 * (that sheet row stays its own job).
 */
export function invoiceAliases(rows, jobRefs) {
  const m = new Map();
  for (const r of liveInvoiceRows(rows)) {
    const ref = `#${r.invoice_number}`;
    if (ref === r.job_ref || jobRefs.has(ref)) continue;
    m.set(ref, r.job_ref);
  }
  return m;
}

/**
 * One status per payment stage over several invoices. Labels only, no amounts:
 * all Paid -> Paid; any Paid or Partially Paid -> Partially Paid; any Invoiced -> Invoiced; else Pending.
 */
export function rollupStages(stageLists) {
  const byStage = new Map();
  for (const list of stageLists) {
    for (const s of list ?? []) {
      const e = byStage.get(s.stage) ?? { stage: s.stage, label: s.label, statuses: [] };
      e.statuses.push(s.status);
      byStage.set(s.stage, e);
    }
  }
  const rank = (st) => (STAGE_ORDER.indexOf(st) < 0 ? 99 : STAGE_ORDER.indexOf(st));
  return [...byStage.values()].sort((a, b) => rank(a.stage) - rank(b.stage)).map(({ stage, label, statuses }) => {
    let status = 'Pending';
    if (statuses.every((x) => x === 'Paid')) status = 'Paid';
    else if (statuses.some((x) => x === 'Paid' || x === 'Partially Paid')) status = 'Partially Paid';
    else if (statuses.some((x) => x === 'Invoiced')) status = 'Invoiced';
    return { stage, label, status };
  });
}

/**
 * The invoices on each job, the payment stages rolled up over them, and, for a job linked to a deal, that deal's other
 * invoices the office could add (pre-ticked in the screen, saved only on confirm). An invoice already on another job,
 * or that is another live job's own number, is never suggested.
 * jobs: buildJobList output. invoiceRows: dev_job_invoices rows. linkMap: resolveLinks output. groups: scheduleGroups.
 * Returns Map jobRef -> { primary, invoices: [{ number, primary, source, room, inSchedule, stages }], payment, suggestions }.
 */
export function resolveInvoices(jobs, { invoiceRows = [], linkMap = new Map(), groups = new Map() }) {
  const byInvoice = groupsByInvoice(groups);
  const live = liveInvoiceRows(invoiceRows);
  const rowsByJob = new Map();
  for (const r of live) {
    const list = rowsByJob.get(r.job_ref);
    if (list) list.push(r); else rowsByJob.set(r.job_ref, [r]);
  }
  const taken = new Set(live.map((r) => String(r.invoice_number)));
  const jobNumbers = new Set(jobs.map(jobNumberOf).filter(Boolean));

  const out = new Map();
  for (const job of jobs) {
    const own = jobNumberOf(job);
    const rows = rowsByJob.get(job.jobRef);
    let list = rows
      ? rows.map((r) => ({ number: String(r.invoice_number), primary: !!r.is_primary, source: r.source, addedBy: r.added_by ?? null, addedAt: r.added_at ?? null }))
      : (own ? [{ number: own, primary: true, source: 'sheet', addedBy: null, addedAt: null }] : []);
    if (list.length && !list.some((i) => i.primary)) {
      const fallback = list.find((i) => i.number === own) ?? list[0];
      list = list.map((i) => ({ ...i, primary: i === fallback }));
    }
    const invoices = list.map((i) => {
      const g = byInvoice.get(i.number);
      return { ...i, room: g?.room ?? null, inSchedule: !!g, stages: g?.stages ?? [] };
    }).sort((a, b) => (b.primary - a.primary) || a.number.localeCompare(b.number, undefined, { numeric: true }));

    const link = linkMap.get(job.jobRef);
    const onJob = new Set(invoices.map((i) => i.number));
    const suggestions = link?.state === 'linked'
      ? [...groups.values()]
        .filter((g) => g.dealId === link.dealId && g.invoiceNumber && !onJob.has(g.invoiceNumber)
          && !taken.has(g.invoiceNumber) && !(jobNumbers.has(g.invoiceNumber) && g.invoiceNumber !== own))
        .map((g) => ({ number: g.invoiceNumber, room: g.room }))
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
      : [];

    out.set(job.jobRef, {
      primary: invoices.find((i) => i.primary)?.number ?? null,
      invoices,
      payment: rollupStages(invoices.map((i) => i.stages)),
      suggestions,
    });
  }
  return out;
}

/** Validates an invoice-edit request body. Throws with a message for the person on bad input. */
export function cleanInvoiceEdit(body) {
  const op = String(body?.op ?? '');
  if (!['add', 'remove', 'primary'].includes(op)) throw new Error('op must be add, remove or primary');
  const jobRef = String(body?.jobRef ?? '').trim();
  if (!jobRef || jobRef.length > 200) throw new Error('jobRef is required');
  const clean = (v) => String(v ?? '').trim().replace(/^#/, '');
  const raw = op === 'add' ? (Array.isArray(body?.numbers) ? body.numbers : [body?.number]) : [body?.number];
  const numbers = [...new Set(raw.map(clean))];
  if (!numbers.length || numbers.length > 20 || numbers.some((n) => !/^\d{1,12}$/.test(n))) {
    throw new Error('Invoice numbers are digits only, e.g. 1235');
  }
  const source = op === 'add' && body?.source === 'deal' ? 'deal' : 'manual';
  return { op, jobRef, numbers, source };
}

/** Validates a link-decide request body. Throws with a message for the person on bad input. */
export function cleanDecision(body) {
  const decision = String(body?.decision ?? '');
  if (!['confirm', 'reject', 'unlink'].includes(decision)) throw new Error('decision must be confirm, reject or unlink');
  const jobRef = String(body?.jobRef ?? '').trim();
  if (!jobRef || jobRef.length > 200) throw new Error('jobRef is required');
  const dealId = String(body?.dealId ?? '').trim();
  if (!/^\d{1,20}$/.test(dealId)) throw new Error('dealId must be a HubSpot deal id');
  const roomRaw = body?.room == null ? null : String(body.room).trim();
  const room = roomRaw ? roomRaw.slice(0, 200) : null;
  const basis = ['invoice number', 'manual'].includes(body?.basis) ? body.basis : 'manual';
  return { decision, jobRef, dealId, room, basis };
}
