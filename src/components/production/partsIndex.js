// Pure helpers for the Parts tab: every hardware order across jobs, newest first, and a part search.
// Read-only. Input is the job list the Production screen already loads (no extra API call).
//
// The hardware sheet stopped recording received dates in 2021, so "not received" cannot be read as
// "still on order". The tab says "receipt not recorded" instead of guessing.

/**
 * One entry per hardware order, carrying its job. orphans: orders that match no job (from the API); they get
 * jobId null and their own label, so the screen shows them without a link.
 */
export function flattenOrders(jobs, orphans = []) {
  const out = [];
  for (const j of jobs ?? []) {
    (j.hardware ?? []).forEach((o, i) => {
      out.push({
        key: `${j.id}:${o.id ?? i}`,
        jobId: j.id,
        jobName: j.name || j.jobRef,
        jobRef: j.jobRef,
        orderedOn: o.orderedOn ?? null,
        orderedText: o.orderedText ?? null,
        receivedOn: o.receivedOn ?? null,
        receivedText: o.receivedText ?? null,
        status: o.status ?? null,
        photoUrl: o.photoUrl ?? null,
        notes: o.notes ?? null,
        parts: o.parts ?? [],
      });
    });
  }
  for (const [i, o] of orphans.entries()) {
    out.push({
      key: `orphan:${o.id ?? i}`,
      jobId: null,
      jobName: o.label || o.jobRef,
      jobRef: o.jobRef,
      orderedOn: o.orderedOn ?? null,
      orderedText: o.orderedText ?? null,
      receivedOn: o.receivedOn ?? null,
      receivedText: o.receivedText ?? null,
      status: o.status ?? null,
      photoUrl: o.photoUrl ?? null,
      notes: o.notes ?? null,
      parts: o.parts ?? [],
    });
  }
  return out;
}

// Quantities above this are flagged "check qty". The photo reader sometimes merges the size into the quantity
// ("527 × Grass Guides" for 5 × 27"); in the sheet data almost every line over 50 is a misread.
export const UNUSUAL_QTY = 50;

/** True when a part's quantity should be checked: over UNUSUAL_QTY and not yet edited or typed by a person. */
export const qtyToCheck = (p) => !p.edited && !p.manual && Number.isFinite(Number(p.qty)) && p.qty !== null && p.qty !== '' && Number(p.qty) > UNUSUAL_QTY;

/** Received if the sheet says so in any of its three places. */
export const isReceived = (o) => Boolean(o.receivedOn || o.receivedText || /^\s*received/i.test(o.status ?? ''));

/** ISO date `days` before `today` (an ISO date). */
export function daysBefore(today, days) {
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - days));
  return t.toISOString().slice(0, 10);
}

/** Orders on or after `since` (ISO date; null = all), newest first. Undated orders only when since is null, last. */
export function ordersSince(orders, since) {
  return orders
    .filter((o) => (since ? o.orderedOn && o.orderedOn >= since : true))
    .sort((a, b) => (b.orderedOn ?? '0000').localeCompare(a.orderedOn ?? '0000'));
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Part lines whose name contains every word of the query. Returns the lines (newest order first) and totals.
 * Quantities that are not numbers are listed but not added up. Flagged quantities are added up but counted in
 * toCheck, so the screen can say the total includes numbers nobody has checked.
 */
export function searchParts(orders, query) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return { lines: [], totalQty: 0, uncounted: 0, toCheck: 0, jobs: 0 };
  const lines = [];
  for (const o of orders) {
    for (const p of o.parts) {
      const name = norm(p.name);
      if (words.every((w) => name.includes(w))) lines.push({ qty: p.qty, name: p.name, check: qtyToCheck(p), order: o });
    }
  }
  lines.sort((a, b) => (b.order.orderedOn ?? '0000').localeCompare(a.order.orderedOn ?? '0000'));
  let totalQty = 0;
  let uncounted = 0;
  for (const l of lines) {
    const n = Number(l.qty);
    if (l.qty !== null && l.qty !== '' && Number.isFinite(n)) totalQty += n; else uncounted += 1;
  }
  return { lines, totalQty, uncounted, toCheck: lines.filter((l) => l.check).length, jobs: new Set(lines.map((l) => l.order.jobId)).size };
}
