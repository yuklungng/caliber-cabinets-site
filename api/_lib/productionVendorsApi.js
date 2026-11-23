/* global process */
/**
 * Vendor parts endpoint, mounted inside handleProduction (?resource=production&action=vendor-...).
 * Reads and writes only the dev_vendor_* tables and the private dev-vendor-catalogs bucket.
 * Files never pass through this function: the browser uploads straight to storage with one-time signed links.
 * A catalog PDF is never uploaded at all: the browser reads it (catalogReader.js) and uploads only a picture per
 * part and a picture per catalog page, then the parts. Price lists (small CSV files) are kept as uploaded.
 * Pictures and files are shown only through signed links that expire (they are the vendors' copyright).
 *
 * Parts go into use as soon as they are read: Mike and the team check, correct or delete them as they use them.
 * A part nobody has checked yet has reviewed_at null; "checked" sets reviewed_by and reviewed_at. "Deleted" is
 * status 'rejected' (kept, hidden, and not added again when the catalog is read again).
 *
 * Prices are shown and edited only by the admin (Mike) and the bookkeeper.
 */
import { readAll } from './productionJobs.js';
import {
  BUCKET, FILE_STATUSES, PART_KINDS, PART_STATUSES,
  cleanCatalogParts, cleanDate, cleanPart, cleanPrice, cleanUnit, cleanVendor, isId, matchPriceRows, partKey, storageName,
} from './productionVendors.js';

const LINK_SECONDS = 3600;
const ACTIONS = new Set([
  'vendors', 'vendor-save', 'vendor-remove',
  'vendor-files', 'vendor-file-start', 'vendor-file-done', 'vendor-file-update', 'vendor-file-link', 'vendor-file-images',
  'vendor-catalog-start', 'vendor-page-image',
  'vendor-parts', 'vendor-part', 'vendor-part-save', 'vendor-parts-review', 'vendor-part-status', 'vendor-part-image',
  'vendor-catalog-parts', 'vendor-price-add', 'vendor-price-import',
]);

export const isVendorAction = (action) => ACTIONS.has(action);
export const canSeePrices = (auth) => !!(auth?.isSuperAdmin || auth?.user?.role === 'bookkeeper');

async function client() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

/** Signed links for a list of storage paths; Map path -> url. Missing or failed paths are left out. */
async function signPaths(supabase, paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique.slice(i, i + 100), LINK_SECONDS);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) if (d.signedUrl && !d.error) out.set(d.path, d.signedUrl);
  }
  return out;
}

/** Newest price per part: Map partId -> { price, unit, asOf, source }. */
async function latestPrices(supabase, t, partIds) {
  const out = new Map();
  for (let i = 0; i < partIds.length; i += 200) {
    const rows = must(await supabase.from(t.prices).select('part_id, price, unit, as_of, source, entered_at')
      .in('part_id', partIds.slice(i, i + 200)).order('as_of', { ascending: false }).order('entered_at', { ascending: false }));
    for (const r of rows) if (!out.has(r.part_id)) out.set(r.part_id, { price: Number(r.price), unit: r.unit, asOf: r.as_of, source: r.source });
  }
  return out;
}

const shapeVendor = (v) => ({
  id: v.id, name: v.name, website: v.website, orderEmail: v.order_email, phone: v.phone,
  accountNumber: v.account_number, notes: v.notes, createdAt: v.created_at,
});
const shapeFile = (f) => ({
  id: f.id, vendorId: f.vendor_id, kind: f.kind, title: f.title, edition: f.edition, fileName: f.file_name,
  sizeBytes: f.size_bytes, pages: f.pages, status: f.status, reader: f.reader, supersededBy: f.superseded_by,
  notes: f.notes, uploadedBy: f.uploaded_by, uploadedAt: f.uploaded_at, extractedAt: f.extracted_at,
});
const shapePart = (p, links, prices) => ({
  id: p.id, vendorId: p.vendor_id, kind: p.kind, itemNumber: p.item_number, name: p.name,
  description: p.description, category: p.category, options: p.options, fileId: p.file_id, page: p.page,
  image: p.image_path ? links?.get(p.image_path) ?? null : null, hasImage: !!p.image_path,
  status: p.status, source: p.source, createdBy: p.created_by, createdAt: p.created_at,
  reviewedBy: p.reviewed_by, reviewedAt: p.reviewed_at, editedBy: p.edited_by, editedAt: p.edited_at,
  ...(prices ? { price: prices.get(p.id) ?? null } : {}),
});

// Search text for a PostgREST or() filter: characters that would break the filter are dropped.
const searchTerm = (q) => String(q ?? '').replace(/[,()%*\\:"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function handleVendors(req, res, auth, { tbl, tableMode }) {
  const action = req.query.action;
  const isPost = req.method === 'POST';
  if (isPost && tableMode() !== 'dev') return res.status(403).json({ error: 'Vendor changes write only to dev_ tables for now' });
  const t = { vendors: tbl('vendors'), files: tbl('vendor_files'), parts: tbl('vendor_parts'), prices: tbl('vendor_prices') };
  const who = String(auth.user?.name ?? auth.user?.email ?? 'admin');
  const now = new Date().toISOString();
  const prices = canSeePrices(auth);
  const body = req.body ?? {};
  res.setHeader('Cache-Control', 'no-store');

  try {
    const supabase = await client();

    // ── Vendors ──────────────────────────────────────────────────────────────
    if (action === 'vendors' && req.method === 'GET') {
      const [vendors, files, parts] = await Promise.all([
        readAll(supabase, t.vendors, '*', (q) => q.is('removed_at', null).order('name')),
        readAll(supabase, t.files, 'id, vendor_id, kind, title, edition, status, reader, uploaded_at', (q) => q.is('removed_at', null)),
        readAll(supabase, t.parts, 'vendor_id, status, reviewed_at', (q) => q.is('removed_at', null)),
      ]);
      return res.status(200).json({
        canSeePrices: prices,
        vendors: vendors.map((v) => {
          const vf = files.filter((f) => f.vendor_id === v.id).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
          const vp = parts.filter((p) => p.vendor_id === v.id);
          const catalog = vf.find((f) => f.kind === 'catalog');
          const priceList = vf.find((f) => f.kind === 'price_list');
          return {
            ...shapeVendor(v),
            parts: vp.filter((p) => p.status === 'active').length,
            review: vp.filter((p) => p.status === 'review').length,
            unchecked: vp.filter((p) => p.status === 'active' && !p.reviewed_at).length,
            latestCatalog: catalog ? { title: catalog.title, edition: catalog.edition, status: catalog.status } : null,
            latestPriceList: priceList ? { title: priceList.title, uploadedAt: priceList.uploaded_at } : null,
            // Catalog layouts read for this vendor before, so a dropped catalog can be matched to it.
            readers: [...new Set(vf.map((f) => f.reader).filter(Boolean))],
          };
        }),
      });
    }

    if (action === 'vendor-save' && isPost) {
      let v;
      try { v = cleanVendor(body); } catch (e) { return res.status(400).json({ error: e.message }); }
      const dupe = must(await supabase.from(t.vendors).select('id').ilike('name', v.name.replace(/[%_\\]/g, '\\$&')).is('removed_at', null));
      if (dupe.some((d) => d.id !== body.id)) return res.status(409).json({ error: `There is already a vendor named ${v.name}` });
      if (body.id) {
        if (!isId(body.id)) return res.status(400).json({ error: 'id is invalid' });
        const row = must(await supabase.from(t.vendors).update({ ...v, updated_at: now }).eq('id', body.id).is('removed_at', null).select('*').maybeSingle());
        if (!row) return res.status(404).json({ error: 'Vendor not found' });
        return res.status(200).json({ vendor: shapeVendor(row) });
      }
      const row = must(await supabase.from(t.vendors).insert({ ...v, created_by: who }).select('*').single());
      return res.status(200).json({ vendor: shapeVendor(row) });
    }

    if (action === 'vendor-remove' && isPost) {
      if (!isId(body.id)) return res.status(400).json({ error: 'id is required' });
      const live = must(await supabase.from(t.parts).select('id').eq('vendor_id', body.id).is('removed_at', null).in('status', ['active', 'review']).limit(1));
      if (live.length) return res.status(400).json({ error: 'Retire or reject this vendor\'s parts first' });
      const row = must(await supabase.from(t.vendors).update({ removed_at: now, updated_at: now }).eq('id', body.id).is('removed_at', null).select('id').maybeSingle());
      if (!row) return res.status(404).json({ error: 'Vendor not found' });
      return res.status(200).json({ removed: row.id });
    }

    // ── Files (catalogs and price lists) ─────────────────────────────────────
    if (action === 'vendor-files' && req.method === 'GET') {
      if (!isId(req.query.vendorId)) return res.status(400).json({ error: 'vendorId is required' });
      const files = must(await supabase.from(t.files).select('*').eq('vendor_id', req.query.vendorId).is('removed_at', null).order('uploaded_at', { ascending: false }));
      const counts = await readAll(supabase, t.parts, 'file_id, status, reviewed_at', (q) => q.eq('vendor_id', req.query.vendorId).is('removed_at', null).not('file_id', 'is', null));
      return res.status(200).json({
        files: files.map((f) => ({
          ...shapeFile(f),
          parts: counts.filter((c) => c.file_id === f.id && c.status === 'active').length,
          review: counts.filter((c) => c.file_id === f.id && c.status === 'review').length,
          unchecked: counts.filter((c) => c.file_id === f.id && c.status === 'active' && !c.reviewed_at).length,
        })),
      });
    }

    // Start a price list upload: makes the file row and a one-time upload link. The browser then PUTs the file to the link.
    //   POST { vendorId, kind: 'price_list', title, edition, fileName, sizeBytes }
    if (action === 'vendor-file-start' && isPost) {
      if (!isId(body.vendorId)) return res.status(400).json({ error: 'vendorId is required' });
      if (body.kind !== 'price_list') return res.status(400).json({ error: 'Only price lists are uploaded as files; a catalog is read in the browser' });
      const fileName = storageName(body.fileName);
      if (!/\.(csv|txt)$/.test(fileName.toLowerCase())) return res.status(400).json({ error: 'A price list must be a CSV file (in Excel: File > Save As > CSV)' });
      const size = Number(body.sizeBytes);
      if (!Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) return res.status(400).json({ error: 'A price list can be up to 10 MB' });
      const title = String(body.title ?? '').trim().slice(0, 200) || fileName;
      const vendor = must(await supabase.from(t.vendors).select('id').eq('id', body.vendorId).is('removed_at', null).maybeSingle());
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
      const row = must(await supabase.from(t.files).insert({
        vendor_id: body.vendorId, kind: body.kind, title, edition: String(body.edition ?? '').trim().slice(0, 100) || null,
        file_name: fileName, size_bytes: size, status: 'uploading', uploaded_by: who,
      }).select('*').single());
      const path = `${body.vendorId}/${row.id}/${fileName}`;
      const { data: up, error: upErr } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (upErr) {
        await supabase.from(t.files).update({ status: 'failed', notes: 'Could not start the upload' }).eq('id', row.id);
        throw new Error(upErr.message);
      }
      must(await supabase.from(t.files).update({ storage_path: path }).eq('id', row.id));
      return res.status(200).json({ file: shapeFile({ ...row, storage_path: path }), upload: { url: up.signedUrl, path } });
    }

    // A catalog read in the browser: the file row only (no PDF is stored). Its pictures and parts follow.
    //   POST { vendorId, title, edition, fileName, sizeBytes, pages, reader }
    if (action === 'vendor-catalog-start' && isPost) {
      if (!isId(body.vendorId)) return res.status(400).json({ error: 'vendorId is required' });
      const fileName = storageName(body.fileName);
      if (!fileName.toLowerCase().endsWith('.pdf')) return res.status(400).json({ error: 'A catalog must be a PDF' });
      const pages = Number(body.pages);
      if (!Number.isInteger(pages) || pages < 1 || pages > 5000) return res.status(400).json({ error: 'pages is required' });
      const vendor = must(await supabase.from(t.vendors).select('id').eq('id', body.vendorId).is('removed_at', null).maybeSingle());
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
      const row = must(await supabase.from(t.files).insert({
        vendor_id: body.vendorId, kind: 'catalog', status: 'extracting', uploaded_by: who,
        title: String(body.title ?? '').trim().slice(0, 200) || fileName.replace(/\.pdf$/i, ''),
        edition: String(body.edition ?? '').trim().slice(0, 100) || null,
        file_name: fileName, size_bytes: Number(body.sizeBytes) > 0 ? Math.round(Number(body.sizeBytes)) : null, pages,
        reader: String(body.reader ?? '').trim().slice(0, 40) || null,
      }).select('*').single());
      return res.status(200).json({ file: shapeFile(row) });
    }

    // After the browser's upload: POST { id, ok } -> 'uploaded' (checked against storage) or 'failed'.
    if (action === 'vendor-file-done' && isPost) {
      if (!isId(body.id)) return res.status(400).json({ error: 'id is required' });
      const f = must(await supabase.from(t.files).select('*').eq('id', body.id).maybeSingle());
      if (!f) return res.status(404).json({ error: 'File not found' });
      let status = 'failed';
      if (body.ok === true && f.storage_path) {
        const folder = f.storage_path.split('/').slice(0, -1).join('/');
        const { data: listed } = await supabase.storage.from(BUCKET).list(folder, { search: f.file_name });
        if ((listed ?? []).some((o) => o.name === f.file_name)) status = 'uploaded';
      }
      const row = must(await supabase.from(t.files).update({ status, notes: status === 'failed' ? (String(body.error ?? '').slice(0, 300) || f.notes) : f.notes }).eq('id', f.id).select('*').single());
      return res.status(200).json({ file: shapeFile(row) });
    }

    // Edit a file's details, or (from the extraction script) its status, reader and page count.
    //   POST { id, title?, edition?, notes?, status?, reader?, pages?, supersededBy? }
    if (action === 'vendor-file-update' && isPost) {
      if (!isId(body.id)) return res.status(400).json({ error: 'id is required' });
      const patch = {};
      if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 200) || 'Untitled';
      if (body.edition !== undefined) patch.edition = String(body.edition ?? '').trim().slice(0, 100) || null;
      if (body.notes !== undefined) patch.notes = String(body.notes ?? '').trim().slice(0, 2000) || null;
      if (body.status !== undefined) {
        if (!FILE_STATUSES.includes(body.status)) return res.status(400).json({ error: 'Unknown status' });
        patch.status = body.status;
        if (body.status === 'extracted') patch.extracted_at = now;
      }
      if (body.reader !== undefined) patch.reader = String(body.reader ?? '').trim().slice(0, 40) || null;
      if (body.pages !== undefined) patch.pages = Number.isInteger(body.pages) && body.pages > 0 ? body.pages : null;
      if (body.supersededBy !== undefined) {
        if (body.supersededBy !== null && !isId(body.supersededBy)) return res.status(400).json({ error: 'supersededBy is invalid' });
        patch.superseded_by = body.supersededBy;
      }
      if (body.removed === true) patch.removed_at = now;
      const row = must(await supabase.from(t.files).update(patch).eq('id', body.id).is('removed_at', null).select('*').maybeSingle());
      if (!row) return res.status(404).json({ error: 'File not found' });
      // Removing a catalog takes off the parts from it that nobody has checked yet; checked parts stay.
      if (body.removed === true) must(await supabase.from(t.parts).update({ removed_at: now }).eq('file_id', row.id).in('status', ['review', 'active']).is('reviewed_at', null).is('removed_at', null));
      return res.status(200).json({ file: shapeFile(row) });
    }

    // A signed link to open or download a file (an hour). GET ?id=
    if (action === 'vendor-file-link' && req.method === 'GET') {
      if (!isId(req.query.id)) return res.status(400).json({ error: 'id is required' });
      const f = must(await supabase.from(t.files).select('storage_path, status').eq('id', req.query.id).maybeSingle());
      if (!f?.storage_path || f.status === 'uploading' || f.status === 'failed') return res.status(404).json({ error: 'No file is kept for this one' });
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, LINK_SECONDS);
      if (error) throw new Error(error.message);
      return res.status(200).json({ url: data.signedUrl });
    }

    // Upload links for a catalog's pictures, read in the browser.
    //   POST { fileId, folder: 'img' | 'pages', names: ['p010-0001.jpg', ...] } (max 100; pages are named page-NNN.jpg)
    if (action === 'vendor-file-images' && isPost) {
      if (!isId(body.fileId)) return res.status(400).json({ error: 'fileId is required' });
      const folder = body.folder === 'pages' ? 'pages' : 'img';
      const names = Array.isArray(body.names) ? body.names.map(storageName) : [];
      if (!names.length || names.length > 100) return res.status(400).json({ error: 'names: 1 to 100 picture names' });
      if (names.some((n) => !/\.jpe?g$/i.test(n))) return res.status(400).json({ error: 'Pictures must be JPEG' });
      if (folder === 'pages' && names.some((n) => !/^page-\d{3,4}\.jpg$/.test(n))) return res.status(400).json({ error: 'Page pictures are named page-NNN.jpg' });
      const f = must(await supabase.from(t.files).select('vendor_id, id, kind').eq('id', body.fileId).is('removed_at', null).maybeSingle());
      if (!f || f.kind !== 'catalog') return res.status(404).json({ error: 'Catalog not found' });
      const uploads = [];
      for (let i = 0; i < names.length; i += 10) {
        uploads.push(...await Promise.all(names.slice(i, i + 10).map(async (n) => {
          const path = `${f.vendor_id}/${f.id}/${folder}/${n}`;
          const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
          if (error) throw new Error(`${n}: ${error.message}`);
          return { name: n, path, url: data.signedUrl };
        })));
      }
      return res.status(200).json({ uploads });
    }

    // A catalog page's picture (an hour's link). GET ?fileId=&page=
    if (action === 'vendor-page-image' && req.method === 'GET') {
      if (!isId(req.query.fileId)) return res.status(400).json({ error: 'fileId is required' });
      const page = Number(req.query.page);
      if (!Number.isInteger(page) || page < 1 || page > 5000) return res.status(400).json({ error: 'page is required' });
      const f = must(await supabase.from(t.files).select('vendor_id, id, kind').eq('id', req.query.fileId).maybeSingle());
      if (!f || f.kind !== 'catalog') return res.status(404).json({ error: 'Catalog not found' });
      const path = `${f.vendor_id}/${f.id}/pages/page-${String(page).padStart(3, '0')}.jpg`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
      if (error) return res.status(404).json({ error: 'No picture of that page' });
      return res.status(200).json({ url: data.signedUrl });
    }

    // ── Parts ────────────────────────────────────────────────────────────────
    // GET ?vendorId=&q=&kind=&status=&fileId=&offset=&limit=   (status defaults to active)
    if (action === 'vendor-parts' && req.method === 'GET') {
      const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      let q = supabase.from(t.parts).select('*', { count: 'exact' }).is('removed_at', null);
      if (req.query.vendorId) { if (!isId(req.query.vendorId)) return res.status(400).json({ error: 'vendorId is invalid' }); q = q.eq('vendor_id', req.query.vendorId); }
      if (req.query.fileId) { if (!isId(req.query.fileId)) return res.status(400).json({ error: 'fileId is invalid' }); q = q.eq('file_id', req.query.fileId); }
      const status = String(req.query.status ?? 'active');
      if (status !== 'all') { if (!PART_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' }); q = q.eq('status', status); }
      if (req.query.kind) { if (!PART_KINDS.includes(req.query.kind)) return res.status(400).json({ error: 'Unknown kind' }); q = q.eq('kind', req.query.kind); }
      // checked=no: only parts nobody has checked yet.
      if (req.query.checked === 'no') q = q.is('reviewed_at', null);
      const term = searchTerm(req.query.q);
      if (term) q = q.or(`name.ilike.*${term}*,item_number.ilike.*${term}*,description.ilike.*${term}*`);
      // Review lists keep catalog order (page by page); others sort by name.
      q = status === 'review' || req.query.checked === 'no' ? q.order('page', { ascending: true, nullsFirst: false }).order('created_at') : q.order('name');
      const { data, error, count } = await q.range(offset, offset + limit - 1);
      if (error) throw new Error(error.message);
      const links = await signPaths(supabase, data.map((p) => p.image_path));
      const priceMap = prices ? await latestPrices(supabase, t, data.map((p) => p.id)) : null;
      return res.status(200).json({ total: count ?? data.length, offset, parts: data.map((p) => shapePart(p, links, priceMap)) });
    }

    // One part with its price history. GET ?id=
    if (action === 'vendor-part' && req.method === 'GET') {
      if (!isId(req.query.id)) return res.status(400).json({ error: 'id is required' });
      const p = must(await supabase.from(t.parts).select('*').eq('id', req.query.id).maybeSingle());
      if (!p) return res.status(404).json({ error: 'Part not found' });
      const links = await signPaths(supabase, [p.image_path]);
      let history;
      if (prices) {
        history = must(await supabase.from(t.prices).select('id, price, unit, as_of, source, file_id, entered_by, entered_at')
          .eq('part_id', p.id).order('as_of', { ascending: false }).order('entered_at', { ascending: false }))
          .map((h) => ({ id: h.id, price: Number(h.price), unit: h.unit, asOf: h.as_of, source: h.source, fileId: h.file_id, enteredBy: h.entered_by, enteredAt: h.entered_at }));
      }
      return res.status(200).json({ part: { ...shapePart(p, links, prices ? new Map(history.length ? [[p.id, history[0]]] : []) : null), ...(prices ? { priceHistory: history } : {}) } });
    }

    // Add (vendorId) or change (id) a part by hand. POST { id? , vendorId?, kind, itemNumber, name, description, category, options, page }
    if (action === 'vendor-part-save' && isPost) {
      let p;
      try { p = cleanPart(body); } catch (e) { return res.status(400).json({ error: e.message }); }
      if (body.id) {
        if (!isId(body.id)) return res.status(400).json({ error: 'id is invalid' });
        const { data, error } = await supabase.from(t.parts).update({ ...p, edited_by: who, edited_at: now }).eq('id', body.id).is('removed_at', null).select('*').maybeSingle();
        if (error) return res.status(/duplicate key/i.test(error.message) ? 409 : 502).json({ error: /duplicate key/i.test(error.message) ? 'This vendor already has a part with that item number or name' : error.message });
        if (!data) return res.status(404).json({ error: 'Part not found' });
        return res.status(200).json({ part: shapePart(data, await signPaths(supabase, [data.image_path])) });
      }
      if (!isId(body.vendorId)) return res.status(400).json({ error: 'vendorId is required' });
      const { data, error } = await supabase.from(t.parts).insert({ ...p, vendor_id: body.vendorId, status: 'active', source: 'manual', created_by: who, reviewed_by: who, reviewed_at: now }).select('*').single();
      if (error) return res.status(/duplicate key/i.test(error.message) ? 409 : 502).json({ error: /duplicate key/i.test(error.message) ? 'This vendor already has a part with that item number or name' : error.message });
      return res.status(200).json({ part: shapePart(data, new Map()) });
    }

    // Checking parts: POST { ids: [...], decision: 'check' | 'reject' } (max 200; 'approve' is the same as 'check').
    // check: the part is right (it stays in use, marked checked). reject: delete it (kept hidden, see above).
    if (action === 'vendor-parts-review' && isPost) {
      const ids = Array.isArray(body.ids) ? body.ids.filter(isId) : [];
      if (!ids.length || ids.length > 200) return res.status(400).json({ error: 'ids: 1 to 200 part ids' });
      if (!['approve', 'check', 'reject'].includes(body.decision)) return res.status(400).json({ error: 'decision must be check or reject' });
      const rows = must(await supabase.from(t.parts).update({ status: body.decision === 'reject' ? 'rejected' : 'active', reviewed_by: who, reviewed_at: now })
        .in('id', ids).in('status', ['review', 'active']).is('removed_at', null).select('id'));
      return res.status(200).json({ changed: rows.map((r) => r.id) });
    }

    // Retire, delete or bring back a part: POST { id, status: 'retired' | 'rejected' | 'active' }
    if (action === 'vendor-part-status' && isPost) {
      if (!isId(body.id)) return res.status(400).json({ error: 'id is required' });
      if (!['retired', 'rejected', 'active'].includes(body.status)) return res.status(400).json({ error: 'status must be retired, rejected or active' });
      const { data, error } = await supabase.from(t.parts).update({ status: body.status, edited_by: who, edited_at: now })
        .eq('id', body.id).is('removed_at', null).in('status', ['active', 'retired', 'rejected', 'review']).select('*').maybeSingle();
      if (error) return res.status(/duplicate key/i.test(error.message) ? 409 : 502).json({ error: /duplicate key/i.test(error.message) ? 'Another live part has the same item number or name' : error.message });
      if (!data) return res.status(404).json({ error: 'Part not found' });
      return res.status(200).json({ part: shapePart(data, await signPaths(supabase, [data.image_path])) });
    }

    // A picture for a part, added by hand. POST { id, step: 'start', fileName } -> upload link; then { id, step: 'done', path }.
    if (action === 'vendor-part-image' && isPost) {
      if (!isId(body.id)) return res.status(400).json({ error: 'id is required' });
      const p = must(await supabase.from(t.parts).select('id, vendor_id').eq('id', body.id).is('removed_at', null).maybeSingle());
      if (!p) return res.status(404).json({ error: 'Part not found' });
      const folder = `${p.vendor_id}/parts/${p.id}`;
      if (body.step === 'start') {
        const name = storageName(body.fileName);
        if (!/\.(jpe?g|png|webp)$/i.test(name)) return res.status(400).json({ error: 'A picture must be JPG, PNG or WebP' });
        const path = `${folder}/${Date.now()}-${name}`;
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error) throw new Error(error.message);
        return res.status(200).json({ upload: { url: data.signedUrl, path } });
      }
      if (body.step === 'done') {
        const path = String(body.path ?? '');
        if (!path.startsWith(folder + '/') || path.includes('..')) return res.status(400).json({ error: 'path is invalid' });
        const row = must(await supabase.from(t.parts).update({ image_path: path, edited_by: who, edited_at: now }).eq('id', p.id).select('*').single());
        return res.status(200).json({ part: shapePart(row, await signPaths(supabase, [path])) });
      }
      return res.status(400).json({ error: 'step must be start or done' });
    }

    // Parts read from a catalog by the extraction script. POST { fileId, parts: [...] } (max 200 per call).
    // New parts go straight into use, not checked yet. A part already listed for this vendor (same item number or name) gets the new page,
    // picture and catalog but keeps its status; a rejected one stays rejected.
    if (action === 'vendor-catalog-parts' && isPost) {
      if (!isId(body.fileId)) return res.status(400).json({ error: 'fileId is required' });
      const f = must(await supabase.from(t.files).select('id, vendor_id, kind').eq('id', body.fileId).is('removed_at', null).maybeSingle());
      if (!f || f.kind !== 'catalog') return res.status(404).json({ error: 'Catalog not found' });
      let incoming;
      try { incoming = cleanCatalogParts(body.parts, `${f.vendor_id}/${f.id}/img`); } catch (e) { return res.status(400).json({ error: e.message }); }
      const existing = await readAll(supabase, t.parts, 'id, item_number, name, status', (q) => q.eq('vendor_id', f.vendor_id).is('removed_at', null));
      const live = new Map(existing.filter((p) => p.status !== 'rejected').map((p) => [partKey(p), p]));
      const rejected = new Set(existing.filter((p) => p.status === 'rejected').map(partKey));
      const out = { added: 0, updated: 0, skippedRejected: 0, duplicates: 0 };
      const seen = new Set();
      const inserts = [];
      for (const p of incoming) {
        const key = partKey(p);
        if (seen.has(key)) { out.duplicates++; continue; }
        seen.add(key);
        const hit = live.get(key);
        if (hit) {
          must(await supabase.from(t.parts).update({ file_id: f.id, page: p.page, ...(p.image_path ? { image_path: p.image_path } : {}) }).eq('id', hit.id));
          out.updated++;
        } else if (rejected.has(key)) {
          out.skippedRejected++;
        } else {
          inserts.push({ ...p, vendor_id: f.vendor_id, file_id: f.id, status: 'active', source: 'catalog', created_by: who });
        }
      }
      if (inserts.length) must(await supabase.from(t.parts).insert(inserts));
      out.added = inserts.length;
      return res.status(200).json(out);
    }

    // ── Prices (admin and bookkeeper only) ───────────────────────────────────
    if ((action === 'vendor-price-add' || action === 'vendor-price-import') && !prices) {
      return res.status(403).json({ error: 'Only the admin and the bookkeeper can change prices' });
    }

    // POST { partId, price, unit, asOf }
    if (action === 'vendor-price-add' && isPost) {
      if (!isId(body.partId)) return res.status(400).json({ error: 'partId is required' });
      let row;
      try { row = { part_id: body.partId, price: cleanPrice(body.price), unit: cleanUnit(body.unit), as_of: cleanDate(body.asOf), source: 'manual', entered_by: who }; }
      catch (e) { return res.status(400).json({ error: e.message }); }
      const p = must(await supabase.from(t.parts).select('id').eq('id', body.partId).is('removed_at', null).maybeSingle());
      if (!p) return res.status(404).json({ error: 'Part not found' });
      must(await supabase.from(t.prices).insert(row));
      return res.status(200).json({ ok: true });
    }

    // A price list, already read in the browser and mapped to columns.
    //   POST { vendorId, fileId?, asOf, rows: [{ itemNumber, name, description, price, unit }], commit }  (max 5000 rows)
    // Without commit: counts only. With commit: new prices for matched parts (only where the price changed), and new
    // parts (in use, not checked yet, source price_list) with their first price.
    if (action === 'vendor-price-import' && isPost) {
      if (!isId(body.vendorId)) return res.status(400).json({ error: 'vendorId is required' });
      if (body.fileId != null && !isId(body.fileId)) return res.status(400).json({ error: 'fileId is invalid' });
      let asOf;
      try { asOf = cleanDate(body.asOf); } catch (e) { return res.status(400).json({ error: e.message }); }
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length || rows.length > 5000) return res.status(400).json({ error: 'rows: 1 to 5000 rows' });
      const parts = await readAll(supabase, t.parts, 'id, item_number, name, status', (q) => q.eq('vendor_id', body.vendorId).is('removed_at', null));
      const latest = await latestPrices(supabase, t, parts.map((p) => p.id));
      const m = matchPriceRows(rows, parts, latest);
      const summary = {
        matched: m.matched.length, changed: m.matched.filter((x) => x.changed).length,
        added: m.added.length, skipped: m.skipped.length, skippedSample: m.skipped.slice(0, 20),
      };
      if (body.commit !== true) return res.status(200).json({ dryRun: true, ...summary });
      const priceRow = (partId, x) => ({ part_id: partId, price: x.price, unit: x.unit, as_of: asOf, source: 'price_list', file_id: body.fileId ?? null, entered_by: who });
      const changed = m.matched.filter((x) => x.changed).map((x) => priceRow(x.partId, x));
      for (let i = 0; i < changed.length; i += 500) must(await supabase.from(t.prices).insert(changed.slice(i, i + 500)));
      for (let i = 0; i < m.added.length; i += 500) {
        const chunk = m.added.slice(i, i + 500);
        const made = must(await supabase.from(t.parts).insert(chunk.map((a) => ({
          vendor_id: body.vendorId, kind: 'other', item_number: a.item_number, name: a.name, description: a.description,
          file_id: body.fileId ?? null, status: 'active', source: 'price_list', created_by: who,
        }))).select('id, item_number, name'));
        const byKey = new Map(made.map((p) => [partKey(p), p.id]));
        const pr = chunk.map((a) => priceRow(byKey.get(partKey(a)), a)).filter((r) => r.part_id);
        if (pr.length) must(await supabase.from(t.prices).insert(pr));
      }
      if (body.fileId) await supabase.from(t.files).update({ status: 'reviewed' }).eq('id', body.fileId);
      return res.status(200).json({ dryRun: false, ...summary });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message ?? e) });
  }
}
