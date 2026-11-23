/**
 * Vendors, their catalogs and price lists, and the parts read from them (db/production/009).
 * Pure input cleaners and matching rules; the handler that reads and writes is productionVendorsApi.js.
 */

export const PART_KINDS = ['door_style', 'drawer_front', 'drawer_box', 'hardware', 'material', 'other'];
export const PART_STATUSES = ['review', 'active', 'retired', 'rejected'];
export const FILE_KINDS = ['catalog', 'price_list', 'price_book'];
export const FILE_STATUSES = ['uploading', 'uploaded', 'extracting', 'extracted', 'reviewed', 'failed'];
export const BUCKET = 'dev-vendor-catalogs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v) => typeof v === 'string' && UUID.test(v);

/** Trimmed text or null; throws when longer than max. */
function text(v, max, label) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > max) throw new Error(`${label} is too long (max ${max})`);
  return s;
}
// Notes keep their line breaks.
function longText(v, max, label) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  if (s.length > max) throw new Error(`${label} is too long (max ${max})`);
  return s;
}

/** Item numbers as printed (533.83.097, BCSC-111); spaces dropped so "533 83 097" and "533.83.097" stay distinct but tidy. */
export function cleanItemNumber(v) {
  const s = text(v, 60, 'Item number');
  return s ? s.replace(/\s+/g, '') : null;
}

/** The key that makes a part unique within its vendor: the item number, else the name; any case. Matches the 009 index. */
export const partKey = (p) => String(p.item_number ?? p.itemNumber ?? '').trim()
  ? String(p.item_number ?? p.itemNumber).trim().toLowerCase()
  : '~' + String(p.name ?? '').trim().toLowerCase();

export function cleanVendor(body) {
  const name = text(body?.name, 120, 'Name');
  if (!name) throw new Error('Name is required');
  const website = text(body?.website, 300, 'Website');
  const orderEmail = text(body?.orderEmail, 200, 'Ordering email');
  if (orderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orderEmail)) throw new Error('Ordering email does not look like an email address');
  return {
    name, website, order_email: orderEmail,
    phone: text(body?.phone, 60, 'Phone'),
    account_number: text(body?.accountNumber, 80, 'Account number'),
    notes: longText(body?.notes, 4000, 'Notes'),
  };
}

export function cleanPart(body) {
  const name = text(body?.name, 200, 'Name');
  if (!name) throw new Error('Name is required');
  const kind = PART_KINDS.includes(body?.kind) ? body.kind : 'other';
  let page = null;
  if (body?.page !== undefined && body?.page !== null && body?.page !== '') {
    page = Number(body.page);
    if (!Number.isInteger(page) || page < 1 || page > 5000) throw new Error('Page must be a whole number');
  }
  return {
    kind, name, page,
    item_number: cleanItemNumber(body?.itemNumber),
    description: longText(body?.description, 2000, 'Description'),
    category: text(body?.category, 120, 'Category'),
    options: longText(body?.options, 2000, 'Options'),
  };
}

/** A price as typed: "$1,234.50", "12", "0.85". Returns a number with 2 decimals, or throws. */
export function cleanPrice(v) {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,4})?$/.test(s)) throw new Error(`Price "${v}" is not a number`);
  return Math.round(Number(s) * 100) / 100;
}

export function cleanDate(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error('Date must be YYYY-MM-DD');
  return s;
}

export const cleanUnit = (v) => (text(v, 30, 'Unit') ?? 'each').toLowerCase();

/** Safe object name for storage: letters, digits, dot, dash, underscore. */
export function storageName(name) {
  const base = String(name ?? 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '');
  return (base || 'file').slice(-120);
}

/**
 * A price list's rows matched against a vendor's parts.
 * rows: [{ itemNumber, name, description, price, unit }] as read from the file (already mapped to columns).
 * parts: the vendor's live parts { id, item_number, name, status }; latest: Map partId -> { price, unit }.
 * Returns { matched: [{ partId, price, unit, changed }], added: [{ part fields, price, unit }], skipped: [{ row, reason }] }.
 * A row matches on item number, else on name (any case). Rejected parts are not matched (a new part is made).
 */
export function matchPriceRows(rows, parts, latest = new Map()) {
  const byKey = new Map();
  for (const p of parts) if (p.status !== 'rejected') byKey.set(partKey(p), p);
  const out = { matched: [], added: [], skipped: [] };
  const seen = new Set();
  rows.forEach((r, i) => {
    const line = i + 2; // row 1 is the header
    let price;
    try { price = cleanPrice(r.price); } catch (e) { out.skipped.push({ line, reason: e.message }); return; }
    let itemNumber; let name;
    try {
      itemNumber = cleanItemNumber(r.itemNumber);
      name = text(r.name, 200, 'Name') ?? text(r.description, 200, 'Description') ?? itemNumber;
    } catch (e) { out.skipped.push({ line, reason: e.message }); return; }
    if (!itemNumber && !name) { out.skipped.push({ line, reason: 'No item number or name' }); return; }
    const key = partKey({ item_number: itemNumber, name });
    if (seen.has(key)) { out.skipped.push({ line, reason: 'Listed twice in the file' }); return; }
    seen.add(key);
    const unit = cleanUnit(r.unit);
    const part = byKey.get(key);
    if (part) {
      const prev = latest.get(part.id);
      out.matched.push({ partId: part.id, price, unit, changed: !prev || Number(prev.price) !== price || prev.unit !== unit });
    } else {
      let description = null;
      try { description = longText(r.description, 2000, 'Description'); } catch { /* too long: leave it off */ }
      out.added.push({ item_number: itemNumber, name, description: description === name ? null : description, price, unit });
    }
  });
  return out;
}

/**
 * Parts read from a catalog by the extraction script, cleaned. Each: { kind, itemNumber, name, description, options, page, imagePath }.
 * imagePath must sit under this file's own folder in the bucket.
 */
export function cleanCatalogParts(list, folder) {
  if (!Array.isArray(list) || !list.length) throw new Error('parts must be a non-empty list');
  if (list.length > 200) throw new Error('At most 200 parts per call');
  return list.map((p, i) => {
    let part;
    try { part = cleanPart(p); } catch (e) { throw new Error(`Part ${i + 1}: ${e.message}`); }
    const imagePath = p?.imagePath ? String(p.imagePath) : null;
    if (imagePath && (!imagePath.startsWith(folder + '/') || imagePath.includes('..'))) throw new Error(`Part ${i + 1}: picture is outside this catalog's folder`);
    return { ...part, image_path: imagePath };
  });
}

// ── Price books (db/production/010) ─────────────────────────────────────────
export const PRICINGS = ['per_sq_ft', 'linear_inch_plus_box', 'per_length', 'each', 'other'];
export const ADDER_KINDS = ['percent', 'per_sq_ft', 'per_piece', 'per_door', 'per_lite', 'per_box', 'per_opening', 'per_set', 'each'];
const VARIANTS = ['door', 'glass', 'drawer_front', 'per_inch', 'per_box', 'price'];

const short = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const rateOf = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new Error(`Price ${v} is invalid`);
  return Math.round(n * 10000) / 10000;
};

/**
 * One table read from a price book in the browser, cleaned for insert:
 * { table: {...dev_price_tables columns}, cells: [...], adders: [...] }. Throws on anything malformed.
 */
export function cleanPriceTable(t, n = 0) {
  const where = `Table ${n + 1}`;
  if (!t || typeof t !== 'object') throw new Error(`${where}: missing`);
  const page = Number(t.page);
  if (!Number.isInteger(page) || page < 1 || page > 5000) throw new Error(`${where}: page is invalid`);
  const columns = Array.isArray(t.columns) ? t.columns : [];
  if (!columns.length || columns.length > 30) throw new Error(`${where}: 1 to 30 columns`);
  const cols = columns.map((c, k) => ({
    key: /^c\d{1,2}$/.test(String(c?.key)) ? String(c.key) : `c${k + 1}`,
    label: short(c?.label, 300),
    variant: VARIANTS.includes(c?.variant) ? c.variant : 'price',
  }));
  const keys = new Set(cols.map((c) => c.key));
  const rows = Array.isArray(t.rows) ? t.rows : [];
  if (!rows.length || rows.length > 200) throw new Error(`${where}: 1 to 200 rows`);
  const cells = [];
  rows.forEach((r, i) => {
    for (const [key, c] of Object.entries(r?.cells ?? {})) {
      if (!keys.has(key)) throw new Error(`${where}: unknown column ${key}`);
      let rate;
      try { rate = rateOf(c?.rate); } catch (e) { throw new Error(`${where}, row ${i + 1}: ${e.message}`); }
      cells.push({ row_index: i, column_key: key, rate, raw: short(c?.raw, 40) || null });
    }
  });
  const adders = (Array.isArray(t.adders) ? t.adders : []).slice(0, 80).flatMap((a, k) => {
    const value = Number(a?.value);
    if (!ADDER_KINDS.includes(a?.kind) || !Number.isFinite(value) || value < 0 || value > 1e6) return [];
    const p = Number(a?.page);
    return [{ seq: k, label: short(a?.label, 300) || short(a?.raw, 300) || 'Add-on', kind: a.kind, value, raw: short(a?.raw, 500) || null, page: Number.isInteger(p) && p > 0 ? p : null }];
  });
  const list = (v, max, len) => (Array.isArray(v) ? v : []).map((x) => short(x, len)).filter(Boolean).slice(0, max);
  const min = Number(t.minSqFt);
  const opt = Number(t.optionsPage);
  return {
    table: {
      page,
      options_page: Number.isInteger(opt) && opt > 0 ? opt : null,
      seq: Number.isInteger(Number(t.seq)) ? Number(t.seq) : n + 1,
      title: short(t.title, 300) || `Page ${page}`,
      styles: list(t.styles, 80, 120),
      also_names: list(t.alsoNames, 80, 120),
      pricing: PRICINGS.includes(t.pricing) ? t.pricing : 'other',
      row_label: short(t.rowLabel, 200) || null,
      columns: cols,
      row_labels: rows.map((r) => short(r?.label, 200)),
      min_sq_ft: Number.isFinite(min) && min > 0 && min < 100 ? min : null,
      notes: list(t.notes, 40, 400),
      issues: list(t.issues, 60, 400),
    },
    cells,
    adders,
  };
}

/** A name in a comparable form: "Juliano RTF (S-Panel)" -> "juliano rtf", "Napa French Lite (p. 37)" -> "napa french lite". */
export const nameKey = (s) => String(s ?? '').toLowerCase()
  .replace(/\(p\.\s*\d+\)/g, ' ').replace(/\([^)]*\)/g, ' ')
  .replace(/[‘’'"“”]/g, '').replace(/[^a-z0-9#/]+/g, ' ').replace(/\s+/g, ' ').trim();

// Words after a style name that say which version of it a part is: "Shaker RTF Glass", "Revere Door", "OP-712 Routed DF".
const VARIANT_TAIL = /\s+(glass door|cut for glass|glass|french lites?|\d+ lites?|door|routed df|routed drawer fronts?|solid drawer fronts?|drawer fronts?|df)$/;
const PIECES = /\s*&\s*|\s+and\s+|,\s*/;

function addWithTails(out, k) {
  let p = k.trim();
  if (p.length >= 3) out.add(p);
  for (let i = 0; i < 3 && VARIANT_TAIL.test(p); i++) {
    p = p.replace(VARIANT_TAIL, '').trim();
    if (p.length >= 3) out.add(p);
  }
}

/** The style names a part could be listed under in a price book. */
export function partNames(name) {
  const out = new Set();
  addWithTails(out, nameKey(name));
  for (const piece of String(name ?? '').split(PIECES)) addWithTails(out, nameKey(piece));
  return [...out];
}

/** The names a price table lists (its captions and title), split where the book joins them: "Liberty, Juliano & Tiffany". */
export function tableNames(table, also = false) {
  const out = new Set();
  const title = String(table.title ?? '');
  const sources = also ? (table.also_names ?? table.alsoNames ?? []) : [...(table.styles ?? []), title.includes(' - ') ? title.split(' - ').slice(1).join(' - ') : ''];
  for (const s of sources) {
    const k = nameKey(s);
    if (!k) continue;
    addWithTails(out, k);
    for (const piece of String(s).split(PIECES)) addWithTails(out, nameKey(piece));
  }
  return out;
}

/**
 * Which price tables list a part. tables: [{ id, title, styles }] (current editions only). links: the part's rows in
 * dev_part_price_links [{ table_id, how }]. Returns table ids: linked by hand first, then automatic matches not hidden.
 */
export function matchPartTables(part, tables, links = []) {
  const names = partNames(part.name);
  const hidden = new Set(links.filter((l) => l.how === 'hidden').map((l) => l.table_id));
  const manual = links.filter((l) => l.how === 'manual').map((l) => l.table_id);
  const cache = matchPartTables.cache ?? (matchPartTables.cache = new WeakMap());
  const namesOf = (t) => { if (!cache.has(t)) cache.set(t, [tableNames(t), tableNames(t, true)]); return cache.get(t); };
  const open = tables.filter((t) => !hidden.has(t.id) && !manual.includes(t.id));
  // Names printed on the table's own page first; the pages after it (pictures, options) only when nothing else matches.
  let auto = open.filter((t) => names.some((n) => namesOf(t)[0].has(n)));
  if (!auto.length) auto = open.filter((t) => names.some((n) => namesOf(t)[1].has(n)));
  return [...manual, ...auto.map((t) => t.id)];
}

/** A table's identity across editions of a book: its title, column headings and row labels. */
export const tableKey = (t) => [nameKey(t.title), ...(t.columns ?? []).map((c) => nameKey(c.label)), ...(t.row_labels ?? []).map(nameKey)].join('|');
