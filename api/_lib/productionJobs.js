/**
 * Read-only job list for the Production screen: one entry per Production Status row, with the install /
 * delivery events and hardware orders that share its job_ref. Pure functions plus one paged reader;
 * nothing here writes.
 */

import { partsFromOrderText } from './productionNormalize.js';

/** Reads every row of a table (Supabase returns at most 1000 per request). `narrow` can add filters. */
export async function readAll(supabase, table, cols, narrow = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await narrow(supabase.from(table).select(cols)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const byRef = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const list = m.get(r.job_ref);
    if (list) list.push(r); else m.set(r.job_ref, [r]);
  }
  return m;
};

// Events sort by their first known date; ones with no date go last.
const dateOf = (e) => e.install_on ?? e.delivery_on ?? '9999-12-31';

/**
 * jobs: dev_production_jobs rows (not removed). installs / hardware: the other tidy tables' rows (not removed).
 * rowNumbers: Map of source_row_id -> sheet row number, so the list can keep the sheet's order.
 */
export function buildJobList({ jobs, installs, hardware, rowNumbers = new Map() }) {
  const inst0 = byRef(installs);
  const hw0 = byRef(hardware);
  // A sheet heading such as "JOBS IN THE SHOP" is read as a job: no invoice number, nothing ticked, nothing filled in.
  jobs = jobs.filter((j) => !(j.ref_is_temp
    && !Object.values(j.steps ?? {}).some((v) => v === true)
    && !inst0.has(j.job_ref) && !hw0.has(j.job_ref)
    && !j.paint_color && !j.pvc_tape_color && !j.priority
    && !j.paint_arrives_on && !j.paint_arrives_text && !j.doors_arrive_on && !j.doors_arrive_text));
  const inst = byRef(installs);
  const hw = byRef(hardware);
  return jobs.map((j) => {
    const entries = Object.entries(j.steps ?? {});
    const events = [...(inst.get(j.job_ref) ?? [])].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    const orders = hw.get(j.job_ref) ?? [];
    return {
      id: j.id,
      jobRef: j.job_ref,
      isTemp: j.ref_is_temp,
      name: j.job_name,
      section: j.section,
      rowNumber: rowNumbers.get(j.source_row_id) ?? null,
      priority: j.priority,
      stepsDone: entries.filter(([, v]) => v === true).length,
      stepsTotal: entries.length,
      steps: j.steps ?? {},
      paintColor: j.paint_color,
      pvcTapeColor: j.pvc_tape_color,
      paintOrdered: j.paint_ordered,
      paintArrives: { on: j.paint_arrives_on, text: j.paint_arrives_text },
      doorsArrive: { on: j.doors_arrive_on, text: j.doors_arrive_text },
      installs: events.map((e) => ({
        details: e.details,
        deliveryOn: e.delivery_on, deliveryText: e.delivery_text,
        installOn: e.install_on, installText: e.install_text,
        confirmed: e.confirmed, completed: e.completed,
      })),
      hardware: [...orders].sort((a, b) => (a.ordered_on ?? '9999-12-31').localeCompare(b.ordered_on ?? '9999-12-31')).map((o) => ({
        // order_text is the OCR'd cell: the first line repeats the job name, the lines after it are the parts.
        parts: partsFromOrderText(o.order_text).map((p) => ({ qty: p.qty, name: p.name })),
        orderedOn: o.ordered_on ?? null, orderedText: o.ordered_text ?? null,
        receivedOn: o.received_on ?? null, receivedText: o.received_text ?? null,
        status: o.status ?? null, notes: o.notes ?? null, photoUrl: o.photo_url ?? null,
      })),
      hardwareOrders: orders.length,
      lastHardwareOrderOn: orders.map((o) => o.ordered_on).filter(Boolean).sort().pop() ?? null,
    };
  }).sort((a, b) => (a.rowNumber ?? 1e9) - (b.rowNumber ?? 1e9));
}
