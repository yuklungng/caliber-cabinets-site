/* global process */
import crypto from 'crypto';

/**
 * Read-only Google Sheets access for the production module.
 *
 * Uses its own service account (GOOGLE_SHEETS_SA_JSON), never the analytics one,
 * and only read scopes. The sheets stay the source of truth until cutover, so
 * nothing here writes to a sheet. The read-only guard (readonly.js) also refuses
 * any non-GET call to sheets.googleapis.com and drive.googleapis.com.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');
const TIMEOUT_MS = 15000;
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SHEETS_SA_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch {
    return null;
  }
}

export const isSheetsConfigured = () => Boolean(loadServiceAccount());

let cached = null; // { token, exp }

async function accessToken() {
  const sa = loadServiceAccount();
  if (!sa) throw new Error('GOOGLE_SHEETS_SA_JSON is not set or is not valid JSON');
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(sa.private_key, 'base64url');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google token exchange failed (${r.status} ${j.error ?? ''})`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function gget(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google ${r.status}: ${j.error?.message ?? 'request failed'}`);
  return j;
}

/** Every spreadsheet shared with the service account: [{ id, name, modifiedTime }]. */
export async function listSharedSpreadsheets() {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      q: `mimeType='${SHEET_MIME}' and trashed=false`,
      fields: 'nextPageToken,files(id,name,modifiedTime)',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const j = await gget(`https://www.googleapis.com/drive/v3/files?${q}`);
    out.push(...(j.files ?? []));
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Tab names with their grid size: [{ title, rows, cols }]. */
export async function listTabs(spreadsheetId) {
  const q = new URLSearchParams({ fields: 'sheets.properties(title,gridProperties(rowCount,columnCount))' });
  const j = await gget(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?${q}`);
  return (j.sheets ?? []).map((s) => ({
    title: s.properties?.title ?? '',
    rows: s.properties?.gridProperties?.rowCount ?? 0,
    cols: s.properties?.gridProperties?.columnCount ?? 0,
  }));
}

export const serviceAccountEmail = () => loadServiceAccount()?.client_email ?? null;
