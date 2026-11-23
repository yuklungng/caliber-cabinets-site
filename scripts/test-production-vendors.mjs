// Checks the vendor parts rules on made-up rows. Run: node scripts/test-production-vendors.mjs
import assert from 'node:assert/strict';
import { cleanCatalogParts, cleanItemNumber, cleanPart, cleanPrice, cleanVendor, matchPriceRows, partKey, storageName } from '../api/_lib/productionVendors.js';
import { canSeePrices, isVendorAction } from '../api/_lib/productionVendorsApi.js';
import { nonPartReason } from '../src/components/production/reviewHints.js';
import { findDomains, guessReader, guessVendor, hostOf, nameKey } from '../src/components/production/vendorMatch.js';

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
};

check('part key: item number first, else name, any case', () => {
  assert.equal(partKey({ item_number: 'ABC-1', name: 'x' }), 'abc-1');
  assert.equal(partKey({ itemNumber: 'ABC-1' }), 'abc-1');
  assert.equal(partKey({ item_number: null, name: ' Shaker RTF ' }), '~shaker rtf');
  assert.notEqual(partKey({ name: 'abc-1' }), partKey({ item_number: 'abc-1' }));
});

check('item numbers lose spaces, keep dots and dashes', () => {
  assert.equal(cleanItemNumber(' 533.83.097 '), '533.83.097');
  assert.equal(cleanItemNumber('BCSC - 111'), 'BCSC-111');
  assert.equal(cleanItemNumber(''), null);
});

check('prices as typed', () => {
  assert.equal(cleanPrice('$1,234.50'), 1234.5);
  assert.equal(cleanPrice('0.855'), 0.86);
  assert.throws(() => cleanPrice('call'));
  assert.throws(() => cleanPrice('-3'));
});

check('vendor needs a name, email must look like one', () => {
  assert.throws(() => cleanVendor({ name: ' ' }));
  assert.throws(() => cleanVendor({ name: 'A', orderEmail: 'nope' }));
  assert.equal(cleanVendor({ name: ' Cal  Door ', orderEmail: 'a@b.co' }).name, 'Cal Door');
});

check('part kind falls back to other, page must be whole', () => {
  assert.equal(cleanPart({ name: 'x', kind: 'weird' }).kind, 'other');
  assert.throws(() => cleanPart({ name: 'x', page: '2.5' }));
  assert.equal(cleanPart({ name: 'x', page: '12' }).page, 12);
});

check('storage names are safe', () => {
  assert.equal(storageName('2024 Product Catalog (Sept2024).pdf'), '2024_Product_Catalog_Sept2024_.pdf');
  assert.equal(storageName('../../etc/passwd'), 'etc_passwd');
  assert.equal(storageName(''), 'file');
});

check('catalog parts: pictures must stay in the catalog folder', () => {
  const ok = cleanCatalogParts([{ name: 'MP-210', kind: 'door_style', page: 9, imagePath: 'v/f/img/p09-1.jpg' }], 'v/f/img');
  assert.equal(ok[0].image_path, 'v/f/img/p09-1.jpg');
  assert.throws(() => cleanCatalogParts([{ name: 'x', imagePath: 'v/other/img/a.jpg' }], 'v/f/img'));
  assert.throws(() => cleanCatalogParts([{ name: 'x', imagePath: 'v/f/img/../../a.jpg' }], 'v/f/img'));
  assert.throws(() => cleanCatalogParts([], 'v/f/img'));
});

check('price list rows: match, change, add, skip', () => {
  const parts = [
    { id: 'p1', item_number: '533.83.097', name: 'Hinge', status: 'active' },
    { id: 'p2', item_number: null, name: 'Shaker', status: 'active' },
    { id: 'p3', item_number: 'OLD-1', name: 'Gone', status: 'rejected' },
  ];
  const latest = new Map([['p1', { price: 4.5, unit: 'each' }], ['p2', { price: 100, unit: 'each' }]]);
  const m = matchPriceRows([
    { itemNumber: '533.83.097', price: '4.50' },          // same price: matched, unchanged
    { name: 'SHAKER', price: '$110' },                     // matched by name, changed
    { itemNumber: 'NEW-9', description: 'Pull', price: '7' }, // new part
    { itemNumber: 'OLD-1', price: '1' },                   // rejected part: a new one is made
    { itemNumber: 'X', price: 'call us' },                 // skipped
    { itemNumber: 'new-9', price: '8' },                   // listed twice
    { price: '3' },                                        // no number or name
  ], parts, latest);
  assert.deepEqual(m.matched.map((x) => [x.partId, x.changed]), [['p1', false], ['p2', true]]);
  assert.deepEqual(m.added.map((a) => [a.item_number, a.name]), [['NEW-9', 'Pull'], ['OLD-1', 'OLD-1']]);
  assert.deepEqual(m.skipped.map((s) => s.line), [6, 7, 8]);
});

check('prices: admin and bookkeeper only', () => {
  assert.equal(canSeePrices({ isSuperAdmin: true }), true);
  assert.equal(canSeePrices({ isSuperAdmin: false, user: { role: 'bookkeeper' } }), true);
  assert.equal(canSeePrices({ isSuperAdmin: false, user: { role: 'staff' } }), false);
});

check('vendor actions are routed, others are not', () => {
  assert.equal(isVendorAction('vendor-parts'), true);
  assert.equal(isVendorAction('jobs'), false);
});

check('web addresses and names for matching', () => {
  assert.deepEqual(findDomains('See www.caldoor.com and CALDOOR.com/x, plus adobe.com and hafele.com/us'), ['caldoor.com', 'hafele.com']);
  assert.equal(hostOf('https://www.CalDoor.com/doors'), 'caldoor.com');
  assert.equal(nameKey('Häfele America Co.'), 'hafeleamerica');
  assert.equal(nameKey('Cal Door & Drawer'), 'caldoordrawer');
});

check('catalog layout is recognised from its contents', () => {
  assert.equal(guessReader('NEW DOOR STYLES 2024 ECHO WOOD SLAB FRONT SERIES RTF FOIL COLORS'), 'caldoor');
  assert.equal(guessReader('Sliding Door Hardware www.hafele.com/us'), null);
});

check('vendor guess: web address, layout, earlier catalog, name, or a new vendor', () => {
  const vendors = [
    { id: 'cd', name: 'Cal Door & Drawer', website: 'caldoor.com', readers: [] },
    { id: 'hf', name: 'Hafele', website: 'https://www.hafele.com/us', readers: [] },
    { id: 'tk', name: 'Top Knobs', website: null, readers: [] },
  ];
  assert.equal(guessVendor({ domains: ['hafele.com'], text: '' }, vendors).vendorId, 'hf');
  assert.equal(guessVendor({ domains: [], text: 'Echo Wood', reader: 'caldoor' }, vendors).vendorId, 'cd');
  assert.equal(guessVendor({ domains: [], text: '', fileName: 'top-knobs-2025.csv' }, vendors).vendorId, 'tk');
  assert.equal(guessVendor({ domains: [], text: '', reader: 'caldoor' }, [{ id: 'x', name: 'Doors R Us', readers: ['caldoor'] }]).vendorId, 'x');
  assert.deepEqual(guessVendor({ domains: [], text: '', reader: 'caldoor' }, []).newVendor, { name: 'Cal Door & Drawer', website: 'caldoor.com' });
  assert.deepEqual(guessVendor({ domains: ['richelieu.com'], text: '' }, vendors).newVendor, { name: 'Richelieu', website: 'richelieu.com' });
  assert.equal(guessVendor({ domains: [], text: 'nothing here' }, vendors), null);
});

check('review: likely non-parts start unticked, real part names do not', () => {
  for (const n of ['3/4", 1/2"', '3/4”, 3/8”', 'Scalloped with', 'San Simeon RTF, (Large C-Panel) in Mission White (discontinued']) assert.ok(nonPartReason(n), n);
  for (const n of ['MP-36', 'DB-2', 'CNS #21 with MUL-1', 'Echo Wood Rift White Oak, 3 piece with 1/8"x1/8" Square-groove', 'Giovanna-280 Glass Door', 'Shaker RTF (4 Lites)']) assert.equal(nonPartReason(n), null, n);
});

if (failed) { console.log(`${failed} FAILED`); process.exit(1); } else console.log('ALL PASSED');
