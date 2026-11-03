// Checks the job list join on made-up rows. Run: node scripts/test-production-jobs.mjs
import assert from 'node:assert/strict';
import { buildJobList, readAll } from '../api/_lib/productionJobs.js';

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
};

const job = (over) => ({
  id: 'j1', source_row_id: 's1', job_ref: '#6001', ref_is_temp: false, job_name: '#6001 Alpha', section: 'Year 2019',
  priority: null, steps: { 'Body Cut': true, 'Boxes Built': false, 'Final Coat': true }, paint_color: 'White', pvc_tape_color: null,
  paint_ordered: true, paint_arrives_on: '2019-03-04', paint_arrives_text: null, doors_arrive_on: null, doors_arrive_text: 'soon', ...over,
});

await check('joins installs and hardware by job_ref, counts steps, sorts events by date', () => {
  const list = buildJobList({
    jobs: [job()],
    installs: [
      { job_ref: '#6001', install_on: '2019-03-25', delivery_on: null, completed: false },
      { job_ref: '#6001', install_on: null, delivery_on: '2019-03-20', completed: true },
      { job_ref: '#9999', install_on: '2019-01-01' },
    ],
    hardware: [
      { job_ref: '#6001', ordered_on: '2019-02-01' }, { job_ref: '#6001', ordered_on: '2019-02-20' }, { job_ref: '#9999', ordered_on: '2020-01-01' },
    ],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].stepsDone, 2);
  assert.equal(list[0].stepsTotal, 3);
  assert.deepEqual(list[0].installs.map((e) => e.deliveryOn ?? e.installOn), ['2019-03-20', '2019-03-25']);
  assert.equal(list[0].hardwareOrders, 2);
  assert.equal(list[0].lastHardwareOrderOn, '2019-02-20');
  assert.equal(list[0].doorsArrive.text, 'soon');
});

await check('a job with nothing else attached still lists, and the sheet order is kept', () => {
  const list = buildJobList({
    jobs: [job({ id: 'b', source_row_id: 'sb', job_ref: '#2' }), job({ id: 'a', source_row_id: 'sa', job_ref: '#1', steps: {} })],
    installs: [], hardware: [],
    rowNumbers: new Map([['sa', 5], ['sb', 9]]),
  });
  assert.deepEqual(list.map((j) => j.id), ['a', 'b']);
  assert.equal(list[0].stepsTotal, 0);
  assert.deepEqual(list[0].installs, []);
  assert.equal(list[0].hardwareOrders, 0);
  assert.equal(list[0].lastHardwareOrderOn, null);
});

await check('a heading row with nothing filled in is left out, but an empty numbered job stays', () => {
  const list = buildJobList({
    jobs: [
      job({ id: 'h', source_row_id: 'sh', job_ref: 'T25-JOBS-IN', ref_is_temp: true, job_name: 'JOBS IN THE SHOP', steps: {}, paint_color: null, paint_arrives_on: null, doors_arrive_text: null }),
      job({ id: 'n', source_row_id: 'sn', job_ref: '#7', steps: {}, paint_color: null, paint_arrives_on: null, doors_arrive_text: null }),
      job({ id: 't', source_row_id: 'st', job_ref: 'T25-X', ref_is_temp: true, steps: { A: true }, paint_color: null, paint_arrives_on: null, doors_arrive_text: null }),
    ],
    installs: [], hardware: [],
  });
  assert.deepEqual(list.map((j) => j.id).sort(), ['n', 't']);
});

await check('hardware orders list their parts (lines after the job name), dates, status and notes', () => {
  const list = buildJobList({
    jobs: [job()],
    installs: [],
    hardware: [
      { job_ref: '#6001', order_text: ['#6001 Alpha', '6) 18 Guides', '', ' Knife Block '].join('\n'), ordered_on: '2019-02-20', received_on: null, received_text: null, status: 'Ordered', notes: 'rush' },
      { job_ref: '#6001', order_text: '#6001 Alpha', ordered_on: '2019-02-01' },
    ],
  });
  const h = list[0].hardware;
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((o) => o.orderedOn), ['2019-02-01', '2019-02-20']);
  assert.deepEqual(h[0].parts, []);
  assert.deepEqual(h[1].parts, [{ qty: 6, name: '18 Guides', fromNotes: false }, { qty: null, name: 'Knife Block', fromNotes: false }]);
  assert.equal(h[1].status, 'Ordered');
  assert.equal(h[1].notes, 'rush');
});

await check('parts table rows win over the order text: edits show, removed parts stay hidden', () => {
  const hardware = [{ source_row_id: 's1', job_ref: '#6001', order_text: '#6001 Alpha\n6) Guides\n1) Pulls', ordered_on: '2019-02-01' },
    { source_row_id: 's2', job_ref: '#6001', order_text: '#6001 Alpha\n2) Hinges', ordered_on: '2019-03-01' }];
  const parts = [
    { id: 'p1', order_source_row_id: 's1', line_no: 2, qty: 4, part_name: 'Pulls fixed', source: 'sheet', edited: true, removed_at: null },
    { id: 'p0', order_source_row_id: 's1', line_no: 1, qty: 6, part_name: 'Guides', source: 'sheet', edited: false, removed_at: null },
    { id: 'p2', order_source_row_id: 's1', line_no: 3, qty: 1, part_name: 'Gone', source: 'sheet', edited: true, removed_at: 'x' },
    { id: 'p3', order_source_row_id: 's1', line_no: 1001, qty: 2, part_name: 'From notes', source: 'sheet', edited: false, removed_at: null },
    { id: 'p4', order_source_row_id: 's1', line_no: 2000, qty: 9, part_name: 'By hand', source: 'manual', edited: true, removed_at: null },
  ];
  const [built] = buildJobList({ jobs: [job()], installs: [], hardware, parts });
  const [a, b] = built.hardware;
  assert.equal(a.id, 's1');
  assert.deepEqual(a.parts.map((p) => [p.id, p.qty, p.name, p.fromNotes, p.manual, p.edited]), [
    ['p0', 6, 'Guides', false, false, false], ['p1', 4, 'Pulls fixed', false, false, true],
    ['p3', 2, 'From notes', true, false, false], ['p4', 9, 'By hand', false, true, true]]);
  assert.deepEqual(b.parts, [{ qty: 2, name: 'Hinges', fromNotes: false }]); // no rows yet: read from the text, no id
});

await check('readAll pages through more than 1000 rows and stops on a short page', async () => {
  const calls = [];
  const supabase = {
    from: () => ({ select: () => ({ range: async (a, b) => {
      calls.push([a, b]);
      return { data: Array.from({ length: a === 0 ? 1000 : 250 }, (_, i) => ({ i })), error: null };
    } }) }),
  };
  const rows = await readAll(supabase, 't', '*');
  assert.equal(rows.length, 1250);
  assert.deepEqual(calls, [[0, 999], [1000, 1999]]);
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
