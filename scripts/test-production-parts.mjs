// Checks the Parts tab helpers on made-up jobs. Run: node scripts/test-production-parts.mjs
import assert from 'node:assert/strict';
import { daysBefore, flattenOrders, isReceived, ordersSince, searchParts } from '../src/components/production/partsIndex.js';

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

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('ALL PASSED');
