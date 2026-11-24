// Price books (db/production/010): the table reader and the part-to-table matching, on made-up pages.
// Run: node scripts/test-production-pricebooks.mjs
import assert from 'node:assert/strict';
import {
  bookTables, bookTitle, doorMinimum, looksLikePriceBook, pageTables, parseAdder, parseRate, pricingFor, variantFor,
} from '../src/components/production/priceBookReader.js';
import { cleanPriceTable, matchPartTables, partNames, tableKey } from '../api/_lib/productionVendors.js';
import { isPriceBookAction } from '../api/_lib/productionPriceBooksApi.js';

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
};

// A text run at (x, y) in page points from the top left, like pageItems returns.
const it = (text, x, y, { w = text.length * 5, size = 9, rotated = false } = {}) => ({
  text, x0: x, x1: x + w, top: y - size / 2, bottom: y + size / 2, cx: x + w / 2, cy: y, size, rotated,
});

// A made-up wood-style page: a side title, captions, headings over five columns, rows with labels, options below.
function woodPage() {
  const items = [
    it('Sample Standard Series', 28, 300, { rotated: true, w: 9 }),
    it('Alpha', 160, 200), it('Beta', 400, 200),
    it('Cut for Glass', 390, 255, { w: 60 }),
    it('Alpha', 213, 275), it('Beta', 287, 275), it('Solid', 525, 269), it('Materials', 90, 281), it('Drawer', 523, 281),
    it('2 1/4" S&R', 205, 287, { w: 40 }), it('2 1/4" S&R', 279, 287, { w: 40 }), it('Alpha', 360, 287), it('Beta', 446, 281), it('Fronts', 525, 293),
    it('2 1/4" S&R', 352, 302, { w: 40 }), it('2 1/4" S&R', 437, 308, { w: 40 }),
  ];
  const rows = [['Oak - Select', [12.5, 15.5, 10.25, 13, 10]], ['Maple - Select', [14, 17.5, 11.75, 14.75, 13]], ['Walnut - Select', [33.25, 41.5, 27.25, 34.25, 26.25]]];
  rows.forEach(([label, vals], k) => {
    const y = 342 + k * 15.5;
    items.push(it(label, 45, y, { w: 90 }));
    [220, 293, 367, 452, 530].forEach((x, c) => items.push(it(vals[c].toFixed(2), x, y, { w: 20 })));
  });
  items.push(it('3" Stiles & Rails: add 20% to sq. ft. price', 41, 560, { w: 200 }));
  items.push(it('R-4 & R-5 Outside Edge: add $7.00 per sq. ft.', 41, 575, { w: 210 }));
  items.push(it('All doors are minimum 2 sq. ft.', 36, 600, { w: 140 }));
  return items;
}

check('numbers: prices and N/A are cells; other numbers are not', () => {
  assert.equal(parseRate('12.50'), 12.5);
  assert.equal(parseRate('$1,016.00'), 1016);
  assert.equal(parseRate('0.43'), 0.43);
  assert.equal(parseRate('N/A'), null);
  assert.equal(parseRate('126-127'), null);
});

check('reader: one table, labelled rows, headed columns, side title and captions', () => {
  const [t] = pageTables(woodPage());
  assert.equal(t.title, 'Sample Standard Series');
  assert.deepEqual(t.rows.map((r) => r.label), ['Oak - Select', 'Maple - Select', 'Walnut - Select']);
  assert.equal(t.columns.length, 5);
  assert.deepEqual(t.columns.map((c) => c.variant), ['price', 'price', 'glass', 'glass', 'drawer_front']);
  assert.match(t.columns[0].label, /^Alpha 2 1\/4" S&R$/);
  assert.match(t.columns[2].label, /^Cut for Glass Alpha/);
  assert.equal(t.rows[2].cells.c2.rate, 41.5);
  assert.deepEqual(t.styles, ['Alpha', 'Beta']);
  assert.deepEqual(t.issues, []);
});

check('reader: adders and minimums from the page; door columns named in a per-sq-ft book', () => {
  const [t] = bookTables([{ page: 8, items: woodPage(), width: 612, height: 792 }]);
  assert.equal(t.pricing, 'per_sq_ft');
  assert.equal(t.minSqFt, 2);
  assert.equal(t.columns[0].variant, 'door');
  assert.deepEqual(t.adders.map((a) => [a.kind, a.value, a.label]), [['percent', 20, '3" Stiles & Rails'], ['per_sq_ft', 7, 'R-4 & R-5 Outside Edge']]);
});

check('reader: a missing number or a number out of line is flagged, not dropped', () => {
  const items = woodPage().filter((i) => !(i.text === '17.50'));
  const w = items.find((i) => i.text === '26.25');
  w.text = '262.50';
  const [t] = pageTables(items);
  assert.equal(t.rows.length, 3);
  assert.ok(t.issues.some((x) => /Row 2 \(Maple - Select\): no number under/.test(x)), t.issues.join('; '));
  assert.ok(t.issues.some((x) => /262\.50 is far out of line/.test(x)), t.issues.join('; '));
});

check('reader: two tables side by side with their rows out of step stay apart', () => {
  const items = [it('Route', 190, 40), it('Materials', 350, 40), it('Price', 505, 40)];
  ['R-2', 'R-3', 'R-4'].forEach((s, k) => { items.push(it(s, 58, 90 + k * 29)); items.push(it('10.00', 192, 90 + k * 29, { w: 20 })); });
  ['MDF', 'Alder', 'Maple', 'Walnut'].forEach((s, k) => { items.push(it(s, 294, 104 + k * 22)); items.push(it((10 + k).toFixed(2), 505, 104 + k * 22, { w: 20 })); });
  const ts = pageTables(items);
  assert.equal(ts.length, 2);
  assert.deepEqual(ts[0].rows.map((r) => r.label), ['R-2', 'R-3', 'R-4']);
  assert.deepEqual(ts[1].rows.map((r) => r.label), ['MDF', 'Alder', 'Maple', 'Walnut']);
});

check('reader: a lone price in running text is not a table', () => {
  assert.deepEqual(pageTables([it('Handling', 40, 100), it('$1.00', 120, 100, { w: 20 }), it('per piece', 150, 100)]), []);
});

check('reader: drawer-box columns (linear inch and per box)', () => {
  assert.equal(variantFor('2 1/4" & 3 1/4" Linear Price'), 'per_inch');
  assert.equal(variantFor('2 1/4" & 3 1/4" Per Box Price'), 'per_box');
  assert.equal(variantFor('Sample RTF Cut for Glass: sq. ft. price + $20.00 per piece'), 'price');
  assert.equal(variantFor("Sample Routed DF's"), 'drawer_front');
});

check('adders: phrases', () => {
  assert.deepEqual(parseAdder('2 1/2" Stiles & Rails: add 10% to sq. ft. price'), { label: '2 1/2" Stiles & Rails', kind: 'percent', value: 10, raw: '2 1/2" Stiles & Rails: add 10% to sq. ft. price' });
  assert.equal(parseAdder('Standard placement of lites: $10.00 per lite.').kind, 'per_lite');
  assert.equal(parseAdder('Drawer Boxes with 3/8" bottom: Add $10.00 per drawer box').kind, 'per_box');
  assert.equal(parseAdder('Routed Drawer Fronts: use solid drawer front sq. ft. price + $10.00 per piece.').label, 'Routed Drawer Fronts');
  assert.equal(parseAdder('Prices are subject to change without notice.'), null);
  assert.equal(doorMinimum(['All doors have a 2 sq. ft. minimum. All solid stock & routed drawers have a 1 sq. ft. minimum.']), 2);
});

check('reader: column headings decide pricing and minimum over the small print', () => {
  const t = 'Product Samples Each Edgeband: Miscellanous available: $1.50 per lineal foot';
  assert.equal(pricingFor(t, [{ label: 'Each', variant: 'price' }]), 'each');
  assert.equal(pricingFor('add $1.50 per lineal foot', [{ label: 'Price Per Square Foot Minimum 2 sq. ft.', variant: 'price' }]), 'per_sq_ft');
  assert.equal(pricingFor('Moldings per 8\' length', [{ label: 'Price', variant: 'price' }]), 'per_length');
  assert.equal(doorMinimum(['Price Per Square Foot Minimum 2 sq. ft.']), 2);
  const a = parseAdder('Standard Placement ONLY: add $3.00 per hole.');
  assert.deepEqual([a.kind, a.value, a.label], ['each', 3, 'Standard Placement ONLY (per hole)']);
  assert.equal(parseAdder('Add $4.00 per notch.').label, 'Add $4.00 per notch.');
});

check('books: title and edition from the file name; price books told from catalogs', () => {
  assert.deepEqual(bookTitle('2026 Sample Price Book (April2026).pdf'), { title: 'Sample Price Book', edition: 'April 2026' });
  assert.equal(looksLikePriceBook('2026 Sample Price Book (April2026).pdf', ''), true);
  assert.equal(looksLikePriceBook('2024 Product Catalog (Sept2024).pdf', 'pricing'), false);
  assert.equal(looksLikePriceBook('scan.pdf', 'Sample Profile & Prices 2025'), true);
});

check('matching: a part finds the table that prints its name, not a near name', () => {
  const tables = [
    { id: 'w8', title: 'Sample Standard Series', styles: ['Alpha', 'Beta'] },
    { id: 'w10', title: 'x', styles: ['Gamma, Delta', '& Epsilon'] },
    { id: 'r46', title: 'Premier Series - Alpha RTF, Delta RTF & Gamma RTF', styles: [] },
    { id: 'r16', title: 'Contemporary Series - Plank RTF Door', styles: ['Plank RTF'], also_names: ['Alpha RTF Glass Door'] },
    { id: 'm52', title: 'Mitered Series', styles: [], also_names: ['Zeta', 'Mitered #5 Solid'] },
  ];
  assert.deepEqual(matchPartTables({ name: 'Alpha' }, tables), ['w8']);
  assert.deepEqual(matchPartTables({ name: 'Epsilon' }, tables), ['w10']);
  assert.deepEqual(matchPartTables({ name: 'Alpha RTF' }, tables), ['r46']);
  assert.deepEqual(matchPartTables({ name: 'Alpha RTF Glass' }, tables), ['r46'], 'own-page names beat the pages after');
  assert.deepEqual(matchPartTables({ name: 'Alpha RTF (4 Lites)' }, tables), ['r46']);
  assert.deepEqual(matchPartTables({ name: 'Mitered #5 Solid' }, tables), ['m52']);
  assert.deepEqual(matchPartTables({ name: 'Unknown' }, tables), []);
  assert.deepEqual(matchPartTables({ name: 'Alpha' }, tables, [{ table_id: 'w8', how: 'hidden' }, { table_id: 'w10', how: 'manual' }]), ['w10']);
  assert.ok(partNames('Sample French Lite (p. 37)').includes('sample'));
});

check('reader: a "Door Styles" list beside "Materials" gives the styles; the rows are the materials', () => {
  const items = [it('Door Styles', 54, 44, { w: 52 }), it('Materials', 186, 44, { w: 43 }), it('Price', 320, 44, { w: 30 })];
  const mats = ['MDF 13/16" Thick', 'Alder - Select', 'Maple - Select'];
  ['Ellen', 'Iceland Solid', 'Juanita'].forEach((s, k) => {
    const y = 89 + k * 23;
    items.push(it(s, 42.3, y, { w: 40 }), it(mats[k], 141, y, { w: 80 }), it((17.5 + k).toFixed(2), 322, y, { w: 25 }));
  });
  items.push(it('MP-26 Solid', 42.3, 158, { w: 45 }), it('See Profile', 42.3, 181, { w: 40 }), it('MP-48 Solid', 42.3, 204, { w: 45 }));
  items.push(it('Unrelated note far below', 42.3, 400, { w: 60 }));
  const [t] = pageTables(items);
  assert.deepEqual(t.rows.map((r) => r.label), mats);
  assert.deepEqual(t.styles, ['Ellen', 'Iceland Solid', 'Juanita', 'MP-26 Solid', 'MP-48 Solid']);
});

check('matching: row labels for doors, applied molding dropped, options on many pages left out', () => {
  const tables = [
    { id: 'echo', title: 'Echo Wood Panels', styles: [], row_labels: ['Echo Wood Qtr Cherry', 'Echo Wood Slate'] },
    { id: 'sm', title: 'Executive Series - San Marino RTF', styles: ['San Marino RTF'] },
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `w${n}`, title: `Series ${n}`, styles: ['R-4', `Style ${n}`] })),
  ];
  assert.deepEqual(matchPartTables({ name: 'Echo Wood Qtr Cherry', kind: 'door_style' }, tables), ['echo']);
  assert.deepEqual(matchPartTables({ name: 'Echo Wood Qtr Cherry', kind: 'other' }, tables), [], 'colours are not matched by row');
  assert.deepEqual(matchPartTables({ name: 'San Marino AM-4 RTF', kind: 'door_style' }, tables), ['sm']);
  assert.deepEqual(matchPartTables({ name: 'R-4 (no lip) & R-5 (fingerpull)', kind: 'drawer_front' }, tables), []);
  assert.deepEqual(matchPartTables({ name: 'Style 3', kind: 'door_style' }, tables), ['w3']);
});

check('tables: cleaned for insert; identity across editions ignores page moves', () => {
  const t = bookTables([{ page: 8, items: woodPage(), width: 612, height: 792 }])[0];
  const c = cleanPriceTable(t);
  assert.equal(c.table.columns.length, 5);
  assert.equal(c.cells.length, 15);
  assert.equal(c.adders.length, 2);
  assert.deepEqual(c.table.row_labels, ['Oak - Select', 'Maple - Select', 'Walnut - Select']);
  assert.equal(tableKey(c.table), tableKey({ ...c.table, page: 99 }));
  assert.throws(() => cleanPriceTable({ ...t, rows: [{ label: 'x', cells: { c9: { rate: 1 } } }] }), /unknown column/);
  assert.throws(() => cleanPriceTable({ ...t, rows: [{ label: 'x', cells: { c1: { rate: -4 } } }] }), /invalid/);
});

check('api: price-book actions are routed', () => {
  for (const a of ['price-book-start', 'price-book-tables', 'price-book-done', 'price-tables', 'price-table', 'price-table-save', 'price-table-check', 'price-table-remove', 'part-price-link']) assert.ok(isPriceBookAction(a), a);
  assert.ok(!isPriceBookAction('vendor-parts'));
});

if (failed) { console.log(`${failed} FAILED`); process.exit(1); } else console.log('ALL PASSED');
