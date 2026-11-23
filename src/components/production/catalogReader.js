/**
 * Reads a vendor catalog PDF in the browser and cuts out its parts: a picture and a name for each, plus a picture of
 * every catalog page. Only these pieces are uploaded; the PDF itself never leaves the computer.
 *
 * pdf.js is loaded only when a catalog is read, and the PDF is read from disk in slices as pages need it, so a
 * 300 MB catalog does not have to sit in memory.
 *
 * One reader per catalog layout:
 *   caldoor  each door or drawer front is its own picture with its name printed under it (Cal Door & Drawer).
 */

import { READER_INFO, findDomains, guessReader } from './vendorMatch.js';

const PICTURE_DPI = 110;
const PAGE_JPEG = 0.7;
const PART_JPEG = 0.82;

export const READERS = Object.fromEntries(Object.entries(READER_INFO).map(([k, v]) => [k, v.label]));

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Opens a local PDF file, reading it from disk in slices. */
export async function openCatalog(file) {
  const pdfjs = await loadPdfjs();
  class FileRange extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin, end) {
      file.slice(begin, end).arrayBuffer().then((b) => this.onDataRange(begin, new Uint8Array(b)));
    }
  }
  // wasmUrl: the picture decoders (JPEG 2000 and others), copied to /pdfjs/ by vite.config.js.
  const task = pdfjs.getDocument({
    range: new FileRange(file.size, null), disableAutoFetch: true, disableStream: true,
    wasmUrl: `${window.location.origin}/pdfjs/`,
  });
  const doc = await task.promise;
  return { pdfjs, doc, close: () => task.destroy() };
}

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Where each picture on a page is drawn, in page points from the top left: [{ x0, y0, x1, y1 }]. */
export async function pictureBoxes(pdfjs, page, viewport) {
  const { OPS } = pdfjs;
  const ops = await page.getOperatorList();
  const boxes = [];
  let ctm = viewport.transform.slice();
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0])) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      // An image fills the unit square of the current transform.
      const pts = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
  }
  return boxes;
}

/**
 * The page's text runs with their boxes in page points from the top left: [{ text, x0, x1, top, size }].
 * A run printed twice on top of itself (a stray overprint, e.g. "CMP-248" over "MP-248") is kept once.
 */
export async function pageText(pdfjs, page, viewport) {
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    const text = (it.str ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const m = pdfjs.Util.transform(viewport.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    const t = { text, x0: m[4], x1: m[4] + it.width, top: m[5] - size * 0.9, size };
    const dup = items.find((o) => Math.abs(o.top - t.top) < o.size * 0.6
      && Math.min(o.x1, t.x1) - Math.max(o.x0, t.x0) > 0.6 * Math.min(o.x1 - o.x0, t.x1 - t.x0));
    if (!dup) items.push(t);
  }
  return items;
}

/** The catalog's contents as [{ from, to, title }], read from its first pages. */
export async function contents(doc) {
  const out = [];
  for (let p = 1; p <= Math.min(4, doc.numPages); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
    if (!/TABLE OF CONTENT/i.test(text)) continue;
    text = text.replace(/^.*?TABLE OF CONTENTS?\s*/i, '');
    // "NEW DOOR STYLES 2024 4-7 SOLID & INSET WOOD DOORS 8-36 ...": a title in capitals, then a page range.
    for (const m of text.matchAll(/([A-Z][A-Z0-9 &/-]*?[A-Z0-9])\s*(\d{1,3})\s*-\s*(\d{1,3})(?!\d)/g)) {
      const title = m[1].trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bRtf\b/g, 'RTF');
      out.push({ from: Number(m[2]), to: Number(m[3]), title });
    }
  }
  return out;
}

/**
 * A quick look at a catalog before reading it, to tell whose it is and which reader fits: the text of its first four
 * pages and last page (where vendors print their name and web address) and its contents.
 * Returns { pages, domains, text, reader, title }.
 */
export async function detectCatalog(file) {
  const { doc, close } = await openCatalog(file);
  try {
    const nums = [...new Set([1, 2, 3, 4, doc.numPages].filter((n) => n >= 1 && n <= doc.numPages))];
    const texts = [];
    for (const n of nums) {
      const tc = await (await doc.getPage(n)).getTextContent();
      texts.push(tc.items.map((i) => i.str).join(' '));
    }
    let title = null;
    try { title = (await doc.getMetadata())?.info?.Title || null; } catch { /* no metadata */ }
    const sections = await contents(doc);
    const text = `${texts.join(' ')} ${sections.map((x) => x.title).join(' ')} ${title ?? ''}`.replace(/\s+/g, ' ');
    return { pages: doc.numPages, domains: findDomains(text), text: text.slice(0, 20000), reader: guessReader(text), title };
  } finally {
    close();
  }
}

export function kindFor(title) {
  const t = String(title ?? '').toLowerCase();
  if (t.includes('drawer front') && !t.includes('door')) return 'drawer_front';
  if (t.includes('drawer box')) return 'drawer_box';
  if (t.includes('color')) return 'other';
  return 'door_style';
}

// Lines under a picture that describe how it is shown, not what it is.
// "shown with CRP-1/2 COVE panel." is not here: it names the variant (see nameParts).
const SHOWN = /^(shown in|\(?discontinued|group \d|standard with|available)/i;

/** Splits a text run into words, spreading its width over its letters. */
function words(t) {
  const out = [];
  let pos = 0;
  for (const part of t.text.split(/(\s+)/)) {
    if (part.trim()) out.push({ ...t, text: part, x0: t.x0 + ((t.x1 - t.x0) * pos) / t.text.length, x1: t.x0 + ((t.x1 - t.x0) * (pos + part.length)) / t.text.length });
    pos += part.length;
  }
  return out;
}

/**
 * Pictures drawn as a grid of tiles (one door cut into equal images, e.g. MP-248 as 2 x 3) joined into one picture.
 * Only tiles of the same size that touch (within 2pt) are joined: separate products photographed edge to edge are
 * different sizes, and separate doors have a gap. Tiny images and page-size backgrounds are never joined.
 */
export function joinTiles(boxes, width = Infinity, height = Infinity) {
  const w = (r) => r.x1 - r.x0;
  const h = (r) => r.y1 - r.y0;
  const skip = (r) => w(r) < 20 || h(r) < 20 || w(r) > width * 0.8 || h(r) > height * 0.8;
  const touch = (a, b) => a.x0 <= b.x1 + 2 && b.x0 <= a.x1 + 2 && a.y0 <= b.y1 + 2 && b.y0 <= a.y1 + 2;
  const sameSize = (a, b) => Math.abs(w(a) - w(b)) <= 0.05 * Math.max(w(a), w(b)) && Math.abs(h(a) - h(b)) <= 0.05 * Math.max(h(a), h(b));
  // Groups of tiles, grown one touching same-size tile at a time.
  const group = boxes.map((_, i) => i);
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
  boxes.forEach((a, i) => boxes.forEach((b, j) => {
    if (j > i && !skip(a) && !skip(b) && touch(a, b) && sameSize(a, b)) group[find(i)] = find(j);
  }));
  const joined = new Map();
  boxes.forEach((b, i) => {
    const k = find(i);
    const r = joined.get(k);
    joined.set(k, r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : { ...b });
  });
  return [...joined.values()];
}

// Caption text is at least this size (pt); smaller text is a label inside a drawing (3/4", 1/2" ...).
const CAPTION_MIN_SIZE = 8;

/**
 * The parts on one Cal Door page: pictures of a real size with their caption, the text printed just under them.
 * boxes and items (pageText) in page points; returns [{ rect, lines }]. Pure, so it can be tested without a PDF.
 *  - A caption line is taken whole, so a caption wider than its picture keeps all its words.
 *  - A caption centred under the gap between two pictures belongs to both (two views of one product).
 *  - A run that holds several pictures' captions (it spans more than one picture) is split into words.
 *  - Pictures with the same caption on a page are one part, cropped around all of them.
 */
export function caldoorPageParts(boxes, items, width, height) {
  const pics = joinTiles(boxes, width, height).filter((r) => {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    // Door pictures: not a full-page photo, not a profile strip or logo.
    return w >= 60 && h >= 60 && w <= width * 0.8 && h <= height * 0.8;
  });
  const below = (t, r) => t.top >= r.y1 - 8 && t.top <= r.y1 + 40;
  const overlap = (t, r) => Math.min(t.x1, r.x1) - Math.max(t.x0, r.x0);
  const centreIn = (t, r) => (t.x0 + t.x1) / 2 >= r.x0 - 4 && (t.x0 + t.x1) / 2 <= r.x1 + 4;
  const captions = new Map(pics.map((r) => [r, []]));
  for (const t of items) {
    if (t.size < CAPTION_MIN_SIZE || /caldoor\.com/i.test(t.text)) continue;
    const near = pics.filter((r) => below(t, r) && overlap(t, r) > 0);
    if (!near.length) continue;
    if (near.length > 1 && near.some((r) => centreIn(t, r))) {
      // One run carrying several captions: each word goes to the picture it sits under.
      for (const w of words(t)) for (const r of near) if (centreIn(w, r)) captions.get(r).push(w);
      continue;
    }
    const home = near.filter((r) => centreIn(t, r));
    const to = home.length ? home : near.filter((r) => overlap(t, r) >= 0.25 * (t.x1 - t.x0));
    for (const r of to) captions.get(r).push(t);
  }
  // A picture with nothing just under it: its caption may sit lower, below a drawing's size label
  // (the Giovanna-280 3/4 Miter Series pages). Take the first caption block within 100pt, as long as no other
  // picture starts in between and the text is not just a measurement.
  const sizeOnly = (t) => /^[\d\s/"'“”′″.&,x×-]+$/i.test(t.text);
  for (const r of pics) {
    if (captions.get(r).length) continue;
    const lower = items.filter((t) => t.size >= CAPTION_MIN_SIZE && !sizeOnly(t) && t.top > r.y1 + 40 && t.top <= r.y1 + 100 && centreIn(t, r)
      && !pics.some((o) => o !== r && o.y0 > r.y1 && o.y0 < t.top && overlap(o, r) > 0)).sort((a, b) => a.top - b.top);
    if (!lower.length) continue;
    const block = [lower[0]];
    for (const t of lower.slice(1)) if (t.top - block[block.length - 1].top <= t.size * 1.8) block.push(t); else break;
    captions.set(r, block);
  }
  const byCaption = new Map();
  for (const r of pics) {
    const rows = new Map();
    for (const t of captions.get(r)) {
      const k = Math.round(t.top / 3);
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(t);
    }
    const lines = [...rows.entries()].sort((a, b) => a[0] - b[0])
      .map(([, ts]) => ts.sort((a, b) => a.x0 - b.x0).map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!lines.length) continue;
    const key = lines.join('\n');
    const prev = byCaption.get(key);
    byCaption.set(key, prev ? { rect: { x0: Math.min(prev.rect.x0, r.x0), y0: Math.min(prev.rect.y0, r.y0), x1: Math.max(prev.rect.x1, r.x1), y1: Math.max(prev.rect.y1, r.y1) }, lines } : { rect: r, lines });
  }
  return [...byCaption.values()];
}

// A second caption line that is a note, not more of the name (any "view", a colon, or starting with a bracket, digit or small letter): "Top View", "( Front & Top View)", "on rails only".
const isNote = (l) => /\bviews?\b/i.test(l) || /:/.test(l) || /^[(\d]|^[a-z]/.test(l);

/**
 * Names and options from caption lines (Cal Door).
 *  - A name that wraps onto a second line is joined ("Echo Wood Qtr Gun" + "Metal Ebony"), unless that line is a
 *    note, a "Shown in" line, or one of the catalog's own colour names (a finish printed without "Shown in").
 *    In the colour sections both lines are the name ("High Gloss" + "Stone Grey").
 *  - A name used for different doors gets its detail added ("Echo Wood Rift White Oak, 3 piece with 1/16” V-groove").
 *  - The same name on several pictures: if each shows a different finish ("Shown in ...") it is one door in several
 *    foils, so one part listing them; on one page it is two views of one product, so one part; otherwise they are
 *    different doors printed with one name, kept apart by page.
 */
export function nameParts(found) {
  const colours = new Set(found.filter((f) => f.kind === 'other').map((f) => f.lines[0].toLowerCase()));
  const named = found.map((f) => {
    // "Shown in ..." and "Top View" lines say how the picture is shown, so they go to the options, not the name.
    const aside = (l, i) => SHOWN.test(l) || (i > 0 && /\bviews?\b/i.test(l));
    const lines = f.lines.filter((l, i) => !aside(l, i));
    if (!lines.length) return null;
    let n = 1;
    if (f.kind === 'other') n = lines.length;
    else while (n < lines.length && /^[A-Z]/.test(lines[n]) && !isNote(lines[n]) && !colours.has(lines[n].toLowerCase())) n++;
    return { ...f, name: lines.slice(0, n).join(' '), detail: lines.slice(n), shown: f.lines.filter((l, i) => aside(l, i)) };
  }).filter(Boolean);
  const variants = new Map();
  for (const f of named) {
    const k = f.name.toLowerCase();
    if (!variants.has(k)) variants.set(k, new Set());
    variants.get(k).add(f.detail.join(' ').toLowerCase());
  }
  const parts = named.map((f) => {
    const split = variants.get(f.name.toLowerCase()).size > 1 && f.detail.length > 0;
    // "shown with CRP-1/2 COVE panel." -> "CRP-1/2 COVE panel"
    const detail = f.detail.join(' ').replace(/^shown with\s+/i, '').replace(/\.$/, '');
    const name = split ? (detail.startsWith('(') ? `${f.name} ${detail}` : `${f.name}, ${detail}`) : f.name;
    return {
      page: f.page, rect: f.rect, kind: f.kind, category: f.category, name: name.replace(/\.$/, '').slice(0, 200), blob: f.blob,
      options: [...f.shown, ...(split ? [] : f.detail)].join('\n') || null, finish: f.shown.find((l) => /^shown in/i.test(l)) ?? null,
    };
  });
  const groups = new Map();
  for (const p of parts) {
    const k = p.name.toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    if (g.every((p) => p.finish)) {
      // One door shown in several foils: one part, the other finishes noted.
      const more = g.slice(1).map((p) => `${p.finish.replace(/^shown in\s*/i, '').replace(/\s*\(discontinued foil\)/i, '')} (p. ${p.page})`);
      out.push({ ...g[0], options: [g[0].options, `Also shown in ${more.join('; ')}`].filter(Boolean).join('\n') });
      continue;
    }
    // The same name twice on one page is two views of one product (e.g. a top view): keep the first.
    const byPage = [];
    for (const p of g) if (!byPage.some((q) => q.page === p.page)) byPage.push(p);
    if (byPage.length === 1) { out.push(byPage[0]); continue; }
    // Different doors printed with the same name on different pages: kept apart by page.
    for (const p of byPage) out.push({ ...p, name: `${p.name} (p. ${p.page})` });
  }
  return out.sort((a, b) => a.page - b.page).map((p) => { const { finish: _finish, ...rest } = p; return rest; });
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make a picture'))), 'image/jpeg', quality));
}

/**
 * Reads a catalog with the Cal Door reader. onProgress({ page, pages }) after each page; signal (AbortSignal) stops it.
 * Returns { pages, sections, parts: [{ page, kind, category, name, options, blob }], pageImages: Map page -> blob }.
 */
export async function readCaldoor(file, { onProgress, signal } = {}) {
  const { pdfjs, doc, close } = await openCatalog(file);
  try {
    const sections = await contents(doc);
    const first = sections.length ? Math.min(...sections.map((s) => s.from)) : 2;
    const scale = PICTURE_DPI / 72;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const found = [];
    const pageImages = new Map();
    for (let p = first; p <= doc.numPages; p++) {
      if (signal?.aborted) throw new Error('Stopped');
      const page = await doc.getPage(p);
      const at1 = page.getViewport({ scale: 1 });
      const [boxes, words] = await Promise.all([pictureBoxes(pdfjs, page, at1), pageText(pdfjs, page, at1)]);
      const section = sections.find((s) => s.from <= p && p <= s.to);
      const onPage = caldoorPageParts(boxes, words, at1.width, at1.height);
      const vp = page.getViewport({ scale });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      pageImages.set(p, await canvasBlob(canvas, PAGE_JPEG));
      for (const f of onPage) {
        const x = Math.max(0, Math.floor(f.rect.x0 * scale));
        const y = Math.max(0, Math.floor(f.rect.y0 * scale));
        const w = Math.min(canvas.width - x, Math.ceil((f.rect.x1 - f.rect.x0) * scale));
        const h = Math.min(canvas.height - y, Math.ceil((f.rect.y1 - f.rect.y0) * scale));
        if (w < 10 || h < 10) continue;
        const crop = document.createElement('canvas');
        crop.width = w; crop.height = h;
        crop.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
        found.push({ ...f, page: p, kind: kindFor(section?.title), category: section?.title ?? null, blob: await canvasBlob(crop, PART_JPEG) });
      }
      page.cleanup();
      onProgress?.({ page: p, pages: doc.numPages });
    }
    return { pages: doc.numPages, sections, parts: nameParts(found), pageImages };
  } finally {
    close();
  }
}
