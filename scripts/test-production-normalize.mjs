// Checks the pure parts of the raw -> tidy tables step on made-up rows.
// Run: node scripts/test-production-normalize.mjs
import assert from 'node:assert/strict';
import {
  parseSheetDate, productionJobFrom, installEventFrom, hardwareOrderFrom, summarizeNormalized, writeNormalized,
  parsePartLine, hardwarePartRows, writeHardwareParts, cleanPartInput,
} from '../api/_lib/productionNormalize.js';

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
};
const raw = (cells, extra = {}) => ({ row_id: 'r1', removed_at: null, raw: { cells, section: '', job_number: null, ...extra } });

await check('dates: 2 and 4 digit years, ISO, and the ones that stay text', () => {
  assert.deepEqual(parseSheetDate('06/03/17'), { on: '2017-06-03', text: '06/03/17' });
  assert.equal(parseSheetDate('6/3/2021').on, '2021-06-03');
  assert.equal(parseSheetDate('2024-02-29').on, '2024-02-29');
  assert.equal(parseSheetDate('06/03/99').on, null); // typo year is kept as text, not guessed
  assert.equal(parseSheetDate('1/25/0026').on, null);
  assert.equal(parseSheetDate('2/30/2020').on, null); // not a real day
  assert.equal(parseSheetDate('TBD').text, 'TBD');
  assert.deepEqual(parseSheetDate(''), { on: null, text: null });
});

await check('dates: ranges give the first day and keep the text', () => {
  assert.deepEqual(parseSheetDate('02/10 - 02/11/25'), { on: '2025-02-10', text: '02/10 - 02/11/25', range: true });
  assert.equal(parseSheetDate('1/15-1/16/20').on, '2020-01-15');
  assert.equal(parseSheetDate('08/16-8/17-8/18/21').on, '2021-08-16');
  assert.equal(parseSheetDate('1/3/24 - 1/9/24').on, '2024-01-03');
  assert.equal(parseSheetDate('12/30 - 1/2/21').on, '2020-12-30'); // crosses New Year
  assert.equal(parseSheetDate('11/17 - 11/18').on, null); // no year anywhere: stays text
  assert.equal(parseSheetDate('Delivery Only').on, null);
  const r = installEventFrom(raw({ 'Job Name': '#7002 Echo', 'Install Date': '02/10 - 02/11/25' }, { job_number: '7002' }));
  assert.equal(r.install_on, '2025-02-10');
  assert.equal(r.install_text, '02/10 - 02/11/25');
  assert.equal(summarizeNormalized([r]).unparsedDates, 0); // parsed, so not counted as unparsed
});

await check('production job: real number, steps, dates, section year', () => {
  const r = productionJobFrom(raw({
    'Job Name': '#6001 Alpha Kitchen', 'Body Cut': 'TRUE', 'Boxes Built': 'FALSE', 'Paint Ordered': 'TRUE',
    'Paint Color / Stain Color': 'White', 'Doors & Drawer Box Arrival Date': '03/04/20', 'Paint Arrives': 'soon',
  }, { job_number: '6001', section: 'Year 2019' }));
  assert.equal(r.job_ref, '#6001');
  assert.equal(r.ref_is_temp, false);
  assert.deepEqual(r.steps, { 'Body Cut': true, 'Boxes Built': false });
  assert.equal(r.paint_ordered, true);
  assert.equal(r.doors_arrive_on, '2020-03-04');
  assert.equal(r.paint_arrives_on, null);
  assert.equal(r.paint_arrives_text, 'soon');
  assert.equal(r.section, 'Year 2019');
});

await check('production job: temp ref takes the year from the section, then from a date', () => {
  const a = productionJobFrom(raw({ 'Job Name': 'Gamma Residence' }, { section: 'Year 2019' }));
  assert.equal(a.job_ref, 'T19-GAMMA-RESIDENCE');
  assert.equal(a.ref_is_temp, true);
  assert.equal(a.job_number, null);
  const b = productionJobFrom(raw({ 'Job Name': 'Gamma Residence', 'Paint Arrives': '05/06/21' }, { section: 'FINISHED JOBS' }));
  assert.equal(b.job_ref, 'T21-GAMMA-RESIDENCE');
});

await check('install event: dates, times, checkboxes', () => {
  const r = installEventFrom(raw({
    'Job Name': '#7001 Delta', 'Job Details': 'Installation', 'Install Date': '3/25/19', 'Delivery Date': '3/20/19',
    'Installation Time': '8am', 'Confirmed': 'TRUE', 'Completed': 'FALSE', '50% Paid': 'TRUE', '45% Paid': 'FALSE', '5% Paid': 'FALSE',
  }, { job_number: '7001' }));
  assert.equal(r.install_on, '2019-03-25');
  assert.equal(r.delivery_on, '2019-03-20');
  assert.equal(r.install_time, '8am');
  assert.equal(r.confirmed, true);
  assert.equal(r.completed, false);
  assert.equal(r.paid_50, true);
  assert.equal(r.paid_5, false);
});

await check('hardware order: first line is the job name, full text kept, temp ref from order date', () => {
  const r = hardwareOrderFrom(raw({
    'Job Name': 'ESTRADA MAIN HOUSE\n16) 21" Grass Guides\n2 18" Accuride 3832',
    'Date Ordered': '06/03/17', 'Date Recieved': '06/12/17', 'Status': 'Received', 'Special Notes': 'ok',
    'Cell Image Link': 'Image 2017-06-05 07-45-26.jpeg',
  }));
  assert.equal(r.job_name, 'ESTRADA MAIN HOUSE');
  assert.ok(r.order_text.includes('Accuride'));
  assert.equal(r.job_ref, 'T17-ESTRADA-MAIN');
  assert.equal(r.ordered_on, '2017-06-03');
  assert.equal(r.received_on, '2017-06-12');
  assert.equal(r.image_name, 'Image 2017-06-05 07-45-26.jpeg');
  const n = hardwareOrderFrom(raw({ 'Job Name': '#6334 Smith', 'Date Ordered': '06/03/99' }, { job_number: '6334' }));
  assert.equal(n.job_ref, '#6334');
  assert.equal(n.ordered_on, null);
  assert.equal(n.ordered_text, '06/03/99');
  assert.equal(n.image_name, null);
});

await check('hardware order: only a plain https Drive link is kept as the photo link', () => {
  const ok = hardwareOrderFrom(raw({ 'Job Name': '#6334 Smith', 'Cell Image URL': 'https://drive.google.com/file/d/abc/view' }, { job_number: '6334' }));
  assert.equal(ok.photo_url, 'https://drive.google.com/file/d/abc/view');
  for (const bad of ['http://drive.google.com/file/d/abc', 'https://evil.example.com/file/d/abc', 'javascript:alert(1)', '']) {
    assert.equal(hardwareOrderFrom(raw({ 'Job Name': '#6334 Smith', 'Cell Image URL': bad }, { job_number: '6334' })).photo_url, null);
  }
  assert.equal(hardwareOrderFrom(raw({ 'Job Name': '#6334 Smith' }, { job_number: '6334' })).photo_url, null);
});

await check('part lines: the number before ")" is the quantity, a line without one keeps qty null', () => {
  assert.deepEqual(parsePartLine('6) 21" GRAss Guides'), [{ qty: 6, name: '21" GRAss Guides', raw: '6) 21" GRAss Guides' }]);
  assert.equal(parsePartLine('16)  448-BCSC-9C')[0].qty, 16);
  assert.deepEqual(parsePartLine('541.39.421 Suzie Q Post'), [{ qty: null, name: '541.39.421 Suzie Q Post', raw: '541.39.421 Suzie Q Post' }]);
  assert.deepEqual(parsePartLine('4) '), []);
  // several items on one line
  assert.deepEqual(parsePartLine('16) 80814-SN  ,  21) 80815- SN').map((p) => [p.qty, p.name]), [[16, '80814-SN'], [21, '80815- SN']]);
  assert.deepEqual(parsePartLine('Pulls 3) A 2)B').map((p) => [p.qty, p.name]), [[null, 'Pulls'], [3, 'A'], [2, 'B']]);
  assert.deepEqual(parsePartLine('4KV255BR-96 3)21" GRASS Guides').map((p) => [p.qty, p.name]), [[null, '4KV255BR-96'], [3, '21" GRASS Guides']]);
  const rows = hardwarePartRows([{ source_row_id: 's1', job_ref: '#6001', removed_at: null, order_text: '#6001 Alpha\n6) 18" Guides\n\nKnife Block' }]);
  assert.deepEqual(rows.map((r) => [r.line_no, r.qty, r.part_name]), [[1, 6, '18" Guides'], [2, null, 'Knife Block']]);
});

await check('notes: only the N) items become parts, numbered after the order lines', () => {
  const rows = hardwarePartRows([{ source_row_id: 's1', job_ref: '#6001', removed_at: null,
    order_text: '#6001 Alpha\n6) Guides', notes: '16) 80814-SN , 21) 80815-SN\nreceived on 1/30 (2) items in stock' }]);
  assert.deepEqual(rows.map((r) => [r.line_no, r.qty, r.part_name]), [[1, 6, 'Guides'], [1001, 16, '80814-SN'], [1002, 21, '80815-SN']]);
});

await check('removed rows carry removed_at through', () => {
  const r = productionJobFrom({ ...raw({ 'Job Name': '#6001 A' }, { job_number: '6001' }), removed_at: '2026-11-01T00:00:00Z' });
  assert.equal(r.removed_at, '2026-11-01T00:00:00Z');
});

await check('summary: counts only, no names', () => {
  const rows = [
    hardwareOrderFrom(raw({ 'Job Name': '#6334 Smith', 'Date Ordered': '06/03/17' }, { job_number: '6334' })),
    hardwareOrderFrom({ ...raw({ 'Job Name': 'Estrada Main', 'Date Ordered': '06/03/17' }), row_id: 'r2' }),
    hardwareOrderFrom({ ...raw({ 'Job Name': 'Estrada Main', 'Date Ordered': '08/01/17' }), row_id: 'r3' }),
    hardwareOrderFrom({ ...raw({ 'Job Name': 'Lopez', 'Date Ordered': '06/03/99' }), row_id: 'r4' }),
  ];
  const s = summarizeNormalized(rows);
  assert.equal(s.rows, 4);
  assert.equal(s.realNumbers, 1);
  assert.equal(s.tempRefs, 3);
  assert.equal(s.tempRefsWithUnknownYear, 1);
  assert.equal(s.distinctRefs, 3);
  assert.equal(s.refsSharedByManyRows, 1);
  assert.equal(s.unparsedDates, 1);
  assert.ok(!JSON.stringify(s).includes('Estrada'));
});

// A tiny in-memory stand-in for the supabase client, enough for writeNormalized.
const fakeSupabase = (rows) => ({
  from: () => ({
    select: () => ({ range: async () => ({ data: rows, error: null }) }),
    upsert: async (batch) => {
      for (const b of batch) {
        const i = rows.findIndex((x) => x.source_row_id === b.source_row_id);
        if (i >= 0) rows[i] = { ...rows[i], ...b }; else rows.push({ job_ref_history: [], ...b }); // column default
      }
      return { error: null };
    },
  }),
});

await check('write: insert, then unchanged, then a temp ref replaced by a real number keeps the old one', async () => {
  const store = [];
  const sb = fakeSupabase(store);
  const temp = productionJobFrom(raw({ 'Job Name': 'Gamma Residence' }, { section: 'Year 2019' }));
  assert.deepEqual(await writeNormalized({ supabase: sb, table: 't', rows: [temp] }), { inserted: 1, updated: 0, unchanged: 0, refChanged: 0 });
  // The database hands back reformatted timestamps and re-ordered jsonb keys; neither may count as a change.
  store[0] = { ...store[0], steps: JSON.parse(JSON.stringify(store[0].steps)), removed_at: null };
  assert.equal((await writeNormalized({ supabase: sb, table: 't', rows: [temp] })).unchanged, 1);
  const real = productionJobFrom(raw({ 'Job Name': '#6001 Gamma Residence' }, { job_number: '6001', section: 'Year 2019' }));
  const res = await writeNormalized({ supabase: sb, table: 't', rows: [real] });
  assert.deepEqual(res, { inserted: 0, updated: 1, unchanged: 0, refChanged: 1 });
  assert.equal(store[0].job_ref, '#6001');
  assert.deepEqual(store[0].job_ref_history, ['T19-GAMMA-RESIDENCE']);
  assert.equal(store[0].ref_is_temp, false);
});

await check('part input: name required, qty a whole number or blank', () => {
  assert.deepEqual(cleanPartInput({ qty: '12', name: '  21"   Guides ' }), { qty: 12, name: '21" Guides' });
  assert.deepEqual(cleanPartInput({ qty: '', name: 'Knife block' }), { qty: null, name: 'Knife block' });
  assert.deepEqual(cleanPartInput({ qty: null, name: 'x' }), { qty: null, name: 'x' });
  assert.throws(() => cleanPartInput({ qty: 1, name: '   ' }), /name is required/);
  assert.throws(() => cleanPartInput({ qty: 1.5, name: 'x' }), /whole number/);
  assert.throws(() => cleanPartInput({ qty: -1, name: 'x' }), /whole number/);
  assert.throws(() => cleanPartInput({ qty: 10000, name: 'x' }), /whole number/);
  assert.throws(() => cleanPartInput({ qty: 1, name: 'x'.repeat(201) }), /too long/);
});

await check('parts write: an edited or manual part survives a re-read of the sheet', async () => {
  const order = { source_row_id: 's1', job_ref: '#6001', removed_at: null, notes: null, order_text: '#6001 A\n6) Guides\n1) Pulls\n2) Hinges' };
  const store = [];
  const sb = { from: () => ({
    select: () => ({ range: async () => ({ data: store, error: null }) }),
    upsert: async (batch) => {
      for (const b of batch) {
        const i = store.findIndex((x) => x.order_source_row_id === b.order_source_row_id && x.line_no === b.line_no);
        if (i >= 0) store[i] = { ...store[i], ...b }; else store.push({ source: 'sheet', edited: false, ...b });
      }
      return { error: null };
    },
  }) };
  const first = await writeHardwareParts({ supabase: sb, table: 't', rows: hardwarePartRows([order]) });
  assert.equal(first.inserted, 3);
  // a person fixes line 2, removes line 3, and adds a part by hand
  store[1] = { ...store[1], qty: 4, part_name: 'Pulls (fixed)', edited: true };
  store[2] = { ...store[2], removed_at: '2026-11-02T00:00:00Z', edited: true };
  store.push({ order_source_row_id: 's1', job_ref: '#6001', line_no: 2000, qty: 9, part_name: 'Manual', raw_line: '', source: 'manual', edited: true, removed_at: null });
  // the sheet text changes: line 1 is reworded, lines 2 and 3 are gone
  const again = await writeHardwareParts({ supabase: sb, table: 't', rows: hardwarePartRows([{ ...order, order_text: '#6001 A\n6) Guides new' }]) });
  assert.equal(again.updated, 1);
  assert.equal(again.keptEdited, 0); // line 2 and 3 are not in the new text, so they are not compared
  assert.equal(store[0].part_name, 'Guides new');
  assert.equal(store[1].part_name, 'Pulls (fixed)');
  assert.equal(store[1].removed_at ?? null, null); // an edited line is not marked removed because the sheet dropped it
  assert.equal(store[3].removed_at ?? null, null); // neither is a manual part
  // the sheet still has line 2: the edit wins over the OCR text
  const third = await writeHardwareParts({ supabase: sb, table: 't', rows: hardwarePartRows([{ ...order, order_text: '#6001 A\n6) Guides new\n7) Pulls again' }]) });
  assert.equal(third.keptEdited, 1);
  assert.equal(store[1].qty, 4);
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
