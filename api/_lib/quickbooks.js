/* global process */
import { createClient } from '@supabase/supabase-js';

/**
 * QuickBooks Online OAuth2 + Accounting API helpers
 *
 * Required env vars:
 *   QUICKBOOKS_CLIENT_ID
 *   QUICKBOOKS_CLIENT_SECRET
 *   SITE_URL                    — used to build the redirect_uri; must exactly
 *                                  match the Redirect URI registered in the
 *                                  Intuit app (Settings → Redirect URIs):
 *                                  <SITE_URL>/api/admin-quickbooks-callback
 *
 * Optional env vars:
 *   QUICKBOOKS_ENVIRONMENT      — 'sandbox' (default) or 'production'. Only
 *                                  affects which Accounting API base URL is
 *                                  used — the OAuth authorize/token endpoints
 *                                  are the same for both; the environment is
 *                                  really determined by which Client ID/Secret
 *                                  pair (development vs production keys) was
 *                                  used to obtain the tokens.
 *
 * One connection for the whole app — stored as a singleton row (id=1) in the
 * quickbooks_connection table, mirroring how this codebase already keeps a
 * single HubSpot portal connection via env-var tokens rather than per-user.
 */

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const SCOPE = 'com.intuit.quickbooks.accounting';

function apiBase() {
  return process.env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function redirectUri() {
  return `${process.env.SITE_URL}/api/admin-quickbooks-callback`;
}

function basicAuthHeader() {
  const raw = `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

function supabaseClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * Build the URL to send the admin's browser to for the Intuit consent screen.
 * `state` is a random CSRF token the caller must have already persisted (via
 * startConnect below) so the callback can verify this exact flow initiated it.
 */
function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.QUICKBOOKS_CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Generate a CSRF state token, store it as pending on the singleton
 * connection row, and return the authorize URL to redirect the browser to.
 */
export async function startConnect() {
  const supabase = supabaseClient();
  const state = crypto.randomUUID();
  const { error } = await supabase
    .from('quickbooks_connection')
    .upsert({ id: 1, pending_state: state }, { onConflict: 'id' });
  if (error) throw error;
  return buildAuthorizeUrl(state);
}

/**
 * Handle Intuit's redirect back: verify `state`, exchange `code` for tokens,
 * fetch the company display name, and persist the connection.
 * Throws on any failure — caller (the callback route) decides how to
 * redirect the browser on error.
 */
export async function completeConnect({ code, state, realmId }) {
  const supabase = supabaseClient();

  const { data: row, error: rowError } = await supabase
    .from('quickbooks_connection')
    .select('pending_state')
    .eq('id', 1)
    .single();
  if (rowError) throw rowError;
  if (!row?.pending_state || row.pending_state !== state) {
    throw new Error('State mismatch — this connect flow was not initiated by this app, or has expired.');
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`QuickBooks token exchange ${tokenRes.status}: ${await tokenRes.text()}`);
  }
  const tokens = await tokenRes.json();

  const now = Date.now();
  const accessExpiresAt = new Date(now + tokens.expires_in * 1000).toISOString();
  const refreshExpiresAt = new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString();

  // Best-effort company name lookup — don't fail the whole connect if this hiccups.
  let companyName = null;
  try {
    const infoRes = await fetch(`${apiBase()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    });
    if (infoRes.ok) {
      const info = await infoRes.json();
      companyName = info?.CompanyInfo?.CompanyName ?? null;
    }
  } catch { /* non-fatal */ }

  const { error: saveError } = await supabase.from('quickbooks_connection').upsert({
    id: 1,
    realm_id: realmId,
    company_name: companyName,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: accessExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
    pending_state: null,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (saveError) throw saveError;

  return { companyName, realmId };
}

/** Current connection status for display in the admin UI. Never exposes tokens. */
export async function getConnectionStatus() {
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from('quickbooks_connection')
    .select('realm_id, company_name, connected_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.realm_id) return { connected: false };
  return { connected: true, companyName: data.company_name, realmId: data.realm_id, connectedAt: data.connected_at };
}

/**
 * Returns a valid { accessToken, realmId }, transparently refreshing via the
 * refresh_token if the current access_token is expired or about to be
 * (60-minute lifetime — refresh proactively inside the last 5 minutes so a
 * slow downstream call never races the actual expiry).
 */
export async function getValidAccessToken() {
  const supabase = supabaseClient();
  const { data: row, error } = await supabase
    .from('quickbooks_connection')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (!row?.refresh_token) throw new Error('QuickBooks is not connected.');

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return { accessToken: row.access_token, realmId: row.realm_id };
  }

  // Expired/near-expiry — refresh. QBO rotates the refresh_token on every use.
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token }),
  });
  if (!res.ok) throw new Error(`QuickBooks token refresh ${res.status}: ${await res.text()}`);
  const tokens = await res.json();

  const now = Date.now();
  const accessExpiresAt = new Date(now + tokens.expires_in * 1000).toISOString();
  const refreshExpiresAt = new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString();

  await supabase.from('quickbooks_connection').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: accessExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', 1);

  return { accessToken: tokens.access_token, realmId: row.realm_id };
}

/** Disconnects: revokes the refresh token with Intuit, then clears the row. */
export async function disconnect() {
  const supabase = supabaseClient();
  const { data: row } = await supabase
    .from('quickbooks_connection')
    .select('refresh_token')
    .eq('id', 1)
    .maybeSingle();

  if (row?.refresh_token) {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ token: row.refresh_token }),
      });
    } catch { /* best-effort — clear our own record regardless */ }
  }

  await supabase.from('quickbooks_connection').upsert({
    id: 1,
    realm_id: null,
    company_name: null,
    access_token: null,
    refresh_token: null,
    access_token_expires_at: null,
    refresh_token_expires_at: null,
    pending_state: null,
    connected_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
}

/** Thin wrapper for authenticated Accounting API calls once connected. */
export async function qbFetch(path, options = {}) {
  const { accessToken, realmId } = await getValidAccessToken();
  return fetch(`${apiBase()}/v3/company/${realmId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}
