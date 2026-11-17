// Checks the Shop view station helpers. Run: node scripts/test-production-shop.mjs
import assert from 'node:assert/strict';
import { buildJobList, mergeStepTicks } from '../api/_lib/productionJobs.js';
import { activeJobs, jobStations, nextVisit, stationCounts } from '../src/components/production/shopStages.js';

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
};

const ALL = ['Paperwork In Shop', 'Body Cut', 'Edge Band Ordered', 'Edge banded', 'Boxes Built', 'Frames Built', 'Doors and Drawers Sanded', 'Sealer / Primer', 'Final Coat', 'Doors Hinged', 'Hardware Installed'];
const steps = (doneUpTo) => Object.fromEntries(ALL.map((k, i) => [k, i < doneUpTo]));

check('a new job sits at Paperwork', () => {
  const r = jobStations({ steps: steps(0), installs: [] });
  assert.equal(r.current, 'paperwork');
  assert.deepEqual(r.stations.map((s) => s.state), ['now', 'todo', 'todo', 'todo', 'todo', 'todo']);
});

check('Edge Band Ordered left unticked does not hold a job at Cut', () => {
  const s = { ...steps(11), 'Edge Band Ordered': false, 'Boxes Built': false, 'Frames Built': false };
  assert.equal(jobStations({ steps: s }).current, 'build');
});

check('all boxes ticked but not installed waits at Install; installed and completed is done', () => {
  assert.equal(jobStations({ steps: steps(11), installs: [{ installOn: '2026-11-20', completed: false }] }).current, 'out');
  assert.equal(jobStations({ steps: steps(11), installs: [{ installOn: '2026-11-20', completed: true }] }).current, null);
});

check('a completed install finishes the job even when its step boxes were never ticked', () => {
  const r = jobStations({ steps: steps(1), installs: [{ installOn: '2026-10-13', completed: true }] });
  assert.equal(r.current, null);
  assert.ok(r.stations.every((s) => s.state === 'done'));
});

check('a step box with an unknown name is kept as "other"', () => {
  const r = jobStations({ steps: { ...steps(1), 'Crown Molding': true } });
  assert.deepEqual(r.other.map((o) => o.name), ['Crown Molding']);
});

check('old unfinished rows with no recent date are left off the shop floor', () => {
  const today = '2026-11-17';
  const jobs = [
    { id: 1, steps: steps(3), installs: [{ installOn: '2026-12-02' }] },
    { id: 2, steps: steps(3), installs: [{ installOn: '2021-04-01' }] },
    { id: 3, steps: steps(11), installs: [{ installOn: '2026-11-10', completed: true }] },
    { id: 4, steps: steps(5), installs: [], hardware: [{ orderedOn: '2026-10-01' }] },
  ];
  assert.deepEqual(activeJobs(jobs, today).map((j) => j.id), [1, 4]);
  const c = stationCounts(activeJobs(jobs, today));
  assert.equal(c.cut, 1);
  assert.equal(c.build, 1);
});

check('nextVisit skips completed rows and prefers the install date', () => {
  const j = { installs: [{ installOn: '2026-10-01', completed: true }, { deliveryOn: '2026-11-20', installOn: '2026-11-21' }] };
  assert.deepEqual(nextVisit(j), { kind: 'Install', on: '2026-11-21', text: null });
  assert.equal(nextVisit({ installs: [] }), null);
});

check('a tick made on the Shop view wins over the sheet box, and only for steps the sheet has', () => {
  const r = mergeStepTicks({ 'Body Cut': false, 'Final Coat': true }, [
    { step: 'Body Cut', done: true, ticked_by: 'A', ticked_at: '2026-11-17T10:00:00Z' },
    { step: 'Final Coat', done: false, ticked_by: 'B', ticked_at: '2026-11-17T11:00:00Z' },
    { step: 'Made Up', done: true, ticked_by: 'C', ticked_at: '2026-11-17T12:00:00Z' },
  ]);
  assert.deepEqual(r.steps, { 'Body Cut': true, 'Final Coat': false });
  assert.equal(r.tickedBy['Body Cut'].by, 'A');
  assert.equal(r.tickedBy['Made Up'], undefined);
});

check('ticks follow the sheet row, so two jobs sharing a number are ticked separately', () => {
  const job = (row, ref) => ({ id: row, source_row_id: row, job_ref: ref, ref_is_temp: false, job_name: row, steps: { 'Body Cut': false } });
  const list = buildJobList({ jobs: [job('r1', '#5971'), job('r2', '#5971')], installs: [], hardware: [], ticks: [{ job_row_id: 'r2', step: 'Body Cut', done: true, ticked_by: 'A', ticked_at: '2026-11-17T10:00:00Z' }] });
  const by = Object.fromEntries(list.map((j) => [j.id, j]));
  assert.equal(by.r1.steps['Body Cut'], false);
  assert.equal(by.r2.steps['Body Cut'], true);
  assert.equal(by.r2.stepsDone, 1);
  assert.equal(by.r2.rowId, 'r2');
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
