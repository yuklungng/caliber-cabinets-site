import { tempJobRef } from './productionSync.js';

/**
 * Raw sheet rows (dev_sheet_rows_raw) -> tidy tables (dev_production_jobs, dev_install_events, dev_hardware_orders).
 * Every output row comes from exactly one raw row, so the tables can be rebuilt from the raw copy at any time.
 * Nothing is written back to a sheet. Pure functions are exported for tests; writeNormalized does the I/O.
 */

/** "06/03/17", "6/3/2017" or "2017-06-03" -> { on: 'YYYY-MM-DD' | null, text }. The original text is always kept. */
export function parseSheetDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return { on: null, text: null };
  let y, m, d;
  let hit = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (hit) {
    m = Number(hit[1]); d = Number(hit[2]); y = Number(hit[3]);
    if (hit[3].length === 2) y += 2000;
  } else if ((hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(text))) {
    y = Number(hit[1]); m = Number(hit[2]); d = Number(hit[3]);
  } else return { on: null, text };
  const ok = y >= 2015 && y <= 2040 && m >= 1 && m <= 12 && d >= 1 && d <= 31
    && new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1;
  if (!ok) return { on: null, text };
  return { on: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, text };
}

const bool = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'TRUE' ? true : s === 'FALSE' ? false : null;
};
const str = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

const refFields = (cells, number, nameForRef, yearText) => {
  const jobRef = number ? `#${number}` : tempJobRef(nameForRef, yearText);
  return { job_ref: jobRef, job_number: number ?? null, ref_is_temp: !number };
};

const NOT_A_STEP = new Set([
  'Job Name', 'Priority #', 'Comments', 'Paint Color / Stain Color', 'PVC Tape Color',
  'Doors & Drawer Box Arrival Date', 'Paint Arrives', 'Attachment Links', 'Paint Ordered',
]);

/** One raw row of the Production Status sheet -> dev_production_jobs row (without timestamps). */
export function productionJobFrom(rawRow) {
  const cells = rawRow.raw.cells ?? {};
  const name = String(cells['Job Name'] ?? '').trim();
  const yearHint = /(20\d{2})/.exec(rawRow.raw.section ?? '')?.[1]
    ?? cells['Doors & Drawer Box Arrival Date'] ?? cells['Paint Arrives'] ?? '';
  const steps = {};
  for (const [k, v] of Object.entries(cells)) {
    if (NOT_A_STEP.has(k)) continue;
    const b = bool(v);
    if (b !== null) steps[k] = b;
  }
  const paint = parseSheetDate(cells['Paint Arrives']);
  const doors = parseSheetDate(cells['Doors & Drawer Box Arrival Date']);
  return {
    source_row_id: rawRow.row_id,
    ...refFields(cells, rawRow.raw.job_number, name, yearHint),
    job_name: name,
    section: str(rawRow.raw.section),
    priority: str(cells['Priority #']),
    steps,
    paint_color: str(cells['Paint Color / Stain Color']),
    pvc_tape_color: str(cells['PVC Tape Color']),
    paint_ordered: bool(cells['Paint Ordered']),
    paint_arrives_on: paint.on, paint_arrives_text: paint.on ? null : paint.text,
    doors_arrive_on: doors.on, doors_arrive_text: doors.on ? null : doors.text,
    attachment_links: str(cells['Attachment Links']),
    removed_at: rawRow.removed_at ?? null,
  };
}

/** One raw row of the Install Schedule sheet -> dev_install_events row. */
export function installEventFrom(rawRow) {
  const cells = rawRow.raw.cells ?? {};
  const name = String(cells['Job Name'] ?? '').trim();
  const delivery = parseSheetDate(cells['Delivery Date']);
  const install = parseSheetDate(cells['Install Date']);
  return {
    source_row_id: rawRow.row_id,
    ...refFields(cells, rawRow.raw.job_number, name, cells['Install Date'] ?? cells['Delivery Date'] ?? ''),
    job_name: name,
    details: str(cells['Job Details']),
    address: str(cells['Address']),
    contact: str(cells['Home Owner / Contrator Number']),
    delivery_on: delivery.on, delivery_text: delivery.on ? null : delivery.text, delivery_time: str(cells['Delivery Time']),
    install_on: install.on, install_text: install.on ? null : install.text, install_time: str(cells['Installation Time']),
    confirmed: bool(cells['Confirmed']),
    completed: bool(cells['Completed']),
    paid_50: bool(cells['50% Paid']),
    paid_45: bool(cells['45% Paid']),
    paid_5: bool(cells['5% Paid']),
    notes: str(cells['NOTES !!!!!']),
    removed_at: rawRow.removed_at ?? null,
  };
}

/** One raw row of the Job Hardware Orders sheet -> dev_hardware_orders row. */
export function hardwareOrderFrom(rawRow) {
  const cells = rawRow.raw.cells ?? {};
  const full = String(cells['Job Name'] ?? '').trim();
  const firstLine = full.split(/\r?\n/)[0].trim();
  const ordered = parseSheetDate(cells['Date Ordered']);
  const received = parseSheetDate(cells['Date Recieved']);
  const image = /^Image [\d -]+\.jpe?g$/i.exec(String(cells['Cell Image Link'] ?? '').trim())?.[0] ?? null;
  return {
    source_row_id: rawRow.row_id,
    ...refFields(cells, rawRow.raw.job_number, full, cells['Date Ordered'] ?? ''),
    job_name: firstLine || full,
    order_text: full,
    ordered_on: ordered.on, ordered_text: ordered.on ? null : ordered.text,
    received_on: received.on, received_text: received.on ? null : received.text,
    status: str(cells['Status']),
    notes: str(cells['Special Notes']),
    image_name: image,
    attachment_links: str(cells['Attachment Links']),
    removed_at: rawRow.removed_at ?? null,
  };
}

export const NORMALIZERS = {
  production_status: { table: 'production_jobs', build: productionJobFrom },
  install_schedule: { table: 'install_events', build: installEventFrom },
  hardware_orders: { table: 'hardware_orders', build: hardwareOrderFrom },
};

/** Counts only, no names: what a fill would produce. */
export function summarizeNormalized(rows) {
  const dateFields = ['paint_arrives_text', 'doors_arrive_text', 'delivery_text', 'install_text', 'ordered_text', 'received_text'];
  const refs = new Map();
  for (const r of rows) refs.set(r.job_ref, (refs.get(r.job_ref) ?? 0) + 1);
  return {
    rows: rows.length,
    realNumbers: rows.filter((r) => !r.ref_is_temp).length,
    tempRefs: rows.filter((r) => r.ref_is_temp).length,
    tempRefsWithUnknownYear: rows.filter((r) => r.ref_is_temp && r.job_ref.startsWith('TXX-')).length,
    distinctRefs: refs.size,
    refsSharedByManyRows: [...refs.values()].filter((n) => n > 1).length,
    unparsedDates: rows.reduce((n, r) => n + dateFields.filter((f) => r[f]).length, 0),
  };
}

/** Comparable form of a column value: sorted-key JSON, and timestamps as epoch ms (the database reformats them). */
const canon = (key, v) => {
  if (key === 'removed_at') return v ? new Date(v).getTime() : null;
  const sorted = (x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted(x[k])])) : x);
  return JSON.stringify(sorted(v ?? null));
};

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export async function readRawRows(supabase, rawTable, sheetKey) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(rawTable).select('row_id, raw, removed_at')
      .eq('sheet_key', sheetKey).order('row_number').range(from, from + 999);
    if (error) throw new Error(`${rawTable}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

/**
 * Upserts rows by source_row_id. Never deletes. When a row's job_ref changes (a temp ref replaced by a real
 * number, say) the old ref is appended to job_ref_history on tables that have it.
 */
export async function writeNormalized({ supabase, table, rows }) {
  const existing = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const e of data) existing.set(e.source_row_id, e);
    if (data.length < 1000) break;
  }
  const now = new Date().toISOString();
  let inserted = 0, updated = 0, unchanged = 0, refChanged = 0;
  const upserts = [];
  for (const r of rows) {
    const e = existing.get(r.source_row_id);
    const next = { ...r };
    if (e && 'job_ref_history' in e) {
      next.job_ref_history = e.job_ref_history ?? [];
      if (e.job_ref !== r.job_ref) { next.job_ref_history = [...next.job_ref_history, e.job_ref]; refChanged++; }
    }
    if (!e) inserted++;
    else {
      if (Object.keys(next).every((k) => canon(k, next[k]) === canon(k, e[k]))) { unchanged++; continue; }
      updated++;
    }
    upserts.push({ ...next, updated_at: now });
  }
  for (const c of chunk(upserts, 200)) {
    const { error } = await supabase.from(table).upsert(c, { onConflict: 'source_row_id' });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return { inserted, updated, unchanged, refChanged };
}
