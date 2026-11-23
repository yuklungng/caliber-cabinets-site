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

const PICTURE_DPI = 110;
const PAGE_JPEG = 0.7;
const PART_JPEG = 0.82;

export const READERS = { caldoor: 'Cal Door & Drawer (one picture per door, name underneath)' };

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

/** The page's words with their boxes in page points from the top left: [{ text, x0, x1, top }]. */
export async function pageWords(pdfjs, page, viewport) {
  const tc = await page.getTextContent();
  const words = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const m = pdfjs.Util.transform(viewport.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    const top = m[5] - size * 0.9;
    const len = it.str.length;
    // Split a run into words, spreading its width over its letters.
    let pos = 0;
    for (const part of it.str.split(/(\s+)/)) {
      if (part.trim()) {
        words.push({ text: part, x0: m[4] + (it.width * pos) / len, x1: m[4] + (it.width * (pos + part.length)) / len, top });
      }
      pos += part.length;
    }
  }
  return words;
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

export function kindFor(title) {
  const t = String(title ?? '').toLowerCase();
  if (t.includes('drawer front') && !t.includes('door')) return 'drawer_front';
  if (t.includes('drawer box')) return 'drawer_box';
  if (t.includes('color')) return 'other';
  return 'door_style';
}

// Lines under a picture that describe how it is shown, not what it is.
const SHOWN = /^(shown (in|with)|\(?discontinued|group \d|standard with|available)/i;

/**
 * The parts on one Cal Door page: pictures of a real size with the words printed just under them.
 * boxes and words in page points; returns [{ rect, lines }]. Pure, so it can be tested without a PDF.
 */
export function caldoorPageParts(boxes, words, width, height) {
  const byCaption = new Map();
  for (const r of boxes) {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    // Door pictures: not a full-page photo, not a profile strip or logo.
    if (w < 60 || h < 60 || w > width * 0.8 || h > height * 0.8) continue;
    const under = words.filter((t) => t.top >= r.y1 - 8 && t.top <= r.y1 + 40 && (t.x0 + t.x1) / 2 >= r.x0 - 4 && (t.x0 + t.x1) / 2 <= r.x1 + 4);
    const rows = new Map();
    for (const t of under) {
      const k = Math.round(t.top / 3);
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(t);
    }
    const lines = [...rows.entries()].sort((a, b) => a[0] - b[0])
      .map(([, ws]) => ws.sort((a, b) => a.x0 - b.x0).map((t) => t.text).join(' ').trim())
      .filter((l) => l && !/caldoor\.com/i.test(l));
    if (!lines.length) continue;
    const key = lines.join('\n');
    // One door drawn as two pictures (same caption on the page): one crop around both.
    const prev = byCaption.get(key);
    byCaption.set(key, prev ? { rect: { x0: Math.min(prev.rect.x0, r.x0), y0: Math.min(prev.rect.y0, r.y0), x1: Math.max(prev.rect.x1, r.x1), y1: Math.max(prev.rect.y1, r.y1) }, lines } : { rect: r, lines });
  }
  return [...byCaption.values()];
}

/** Names and options from caption lines; a name used for different doors gets its detail added. */
export function nameParts(found) {
  const named = found.map((f) => {
    const nameLines = f.lines.filter((l) => !SHOWN.test(l));
    return nameLines.length ? { ...f, name: nameLines[0], detail: nameLines.slice(1), shown: f.lines.filter((l) => SHOWN.test(l)) } : null;
  }).filter(Boolean);
  const variants = new Map();
  for (const f of named) {
    const k = f.name.toLowerCase();
    if (!variants.has(k)) variants.set(k, new Set());
    variants.get(k).add(f.detail.join(' ').toLowerCase());
  }
  return named.map((f) => {
    const split = variants.get(f.name.toLowerCase()).size > 1 && f.detail.length > 0;
    const name = split ? `${f.name}, ${f.detail.join(' ')}` : f.name;
    return {
      page: f.page, rect: f.rect, kind: f.kind, category: f.category, name: name.slice(0, 200), blob: f.blob,
      options: [...f.shown, ...(split ? [] : f.detail)].join('\n') || null,
    };
  });
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
      const [boxes, words] = await Promise.all([pictureBoxes(pdfjs, page, at1), pageWords(pdfjs, page, at1)]);
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
