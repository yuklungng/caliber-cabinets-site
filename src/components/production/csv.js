/**
 * A small CSV reader for vendor price lists (Excel "Save As > CSV"). Handles quoted fields, doubled quotes,
 * commas and line breaks inside quotes, CRLF, a leading byte-order mark, and semicolon- or tab-separated files.
 * Returns rows as arrays of trimmed strings; blank rows are dropped.
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field.trim());
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

// Header words that usually name each column in a vendor price list.
const GUESS = {
  itemNumber: /(item|part|sku|article|catalog|model|product)\s*(no|#|num|number|code)?|^(sku|code|item)$/i,
  name: /^(name|product name|item name|title)$/i,
  description: /desc/i,
  price: /(price|cost|net|each|dealer|list)/i,
  unit: /^(unit|uom|u\/m|per|pack)/i,
};

/** Best guess of which column holds what: { itemNumber, name, description, price, unit } -> column index or -1. */
export function guessColumns(header) {
  const used = new Set();
  const out = {};
  for (const key of ['itemNumber', 'price', 'unit', 'name', 'description']) {
    const idx = header.findIndex((h, i) => !used.has(i) && GUESS[key].test(String(h).trim()));
    out[key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return out;
}
