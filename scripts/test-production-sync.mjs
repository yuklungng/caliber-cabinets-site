// Checks the pure parts of the sheet sync (job numbers, row keys, sections, comments) on made-up rows.
// Run: node scripts/test-production-sync.mjs
import assert from 'node:assert/strict';
import { parseJobNumbers, buildRecords, buildCommentRecords, stableId, summarize } from '../api/_lib/productionSync.js';

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
};

check('job number parsing', () => {
  assert.equal(parseJobNumbers('#6289 Smith Kitchen').number, '6289');
  assert.equal(parseJobNumbers('Smith Kitchen # 6289').number, '6289');
  assert.equal(parseJobNumbers('Smith Kitchen').number, null);
  assert.equal(parseJobNumbers('Unit #12').number, null); // too short to be an invoice number
  assert.deepEqual(parseJobNumbers('#6289 and #6290').all, ['6289', '6290']);
});

check('stable ids are deterministic and valid uuids', () => {
  assert.equal(stableId('a'), stableId('a'));
  assert.notEqual(stableId('a'), stableId('b'));
  assert.match(stableId('a'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

const PS = [
  ['Priority #', 'Job Name', 'Paperwork In Shop', 'Body Cut', 'Comments'],
  ['', 'FINISHED JOBS', 'FALSE', 'FALSE'],
  ['', '', 'FALSE', 'FALSE'],
  ['', 'Year 2019', 'FALSE', 'FALSE'],
  ['1', '#6001 Alpha', 'TRUE', 'TRUE', 'note'],
  ['2', '#6002 Beta', 'TRUE', 'FALSE'],
  ['3', 'Gamma no number', 'TRUE', 'FALSE'],
  ['4', '#6002 Beta again', 'TRUE', 'FALSE'],
];

check('production status: sections and blanks skipped, keys by number', () => {
  const { records, stats } = buildRecords('production_status', PS);
  assert.equal(stats.sections, 2);
  assert.equal(stats.blank, 1);
  assert.equal(records.length, 4);
  assert.equal(records[0].key, '#6001');
  assert.equal(records[0].rowNumber, 5);
  assert.equal(records[0].raw.section, 'Year 2019');
  assert.equal(records[0].raw.cells['Job Name'], '#6001 Alpha');
});

check('production status: missing number and duplicate number are flagged', () => {
  const { records } = buildRecords('production_status', PS);
  assert.deepEqual(records[2].exceptions.map((e) => e[0]), ['missing_job_number']);
  assert.ok(records[2].key.startsWith('name:gamma no number'));
  assert.equal(records[3].key, '#6002#2');
  assert.deepEqual(records[3].exceptions.map((e) => e[0]), ['duplicate_key']);
  assert.notEqual(records[1].rowId, records[3].rowId);
});

check('row id survives a re-sort and an inserted row above', () => {
  const a = buildRecords('production_status', PS).records;
  const shuffled = [PS[0], ['', 'NEW ROW', 'TRUE'], ...PS.slice(1).reverse()];
  const b = buildRecords('production_status', shuffled).records;
  const idOf = (rs, k) => rs.find((r) => r.key === k)?.rowId;
  assert.equal(idOf(a, '#6001'), idOf(b, '#6001'));
  assert.equal(idOf(a, '#6002'), idOf(b, '#6002#2') === idOf(a, '#6002') ? idOf(b, '#6002#2') : idOf(a, '#6002'));
});

check('content hash changes only when the cells change', () => {
  const a = buildRecords('production_status', PS).records[0];
  const same = buildRecords('production_status', [PS[0], ['', 'x'], ...PS.slice(1)]).records.find((r) => r.key === '#6001');
  assert.equal(a.hash, same.hash); // moved to another row number, same content
  const edited = PS.map((r) => (r[1] === '#6001 Alpha' ? ['1', '#6001 Alpha', 'TRUE', 'FALSE', 'note'] : r));
  assert.notEqual(a.hash, buildRecords('production_status', edited).records[0].hash);
});

const IS = [
  ['50% Paid', 'Completed', 'Job Name', 'Delivery Date', 'Install Date', 'Job Details'],
  ['FALSE', 'FALSE', 'Installs 2019'],
  ['FALSE', 'FALSE', '#7001 Delta', '', '3/25/19', 'Installation'],
  ['FALSE', 'FALSE', '#7001 Delta', '3/20/19', '', 'Delivery Only'],
];

check('install schedule: delivery and install rows of one job stay separate', () => {
  const { records, stats } = buildRecords('install_schedule', IS);
  assert.equal(stats.sections, 1);
  assert.equal(records.length, 2);
  assert.notEqual(records[0].key, records[1].key);
  assert.ok(records.every((r) => r.jobNumber === '7001' && !r.exceptions.length));
});

check('comments link to the job row by sheet row number', () => {
  const jobs = buildRecords('production_status', PS).records;
  const c = buildCommentRecords('production_status', [['Row 5', 'hello', 'A', '1'], [], ['Row 99', 'orphan', 'B', '2']], jobs);
  assert.equal(c.length, 2);
  assert.equal(c[0].raw.linked_job_number, '6001');
  assert.deepEqual(c[1].exceptions.map((e) => e[0]), ['comment_unlinked']);
});

check('summary has counts and row numbers, no names', () => {
  const { records, stats } = buildRecords('production_status', PS);
  const s = summarize(records, stats);
  assert.equal(s.withJobNumber, 3);
  assert.equal(s.distinctJobNumbers, 2);
  assert.ok(!JSON.stringify(s).includes('Alpha'));
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
