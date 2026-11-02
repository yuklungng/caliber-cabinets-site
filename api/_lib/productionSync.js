import crypto from 'crypto';

/**
 * Sheet sync, one way: Google Sheets (DEV COPY) -> dev_ raw tables. The sheets stay the source of truth.
 *
 * Row identity: the invoice number typed into the Job Name cell as "#1234" (it is the QuickBooks
 * invoice number). Nothing is ever written back to a sheet. A row with no number gets a fallback key
 * built from its text and is reported as an exception, never guessed at.
 *
 * Pure functions are exported for tests; runSync does the I/O with everything injected.
 */

export const SHEETS = {
  production_status: { spreadsheet: /production status/i, tab: 'Production Status', details: null, extra: [] },
  install_schedule: { spreadsheet: /install schedule/i, tab: 'Install Schedule', details: 'Job Details', extra: ['Delivery Date', 'Install Date'] },
  hardware_orders: { spreadsheet: /job hardware orders/i, tab: 'Job Hardware Orders', details: null, extra: ['Date Ordered'] },
  punch_list: { spreadsheet: /punch list/i, tab: 'Punch List Items', details: null, extra: ['Date'] },
};

const NAME_COL = 'Job Name';

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9#| /.-]/g, '').trim();
const isEmptyCell = (v) => v === undefined || v === null || String(v).trim() === '' || String(v).trim().toUpperCase() === 'FALSE';

/** Name-based UUID v5-style id: the same text always gives the same id. */
export function stableId(text) {
  const h = crypto.createHash('sha1').update(`caliber-production-sync|${text}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** "#1234" style numbers in a Job Name. First one wins; all are returned so a messy cell can be flagged. */
export function parseJobNumbers(name) {
  const found = [...String(name ?? '').matchAll(/#\s*(\d{3,6})\b/g)].map((m) => m[1]);
  return { number: found[0] ?? null, all: [...new Set(found)] };
}

/**
 * Readable stand-in for a job that has no #invoice number: T + 2-digit year + first two words of the
 * first line of the job name, e.g. "T17-ESTRADA-MAIN". Same name and year give the same label, so
 * several orders for one customer group together. Always temporary: a real number replaces it.
 * yearText is any date text ending in a 2 or 4 digit year (e.g. "06/03/17"); unusable years give "XX".
 */
export function tempJobRef(name, yearText) {
  const m = /(\d{2,4})\s*$/.exec(String(yearText ?? ''));
  const y = m ? Number(m[1]) % 100 : NaN;
  const yy = Number.isInteger(y) && y >= 15 && y <= 40 ? String(y).padStart(2, '0') : 'XX';
  const words = String(name ?? '').split(/\r?\n/)[0].toUpperCase().replace(/#\s*\d+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2);
  return `T${yy}-${words.join('-') || 'UNKNOWN'}`;
}

function headerKeys(headerRow) {
  const seen = {};
  return headerRow.map((h, i) => {
    const base = String(h ?? '').trim() || `col_${i + 1}`;
    seen[base] = (seen[base] ?? 0) + 1;
    return seen[base] > 1 ? `${base}_${seen[base]}` : base;
  });
}

/**
 * rows: the tab as arrays, row 1 = headers. Returns job records, plus counts of rows skipped.
 * rowNumber is the 1-based sheet row.
 */
export function buildRecords(sheetKey, rows) {
  const cfg = SHEETS[sheetKey];
  const header = headerKeys(rows[0] ?? []);
  const records = [];
  const stats = { blank: 0, sections: 0 };
  let section = '';
  const ordinals = {};

  for (let i = 1; i < rows.length; i++) {
    const cells = {};
    header.forEach((h, c) => {
      const v = rows[i][c];
      if (v !== undefined && String(v).trim() !== '') cells[h] = String(v);
    });
    const nonDefault = Object.entries(cells).filter(([, v]) => !isEmptyCell(v));
    if (!nonDefault.length) { stats.blank++; continue; }

    const name = cells[NAME_COL] ?? '';
    const { number, all } = parseJobNumbers(name);
    const onlyName = nonDefault.length === 1 && nonDefault[0][0] === NAME_COL;
    if (!number && onlyName) { stats.sections++; section = name.trim(); continue; }

    const details = cfg.details ? norm(cells[cfg.details]) : '';
    const extra = cfg.extra.map((k) => norm(cells[k])).join('|');
    let key;
    if (sheetKey === 'production_status') key = number ? `#${number}` : `name:${norm(name)}|${norm(section)}`;
    else if (sheetKey === 'install_schedule') key = number ? `#${number}|${details}` : `name:${norm(name)}|${details}|${extra}`;
    else key = number ? `#${number}|${extra}` : `name:${norm(name)}|${extra}`;

    ordinals[key] = (ordinals[key] ?? 0) + 1;
    const ordinal = ordinals[key];
    const fullKey = ordinal > 1 ? `${key}#${ordinal}` : key;

    const exceptions = [];
    if (!number) exceptions.push(['missing_job_number', name ? 'no #number in Job Name' : 'empty Job Name']);
    if (all.length > 1) exceptions.push(['multiple_job_numbers', `${all.length} different numbers in Job Name`]);
    if (ordinal > 1) exceptions.push(['duplicate_key', `same key seen ${ordinal} times`]);

    const raw = { cells, section, job_number: number, key: fullKey };
    records.push({
      rowNumber: i + 1,
      rowId: stableId(`${sheetKey}|${fullKey}`),
      key: fullKey,
      jobNumber: number,
      raw,
      hash: crypto.createHash('sha256').update(JSON.stringify({ cells, job_number: number })).digest('hex'),
      exceptions,
    });
  }
  return { records, stats };
}

/**
 * Adds one column of link addresses to the rows read from a tab. links[i] belongs to sheet row i + 2 (row 1 is the
 * header). The new column's header is newHeader; rows are padded so the cell lands in the same column for every row.
 * Returns the number of rows that got a link. The rows are changed in place.
 */
export function addLinkColumn(rows, newHeader, links) {
  if (!rows.length) return 0;
  const col = Math.max(...rows.map((r) => r.length));
  let added = 0;
  rows[0] = [...rows[0], ...Array(col - rows[0].length).fill(''), newHeader];
  for (let i = 1; i < rows.length; i++) {
    const link = links[i - 1] ?? null;
    if (!link) continue;
    rows[i] = [...rows[i], ...Array(col - rows[i].length).fill(''), link];
    added++;
  }
  return added;
}

/** Comments tab rows look like ["Row 448", text, author, time]. Linked to the job row at that sheet row. */
export function buildCommentRecords(sheetKey, rows, jobRecords) {
  const byRow = new Map(jobRecords.map((r) => [r.rowNumber, r]));
  const seen = {};
  const out = [];
  for (const r of rows) {
    if (!r || r.every((c) => String(c ?? '').trim() === '')) continue;
    const m = /row\s*(\d+)/i.exec(String(r[0] ?? ''));
    const anchorRow = m ? Number(m[1]) : null;
    const linked = anchorRow ? byRow.get(anchorRow) : null;
    const sig = r.map((c) => String(c ?? '').trim()).join('|');
    seen[sig] = (seen[sig] ?? 0) + 1;
    const raw = {
      anchor_row: anchorRow, text: r[1] ?? '', author: r[2] ?? '', at: r[3] ?? '',
      linked_key: linked?.key ?? null, linked_job_number: linked?.jobNumber ?? null,
    };
    out.push({
      rowNumber: anchorRow ?? 0,
      rowId: stableId(`${sheetKey}_comments|${sig}|${seen[sig]}`),
      key: sig,
      jobNumber: linked?.jobNumber ?? null,
      raw,
      hash: crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
      exceptions: linked ? [] : [['comment_unlinked', `comment anchored to row ${anchorRow ?? '?'} has no job row`]],
    });
  }
  return out;
}

/** What the run found, without any business names. */
export function summarize(records, stats) {
  const codes = {};
  const samples = {};
  for (const r of records) for (const [code] of r.exceptions) {
    codes[code] = (codes[code] ?? 0) + 1;
    (samples[code] ??= []).length < 8 && samples[code].push(r.rowNumber);
  }
  const numbers = records.filter((r) => r.jobNumber).map((r) => r.jobNumber);
  return {
    records: records.length,
    ...stats,
    withJobNumber: numbers.length,
    distinctJobNumbers: new Set(numbers).size,
    exceptions: codes,
    exampleRowNumbers: samples,
  };
}

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

async function allRows(supabase, table, sheetKey, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).eq('sheet_key', sheetKey).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

/**
 * Writes records for one sheet_key into the raw tables. Never deletes: a row missing on two runs in
 * a row gets removed_at. Old values go to the versions table when a row changes.
 */
export async function writeRecords({ supabase, t, sheetKey, records }) {
  const run = await supabase.from(t.runs).insert({ sheet_key: sheetKey }).select('id, started_at').single();
  if (run.error) throw new Error(`${t.runs}: ${run.error.message}`);
  const prev = await supabase.from(t.runs).select('started_at').eq('sheet_key', sheetKey)
    .not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(1);
  const prevStart = prev.data?.[0]?.started_at ?? null;

  const existing = await allRows(supabase, t.raw, sheetKey, 'row_id, content_hash, raw, last_seen_at, removed_at');
  const byId = new Map(existing.map((e) => [e.row_id, e]));
  const now = new Date().toISOString();
  const seenIds = new Set();
  let inserted = 0, updated = 0, unchanged = 0, removed = 0;
  const versions = [];

  const upserts = records.map((r) => {
    seenIds.add(r.rowId);
    const e = byId.get(r.rowId);
    if (!e) inserted++;
    else if (e.content_hash !== r.hash) { updated++; versions.push({ sheet_key: sheetKey, row_id: r.rowId, raw: e.raw }); }
    else unchanged++;
    return { sheet_key: sheetKey, row_id: r.rowId, row_number: r.rowNumber, raw: r.raw, content_hash: r.hash, last_seen_at: now, removed_at: null };
  });
  for (const c of chunk(upserts, 200)) {
    const { error } = await supabase.from(t.raw).upsert(c, { onConflict: 'sheet_key,row_id' });
    if (error) throw new Error(`${t.raw}: ${error.message}`);
  }
  for (const c of chunk(versions, 200)) {
    const { error } = await supabase.from(t.versions).insert(c);
    if (error) throw new Error(`${t.versions}: ${error.message}`);
  }

  // Missing on this run and also on the previous finished run (last seen before it started) -> removed.
  const gone = existing.filter((e) => !seenIds.has(e.row_id) && !e.removed_at && prevStart && e.last_seen_at < prevStart);
  for (const c of chunk(gone.map((g) => g.row_id), 200)) {
    const { error } = await supabase.from(t.raw).update({ removed_at: now }).eq('sheet_key', sheetKey).in('row_id', c);
    if (error) throw new Error(`${t.raw}: ${error.message}`);
  }
  removed = gone.length;

  // Exceptions: keep open ones that still apply, resolve ones that no longer do, add new ones.
  const open = await supabase.from(t.exceptions).select('id, row_id, code').eq('sheet_key', sheetKey).is('resolved_at', null);
  if (open.error) throw new Error(`${t.exceptions}: ${open.error.message}`);
  const wanted = new Map();
  for (const r of records) for (const [code, detail] of r.exceptions) wanted.set(`${r.rowId}|${code}`, { sheet_key: sheetKey, row_id: r.rowId, code, detail });
  const openKeys = new Set(open.data.map((o) => `${o.row_id}|${o.code}`));
  const stale = open.data.filter((o) => !wanted.has(`${o.row_id}|${o.code}`)).map((o) => o.id);
  for (const c of chunk(stale, 200)) await supabase.from(t.exceptions).update({ resolved_at: now }).in('id', c);
  const fresh = [...wanted.entries()].filter(([k]) => !openKeys.has(k)).map(([, v]) => v);
  for (const c of chunk(fresh, 200)) {
    const { error } = await supabase.from(t.exceptions).insert(c);
    if (error) throw new Error(`${t.exceptions}: ${error.message}`);
  }

  await supabase.from(t.runs).update({
    finished_at: new Date().toISOString(), rows_seen: records.length, inserted, updated, removed,
  }).eq('id', run.data.id);
  return { inserted, updated, unchanged, removed, exceptionsOpened: fresh.length, exceptionsResolved: stale.length };
}
