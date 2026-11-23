/**
 * Parts read from a catalog that are probably not parts, so the Review queue starts with them unticked.
 * Only a hint: nothing is rejected automatically, and the reviewer can tick them back.
 * Returns a short reason, or null when the name looks like a real part.
 */
export function nonPartReason(name) {
  const n = String(name ?? '').trim();
  if (!n) return 'no name';
  // A caption that is only sizes, e.g. the panel profiles drawn beside a door: 3/4", 1/2"
  if (/^[\d\s/"'“”′″.,x×-]+$/i.test(n)) return 'only a measurement';
  // A caption cut off mid-phrase: "Scalloped with", "... in Mission White (discontinued"
  if (/\b(with|and|or|in|of|for|the|a|to|on)$/i.test(n)) return 'name cut off';
  if ((n.match(/\(/g) ?? []).length > (n.match(/\)/g) ?? []).length) return 'name cut off';
  // The caption of a room photo ("Kitchen with Corner Drawers")
  if (/^(kitchen|bath(room)?|laundry|pantry|closet|mudroom|office|vanity|room)\b/i.test(n)) return 'a room photo, not a part';
  return null;
}
