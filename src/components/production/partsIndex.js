// Pure helpers for the Parts tab: every hardware order across jobs, newest first, and a part search.
// Read-only. Input is the job list the Production screen already loads (no extra API call).
//
// The hardware sheet stopped recording received dates in 2021, so "not received" cannot be read as
// "still on order". The tab says "receipt not recorded" instead of guessing.

/** One entry per hardware order, carrying its job. */
export function flattenOrders(jobs) {
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
  return out;
}

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
 * Quantities that are not numbers are listed but not added up.
 */
export function searchParts(orders, query) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return { lines: [], totalQty: 0, uncounted: 0, jobs: 0 };
  const lines = [];
  for (const o of orders) {
    for (const p of o.parts) {
      const name = norm(p.name);
      if (words.every((w) => name.includes(w))) lines.push({ qty: p.qty, name: p.name, order: o });
    }
  }
  lines.sort((a, b) => (b.order.orderedOn ?? '0000').localeCompare(a.order.orderedOn ?? '0000'));
  let totalQty = 0;
  let uncounted = 0;
  for (const l of lines) {
    const n = Number(l.qty);
    if (l.qty !== null && l.qty !== '' && Number.isFinite(n)) totalQty += n; else uncounted += 1;
  }
  return { lines, totalQty, uncounted, jobs: new Set(lines.map((l) => l.order.jobId)).size };
}
