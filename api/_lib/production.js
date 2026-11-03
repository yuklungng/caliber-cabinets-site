/* global process */
import { isReadOnlyPreview } from './readonly.js';
import { isSheetsConfigured, listSharedSpreadsheets, listTabs, readAllRows, readColumnLinks, readTopRows, serviceAccountEmail } from './googleSheets.js';
import { SHEETS, addLinkColumn, buildRecords,buildCommentRecords, summarize, writeRecords } from './productionSync.js';
import { NORMALIZERS, hardwarePartRows, readRawRows, summarizeNormalized, writeHardwareParts, writeNormalized } from './productionNormalize.js';
import { buildJobList, readAll } from './productionJobs.js';

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
  'hardware_parts',
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

  // Shape of the links behind the photo cells of the hardware sheet (host and the start of the path only).
  // Read-only; shows whether the links can be saved. ?rows=N (default 8, max 25) rows from the top.
  if (req.method === 'GET' && req.query?.action === 'sheet-links') {
    if (!isSheetsConfigured()) return res.status(200).json({ configured: false });
    try {
      const cfg = SHEETS.hardware_orders;
      const files = (await listSharedSpreadsheets()).filter((f) => /dev copy/i.test(f.name) && cfg.spreadsheet.test(f.name));
      if (files.length !== 1) return res.status(404).json({ error: `expected one DEV COPY sheet, found ${files.length}` });
      const header = (await readTopRows(files[0].id, cfg.tab, 1, 80))[0] ?? [];
      const rows = Math.min(Number(req.query.rows) || 8, 25);
      const out = {};
      for (const name of ['Cell Image Link', 'Attachment Links']) {
        const idx = header.findIndex((h) => String(h).trim() === name);
        if (idx < 0) { out[name] = 'column not found'; continue; }
        const cells = await readColumnLinks(files[0].id, cfg.tab, idx, rows + 1);
        out[name] = cells.map((c) => {
          if (!c.link) return { text: c.text, link: false };
          let u = null;
          try { u = new URL(c.link); } catch { /* not a URL */ }
          return { text: c.text, link: true, host: u?.host ?? null, path: u ? u.pathname.slice(0, 40) : c.link.slice(0, 40), length: c.link.length };
        });
      }
      res.setHeader('Cache-Control', 'no-store');
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
      // The photo cells show only a label; the Drive link behind each one is saved beside it.
      if (sheetKey === 'hardware_orders') {
        const idx = (rows[0] ?? []).findIndex((h) => String(h).trim() === 'Cell Image Link');
        if (idx >= 0) addLinkColumn(rows, 'Cell Image URL', (await readColumnLinks(files[0].id, main.title, idx, main.rows)).map((c) => c.link));
      }
      const { records, stats } = buildRecords(sheetKey, rows);
      const commentsTab = tabs.find((t) => t.title === 'Comments');
      const commentRows = commentsTab ? await readAllRows(files[0].id, commentsTab.title, commentsTab.rows) : [];
      const comments = buildCommentRecords(sheetKey, commentRows, records);
      const out = { sheet: sheetKey, mode: commit ? 'commit' : 'dry-run', jobs: summarize(records, stats), comments: summarize(comments, {}) };
      if (commit) {
        const { createClient } = await import('@supabase/supabase-js');
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

  // Read-only job list for the Production screen, built from the tidy tables. Never writes.
  if (req.method === 'GET' && req.query?.action === 'jobs') {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const live = (q) => q.is('removed_at', null);
      const [jobs, installs, hardware, raw] = await Promise.all([
        readAll(supabase, tbl('production_jobs'), '*', live),
        readAll(supabase, tbl('install_events'), '*', live),
        readAll(supabase, tbl('hardware_orders'), 'job_ref, order_text, ordered_on, ordered_text, received_on, received_text, status, notes, photo_url', live),
        readAll(supabase, tbl('sheet_rows_raw'), 'row_id, row_number', (q) => q.eq('sheet_key', 'production_status')),
      ]);
      const rowNumbers = new Map(raw.map((r) => [r.row_id, r.row_number]));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        mode: tableMode(),
        jobs: buildJobList({ jobs, installs, hardware, rowNumbers }),
      });
    } catch (e) {
      return res.status(502).json({ error: String(e.message ?? e) });
    }
  }

  // Builds the tidy tables from the raw sheet copy already in the database (no Google call).
  // GET = dry run: counts only, nothing written. POST with commit=1 writes the dev_ tables and needs
  // PRODUCTION_SYNC_ENABLED=1 and dev table mode, like the sheet sync.
  if (req.query?.action === 'normalize') {
    const sheetKey = String(req.query.sheet ?? '');
    const norm = NORMALIZERS[sheetKey];
    if (!norm) return res.status(400).json({ error: 'sheet must be one of ' + Object.keys(NORMALIZERS).join(', ') });
    const commit = req.method === 'POST' && req.query.commit === '1';
    if (commit && !isProductionSyncEnabled()) return res.status(403).json({ error: 'PRODUCTION_SYNC_ENABLED is not set' });
    if (commit && tableMode() !== 'dev') return res.status(403).json({ error: 'Normalize writes only to dev_ tables for now' });
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const rawRows = await readRawRows(supabase, tbl('sheet_rows_raw'), sheetKey);
      const rows = rawRows.map(norm.build);
      const out = { sheet: sheetKey, mode: commit ? 'commit' : 'dry-run', table: tbl(norm.table), summary: summarizeNormalized(rows) };
      if (commit) out.written = await writeNormalized({ supabase, table: tbl(norm.table), rows });
      if (sheetKey === 'hardware_orders') {
        const parts = hardwarePartRows(rows);
        out.parts = { rows: parts.length, withQty: parts.filter((p) => p.qty !== null).length };
        if (commit) {
          // Needs db/production/004; report instead of failing the order write that already succeeded.
          try { out.parts.written = await writeHardwareParts({ supabase, table: tbl('hardware_parts'), rows: parts }); }
          catch (e) { out.parts.error = String(e.message ?? e); }
        }
      }
      return res.status(200).json(out);
    } catch (e) {
      return res.status(502).json({ error: String(e.message ?? e) });
    }
  }

  return res.status(404).json({ error: 'Not found' });
}
