// Run: node scripts/test-readonly.mjs [1|0]   (1 = guard on, expect ALL PASSED; 0 = guard off, no 403s)
const calls = [];
globalThis.fetch = async (u, i) => { calls.push([String(u), i?.method ?? 'GET']); return new Response('{}', { status: 200 }); };
process.env.SUPABASE_URL = 'https://abc.supabase.co';
process.env.READ_ONLY_PREVIEW = process.argv[2] ?? '1';
await import('../api/_lib/readonly.js');
const cases = [
  ['GET supabase leads',            'https://abc.supabase.co/rest/v1/leads?select=*', 'GET', true],
  ['POST supabase leads',           'https://abc.supabase.co/rest/v1/leads', 'POST', false],
  ['PATCH supabase payment_sched',  'https://abc.supabase.co/rest/v1/payment_schedule?id=eq.1', 'PATCH', false],
  ['DELETE supabase leads',         'https://abc.supabase.co/rest/v1/leads?id=eq.1', 'DELETE', false],
  ['POST supabase dev_ table',      'https://abc.supabase.co/rest/v1/dev_production_jobs?on_conflict=id', 'POST', true],
  ['POST supabase admin_sessions',  'https://abc.supabase.co/rest/v1/admin_sessions', 'POST', true],
  ['DELETE admin_sessions',         'https://abc.supabase.co/rest/v1/admin_sessions?token=eq.x', 'DELETE', true],
  ['POST lookalike devx table',     'https://abc.supabase.co/rest/v1/devices', 'POST', false],
  ['POST supabase rpc',             'https://abc.supabase.co/rest/v1/rpc/f', 'POST', false],
  ['POST supabase storage',         'https://abc.supabase.co/storage/v1/object/b/f', 'POST', false],
  ['POST hubspot search',           'https://api.hubapi.com/crm/v3/objects/deals/search', 'POST', true],
  ['POST hubspot batch read',       'https://api.hubapi.com/crm/v3/associations/deals/contacts/batch/read', 'POST', true],
  ['PATCH hubspot deal',            'https://api.hubapi.com/crm/v3/objects/deals/1', 'PATCH', false],
  ['POST hubspot note',             'https://api.hubapi.com/crm/v3/objects/notes', 'POST', false],
  ['POST qbo token refresh',        'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', 'POST', false],
  ['POST qbo revoke',               'https://developer.api.intuit.com/v2/oauth2/tokens/revoke', 'POST', false],
  ['POST qbo query',                'https://quickbooks.api.intuit.com/v3/company/1/query', 'POST', true],
  ['POST qbo invoice',              'https://quickbooks.api.intuit.com/v3/company/1/invoice', 'POST', false],
  ['GET qbo query',                 'https://quickbooks.api.intuit.com/v3/company/1/query?query=x', 'GET', true],
  ['POST google token (not guarded)','https://oauth2.googleapis.com/token', 'POST', true],
];
let bad = 0;
for (const [name, url, method, allowed] of cases) {
  const r = await fetch(url, { method });
  const passed = (r.status !== 403) === allowed;
  if (!passed) bad++;
  console.log(passed ? 'ok  ' : 'FAIL', name, '->', r.status);
}
// Request-object input form
const r2 = await fetch(new Request('https://abc.supabase.co/rest/v1/leads', { method: 'POST', body: '{}' }));
console.log(r2.status === 403 ? 'ok  ' : 'FAIL', 'Request object POST leads ->', r2.status); if (r2.status !== 403) bad++;
console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
