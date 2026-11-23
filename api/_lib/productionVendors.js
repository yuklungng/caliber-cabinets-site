/**
 * Vendors, their catalogs and price lists, and the parts read from them (db/production/009).
 * Pure input cleaners and matching rules; the handler that reads and writes is productionVendorsApi.js.
 */

export const PART_KINDS = ['door_style', 'drawer_front', 'drawer_box', 'hardware', 'material', 'other'];
export const PART_STATUSES = ['review', 'active', 'retired', 'rejected'];
export const FILE_KINDS = ['catalog', 'price_list'];
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
