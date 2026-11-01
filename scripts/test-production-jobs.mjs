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
