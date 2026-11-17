// Checks job-to-deal link rules on made-up rows. Run: node scripts/test-production-links.mjs
import assert from 'node:assert/strict';
import { candidateOptions, cleanDecision, dealIdsToName, resolveLinks, scheduleGroups, stageStatus } from '../api/_lib/productionLinks.js';

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
};

const row = (over) => ({ hubspot_deal_id: '111', room: null, stage: 'initial_deposit', qb_invoice_number: '7001', invoice_date: null, paid_date: null, qb_paid_amount: null, ...over });
const schedule = [
  row({ stage: 'final_payment' }),
  row({ stage: 'initial_deposit', invoice_date: '2026-01-02', paid_date: '2026-01-05' }),
  row({ stage: 'production_payment', invoice_date: '2026-02-01', qb_paid_amount: 10 }),
  row({ hubspot_deal_id: '222', room: 'Kitchen', qb_invoice_number: '7002' }),
  row({ hubspot_deal_id: '222', room: 'Laundry', qb_invoice_number: '7003' }),
];
const job = (ref, isTemp = false) => ({ jobRef: ref, isTemp });
const link = (over) => ({ job_ref: '#7001', system: 'hubspot_deal', external_id: '111', room: null, status: 'confirmed', basis: 'manual', decided_by: 'Mike', decided_at: '2026-11-01T00:00:00Z', ...over });

check('stage status follows Financial Management rules', () => {
  assert.equal(stageStatus({ paid_date: 'x' }), 'Paid');
  assert.equal(stageStatus({ qb_paid_amount: 5 }), 'Partially Paid');
  assert.equal(stageStatus({ invoice_date: 'x' }), 'Invoiced');
  assert.equal(stageStatus({}), 'Pending');
});

check('groups by deal and room, stages in contract order', () => {
  const g = scheduleGroups(schedule);
  assert.equal(g.size, 3);
  assert.deepEqual(g.get('111|').stages.map((s) => `${s.label}:${s.status}`),
    ['Initial Deposit:Paid', 'Production Payment:Partially Paid', 'Final Payment:Pending']);
  assert.equal(g.get('222|Laundry').invoiceNumber, '7003');
});

check('job number matching an invoice is suggested, not linked', () => {
  const m = resolveLinks([job('#7003')], { links: [], groups: scheduleGroups(schedule) });
  const l = m.get('#7003');
  assert.equal(l.state, 'suggested');
  assert.equal(l.dealId, '222');
  assert.equal(l.room, 'Laundry');
  assert.equal(l.basis, 'invoice number');
});

check('temp refs and unknown numbers stay unlinked', () => {
  const m = resolveLinks([job('T25-Smith', true), job('#9999')], { links: [], groups: scheduleGroups(schedule) });
  assert.equal(m.get('T25-Smith').state, 'unlinked');
  assert.equal(m.get('#9999').state, 'unlinked');
});

check('a rejected suggestion is not suggested again', () => {
  const m = resolveLinks([job('#7001')], { links: [link({ status: 'rejected' })], groups: scheduleGroups(schedule) });
  assert.equal(m.get('#7001').state, 'unlinked');
});

check('a confirmed link wins over the number match and carries payment status', () => {
  const m = resolveLinks([job('#7001')], { links: [link({ external_id: '222', room: 'Kitchen' })], groups: scheduleGroups(schedule) });
  const l = m.get('#7001');
  assert.equal(l.state, 'linked');
  assert.equal(l.dealId, '222');
  assert.equal(l.invoiceNumber, '7002');
  assert.equal(l.decidedBy, 'Mike');
});

check('newest confirmed link is the one shown', () => {
  const links = [link({ decided_at: '2026-10-01T00:00:00Z' }), link({ external_id: '222', room: 'Laundry', decided_at: '2026-11-05T00:00:00Z' })];
  assert.equal(resolveLinks([job('#7001')], { links, groups: scheduleGroups(schedule) }).get('#7001').dealId, '222');
});

check('link with no room finds a deal with a single group', () => {
  const l = resolveLinks([job('#5000')], { links: [link({ job_ref: '#5000' })], groups: scheduleGroups(schedule) }).get('#5000');
  assert.equal(l.invoiceNumber, '7001');
  assert.equal(l.stages.length, 3);
});

check('deal ids to name are unique', () => {
  const m = resolveLinks([job('#7002'), job('#7003'), job('#1')], { links: [], groups: scheduleGroups(schedule) });
  assert.deepEqual(dealIdsToName(m), ['222']);
});

check('picker lists each room group, newest deal first, deals with no schedule once', () => {
  const opts = candidateOptions([
    { hubspot_deal_id: '111', name: 'Old', closed_at: '2026-01-01' },
    { hubspot_deal_id: '222', name: 'New', closed_at: '2026-06-01' },
    { hubspot_deal_id: '333', name: 'Bare', closed_at: '2026-03-01' },
  ], scheduleGroups(schedule));
  assert.deepEqual(opts.map((o) => `${o.name}|${o.room ?? ''}`), ['New|Kitchen', 'New|Laundry', 'Bare|', 'Old|']);
});

check('decision input is validated', () => {
  assert.throws(() => cleanDecision({ decision: 'delete', jobRef: '#1', dealId: '1' }));
  assert.throws(() => cleanDecision({ decision: 'confirm', jobRef: '', dealId: '1' }));
  assert.throws(() => cleanDecision({ decision: 'confirm', jobRef: '#1', dealId: 'abc' }));
  const d = cleanDecision({ decision: 'confirm', jobRef: ' #1 ', dealId: '42', room: '  ', basis: 'whatever' });
  assert.deepEqual(d, { decision: 'confirm', jobRef: '#1', dealId: '42', room: null, basis: 'manual' });
});

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('ALL PASSED');
