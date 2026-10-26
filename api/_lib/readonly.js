/* global process */

/**
 * READ_ONLY_PREVIEW guard.
 *
 * Set READ_ONLY_PREVIEW=1 on a deployment that points at the live Supabase,
 * HubSpot or QuickBooks (the Hobby-team preview) and every outgoing write is
 * refused, whichever handler or helper makes it. Leave it unset on Mike's site.
 *
 * Importing this file is enough: each api/*.js entry point has one side-effect
 * import so the guard is in place before any client is created. It wraps
 * globalThis.fetch, which supabase-js and the HubSpot and QuickBooks helpers use.
 *
 * Allowed while on:
 *   - every GET/HEAD/OPTIONS
 *   - Supabase writes to dev_* tables (the production module's own tables) and
 *     to admin_sessions (so signing in and out still works)
 *   - HubSpot POSTs that are reads (search, batch/read)
 *   - QuickBooks POSTs to /query
 *
 * QuickBooks token refresh and revoke are blocked on purpose: Intuit rotates
 * the refresh token on every use, and if the new one cannot be saved the stored
 * one goes stale and Mike's QuickBooks connection breaks. While this guard is
 * on, QuickBooks calls work only as long as the stored access token is valid.
 *
 * SMTP is not fetch. lead-submit.js checks isReadOnlyPreview() itself.
 */

export function isReadOnlyPreview() {
  return process.env.READ_ONLY_PREVIEW === '1';
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_SUPABASE_TABLES = /^\/rest\/v1\/(dev_[a-z0-9_]+|admin_sessions)(\?|\/|$)/;

const INTUIT_HOSTS = new Set([
  'oauth.platform.intuit.com',
  'developer.api.intuit.com',
  'quickbooks.api.intuit.com',
  'sandbox-quickbooks.api.intuit.com',
]);

/** Returns a reason string when this request must be refused, or null. */
export function blockedReason(url, method) {
  if (!isReadOnlyPreview()) return null;
  const verb = String(method || 'GET').toUpperCase();
  if (READ_METHODS.has(verb)) return null;

  let u;
  try {
    u = new URL(typeof url === 'string' ? url : url.url ?? String(url));
  } catch {
    return null;
  }

  let supabaseHost = null;
  try { supabaseHost = new URL(process.env.SUPABASE_URL ?? '').host; } catch { /* unset */ }

  if (supabaseHost && u.host === supabaseHost) {
    if (u.pathname.startsWith('/rest/v1/') && ALLOWED_SUPABASE_TABLES.test(u.pathname + u.search)) return null;
    return `Supabase ${verb} ${u.pathname}`;
  }
  if (u.host === 'api.hubapi.com') {
    if (u.pathname.includes('/search') || u.pathname.includes('/batch/read')) return null;
    return `HubSpot ${verb} ${u.pathname}`;
  }
  if (INTUIT_HOSTS.has(u.host)) {
    if (u.pathname.endsWith('/query')) return null;
    return `QuickBooks ${verb} ${u.pathname}`;
  }
  return null;
}

if (isReadOnlyPreview() && !globalThis.__readOnlyPreviewInstalled) {
  globalThis.__readOnlyPreviewInstalled = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function guardedFetch(input, init) {
    const method = init?.method ?? (typeof input === 'object' && input?.method) ?? 'GET';
    const reason = blockedReason(input, method);
    if (reason) {
      console.warn(`[read-only-preview] blocked: ${reason}`);
      return new Response(
        JSON.stringify({ code: 'READ_ONLY_PREVIEW', message: `Blocked on this preview: ${reason}` }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(input, init);
  };
}
