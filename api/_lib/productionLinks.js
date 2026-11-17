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
 * Picker options: closed-won deals (from HubSpot) with their room groups, newest first.
 * deals: [{ hubspot_deal_id, name, closed_at }]. One option per room group; a deal with no schedule yet
 * is one option with no room.
 */
export function candidateOptions(deals, groups) {
  const groupsByDeal = new Map();
  for (const g of groups.values()) {
    const list = groupsByDeal.get(g.dealId);
    if (list) list.push(g); else groupsByDeal.set(g.dealId, [g]);
  }
  const out = [];
  for (const d of [...deals].sort((a, b) => String(b.closed_at ?? '').localeCompare(String(a.closed_at ?? '')))) {
    const gs = groupsByDeal.get(d.hubspot_deal_id) ?? [];
    if (gs.length === 0) {
      out.push({ dealId: d.hubspot_deal_id, name: d.name, room: null, invoiceNumber: null, closedAt: d.closed_at ?? null });
      continue;
    }
    for (const g of [...gs].sort((a, b) => (a.room ?? '').localeCompare(b.room ?? ''))) {
      out.push({ dealId: d.hubspot_deal_id, name: d.name, room: g.room, invoiceNumber: g.invoiceNumber, closedAt: d.closed_at ?? null });
    }
  }
  return out;
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
