// Pure helpers for the Shop view: the sheet's step boxes grouped into the stations of the shop floor, in the order
// a cabinet goes through them, and where each job is on that line. Read-only.
//
// Stations and their order were agreed with Mike on 2026-11-20: Paperwork, Cut, Build, Finish, Assemble, Install.
// The Production Status sheet has 11 step boxes. "Edge Band Ordered" is an ordering note, not a shop step: ordering
// gets its own view, so it is left off the shop floor (the office Jobs view still shows it).
// Install has no boxes on the sheet, so its three steps (INSTALL_STEPS) exist only as ticks made here; keep the list
// in step with INSTALL_STEPS in api/_lib/productionJobs.js. The final 5% is collected after the punch list.

export const INSTALL_STEPS = ['Delivered', 'Installed', 'Punch list done'];
export const ORDERING_STEPS = ['Edge Band Ordered'];

export const STATIONS = [
  { key: 'paperwork', label: 'Paperwork', short: 'Paperwork', steps: ['Paperwork In Shop'] },
  { key: 'cut', label: 'Cut', short: 'Cut', detail: 'Cut, PVC edge band, CNC for assembly holes', steps: ['Body Cut', 'Edge banded'] },
  { key: 'build', label: 'Build', short: 'Build', detail: 'Assemble the boxes and drawer boxes', steps: ['Boxes Built', 'Frames Built'] },
  { key: 'finish', label: 'Finish', short: 'Finish', detail: 'Sand and paint doors and drawer fronts', steps: ['Doors and Drawers Sanded', 'Sealer / Primer', 'Final Coat'] },
  { key: 'assemble', label: 'Assemble', short: 'Assemble', detail: 'Hang doors and fronts, drill for handles, quality check, load', steps: ['Doors Hinged', 'Hardware Installed'] },
  { key: 'out', label: 'Install', short: 'Install', detail: 'Delivery, install and punch list', steps: INSTALL_STEPS },
];

const NOT_BLOCKING = new Set();
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Days between two ISO dates (b - a). */
const daysBetween = (a, b) => {
  const ms = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(b) - ms(a)) / 86400000);
};

/**
 * Each station for one job: { key, label, short, state: 'done' | 'now' | 'todo', steps: [{ name, done, blocking }] },
 * plus `current` (the key of the first station not done, or null when everything is done) and `other` (step boxes on
 * the sheet that fit no station, so a renamed column still shows up).
 */
export function jobStations(job) {
  const steps = job?.steps ?? {};
  const byName = new Map(Object.entries(steps).map(([k, v]) => [norm(k), { name: k, done: v === true }]));
  const used = new Set(ORDERING_STEPS.map(norm));
  const out = STATIONS.map((s) => {
    const list = s.steps
      .map((n) => { const hit = byName.get(norm(n)); if (hit) used.add(norm(n)); return hit ? { ...hit, blocking: !NOT_BLOCKING.has(norm(n)) } : null; })
      .filter(Boolean);
    const blocking = list.filter((p) => p.blocking);
    let done = blocking.length > 0 && blocking.every((p) => p.done);
    if (s.key === 'out' && !done) {
      // Jobs from before the Install ticks existed count as installed when the sheet marks every install completed.
      const installs = job?.installs ?? [];
      done = installs.length > 0 && installs.every((e) => e.completed);
    }
    return { key: s.key, label: s.label, short: s.short, detail: s.detail ?? null, steps: list, done };
  });
  // The shop often leaves step boxes unticked, so a job whose installs are all marked completed is finished
  // whatever its boxes say.
  if (out[out.length - 1].done) for (const s of out) s.done = true;
  const firstOpen = out.findIndex((s) => !s.done);
  const stations = out.map((s, i) => ({ ...s, state: s.done ? 'done' : i === firstOpen ? 'now' : 'todo' }));
  const other = [...byName.entries()].filter(([k]) => !used.has(k)).map(([, v]) => v);
  return { stations: stations.map((s) => ({ key: s.key, label: s.label, short: s.short, detail: s.detail, steps: s.steps, state: s.state })), current: firstOpen === -1 ? null : out[firstOpen].key, other };
}

/** Every real date on a job (schedule, paint, doors, hardware). */
function jobDates(job) {
  return [
    ...(job.installs ?? []).flatMap((e) => [e.installOn, e.deliveryOn]),
    job.paintArrives?.on, job.doorsArrive?.on,
    ...(job.hardware ?? []).flatMap((o) => [o.orderedOn, o.receivedOn]),
  ].filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
}

/**
 * Jobs still in the shop: not installed and completed, and with some date within `recentDays` before today or any
 * date after it. Old rows the sheet never closed out (no date in months) are left off the shop floor.
 */
export function activeJobs(jobs, today, recentDays = 120) {
  return (jobs ?? []).filter((j) => {
    const { current } = jobStations(j);
    if (current === null) return false;
    return jobDates(j).some((d) => daysBetween(d, today) <= recentDays);
  });
}

/** How many of the given jobs are at each station: { paperwork: n, cut: n, … }. */
export function stationCounts(jobs) {
  const c = Object.fromEntries(STATIONS.map((s) => [s.key, 0]));
  for (const j of jobs) {
    const { current } = jobStations(j);
    if (current) c[current] += 1;
  }
  return c;
}

/** The job's next delivery or install that is not completed: { kind, on, text } or null. */
export function nextVisit(job) {
  for (const e of job?.installs ?? []) {
    if (e.completed) continue;
    if (e.installOn || e.installText) return { kind: 'Install', on: e.installOn ?? null, text: e.installText ?? null };
    if (e.deliveryOn || e.deliveryText) return { kind: 'Delivery', on: e.deliveryOn ?? null, text: e.deliveryText ?? null };
  }
  return null;
}
