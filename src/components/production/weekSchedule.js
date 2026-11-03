// Pure date helpers for the Production "This week" view. Dates are ISO yyyy-mm-dd strings; arithmetic goes through UTC
// so a daylight-saving change never shifts a day. Nothing here reads or writes anything.

const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const toMs = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };

export const addDays = (iso, n) => toIso(toMs(iso) + n * 86400000);

/** The Monday on or before the given date. */
export function mondayOf(iso) {
  const dow = new Date(toMs(iso)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

/** Today in the browser's own time zone, as yyyy-mm-dd. */
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * The seven days from `start` (a Monday), each with the deliveries and installs dated that day. A schedule row with
 * both dates gives one item on each day. Rows with only free text (no real date) cannot be placed and are left out.
 * Jobs are the entries from the jobs action: { id, name, jobRef, installs: [{ details, deliveryOn, installOn, confirmed, completed }] }.
 */
export function weekDays(jobs, start) {
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), items: [] }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const j of jobs) {
    for (const e of j.installs ?? []) {
      for (const [kind, on] of [['Delivery', e.deliveryOn], ['Install', e.installOn]]) {
        const day = on && byDate.get(on);
        if (day) day.items.push({ jobId: j.id, jobName: j.name || j.jobRef, jobRef: j.jobRef, isTemp: j.isTemp, kind, details: e.details ?? null, confirmed: !!e.confirmed, completed: !!e.completed });
      }
    }
  }
  for (const d of days) d.items.sort((a, b) => a.kind.localeCompare(b.kind) || a.jobName.localeCompare(b.jobName));
  return days;
}

/** True when a sheet section heading (such as "Year 2026") names the given year. */
export const sectionInYear = (section, year) => new RegExp(`(^|\\D)${year}(\\D|$)`).test(section ?? '');
