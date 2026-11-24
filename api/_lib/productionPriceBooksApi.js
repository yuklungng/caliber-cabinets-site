/* global process */
/**
 * Price books endpoint, mounted inside handleProduction (?resource=production&action=price-...).
 * Reads and writes only dev_vendor_files (kind 'price_book'), dev_price_tables, dev_price_cells, dev_price_adders and
 * dev_part_price_links (db/production/010). Only the admin (Mike) and the bookkeeper may use it.
 *
 * A price book PDF is read in the browser (priceBookReader.js); only a picture of each price page and the tables go up.
 * Tables are in use as soon as they are read and marked "not checked yet" until someone checks one against its page.
 * When a new edition of a book comes in it supersedes the old one: a table someone checked stays checked if its numbers
 * didn't change; a changed number keeps the old one (prev_rate) and its table goes back to "not checked yet".
 * Which table prices a part is worked out when read (its name is printed on the table's page); links set by hand win.
 */
import { readAll } from './productionJobs.js';
import { BUCKET, cleanPriceTable, isId, matchPartTables, storageName, tableKey } from './productionVendors.js';
import { canSeePrices } from './productionVendorsApi.js';

const LINK_SECONDS = 3600;
const ACTIONS = new Set([
  'price-book-start', 'price-book-tables', 'price-book-done',
  'price-tables', 'price-table', 'price-table-save', 'price-table-check', 'price-table-remove', 'part-price-link',
]);
export const isPriceBookAction = (action) => ACTIONS.has(action);

async function client() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const pagePath = (f, page) => `${f.vendor_id}/${f.id}/pages/page-${String(page).padStart(3, '0')}.jpg`;

/** The current price tables of a vendor (books not removed or superseded), with what linking needs. */
export async function currentTables(supabase, t, vendorId, cols = 'id, file_id, title, styles, also_names, row_labels, page, seq, checked_at') {
  const books = await readAll(supabase, t.files, 'id', (q) => q.eq('vendor_id', vendorId).eq('kind', 'price_book').is('removed_at', null).is('superseded_by', null).eq('status', 'extracted'));
  if (!books.length) return [];
  return readAll(supabase, t.tables, cols, (q) => q.in('file_id', books.map((b) => b.id)).is('removed_at', null).order('seq'));
}

/** Price tables for one part: [{ id, title, page, ... cells }] in the shape the part window shows. */
export async function partPriceTables(supabase, t, part) {
  const tables = await currentTables(supabase, t, part.vendor_id);
  if (!tables.length) return [];
  const links = must(await supabase.from(t.links).select('table_id, how').eq('part_id', part.id));
  const manualIds = links.filter((l) => l.how === 'manual').map((l) => l.table_id);
  const extra = manualIds.filter((id) => !tables.some((x) => x.id === id));
  const all = extra.length ? [...tables, ...must(await supabase.from(t.tables).select('id, file_id, title, styles, also_names, row_labels, page, seq, checked_at').in('id', extra).is('removed_at', null))] : tables;
  const ids = matchPartTables(part, all, links).slice(0, 6);
  return Promise.all(ids.map(async (id) => ({ ...(await fullTable(supabase, t, id, { withPages: false })), linkedBy: manualIds.includes(id) ? 'hand' : 'name' })));
}

function shapeTable(r) {
  return {
    id: r.id, vendorId: r.vendor_id, fileId: r.file_id, page: r.page, optionsPage: r.options_page, seq: r.seq,
    title: r.title, styles: r.styles, pricing: r.pricing, rowLabel: r.row_label, columns: r.columns, rowLabels: r.row_labels,
    minSqFt: r.min_sq_ft == null ? null : Number(r.min_sq_ft), notes: r.notes, issues: r.issues,
    checkedBy: r.checked_by, checkedAt: r.checked_at, editedBy: r.edited_by, editedAt: r.edited_at,
  };
}

async function fullTable(supabase, t, id, { withPages = true } = {}) {
  const r = must(await supabase.from(t.tables).select('*').eq('id', id).is('removed_at', null).maybeSingle());
  if (!r) return null;
  const [cells, adders, file] = await Promise.all([
    readAll(supabase, t.cells, 'row_index, column_key, rate, raw, prev_rate, edited_by, edited_at', (q) => q.eq('table_id', id)),
    readAll(supabase, t.adders, 'seq, label, kind, value, raw, page', (q) => q.eq('table_id', id).order('seq')),
    supabase.from(t.files).select('id, vendor_id, title, edition, superseded_by').eq('id', r.file_id).maybeSingle().then(must),
  ]);
  const out = {
    ...shapeTable(r),
    book: file ? { id: file.id, title: file.title, edition: file.edition, current: !file.superseded_by } : null,
    cells: cells.map((c) => ({
      row: c.row_index, col: c.column_key, rate: c.rate == null ? null : Number(c.rate), raw: c.raw,
      prevRate: c.prev_rate == null ? null : Number(c.prev_rate), editedBy: c.edited_by, editedAt: c.edited_at,
    })),
    adders: adders.map((a) => ({ label: a.label, kind: a.kind, value: Number(a.value), raw: a.raw, page: a.page })),
  };
  if (withPages && file) {
    const pages = [r.page, r.options_page].filter(Boolean);
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(pages.map((p) => pagePath(file, p)), LINK_SECONDS);
    out.pageImages = pages.map((p, k) => ({ page: p, url: data?.[k]?.signedUrl ?? null }));
  }
  return out;
}

export async function handlePriceBooks(req, res, auth, { tbl, tableMode }) {
  const action = req.query.action;
  const isPost = req.method === 'POST';
  res.setHeader('Cache-Control', 'no-store');
  if (!canSeePrices(auth)) return res.status(403).json({ error: 'Only the admin and the bookkeeper can see price books' });
  if (isPost && tableMode() !== 'dev') return res.status(403).json({ error: 'Price book changes write only to dev_ tables for now' });
  const t = {
    vendors: tbl('vendors'), files: tbl('vendor_files'), parts: tbl('vendor_parts'),
    tables: tbl('price_tables'), cells: tbl('price_cells'), adders: tbl('price_adders'), links: tbl('part_price_links'),
  };
  const who = String(auth.user?.name ?? auth.user?.email ?? 'admin');
  const now = new Date().toISOString();
  const body = req.body ?? {};

  try {
    const supabase = await client();

    // Start reading a price book: the file row only (no PDF is stored). Page pictures and tables follow.
    //   POST { vendorId, title, edition, fileName, sizeBytes, pages }
    if (action === 'price-book-start' && isPost) {
      if (!isId(body.vendorId)) return res.status(400).json({ error: 'vendorId is required' });
      const fileName = storageName(body.fileName);
      if (!fileName.toLowerCase().endsWith('.pdf')) return res.status(400).json({ error: 'A price book must be a PDF' });
      const pages = Number(body.pages);
      if (!Number.isInteger(pages) || pages < 1 || pages > 5000) return res.status(400).json({ error: 'pages is required' });
      const vendor = must(await supabase.from(t.vendors).select('id').eq('id', body.vendorId).is('removed_at', null).maybeSingle());
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
      const title = String(body.title ?? '').trim().slice(0, 200) || fileName.replace(/\.pdf$/i, '');
      const row = must(await supabase.from(t.files).insert({
        vendor_id: body.vendorId, kind: 'price_book', status: 'extracting', uploaded_by: who, title,
        edition: String(body.edition ?? '').trim().slice(0, 100) || null,
        file_name: fileName, size_bytes: Number(body.sizeBytes) > 0 ? Math.round(Number(body.sizeBytes)) : null, pages, reader: 'price-grid',
      }).select('*').single());
      // The edition this one replaces: same vendor and title, still current.
      const prev = must(await supabase.from(t.files).select('id, edition, uploaded_at').eq('vendor_id', body.vendorId).eq('kind', 'price_book')
        .ilike('title', title.replace(/[%_\\]/g, '\\$&')).is('removed_at', null).is('superseded_by', null).neq('id', row.id).eq('status', 'extracted'));
      return res.status(200).json({ file: { id: row.id, title: row.title, edition: row.edition }, replaces: prev.map((p) => ({ id: p.id, edition: p.edition })) });
    }

    // Tables read from the book. POST { fileId, tables: [...] } (max 25 per call). Each: page, seq, title, styles,
    // alsoNames, pricing, rowLabel, columns, rows: [{ label, cells: { c1: { rate, raw } } }], minSqFt, notes, issues, adders.
    if (action === 'price-book-tables' && isPost) {
      if (!isId(body.fileId)) return res.status(400).json({ error: 'fileId is required' });
      const f = must(await supabase.from(t.files).select('id, vendor_id, kind, status').eq('id', body.fileId).is('removed_at', null).maybeSingle());
      if (!f || f.kind !== 'price_book') return res.status(404).json({ error: 'Price book not found' });
      if (f.status !== 'extracting') return res.status(400).json({ error: 'This price book has already been read' });
      const list = Array.isArray(body.tables) ? body.tables : [];
      if (!list.length || list.length > 25) return res.status(400).json({ error: 'tables: 1 to 25 per call' });
      let clean;
      try { clean = list.map((x, i) => cleanPriceTable(x, i)); } catch (e) { return res.status(400).json({ error: e.message }); }
      const made = must(await supabase.from(t.tables).insert(clean.map((c) => ({ ...c.table, vendor_id: f.vendor_id, file_id: f.id }))).select('id, seq'));
      const idOf = new Map(made.map((m) => [m.seq, m.id]));
      const cells = clean.flatMap((c) => c.cells.map((x) => ({ ...x, table_id: idOf.get(c.table.seq) })));
      const adders = clean.flatMap((c) => c.adders.map((x) => ({ ...x, table_id: idOf.get(c.table.seq) })));
      for (let i = 0; i < cells.length; i += 1000) must(await supabase.from(t.cells).insert(cells.slice(i, i + 1000)));
      for (let i = 0; i < adders.length; i += 1000) must(await supabase.from(t.adders).insert(adders.slice(i, i + 1000)));
      return res.status(200).json({ tables: made.length, cells: cells.length, adders: adders.length });
    }

    // Finish: POST { fileId, notes, replaces: [fileId] } -> the book is in use; the editions it replaces are superseded,
    // checks carried over where the numbers are the same, and links set by hand moved to the new tables.
    if (action === 'price-book-done' && isPost) {
      if (!isId(body.fileId)) return res.status(400).json({ error: 'fileId is required' });
      const f = must(await supabase.from(t.files).select('*').eq('id', body.fileId).is('removed_at', null).maybeSingle());
      if (!f || f.kind !== 'price_book') return res.status(404).json({ error: 'Price book not found' });
      const replaces = (Array.isArray(body.replaces) ? body.replaces : []).filter(isId);
      const out = { carriedChecked: 0, changedNumbers: 0, movedLinks: 0 };
      if (replaces.length) {
        const old = await readAll(supabase, t.files, 'id', (q) => q.in('id', replaces).eq('vendor_id', f.vendor_id).eq('kind', 'price_book').is('superseded_by', null));
        const oldIds = old.map((o) => o.id);
        if (oldIds.length) {
          const [oldTables, newTables] = await Promise.all([
            readAll(supabase, t.tables, 'id, title, columns, row_labels, checked_by, checked_at', (q) => q.in('file_id', oldIds).is('removed_at', null)),
            readAll(supabase, t.tables, 'id, title, columns, row_labels', (q) => q.eq('file_id', f.id).is('removed_at', null)),
          ]);
          const byKey = new Map();
          for (const o of oldTables) { const k = tableKey(o); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(o); }
          for (const n of newTables) {
            const o = byKey.get(tableKey(n))?.shift();
            if (!o) continue;
            const [oc, nc] = await Promise.all([
              readAll(supabase, t.cells, 'row_index, column_key, rate', (q) => q.eq('table_id', o.id)),
              readAll(supabase, t.cells, 'id, row_index, column_key, rate', (q) => q.eq('table_id', n.id)),
            ]);
            const was = new Map(oc.map((c) => [`${c.row_index}|${c.column_key}`, c.rate == null ? null : Number(c.rate)]));
            const changed = nc.filter((c) => { const k = `${c.row_index}|${c.column_key}`; return was.has(k) && was.get(k) !== (c.rate == null ? null : Number(c.rate)); });
            for (const c of changed) must(await supabase.from(t.cells).update({ prev_rate: was.get(`${c.row_index}|${c.column_key}`) }).eq('id', c.id));
            out.changedNumbers += changed.length;
            if (!changed.length && o.checked_at && nc.length === oc.length) {
              must(await supabase.from(t.tables).update({ checked_by: o.checked_by, checked_at: o.checked_at }).eq('id', n.id));
              out.carriedChecked++;
            }
            const links = must(await supabase.from(t.links).select('part_id, how, created_by').eq('table_id', o.id));
            if (links.length) {
              must(await supabase.from(t.links).upsert(links.map((l) => ({ ...l, table_id: n.id })), { onConflict: 'part_id,table_id', ignoreDuplicates: true }));
              out.movedLinks += links.length;
            }
          }
          must(await supabase.from(t.files).update({ superseded_by: f.id }).in('id', oldIds));
        }
      }
      const row = must(await supabase.from(t.files).update({ status: 'extracted', extracted_at: now, notes: String(body.notes ?? '').trim().slice(0, 2000) || null })
        .eq('id', f.id).select('id, status').single());
      return res.status(200).json({ file: row, ...out });
    }

    // GET ?vendorId=&checked=no&q=&fileId= -> the current tables (summary), most useful first: book order.
    if (action === 'price-tables' && req.method === 'GET') {
      if (!isId(req.query.vendorId)) return res.status(400).json({ error: 'vendorId is required' });
      let rows;
      if (req.query.fileId) {
        if (!isId(req.query.fileId)) return res.status(400).json({ error: 'fileId is invalid' });
        rows = await readAll(supabase, t.tables, '*', (q) => q.eq('file_id', req.query.fileId).is('removed_at', null).order('seq'));
      } else {
        rows = await currentTables(supabase, t, req.query.vendorId, '*');
      }
      const all = rows.length;
      const unchecked = rows.filter((r) => !r.checked_at).length;
      const flagged = rows.filter((r) => r.issues?.length).length;
      if (req.query.checked === 'no') rows = rows.filter((r) => !r.checked_at);
      const term = String(req.query.q ?? '').trim().toLowerCase();
      if (term) rows = rows.filter((r) => [r.title, ...(r.styles ?? []), ...(r.row_labels ?? []), ...(r.columns ?? []).map((c) => c.label)].join(' ').toLowerCase().includes(term));
      const books = await readAll(supabase, t.files, 'id, title, edition, superseded_by, uploaded_at', (q) => q.eq('vendor_id', req.query.vendorId).eq('kind', 'price_book').is('removed_at', null));
      return res.status(200).json({
        total: rows.length, all, unchecked, flagged,
        books: books.map((b) => ({ id: b.id, title: b.title, edition: b.edition, current: !b.superseded_by, uploadedAt: b.uploaded_at })),
        tables: rows.map((r) => ({ ...shapeTable(r), rows: r.row_labels?.length ?? 0 })),
      });
    }

    // One table with its numbers, add-ons, page pictures and the parts it prices. GET ?id=
    if (action === 'price-table' && req.method === 'GET') {
      if (!isId(req.query.id)) return res.status(400).json({ error: 'id is required' });
      const table = await fullTable(supabase, t, req.query.id);
      if (!table) return res.status(404).json({ error: 'Price table not found' });
      const parts = await readAll(supabase, t.parts, 'id, name, kind, vendor_id', (q) => q.eq('vendor_id', table.vendorId).is('removed_at', null).in('status', ['active', 'retired']));
      const links = await readAll(supabase, t.links, 'part_id, table_id, how', (q) => q.in('part_id', parts.map((p) => p.id)).limit(5000));
      const current = await currentTables(supabase, t, table.vendorId);
      const pool = current.some((c) => c.id === table.id) ? current : [...current, { id: table.id, title: table.title, styles: table.styles, row_labels: table.rowLabels }];
      const priced = parts.filter((p) => matchPartTables(p, pool, links.filter((l) => l.part_id === p.id)).includes(table.id));
      return res.status(200).json({ table: { ...table, parts: priced.map((p) => ({ id: p.id, name: p.name, kind: p.kind, linkedBy: links.some((l) => l.part_id === p.id && l.table_id === table.id && l.how === 'manual') ? 'hand' : 'name' })) } });
    }

    // Correct numbers or labels. POST { id, cells: [{ row, col, rate }], title?, rowLabels?: [..], columnLabels?: { c1: '...' } }
    if (action === 'price-table-save' && isPost) {
      if (!isId(body.id)) return res.status(400).json({ error: 'id is required' });
      const r = must(await supabase.from(t.tables).select('*').eq('id', body.id).is('removed_at', null).maybeSingle());
      if (!r) return res.status(404).json({ error: 'Price table not found' });
      const keys = new Set((r.columns ?? []).map((c) => c.key));
      const edits = Array.isArray(body.cells) ? body.cells.slice(0, 2000) : [];
      for (const e of edits) {
        const row = Number(e?.row);
        if (!Number.isInteger(row) || row < 0 || row >= (r.row_labels?.length ?? 0) || !keys.has(e?.col)) return res.status(400).json({ error: 'A cell is outside the table' });
        let rate = null;
        if (e.rate !== null && e.rate !== '' && e.rate !== undefined) {
          rate = Number(e.rate);
          if (!Number.isFinite(rate) || rate < 0 || rate > 1e7) return res.status(400).json({ error: `Price ${e.rate} is invalid` });
          rate = Math.round(rate * 10000) / 10000;
        }
        must(await supabase.from(t.cells).upsert({ table_id: r.id, row_index: row, column_key: e.col, rate, edited_by: who, edited_at: now }, { onConflict: 'table_id,row_index,column_key' }));
      }
      const patch = { edited_by: who, edited_at: now };
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 300);
      if (Array.isArray(body.rowLabels) && body.rowLabels.length === (r.row_labels?.length ?? 0)) patch.row_labels = body.rowLabels.map((x) => String(x ?? '').trim().slice(0, 200));
      if (body.columnLabels && typeof body.columnLabels === 'object') {
        patch.columns = (r.columns ?? []).map((c) => (typeof body.columnLabels[c.key] === 'string' ? { ...c, label: body.columnLabels[c.key].trim().slice(0, 300) } : c));
      }
      must(await supabase.from(t.tables).update(patch).eq('id', r.id));
      return res.status(200).json({ table: await fullTable(supabase, t, r.id) });
    }

    // POST { ids: [...], checked: true | false } (max 200)
    if (action === 'price-table-check' && isPost) {
      const ids = Array.isArray(body.ids) ? body.ids.filter(isId) : [];
      if (!ids.length || ids.length > 200) return res.status(400).json({ error: 'ids: 1 to 200 table ids' });
      const rows = must(await supabase.from(t.tables).update(body.checked === false ? { checked_by: null, checked_at: null } : { checked_by: who, checked_at: now })
        .in('id', ids).is('removed_at', null).select('id'));
      return res.status(200).json({ changed: rows.map((x) => x.id) });
    }

    // A table the reader found that isn't a price table (an order form, an index). POST { id }
    if (action === 'price-table-remove' && isPost) {
      if (!isId(body.id)) return res.status(400).json({ error: 'id is required' });
      const row = must(await supabase.from(t.tables).update({ removed_at: now, edited_by: who, edited_at: now }).eq('id', body.id).is('removed_at', null).select('id').maybeSingle());
      if (!row) return res.status(404).json({ error: 'Price table not found' });
      return res.status(200).json({ removed: row.id });
    }

    // Link a part to a table by hand, or undo a link: POST { partId, tableId, link: 'manual' | 'hidden' | 'none' }
    // 'hidden' stops a match by name; 'none' removes what was set by hand.
    if (action === 'part-price-link' && isPost) {
      if (!isId(body.partId) || !isId(body.tableId)) return res.status(400).json({ error: 'partId and tableId are required' });
      if (!['manual', 'hidden', 'none'].includes(body.link)) return res.status(400).json({ error: 'link must be manual, hidden or none' });
      const [p, tb] = await Promise.all([
        supabase.from(t.parts).select('id, vendor_id').eq('id', body.partId).is('removed_at', null).maybeSingle().then(must),
        supabase.from(t.tables).select('id, vendor_id').eq('id', body.tableId).is('removed_at', null).maybeSingle().then(must),
      ]);
      if (!p || !tb || p.vendor_id !== tb.vendor_id) return res.status(404).json({ error: 'Part or table not found' });
      if (body.link === 'none') must(await supabase.from(t.links).delete().eq('part_id', p.id).eq('table_id', tb.id));
      else must(await supabase.from(t.links).upsert({ part_id: p.id, table_id: tb.id, how: body.link, created_by: who, created_at: now }, { onConflict: 'part_id,table_id' }));
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message ?? e) });
  }
}
