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
// dev_hardware_parts rows (removed ones included) by order. An order that has rows there shows those, so
// edits and removals stick; an order with none yet shows the parts read straight from its text (not editable).
function partsLookup(parts) {
  const partsByOrder = new Map();
  for (const p of parts) {
    const list = partsByOrder.get(p.order_source_row_id);
    if (list) list.push(p); else partsByOrder.set(p.order_source_row_id, [p]);
  }
  return (o) => {
    const rows = partsByOrder.get(o.source_row_id);
    if (!rows) return partsFromOrderText(o.order_text, o.notes).map((p) => ({ qty: p.qty, name: p.name, fromNotes: !!p.fromNotes }));
    return rows.filter((p) => !p.removed_at).sort((a, b) => a.line_no - b.line_no).map((p) => ({
      id: p.id, qty: p.qty, name: p.part_name,
      fromNotes: p.line_no >= 1000 && p.line_no < 2000, manual: p.source === 'manual', edited: !!p.edited,
    }));
  };
}

// One hardware order as the screen sees it. order_text is the OCR'd cell: the first line repeats the job name,
// the lines after it are the parts.
const shapeOrder = (o, partsOf) => ({
  id: o.source_row_id ?? null,
  parts: partsOf(o),
  orderedOn: o.ordered_on ?? null, orderedText: o.ordered_text ?? null,
  receivedOn: o.received_on ?? null, receivedText: o.received_text ?? null,
  status: o.status ?? null, notes: o.notes ?? null, photoUrl: o.photo_url ?? null,
});

/**
 * Hardware orders that belong to no job in the list (orders from before the Production sheet starts, or
 * whose job name could not be read), so the Parts tab can still show them. Same shape as a job's
 * hardware entries plus the order's own label.
 */
export function orphanOrders({ list, hardware, parts = [] }) {
  const refs = new Set(list.map((j) => j.jobRef));
  const partsOf = partsLookup(parts);
  return hardware.filter((o) => !refs.has(o.job_ref)).map((o) => ({
    ...shapeOrder(o, partsOf),
    jobRef: o.job_ref,
    label: o.job_name || String(o.order_text ?? '').split(/\r?\n/)[0] || o.job_ref,
  }));
}

/**
 * Install steps the sheet has no boxes for (agreed with Mike 2026-11-20). They exist only as ticks made on the Shop
 * view and start unticked on every job. Keep in step with INSTALL_STEPS in src/components/production/shopStages.js.
 */
export const INSTALL_STEPS = ['Delivered', 'Installed', 'Punch list done'];

/**
 * The sheet's step boxes with the Shop view's ticks laid over them, plus the INSTALL_STEPS. A tick row
 * (dev_job_step_ticks) wins over the sheet for its step; only steps the sheet has, and the install steps, are touched.
 * Returns the merged steps and who ticked each one here.
 */
export function mergeStepTicks(sheetSteps, ticks = []) {
  const steps = { ...(sheetSteps ?? {}) };
  for (const st of INSTALL_STEPS) if (!Object.prototype.hasOwnProperty.call(steps, st)) steps[st] = false;
  const tickedBy = {};
  for (const t of ticks) {
    if (!Object.prototype.hasOwnProperty.call(steps, t.step)) continue;
    steps[t.step] = t.done === true;
    tickedBy[t.step] = { by: t.ticked_by ?? null, at: t.ticked_at ?? null, done: t.done === true };
  }
  return { steps, tickedBy };
}

export function buildJobList({ jobs, installs, hardware, rowNumbers = new Map(), parts = [], ticks = [] }) {
  const partsOf = partsLookup(parts);
  const ticksByRef = new Map();
  for (const t of ticks) {
    const list = ticksByRef.get(t.job_row_id);
    if (list) list.push(t); else ticksByRef.set(t.job_row_id, [t]);
  }
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
    const { steps, tickedBy } = mergeStepTicks(j.steps, ticksByRef.get(j.source_row_id));
    // Progress counts the sheet's own boxes, so the install steps do not change "8 of 11" on older jobs.
    const entries = Object.entries(steps).filter(([k]) => Object.prototype.hasOwnProperty.call(j.steps ?? {}, k));
    const events = [...(inst.get(j.job_ref) ?? [])].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    const orders = hw.get(j.job_ref) ?? [];
    return {
      id: j.id,
      jobRef: j.job_ref,
      rowId: j.source_row_id ?? null,
      isTemp: j.ref_is_temp,
      name: j.job_name,
      section: j.section,
      rowNumber: rowNumbers.get(j.source_row_id) ?? null,
      priority: j.priority,
      stepsDone: entries.filter(([, v]) => v === true).length,
      stepsTotal: entries.length,
      steps,
      stepTicks: tickedBy,
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
      hardware: [...orders].sort((a, b) => (a.ordered_on ?? '9999-12-31').localeCompare(b.ordered_on ?? '9999-12-31')).map((o) => shapeOrder(o, partsOf)),
      hardwareOrders: orders.length,
      lastHardwareOrderOn: orders.map((o) => o.ordered_on).filter(Boolean).sort().pop() ?? null,
    };
  }).sort((a, b) => (a.rowNumber ?? 1e9) - (b.rowNumber ?? 1e9));
}
