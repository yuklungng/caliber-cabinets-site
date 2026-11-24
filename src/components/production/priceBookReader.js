/**
 * Reads a vendor price book PDF in the browser: every table of prices on every page, with its row and column labels,
 * the add-on charges and minimums printed around it, and a picture of each page that has prices. As with catalogs,
 * the PDF itself is never uploaded.
 *
 * Price books can't be read as plain text: in some (Cal Door's RTF book) the row labels and the numbers come out in a
 * different order from how they look. So the reader works from where each piece of text sits on the page:
 *   - every price ("12.50", "$16.00", "N/A") is a cell; cells that line up across and down make a table;
 *   - the text to the left of a row is its label, and the text above a column (up to the first big gap) its heading;
 *   - every table is then checked (a number in every cell, every row labelled, no number far out of line with the
 *     rest of its column), and anything that fails is flagged, not dropped.
 */

import { openCatalog } from './catalogReader.js';

const PAGE_DPI = 110;
const PAGE_JPEG = 0.7;

const NUM = /^\$?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/;
const NA = /^(N\/A|n\/a|NA)$/;

export const isCellText = (t) => NUM.test(t) || NA.test(t);
export const parseRate = (t) => {
  const m = NUM.exec(String(t ?? '').trim());
  return m ? Number(`${m[1].replace(/,/g, '')}.${m[2]}`) : null;
};

/**
 * The page's text with boxes in page points from the top left:
 * [{ text, x0, x1, top, bottom, cx, cy, size, rotated }]. Overprinted duplicates are kept once.
 */
export async function pageItems(pdfjs, page, viewport) {
  const tc = await page.getTextContent();
  return toItems(tc.items, (t) => pdfjs.Util.transform(viewport.transform, t));
}

export function toItems(raw, place) {
  const items = [];
  for (const it of raw) {
    const text = (it.str ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const m = place(it.transform);
    const rotated = Math.abs(m[1]) > Math.abs(m[0]) * 0.2 || Math.abs(m[2]) > Math.abs(m[3]) * 0.2;
    const size = rotated ? Math.hypot(m[0], m[1]) : Math.hypot(m[2], m[3]);
    const x0 = m[4];
    const x1 = rotated ? m[4] + size : m[4] + it.width;
    const top = m[5] - size * 0.85;
    const t = { text, x0, x1, top, bottom: top + size, cx: (x0 + x1) / 2, cy: top + size / 2, size, rotated };
    const dup = items.find((o) => o.text === t.text && Math.abs(o.cy - t.cy) < 2 && Math.abs(o.x0 - t.x0) < 2);
    if (!dup) items.push(t);
  }
  return items;
}

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const joinText = (list) => list
  .sort((a, b) => (Math.abs(a.cy - b.cy) > 2.5 ? a.cy - b.cy : a.x0 - b.x0))
  .map((i) => i.text).join(' ')
  .replace(/\s+([,.:;)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim();

/** What a column prices, from its heading. */
// "Cut for Glass: sq. ft. price + $20.00 per piece" under a door heading is an add-on, not what the column prices.
export const HEAD_ADDER = /(?:[a-z' ]{3,30}:\s*)?sq\.?\s*ft\.?\s*price\s*\+\s*\$?\s?\d+(?:\.\d\d)?\s*per\s*[a-z]+/gi;

export function variantFor(label) {
  const l = String(label ?? '').replace(HEAD_ADDER, ' ').toLowerCase();
  if (/linear/.test(l)) return 'per_inch';
  if (/per\s*box/.test(l)) return 'per_box';
  if (/glass/.test(l)) return 'glass';
  if (/drawer\s*fronts?|\bdf'?s?\b/.test(l)) return 'drawer_front';
  if (/door/.test(l)) return 'door';
  return 'price';
}

/** How a table's prices work, from the words on its page. */
export function pricingFor(text, columns) {
  if (columns.some((c) => c.variant === 'per_inch')) return 'linear_inch_plus_box';
  // The column headings say it best ("Price Per Square Foot", "Each"); the rest of the page can mention other units
  // in its small print (Flex Line's sample page: "Each" samples, edgeband "per lineal foot").
  const heads = columns.map((c) => c.label).join(' ').toLowerCase();
  if (/square foot|sq\.?\s*ft/.test(heads)) return 'per_sq_ft';
  if (/^\s*each\s*$|per piece/.test(heads)) return 'each';
  const t = String(text ?? '').toLowerCase();
  if (/per (8'|8’|linear|lineal)|per\s+\d+['’]\s*length|lengths? only/.test(t)) return 'per_length';
  if (/square foot|sq\.?\s*ft/.test(t)) return 'per_sq_ft';
  if (/\beach\b|per piece/.test(t)) return 'each';
  return 'other';
}

const ADDER_UNITS = [
  [/sq\.?\s*ft|square f(oo|ee)t/i, 'per_sq_ft'],
  [/drawer box|\bbox\b/i, 'per_box'],
  [/\blite\b/i, 'per_lite'],
  [/\bdoor\b/i, 'per_door'],
  [/\bopening\b/i, 'per_opening'],
  [/\bpiece\b|\bpc\b/i, 'per_piece'],
  [/\bset\b/i, 'per_set'],
];

/**
 * An add-on charge from one printed phrase, or null when it isn't one.
 * "R-4 & R-5 Outside Edge: add $7.00 per sq. ft." -> { label: 'R-4 & R-5 Outside Edge', kind: 'per_sq_ft', value: 7 }
 * "3" Stiles & Rails: add 20% to sq. ft. price"  -> { label: '3" Stiles & Rails', kind: 'percent', value: 20 }
 */
export function parseAdder(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  const pct = /\badd\s+(\d+(?:\.\d+)?)\s*%/i.exec(raw);
  const money = /(?:\badd\s+)?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:per|\/)\s*([a-z. ]{2,20})/i.exec(raw);
  let kind = null;
  let value = null;
  let at = -1;
  if (pct && (!money || pct.index <= money.index)) {
    kind = 'percent'; value = Number(pct[1]); at = pct.index;
  } else if (money) {
    const unit = ADDER_UNITS.find(([re]) => re.test(money[2]));
    kind = unit ? unit[1] : 'each';
    value = Number(money[1].replace(/,/g, ''));
    at = money.index;
  } else {
    return null;
  }
  let label = raw.slice(0, at);
  if (label.includes(':')) label = label.slice(0, label.indexOf(':'));
  label = label.replace(/[:+\-–\s]+$/, '').replace(/^[•\s]+/, '').trim();
  if (/^(use|and|or)\b/i.test(label) || label.length < 2) label = '';
  // A unit with no kind of its own ("per lineal foot", "per hole") stays in the label, so it isn't read as "each".
  if (kind === 'each' && money && label) label = `${label} (per ${money[2].replace(/[.\s]+$/, '').trim()})`;
  return { label: label || raw.slice(0, 80), kind, value, raw };
}

/** Text lines of a page split into runs, so side-by-side blocks of text don't run together. */
function textRuns(items) {
  const flat = items.filter((i) => !i.rotated).sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  const lines = [];
  for (const i of flat) {
    const line = lines.find((l) => Math.abs(l.cy - i.cy) <= 2.5);
    if (line) line.items.push(i); else lines.push({ cy: i.cy, items: [i] });
  }
  const runs = [];
  for (const l of lines) {
    const its = l.items.sort((a, b) => a.x0 - b.x0);
    let run = [its[0]];
    for (let k = 1; k < its.length; k++) {
      const gap = its[k].x0 - run[run.length - 1].x1;
      if (gap > 18) { runs.push(run); run = []; }
      run.push(its[k]);
    }
    runs.push(run);
  }
  return runs.map((r) => ({ text: joinText([...r]), cy: r[0].cy, x0: r[0].x0, x1: r[r.length - 1].x1 }));
}

/** Add-on charges and minimums printed on a page (outside its tables). */
export function pageAdders(items) {
  const adders = [];
  const notes = [];
  for (const r of textRuns(items.filter((i) => !i.inTable))) {
    if (/minimum|maximum|call for pric/i.test(r.text) && r.text.length < 160) notes.push(r.text);
    const a = parseAdder(r.text);
    if (a && !adders.some((x) => x.raw === a.raw)) adders.push(a);
  }
  return { adders, notes: [...new Set(notes)] };
}

/** "All doors are minimum 2 sq. ft." / "All doors have a 2 sq. ft. minimum." -> 2 */
export function doorMinimum(notes) {
  for (const n of notes) {
    const m = /doors?[^.]*?(?:minimum\s+(\d+(?:\.\d+)?)\s*sq|(\d+(?:\.\d+)?)\s*sq\.?\s*ft\.?\s*minimum)/i.exec(n)
      || /minimum\s+(\d+(?:\.\d+)?)\s*sq\.?\s*ft/i.exec(n);
    if (m) return Number(m[1] ?? m[2]);
  }
  return null;
}

// Lines under a picture that describe how it is shown, not what it is.
const NOT_A_STYLE = /^(shown in|\(?discontinued|refer to|available|standard with|must specify|•|\*|\d)/i;

/**
 * The tables on one page. items from pageItems. Returns
 * [{ title, styles, rowLabel, columns: [{ key, label, variant }], rows: [{ label, cells: { key: { rate, raw } } }], issues }]
 * and marks the items used by a table (item.inTable) so the page's adders can be read from the rest.
 */
export function pageTables(items, { width = 612, height = 792 } = {}) {
  const cells = items.filter((i) => !i.rotated && isCellText(i.text));
  if (cells.length < 2) return [];

  // Columns: cells at the same place across the page.
  const byX = [...cells].sort((a, b) => a.cx - b.cx);
  const cols = [];
  for (const c of byX) {
    const col = cols[cols.length - 1];
    if (col && c.cx - col.cxs[col.cxs.length - 1] <= 14) { col.cxs.push(c.cx); col.cells.push(c); } else cols.push({ cxs: [c.cx], cells: [c] });
  }
  // Side-by-side tables: neighbouring columns belong together when their rows line up.
  const lined = (a, b) => {
    const hit = a.cells.filter((c) => b.cells.some((d) => Math.abs(c.cy - d.cy) <= 4)).length;
    return hit / Math.min(a.cells.length, b.cells.length) >= 0.5;
  };
  const groups = [];
  for (const c of cols.filter((x) => x.cells.length > 1)) {
    // The nearest table on the left that this column lines up with (a column of another table may sit between).
    const g = [...groups].reverse().find((gr) => lined(gr[gr.length - 1], c));
    if (g) g.push(c); else groups.push([c]);
  }
  // A lone number joins a table it lines up with (a row's last price), else it is a stray price in the text.
  for (const c of cols.filter((x) => x.cells.length === 1)) {
    const g = groups.find((gr) => gr.some((x) => lined(x, c)));
    if (g) { g.push(c); g.sort((x, y) => x.cxs[0] - y.cxs[0]); }
  }
  if (!groups.length && cols.length > 1) groups.push(cols);
  groups.sort((x, y) => x[0].cxs[0] - y[0].cxs[0]);

  const rotatedTitle = joinText(items.filter((i) => i.rotated && i.text.length > 6));
  const others = items.filter((i) => !i.rotated && !isCellText(i.text));
  const tables = [];
  for (const g of groups) {
    const groupCells = g.flatMap((c) => c.cells);
    // Row labels can't come from another table on the left.
    const gx0 = Math.min(...groupCells.map((c) => c.x0));
    const leftCells = groups.filter((o) => o !== g).flatMap((o) => o.flatMap((c) => c.cells)).filter((c) => c.x1 < gx0);
    const leftEdge = leftCells.length ? Math.max(...leftCells.map((c) => c.x1)) : 0;

    // Rows: cells at the same height. The tolerance follows the table's row spacing.
    const ys = [...new Set(groupCells.map((c) => Math.round(c.cy)))].sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, k) => y - ys[k]).filter((x) => x > 2.5);
    const pitch = median(gaps) || 15;
    const tol = Math.min(7, Math.max(3, pitch * 0.4));
    const rows = [];
    for (const c of [...groupCells].sort((a, b) => a.cy - b.cy)) {
      const r = rows[rows.length - 1];
      if (r && c.cy - r.cy0 <= tol) r.cells.push(c);
      else rows.push({ cy0: c.cy, cells: [c] });
    }
    for (const r of rows) r.cy = median(r.cells.map((c) => c.cy));
    // Separate tables down the page: runs of rows close together.
    const blocks = [];
    for (const r of rows) {
      const b = blocks[blocks.length - 1];
      const last = b?.rows[b.rows.length - 1];
      if (b && r.cy - last.cy <= Math.max(pitch * 2.2, 30)) b.rows.push(r);
      else blocks.push({ rows: [r] });
    }

    for (const b of blocks) {
      const inBlock = new Set(b.rows.flatMap((r) => r.cells));
      const bcols = g.map((c) => ({ ...c, cells: c.cells.filter((x) => inBlock.has(x)) })).filter((c) => c.cells.length);
      // A table needs at least two real prices; one column with a row or two is a price in running text.
      if ([...inBlock].filter((x) => !NA.test(x.text)).length < 2) continue;
      if (bcols.length < 2 && b.rows.length < 3) continue;
      if (bcols.length < 2 && b.rows.length < 2) continue;
      bcols.forEach((c, k) => {
        c.cx = median(c.cells.map((i) => i.cx));
        c.x0 = Math.min(...c.cells.map((i) => i.x0));
        c.x1 = Math.max(...c.cells.map((i) => i.x1));
        c.key = `c${k + 1}`;
      });
      bcols.forEach((c, k) => {
        c.z0 = k ? (bcols[k - 1].cx + c.cx) / 2 : c.x0 - 40;
        c.z1 = k < bcols.length - 1 ? (c.cx + bcols[k + 1].cx) / 2 : Math.min(c.x1 + 45, width);
      });
      const left = bcols[0].x0;
      const top = b.rows[0].cy;
      const bottom = b.rows[b.rows.length - 1].cy;

      // Row labels: text to the left of the first column, at the row's height (or nearest it, within half a row).
      const rowTol = Math.max(tol, Math.min(pitch * 0.55, 14));
      const used = new Set();
      const outRows = b.rows.map((r) => {
        const near = (i) => i.x1 <= left + 2 && Math.abs(i.cy - r.cy) <= rowTol
          && b.rows.every((o) => o === r || Math.abs(i.cy - o.cy) >= Math.abs(i.cy - r.cy));
        let lab = others.filter((i) => near(i) && i.x0 >= leftEdge - 2);
        // A table beside another shares its row labels (Cal Door's RTF book).
        if (!lab.length) {
          const all = others.filter(near);
          const x0 = Math.min(...all.map((i) => i.x0));
          lab = all.filter((i) => i.x0 <= x0 + 60);
        }
        lab.forEach((i) => used.add(i));
        const out = { label: joinText(lab), cells: {}, lab };
        for (const c of r.cells) {
          const col = bcols.find((cc) => cc.cells.includes(c));
          if (out.cells[col.key]) out.dupe = true;
          out.cells[col.key] = { rate: parseRate(c.text), raw: c.text };
        }
        return out;
      });

      // Headings: text above the table, line by line upwards until a big gap.
      const right = bcols[bcols.length - 1].z1;
      const above = others
        .filter((i) => i.cy < top - tol * 0.5 && i.x1 > Math.max(leftEdge, left - 200) && i.x0 < right && !used.has(i))
        .sort((a, c) => c.cy - a.cy);
      const head = [];
      let edge = top;
      for (const i of above) {
        const gap = edge - i.cy;
        if (gap > (head.length ? 24 : 62)) break;
        head.push(i);
        edge = Math.min(edge, i.cy);
      }
      const headTop = head.length ? edge : top;
      const notes = [];
      const colItems = new Map(bcols.map((c) => [c.key, []]));
      const rowHead = [];
      for (const i of head) {
        if (i.x1 <= left + 2) { rowHead.push(i); continue; }
        const spans = bcols.filter((c) => Math.min(i.x1, c.z1) - Math.max(i.x0, c.z0) >= Math.min(12, (i.x1 - i.x0) * 0.3));
        if (spans.length >= 3 && bcols.length >= 3) { notes.push(i.text); continue; }
        for (const c of spans) colItems.get(c.key).push(i);
        if (!spans.length) rowHead.push(i);
      }
      const columns = bcols.map((c) => {
        const label = joinText(colItems.get(c.key));
        return { key: c.key, label, variant: variantFor(label) };
      });

      // Names on the page above the table (captions under the pictures), e.g. "Revere", "Juliano RTF (S-Panel)".
      const styles = captionNames(others.filter((i) => i.cy < headTop - 4), height);

      // A "Door Styles" list beside a "Materials" column (Cal Door's mitered inset pages): the rows are the materials,
      // and the list, which runs on below the table, names the styles the table prices.
      const matHead = rowHead.find((i) => /^materials?$/i.test(i.text.trim()));
      const dsHead = matHead && others.find((i) => /^door\s*styles?$/i.test(i.text.trim()) && Math.abs(i.cy - matHead.cy) <= 4 && i.x1 <= matHead.x0);
      if (dsHead && matHead && dsHead.x1 < matHead.x0) {
        // The materials column starts where the labels' second column of left edges does (its heading is centred).
        const xs = outRows.flatMap((r) => r.lab.map((i) => i.x0)).filter((x) => x > dsHead.x0 + 30 && x < matHead.x1);
        const split = (xs.length ? Math.min(...xs) : matHead.x0) - 4;
        for (const r of outRows) r.label = joinText(r.lab.filter((i) => i.x0 >= split));
        const list = others.filter((i) => i.x0 >= Math.max(leftEdge - 2, dsHead.x0 - 20) && i.x1 <= split + 4 && i.cy > dsHead.cy)
          .sort((a, c) => a.cy - c.cy);
        let prev = dsHead.cy;
        for (const i of list) {
          if (i.cy - prev > Math.max(pitch * 2.5, 40)) break;
          prev = i.cy;
          const name = i.text.replace(/\s+/g, ' ').trim();
          if (!/^(see |page \d|matches |\*|inset:|with |outside edge|shown )/i.test(name) && name.length > 1 && !styles.includes(name)) styles.push(name);
          i.inTable = true;
        }
      }
      for (const r of outRows) delete r.lab;

      // Items in the table, so they aren't read again as add-ons.
      for (const i of items) {
        if (i.cy >= headTop - 1 && i.cy <= bottom + tol && i.x1 >= Math.max(leftEdge, left - 200) && i.x0 <= right && !/^[•*]/.test(i.text)) i.inTable = true;
      }

      // Checks.
      const issues = [];
      outRows.forEach((r, k) => {
        const missing = bcols.filter((c) => !r.cells[c.key]);
        const name = `Row ${k + 1}${r.label ? ` (${r.label})` : ''}`;
        if (missing.length) issues.push(`${name}: no number under ${missing.map((c) => columns.find((x) => x.key === c.key).label || c.key).join(', ')}`);
        if (!r.label) issues.push(`Row ${k + 1}: no label found`);
        if (r.dupe) issues.push(`${name}: two numbers in one column`);
      });
      for (const c of bcols) {
        const vals = outRows.map((r) => r.cells[c.key]?.rate).filter((v) => v != null && v > 0);
        const med = median(vals);
        if (!med || vals.length < 3) continue;
        outRows.forEach((r, k) => {
          const v = r.cells[c.key]?.rate;
          if (v != null && v > 0 && (v > med * 4 || v < med / 4)) issues.push(`Row ${k + 1}${r.label ? ` (${r.label})` : ''}: ${r.cells[c.key].raw} is far out of line with the rest of its column`);
        });
      }
      if (columns.every((c) => !c.label)) issues.push('No column headings found');

      tables.push({
        title: rotatedTitle || null,
        styles,
        rowLabel: joinText(rowHead) || null,
        columns,
        rows: outRows,
        notes,
        issues,
        headText: head.map((i) => i.text).join(' '),
      });
    }
  }
  return tables;
}

/** Short names on a page: picture captions and style lists, used to link parts to their price table. */
export function captionNames(items, height = 792) {
  const out = [];
  for (const i of items) {
    if (i.rotated || i.size < 7 || NOT_A_STYLE.test(i.text) || i.text.length > 45) continue;
    if (i.cy < 12 || i.cy > height - 30) continue;
    const name = i.text.replace(/\([^)]*\)?/g, '').replace(/[:,]+$/, '').replace(/\s+/g, ' ').trim();
    if (name.length > 1 && /[a-z]/i.test(name) && !/price|pricing|\b(19|20)\d{2}\b/i.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The book's title and edition from its file name: "2026 RTF Price Book (April2026).pdf" -> RTF Price Book, April 2026. */
export function bookTitle(fileName) {
  const base = String(fileName ?? '').replace(/\.pdf$/i, '');
  const ed = /\(([^)]*)\)/.exec(base)?.[1]?.replace(/([a-z])(\d)/i, '$1 $2').trim() || null;
  const title = base.replace(/\([^)]*\)/g, '').replace(/^\s*(19|20)\d{2}\s+/, '').replace(/\s+/g, ' ').trim();
  return { title: title || base, edition: ed };
}

/** Whether a dropped PDF looks like a price book rather than a catalog. */
export function looksLikePriceBook(fileName, text) {
  if (/price\s*(book|list)|pricing/i.test(fileName ?? '')) return true;
  if (/catalog/i.test(fileName ?? '')) return false;
  return /price book|profile (&|and) prices|product pricing|price list/i.test(text ?? '');
}

/** Cleans up a table's title: the side heading, else the page's biggest line. */
function pageHeading(items) {
  const flat = items.filter((i) => !i.rotated && !isCellText(i.text) && i.text.length > 3 && /[a-z]{3}/i.test(i.text) && !/pric(e|ing)/i.test(i.text));
  if (!flat.length) return null;
  const big = Math.max(...flat.map((i) => i.size));
  return joinText(flat.filter((i) => i.size >= big - 0.5).slice(0, 3));
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make a picture'))), 'image/jpeg', quality));
}

/**
 * Reads every page's tables and add-ons. Pure (no pdf.js), so it can be tested:
 * pages = [{ page, items, width, height }]. Returns tables in book order with page, seq, adders and notes.
 */
export function bookTables(pages) {
  const out = [];
  for (let k = 0; k < pages.length; k++) {
    const { page, items, width, height } = pages[k];
    const found = pageTables(items, { width, height });
    if (!found.length) continue;
    const here = pageAdders(items);
    // The page after a table often holds its options (Cal Door's wood book: prices left, options right).
    const next = pages[k + 1];
    const nextHasTable = next && pageTables(next.items.map((i) => ({ ...i })), next).length > 0;
    const there = next && !nextHasTable && next.page === page + 1 ? pageAdders(next.items) : { adders: [], notes: [] };
    const heading = pageHeading(items);
    // Names on the picture and option pages that follow, up to the next page with prices.
    const later = [];
    for (let j = k + 1; j < Math.min(pages.length, k + 3); j++) {
      if (pageTables(pages[j].items.map((i) => ({ ...i })), pages[j]).length) break;
      later.push(...captionNames(pages[j].items, pages[j].height));
    }
    found.forEach((t, n) => {
      const notes = [...new Set([...t.notes, ...here.notes, ...there.notes])];
      const adders = [...here.adders.map((a) => ({ ...a, page })), ...there.adders.filter((a) => !here.adders.some((h) => h.raw === a.raw)).map((a) => ({ ...a, page: next.page }))];
      const generic = !t.title || /^(product )?pric(e|ing)s?$/i.test(t.title.trim());
      const title = (generic ? [t.title && !heading ? t.title : null, heading].filter(Boolean).join(' – ') : t.title) || `Page ${page}`;
      const allText = [t.headText, ...notes, ...adders.map((a) => a.raw), title, items.map((i) => i.text).join(' ')].join(' ');
      const pricing = pricingFor(allText, t.columns);
      for (const c of t.columns) {
        for (const m of c.label.match(HEAD_ADDER) ?? []) {
          const a = parseAdder(m.replace(/price\s*\+\s*\$/i, 'price + add $'));
          const base = c.label.replace(m, '').trim();
          if (a) adders.unshift({ ...a, label: `${base}${/:/.test(m) ? ` ${m.split(':')[0].trim()}` : ''}`.trim() || a.label, raw: m.trim(), page });
        }
      }
      const columns = t.columns.map((c) => (c.variant === 'price' && pricing === 'per_sq_ft' ? { ...c, variant: 'door' } : c));
      out.push({
        page,
        optionsPage: there.adders.length || there.notes.length ? next.page : null,
        seq: out.length + 1,
        title: found.length > 1 ? `${title} (${n + 1})` : title,
        styles: t.styles.slice(0, 60),
        alsoNames: [...new Set(later)].filter((x) => !t.styles.includes(x)).slice(0, 80),
        rowLabel: t.rowLabel,
        columns,
        rows: t.rows,
        pricing,
        minSqFt: doorMinimum([...notes, ...t.columns.map((c) => c.label)]),
        notes,
        adders,
        issues: t.issues,
      });
    });
  }
  return out;
}

/**
 * Reads a price book. onProgress({ page, pages }); signal (AbortSignal) stops it.
 * Returns { pages, tables, pageImages: Map page -> blob } with a picture of every page that has prices or options.
 */
export async function readPriceBook(file, { onProgress, signal } = {}) {
  const { pdfjs, doc, close } = await openCatalog(file);
  try {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      if (signal?.aborted) throw new Error('Stopped');
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      pages.push({ page: p, items: await pageItems(pdfjs, page, vp), width: vp.width, height: vp.height });
      page.cleanup();
      onProgress?.({ page: p, pages: doc.numPages * 2, step: 'reading' });
    }
    const tables = bookTables(pages);
    const want = new Set(tables.flatMap((t) => [t.page, t.optionsPage].filter(Boolean)));
    const pageImages = new Map();
    const scale = PAGE_DPI / 72;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let done = 0;
    for (const p of [...want].sort((a, b) => a - b)) {
      if (signal?.aborted) throw new Error('Stopped');
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      pageImages.set(p, await canvasBlob(canvas, PAGE_JPEG));
      page.cleanup();
      done += 1;
      onProgress?.({ page: doc.numPages + Math.round((done / want.size) * doc.numPages), pages: doc.numPages * 2, step: 'pictures' });
    }
    return { pages: doc.numPages, tables, pageImages };
  } finally {
    close();
  }
}
