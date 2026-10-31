/* global process */
import { isReadOnlyPreview } from './readonly.js';
import { createClient } from '@supabase/supabase-js';
import { isSheetsConfigured, listSharedSpreadsheets, listTabs, readAllRows, readTopRows, serviceAccountEmail } from './googleSheets.js';
import { SHEETS, buildRecords, buildCommentRecords, summarize, writeRecords } from './productionSync.js';

/**
 * Production module: feature flags, table names and the status endpoint.
 *
 * Everything the module adds is behind PRODUCTION_MODULE_ENABLED (default off),
 * so pieces can merge to main without showing anything on Mike's site. The
 * module's tables are new tables named dev_<name> until go-live. Setting
 * PRODUCTION_DB_MODE=live drops the prefix (after the tables are renamed).
 *
 * Mounted through admin-settings.js (?resource=production) so this adds no
 * serverless function; move it to its own api file once the function cap on
 * Mike's plan is confirmed.
 */

const TABLES = [
  'sheet_rows_raw',
  'sheet_row_versions',
  'sync_runs',
  'sync_exceptions',
  'production_jobs',
  'install_events',
  'hardware_orders',
  'job_links',
];

export const isProductionModuleEnabled = () => process.env.PRODUCTION_MODULE_ENABLED === '1';
export const isProductionSyncEnabled = () => process.env.PRODUCTION_SYNC_ENABLED === '1';

export const tableMode = () => (process.env.PRODUCTION_DB_MODE === 'live' ? 'live' : 'dev');
export const tablePrefix = () => (tableMode() === 'live' ? '' : 'dev_');

/** Table name for a module table. Throws on a name the module does not own, so a typo can never reach an existing table. */
export function tbl(name) {
  if (!TABLES.includes(name)) throw new Error(`Unknown production table: ${name}`);
  return `${tablePrefix()}${name}`;
}

/** Flags the admin UI needs, safe to show to any signed-in admin. */
export function publicFlags() {
  return { productionModule: isProductionModuleEnabled() };
}

/**
 * Handler for ?resource=production. The caller has already authenticated.
 * With the flag off it answers 404, as if the endpoint did not exist.
 */
export async function handleProduction(req, res, auth) {
  if (!isProductionModuleEnabled()) return res.status(404).json({ error: 'Not found' });
  if (!auth?.isSuperAdmin) return res.status(403).json({ error: 'Super admin required' });

  if (req.method === 'GET' && req.query?.action === 'status') {
    return res.status(200).json({
      enabled: true,
      syncEnabled: isProductionSyncEnabled(),
      mode: tableMode(),
      prefix: tablePrefix(),
      readOnlyPreview: isReadOnlyPreview(),
      tables: TABLES.map(tbl),
    });
  }

  // Lists the DEV COPY spreadsheets shared with the module's service account and their tabs.
  // Read-only. Anything shared that is not named DEV COPY is reported so it can be unshared:
  // the module must only ever see copies, never Mike's originals.
  if (req.method === 'GET' && req.query?.action === 'sheets-status') {
    if (!isSheetsConfigured()) {
      return res.status(200).json({ configured: false, note: 'GOOGLE_SHEETS_SA_JSON is not set or is not valid JSON' });
    }
    try {
      const files = await listSharedSpreadsheets();
      const isCopy = (f) => /dev copy/i.test(f.name);
      const copies = [];
      for (const f of files.filter(isCopy)) {
        copies.push({ name: f.name, id: f.id, modifiedTime: f.modifiedTime, tabs: await listTabs(f.id) });
      }
      const others = files.filter((f) => !isCopy(f)).map((f) => f.name);
      return res.status(200).json({
        configured: true,
        serviceAccount: serviceAccountEmail(),
        copies,
        notCopies: others,
        warning: others.length ? 'Spreadsheets not named DEV COPY are shared with the service account. Unshare them.' : null,
      });
    } catch (e) {
      return res.status(502).json({ configured: true, error: String(e.message ?? e) });
    }
  }

  // Top rows of every tab of the DEV COPY sheets, so the header row and the shape of the data can be
  // checked before the sync is written. Read-only; only DEV COPY spreadsheets are ever opened.
  if (req.method === 'GET' && req.query?.action === 'sheets-headers') {
    if (!isSheetsConfigured()) return res.status(200).json({ configured: false });
    try {
      const rows = Math.min(Number(req.query.rows) || 6, 12);
      const files = (await listSharedSpreadsheets()).filter((f) => /dev copy/i.test(f.name));
      const out = {};
      for (const f of files) {
        out[f.name] = {};
        for (const t of await listTabs(f.id)) out[f.name][t.title] = await readTopRows(f.id, t.title, rows);
      }
      return res.status(200).json(out);
    } catch (e) {
      return res.status(502).json({ error: String(e.message ?? e) });
    }
  }

  // One sheet at a time (?sheet=production_status|install_schedule|hardware_orders).
  // GET = dry run: reads the DEV COPY sheet and reports what a sync would do, no names, no writes.
  // POST with commit=1 writes the dev_ raw tables. That needs PRODUCTION_SYNC_ENABLED=1 and dev table mode.
  if (req.query?.action === 'sync') {
    const sheetKey = String(req.query.sheet ?? '');
    const cfg = SHEETS[sheetKey];
    if (!cfg) return res.status(400).json({ error: 'sheet must be one of ' + Object.keys(SHEETS).join(', ') });
    if (!isSheetsConfigured()) return res.status(200).json({ configured: false });
    const commit = req.method === 'POST' && req.query.commit === '1';
    if (commit && !isProductionSyncEnabled()) return res.status(403).json({ error: 'PRODUCTION_SYNC_ENABLED is not set' });
    if (commit && tableMode() !== 'dev') return res.status(403).json({ error: 'Sync writes only to dev_ tables for now' });
    try {
      const files = (await listSharedSpreadsheets()).filter((f) => /dev copy/i.test(f.name) && cfg.spreadsheet.test(f.name));
      if (files.length !== 1) return res.status(404).json({ error: `expected one DEV COPY sheet for ${sheetKey}, found ${files.length}` });
      const tabs = await listTabs(files[0].id);
      const main = tabs.find((t) => t.title === cfg.tab);
      if (!main) return res.status(404).json({ error: 'tab not found: ' + cfg.tab });
      const rows = await readAllRows(files[0].id, main.title, main.rows);
      const { records, stats } = buildRecords(sheetKey, rows);
      const commentsTab = tabs.find((t) => t.title === 'Comments');
      const commentRows = commentsTab ? await readAllRows(files[0].id, commentsTab.title, commentsTab.rows) : [];
      const comments = buildCommentRecords(sheetKey, commentRows, records);
      const out = { sheet: sheetKey, mode: commit ? 'commit' : 'dry-run', jobs: summarize(records, stats), comments: summarize(comments, {}) };
      if (commit) {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const t = { raw: tbl('sheet_rows_raw'), versions: tbl('sheet_row_versions'), runs: tbl('sync_runs'), exceptions: tbl('sync_exceptions') };
        out.written = {
          jobs: await writeRecords({ supabase, t, sheetKey, records }),
          comments: await writeRecords({ supabase, t, sheetKey: sheetKey + '_comments', records: comments }),
        };
      }
      return res.status(200).json(out);
    } catch (e) {
      return res.status(502).json({ error: String(e.message ?? e) });
    }
  }

  return res.status(404).json({ error: 'Not found' });
}
