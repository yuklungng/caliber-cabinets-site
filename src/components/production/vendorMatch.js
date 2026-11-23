/**
 * Which vendor a dropped catalog or price list belongs to, worked out from what is in it, so nobody has to open the
 * vendor first. Pure functions (no PDF, no network), so they can be tested on their own.
 *
 * Clues, strongest first:
 *   1. a web address in the file that matches a vendor's website (the 2019 Cal Door and Häfele PDFs print theirs);
 *   2. the catalog's layout: a reader recognises its own vendor's catalogs (the 2024 Cal Door catalog never prints
 *      the name in text, only in its logo, but its sections, Echo Wood, RTF and so on, are its own);
 *   3. a vendor's name in the file or the file name.
 * When nothing matches an existing vendor, it suggests a new one (from the reader or the web address).
 */

// One entry per catalog layout that catalogReader.js can read.
export const READER_INFO = {
  caldoor: {
    label: 'Cal Door & Drawer (one picture per door, name underneath)',
    vendorName: 'Cal Door & Drawer',
    website: 'caldoor.com',
    // Words in the catalog (its contents page and first pages) that mark a Cal Door catalog.
    signature: /\becho wood\b|\bflex line\b|\brtf (doors|glass|foil)|caldoor\.com|cal door/i,
  },
};

// Web addresses that say nothing about the vendor.
const IGNORE_DOMAINS = /^(adobe|google|facebook|instagram|youtube|pinterest|twitter|x|linkedin|houzz|issuu|w3)\./i;

/** Web addresses in some text, most frequent first: ['caldoor.com', ...]. */
export function findDomains(text) {
  const counts = new Map();
  for (const m of String(text ?? '').matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]{1,62}\.(?:com|net|us|ca|org|biz))\b/gi)) {
    const d = m[1].toLowerCase();
    if (!IGNORE_DOMAINS.test(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}

/** The host of a website as typed ("https://www.CalDoor.com/x" -> "caldoor.com"). */
export function hostOf(website) {
  const s = String(website ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  return s.split(/[/?#]/)[0] || null;
}

/** A name boiled down for matching: letters and digits only, no "inc", "and", "usa". */
export function nameKey(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' ').replace(/\b(inc|llc|co|corp|and|the|usa|us)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
}

/** Which reader's layout this looks like, or null. */
export function guessReader(text) {
  for (const [key, info] of Object.entries(READER_INFO)) if (info.signature.test(String(text ?? ''))) return key;
  return null;
}

/**
 * clues: { domains: [...], text, fileName, reader }
 * vendors: [{ id, name, website, readers: ['caldoor', ...] }]
 * Returns { vendorId, why } for an existing vendor, { newVendor: { name, website }, why } for a suggested new one,
 * or null when there is no clue at all.
 */
export function guessVendor(clues, vendors) {
  const domains = clues.domains ?? [];
  const text = nameKey(clues.text);
  const file = nameKey(clues.fileName);
  const scores = new Map();
  const add = (v, pts, why) => {
    const s = scores.get(v.id) ?? { pts: 0, why: [] };
    s.pts += pts; if (!s.why.includes(why)) s.why.push(why);
    scores.set(v.id, s);
  };
  const info = clues.reader ? READER_INFO[clues.reader] : null;
  for (const v of vendors) {
    const host = hostOf(v.website);
    if (host && domains.includes(host)) add(v, 10, `its web address (${host}) is in the file`);
    if (clues.reader && (v.readers ?? []).includes(clues.reader)) add(v, 8, 'same layout as its earlier catalog');
    if (info && ((host && host === hostOf(info.website)) || nameKey(v.name) === nameKey(info.vendorName))) add(v, 6, 'the catalog layout');
    const key = nameKey(v.name);
    if (key.length >= 4 && text.includes(key)) add(v, 4, 'its name is in the file');
    if (key.length >= 4 && file.includes(key)) add(v, 3, 'its name is in the file name');
  }
  const best = [...scores.entries()].sort((a, b) => b[1].pts - a[1].pts)[0];
  if (best) return { vendorId: best[0], why: best[1].why.join('; ') };
  if (info) return { newVendor: { name: info.vendorName, website: info.website }, why: 'the catalog layout' };
  if (domains[0]) {
    const stem = domains[0].split('.')[0];
    return { newVendor: { name: stem.charAt(0).toUpperCase() + stem.slice(1), website: domains[0] }, why: `its web address (${domains[0]}) is in the file` };
  }
  return null;
}
