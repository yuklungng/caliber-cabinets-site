// Checks the Parts tab helpers on made-up jobs. Run: node scripts/test-production-parts.mjs
import assert from 'node:assert/strict';
import { matchOrdersToJobs } from '../api/_lib/productionNormalize.js';
import { orphanOrders } from '../api/_lib/productionJobs.js';
import { daysBefore, flattenOrders, isReceived, ordersSince, qtyToCheck, searchParts } from '../src/components/production/partsIndex.js';

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
};

const jobs = [
  { id: 'a', name: '#1 Alpha', jobRef: '#1', hardware: [
    { id: 'o1', orderedOn: '2026-11-01', parts: [{ qty: 10, name: 'Blum soft-close Hinge' }, { qty: 4, name: 'Drawer slide 21"' }] },
    { id: 'o2', orderedOn: '2026-06-01', status: 'Received', parts: [{ qty: 2, name: 'hinge plate' }] },
  ] },
  { id: 'b', name: '', jobRef: '#2', hardware: [
    { id: 'o3', orderedOn: null, orderedText: 'asap', parts: [{ qty: null, name: 'HINGE' }] },
    { id: 'o4', orderedOn: '2026-10-20', receivedText: '10/22', parts: [] },
  ] },
  { id: 'c', name: 'No orders', jobRef: '#3', hardware: [] },
];

check('one entry per order, carrying the job (ref when no name)', () => {
  const o = flattenOrders(jobs);
  assert.equal(o.length, 4);
  assert.equal(o.find((x) => x.key === 'b:o3').jobName, '#2');
});

check('received from any of date, text or status', () => {
  const o = Object.fromEntries(flattenOrders(jobs).map((x) => [x.key, x]));
  assert.equal(isReceived(o['a:o1']), false);
  assert.equal(isReceived(o['a:o2']), true);
  assert.equal(isReceived(o['b:o4']), true);
  assert.equal(isReceived({ status: 'Not Received' }), false);
});

check('date range keeps dated orders on or after the cutoff, newest first', () => {
  assert.equal(daysBefore('2026-11-16', 30), '2026-10-17');
  const r = ordersSince(flattenOrders(jobs), '2026-10-17');
  assert.deepEqual(r.map((x) => x.key), ['a:o1', 'b:o4']);
});

check('all orders include undated ones last', () => {
  assert.deepEqual(ordersSince(flattenOrders(jobs), null).map((x) => x.key), ['a:o1', 'b:o4', 'a:o2', 'b:o3']);
});

check('search matches every word, any case, and totals numeric quantities', () => {
  const r = searchParts(flattenOrders(jobs), ' Hinge ');
  assert.equal(r.lines.length, 3);
  assert.equal(r.totalQty, 12);
  assert.equal(r.uncounted, 1);
  assert.equal(r.jobs, 2);
  assert.equal(searchParts(flattenOrders(jobs), 'hinge plate').lines.length, 1);
  assert.equal(searchParts(flattenOrders(jobs), '   ').lines.length, 0);
});

check('quantities over 50 are flagged until a person edits or types them', () => {
  assert.equal(qtyToCheck({ qty: 527, name: 'Grass Guides' }), true);
  assert.equal(qtyToCheck({ qty: '182', name: 'salice' }), true);
  assert.equal(qtyToCheck({ qty: 50, name: 'x' }), false);
  assert.equal(qtyToCheck({ qty: null, name: 'x' }), false);
  assert.equal(qtyToCheck({ qty: 'lots', name: 'x' }), false);
  assert.equal(qtyToCheck({ qty: 527, name: 'x', edited: true }), false);
  assert.equal(qtyToCheck({ qty: 150, name: 'x', manual: true }), false);
});

check('search counts flagged lines in the total and in toCheck', () => {
  const big = [{ id: 'z', name: 'Z', jobRef: '#9', hardware: [{ id: 'o9', orderedOn: '2026-11-02', parts: [{ qty: 327, name: 'Grass Guides' }, { qty: 4, name: 'grass guides 18' }] }] }];
  const r = searchParts(flattenOrders(big), 'grass');
  assert.equal(r.totalQty, 331);
  assert.equal(r.toCheck, 1);
  assert.equal(r.lines.find((l) => l.qty === 327).check, true);
});

check('garbled job numbers on orders re-attach only to real, unambiguous jobs', () => {
  const o = (ref, text, temp = true) => ({ source_row_id: ref, job_ref: ref, ref_is_temp: temp, job_number: temp ? null : ref.slice(1), order_text: text });
  const rows = [
    o('T26-6322-MACACHOR', '6322 Macachor\n10) 21" salice'),
    o('T26-H6313-READLER', 'H6313-Readler\n32) 21" salice'),
    o('T26-16333-KAL', '16333-KAL\n12) 18" Salice'),
    o('T26-EBONY', '# -EBOnY\n25) 21" Salice'),
    o('T26-9999-NOPE', '9999 Nope'),
    o('T26-TWO', '6322 and 6313 shared'),
    o('#6302', '#6302-Whnight', false),
    o('T26-PARTS', 'Smith\n6322) hinges'),
  ];
  const { rows: out, matched } = matchOrdersToJobs(rows, new Set(['6322', '6313', '6333', '6302']));
  const by = Object.fromEntries(out.map((r) => [r.source_row_id, r]));
  assert.equal(matched, 3);
  assert.equal(by['T26-6322-MACACHOR'].job_ref, '#6322');
  assert.equal(by['T26-H6313-READLER'].job_ref, '#6313');
  assert.equal(by['T26-16333-KAL'].job_ref, '#6333');
  assert.equal(by['T26-16333-KAL'].ref_is_temp, false);
  assert.equal(by['T26-EBONY'].job_ref, 'T26-EBONY');
  assert.equal(by['T26-9999-NOPE'].ref_is_temp, true);
  assert.equal(by['T26-TWO'].ref_is_temp, true);
  assert.equal(by['#6302'].job_ref, '#6302');
  assert.equal(by['T26-PARTS'].ref_is_temp, true);
});

check('orders with no job are listed with their own label and no job link', () => {
  const list = [{ jobRef: '#1' }];
  const hardware = [
    { source_row_id: 'h1', job_ref: '#1', order_text: 'x' },
    { source_row_id: 'h2', job_ref: 'T17-ESTRADA', job_name: 'Estrada main', order_text: 'Estrada main\n2) hinge', ordered_on: '2017-06-03' },
  ];
  const orphans = orphanOrders({ list, hardware });
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].label, 'Estrada main');
  assert.deepEqual(orphans[0].parts.map((p) => `${p.qty}|${p.name}`), ['2|hinge']);
  const flat = flattenOrders([], orphans);
  assert.equal(flat[0].jobId, null);
  assert.equal(flat[0].jobName, 'Estrada main');
  assert.equal(searchParts(flat, 'hinge').lines.length, 1);
});

check('an order shown on two jobs with the same number is listed once', () => {
  const shared = { id: 'o1', orderedOn: '2020-01-01', parts: [{ qty: 2, name: 'hinge' }] };
  const flat = flattenOrders([{ id: 'j1', name: 'Telford', jobRef: '#4128', hardware: [shared] }, { id: 'j2', name: 'Jordan', jobRef: '#4128', hardware: [shared] }]);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].jobName, 'Telford');
  assert.equal(searchParts(flat, 'hinge').totalQty, 2);
});

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('ALL PASSED');
