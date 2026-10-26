// Run: node scripts/test-production-flags.mjs
// Checks the production module's flag defaults, table naming and 404-when-off behavior.
import assert from 'node:assert/strict';

const clear = () => { for (const k of ['PRODUCTION_MODULE_ENABLED', 'PRODUCTION_SYNC_ENABLED', 'PRODUCTION_DB_MODE', 'READ_ONLY_PREVIEW']) delete process.env[k]; };
clear();
const m = await import('../api/_lib/production.js');

const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const admin = { ok: true, isSuperAdmin: true };

// Defaults: everything off, dev tables.
assert.equal(m.isProductionModuleEnabled(), false);
assert.equal(m.isProductionSyncEnabled(), false);
assert.equal(m.tbl('sheet_rows_raw'), 'dev_sheet_rows_raw');
assert.deepEqual(m.publicFlags(), { productionModule: false });

// Flag off: the endpoint behaves as if it does not exist, even for a super admin.
let r = res(); await m.handleProduction({ method: 'GET', query: { action: 'status' } }, r, admin);
assert.equal(r.code, 404);

// Table names can only be module tables.
assert.throws(() => m.tbl('leads'));
assert.throws(() => m.tbl('payment_schedule'));

// Flag on: super admin gets status, others are refused, unknown actions 404.
process.env.PRODUCTION_MODULE_ENABLED = '1';
r = res(); await m.handleProduction({ method: 'GET', query: { action: 'status' } }, r, admin);
assert.equal(r.code, 200); assert.equal(r.body.mode, 'dev'); assert.equal(r.body.prefix, 'dev_'); assert.equal(r.body.syncEnabled, false);
assert.ok(r.body.tables.every((t) => t.startsWith('dev_')));
r = res(); await m.handleProduction({ method: 'GET', query: { action: 'status' } }, r, { ok: true, isSuperAdmin: false });
assert.equal(r.code, 403);
r = res(); await m.handleProduction({ method: 'POST', query: { action: 'status' } }, r, admin);
assert.equal(r.code, 404);
assert.deepEqual(m.publicFlags(), { productionModule: true });

// Live mode drops the prefix only when explicitly set.
process.env.PRODUCTION_DB_MODE = 'live';
assert.equal(m.tbl('job_links'), 'job_links');
process.env.PRODUCTION_DB_MODE = 'anything-else';
assert.equal(m.tbl('job_links'), 'dev_job_links');

clear();
console.log('ALL PASSED');
