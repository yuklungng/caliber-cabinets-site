// Checks the "This week" date helpers. Run: node scripts/test-production-week.mjs
import assert from 'node:assert/strict';
import { addDays, mondayOf, todayIso, weekDays } from '../src/components/production/weekSchedule.js';

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
};

check('mondayOf gives the Monday on or before any day, across month and year ends', () => {
  assert.equal(mondayOf('2026-11-03'), '2026-11-02'); // Tuesday
  assert.equal(mondayOf('2026-11-02'), '2026-11-02'); // Monday
  assert.equal(mondayOf('2026-11-08'), '2026-11-02'); // Sunday
  assert.equal(mondayOf('2027-01-01'), '2026-12-28'); // Friday
});

check('addDays crosses daylight-saving changes without drifting', () => {
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-11-02', -7), '2026-10-26');
});

check('todayIso uses the local date', () => {
  assert.equal(todayIso(new Date(2026, 10, 3, 23, 59)), '2026-11-03');
});

const job = (id, name, installs) => ({ id, name, jobRef: `#${id}`, isTemp: false, installs });

check('weekDays places deliveries and installs on their days and ignores dates outside the week or text-only', () => {
  const days = weekDays([
    job('b', 'Beta', [{ deliveryOn: '2026-11-04', installOn: '2026-11-06', details: 'Kitchen', confirmed: true, completed: false }]),
    job('a', 'Alpha', [{ installOn: '2026-11-04' }, { deliveryOn: '2026-11-09' }, { installOn: null, installText: 'TBD' }]),
    job('c', 'Gamma', []),
  ], '2026-11-02');
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.deepEqual(days[2].items.map((i) => [i.jobName, i.kind]), [['Beta', 'Delivery'], ['Alpha', 'Install']]);
  assert.deepEqual(days[4].items.map((i) => [i.jobName, i.kind, i.details, i.confirmed]), [['Beta', 'Install', 'Kitchen', true]]);
  assert.equal(days.flatMap((d) => d.items).length, 3);
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
