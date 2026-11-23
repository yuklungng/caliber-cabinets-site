import { useCallback, useEffect, useRef, useState } from 'react';
import { guessColumns, parseCsv } from './csv.js';
import { READERS, detectCatalog, readCaldoor } from './catalogReader.js';
import { looksLikePriceBook } from './priceBookReader.js';
import { PartPriceTables, PriceBookRead, PricesPanel } from './PriceBooksView.jsx';
import { findDomains, guessVendor } from './vendorMatch.js';
import { nonPartReason } from './reviewHints.js';
import { call, pool, uploadTo, ctl, primary, field, card, muted, money, fmtDay, fmtSize, todayIso, isPdf, isCsv, useDebounced } from './vendorLib.js';
import { Labeled, Err, DropZone, PartWindow } from './vendorUi.jsx';

// Vendors tab of the Office view (db/production/009): each vendor's details, its catalogs and price lists, and its
// parts with pictures. A catalog PDF is read here in the browser (catalogReader.js) and never uploaded: only a picture
// per part, a picture per catalog page and the part details go up. Those parts are in use straight away; the team
// checks, corrects or deletes them as they come across them ("To check" lists the ones nobody has checked yet).
// Uploads go straight from the browser to private storage with one-time links; pictures and files are shown through
// links that expire after an hour.
// Prices are shown only to the admin and the bookkeeper (the server leaves them out for everyone else).
// Nothing here orders anything or changes QuickBooks.

const KINDS = [
  ['door_style', 'Door style'], ['drawer_front', 'Drawer front'], ['drawer_box', 'Drawer box'],
  ['hardware', 'Hardware'], ['material', 'Material'], ['other', 'Other'],
];
const kindLabel = (k) => KINDS.find(([key]) => key === k)?.[1] ?? 'Other';
const FILE_STATUS = {
  uploading: ['Uploading', '#fef3c7', '#92400e'], uploaded: ['Uploaded, waiting to be read', '#e0f2fe', '#075985'],
  extracting: ['Upload not finished', '#fef3c7', '#92400e'], extracted: ['Read, parts in use', '#dcfce7', '#166534'],
  reviewed: ['Done', '#dcfce7', '#166534'], failed: ['Failed', '#fee2e2', '#991b1b'],
};

// The drop zone at the top of the Vendors tab: works out whose catalog or price list it is, then reads or imports it
// for that vendor, so nobody has to open the vendor first.
function AddFile({ vendors, canSeePrices, onDone }) {
  const [file, setFile] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [guess, setGuess] = useState(null); // { vendorId | newVendor, why, reader }
  const [choice, setChoice] = useState(''); // vendor id, or 'new'
  const [newVendor, setNewVendor] = useState({ name: '', website: '' });
  const [ready, setReady] = useState(null); // { vendorId, kind, reader }
  const [kind, setKind] = useState('catalog'); // for a PDF: 'catalog' | 'price_book'
  const [err, setErr] = useState('');

  async function take(f) {
    setErr(''); setGuess(null); setReady(null); setChoice('');
    if (!isPdf(f) && !isCsv(f)) { setFile(null); setErr('Drop a catalog (PDF) or a price list (CSV). An Excel price list needs saving as CSV first (File > Save As > CSV).'); return; }
    if (isCsv(f) && !canSeePrices) { setFile(null); setErr('Only the admin and the bookkeeper can import price lists.'); return; }
    setFile(f); setDetecting(true);
    try {
      let clues;
      if (isPdf(f)) {
        const d = await detectCatalog(f);
        clues = { domains: d.domains, text: d.text, fileName: f.name, reader: d.reader };
        setKind(canSeePrices && looksLikePriceBook(f.name, d.text) ? 'price_book' : 'catalog');
      } else {
        const text = (await f.slice(0, 20000).text());
        clues = { domains: findDomains(text), text, fileName: f.name, reader: null };
      }
      const g = guessVendor(clues, vendors);
      setGuess({ ...g, reader: clues.reader });
      if (g?.vendorId) setChoice(g.vendorId);
      else if (g?.newVendor) { setChoice('new'); setNewVendor(g.newVendor); }
      else setChoice(vendors.length ? '' : 'new');
    } catch (e) {
      setErr(`Could not open this file: ${e.message}`);
    } finally { setDetecting(false); }
  }

  async function confirm() {
    setErr('');
    try {
      let vendorId = choice;
      if (choice === 'new') vendorId = (await call('vendor-save', { body: newVendor })).vendor.id;
      if (!vendorId) { setErr('Pick the vendor first.'); return; }
      setReady({ vendorId, kind: isPdf(file) ? kind : 'price_list', reader: guess?.reader ?? 'caldoor' });
    } catch (e) { setErr(e.message); }
  }

  const reset = () => { setFile(null); setGuess(null); setReady(null); setChoice(''); setErr(''); };
  const vendorName = ready ? (vendors.find((v) => v.id === ready.vendorId)?.name ?? newVendor.name) : '';

  if (ready) {
    return (
      <div style={{ display: 'grid', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
          <strong style={{ fontSize: '14px' }}>{ready.kind === 'catalog' ? 'Catalog' : ready.kind === 'price_book' ? 'Price book' : 'Price list'} for {vendorName}</strong>
          <button type="button" style={ctl} onClick={reset}>Cancel</button>
        </div>
        {ready.kind === 'catalog'
          ? <CatalogRead vendorId={ready.vendorId} initialFile={file} initialReader={ready.reader} onDone={() => { reset(); onDone(ready.vendorId); }} />
          : ready.kind === 'price_book'
            ? <PriceBookRead vendorId={ready.vendorId} initialFile={file} onDone={() => { reset(); onDone(ready.vendorId, 'prices'); }} />
            : <PriceImport vendorId={ready.vendorId} initialFile={file} onDone={() => { reset(); onDone(ready.vendorId); }} />}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <DropZone
        title={canSeePrices ? 'Drop a catalog, price book (PDF) or price list (CSV) here' : 'Drop a catalog (PDF) here'}
        hint="or click to choose one. The vendor is worked out from the file; a PDF stays on this computer."
        accept={canSeePrices ? '.pdf,application/pdf,.csv,text/csv,.txt' : '.pdf,application/pdf'}
        onFile={take} disabled={detecting} file={file}
      />
      {detecting && <span style={muted}>Looking at the file…</span>}
      {file && !detecting && guess !== null && (
        <div style={{ ...card, display: 'grid', gap: '8px' }}>
          <span style={{ fontSize: '13px' }}>
            {guess?.vendorId ? <>Looks like <strong>{vendors.find((v) => v.id === guess.vendorId)?.name}</strong> ({guess.why}).</>
              : guess?.newVendor ? <>Looks like a new vendor, <strong>{guess.newVendor.name}</strong> ({guess.why}).</>
                : 'Could not tell whose file this is. Pick the vendor:'}
            {isPdf(file) && kind === 'catalog' && !guess?.reader && ' No reader knows this catalog layout yet, so it may find no parts.'}
          </span>
          {isPdf(file) && canSeePrices && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px' }}>
              <span>Read it as:</span>
              <button type="button" aria-pressed={kind === 'catalog'} style={kind === 'catalog' ? primary : ctl} onClick={() => setKind('catalog')}>A catalog (parts and pictures)</button>
              <button type="button" aria-pressed={kind === 'price_book'} style={kind === 'price_book' ? primary : ctl} onClick={() => setKind('price_book')}>A price book (price tables)</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'end' }}>
            <Labeled label="Vendor">
              <select style={{ ...field, appearance: 'auto', minWidth: '220px' }} value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="" disabled>Pick a vendor</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                <option value="new">New vendor…</option>
              </select>
            </Labeled>
            {choice === 'new' && (
              <>
                <Labeled label="New vendor's name"><input style={field} value={newVendor.name} onChange={(e) => setNewVendor((x) => ({ ...x, name: e.target.value }))} /></Labeled>
                <Labeled label="Website"><input style={field} value={newVendor.website} onChange={(e) => setNewVendor((x) => ({ ...x, website: e.target.value }))} /></Labeled>
              </>
            )}
            <button type="button" style={primary} disabled={!choice || (choice === 'new' && !newVendor.name.trim())} onClick={confirm}>
              {choice === 'new' ? 'Add vendor and continue' : 'Continue'}
            </button>
            <button type="button" style={ctl} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
      <Err text={err} />
    </div>
  );
}

// ── Vendor list and details ─────────────────────────────────────────────────

function VendorForm({ vendor, onSaved, onCancel }) {
  const [f, setF] = useState({
    name: vendor?.name ?? '', website: vendor?.website ?? '', orderEmail: vendor?.orderEmail ?? '',
    phone: vendor?.phone ?? '', accountNumber: vendor?.accountNumber ?? '', notes: vendor?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onSaved((await call('vendor-save', { body: { ...f, id: vendor?.id } })).vendor); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
      <Labeled label="Name"><input style={field} value={f.name} onChange={set('name')} required maxLength={120} autoFocus /></Labeled>
      <Labeled label="Website"><input style={field} value={f.website} onChange={set('website')} placeholder="caldoor.com" /></Labeled>
      <Labeled label="Ordering email"><input style={field} type="email" value={f.orderEmail} onChange={set('orderEmail')} /></Labeled>
      <Labeled label="Phone"><input style={field} value={f.phone} onChange={set('phone')} /></Labeled>
      <Labeled label="Account number"><input style={field} value={f.accountNumber} onChange={set('accountNumber')} /></Labeled>
      <Labeled label="Notes (no logins or passwords)" wide><textarea style={{ ...field, minHeight: '60px' }} value={f.notes} onChange={set('notes')} /></Labeled>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button type="submit" style={primary} disabled={busy}>{busy ? 'Saving…' : 'Save vendor'}</button>
        <button type="button" style={ctl} onClick={onCancel}>Cancel</button>
        <Err text={err} />
      </div>
    </form>
  );
}

export default function VendorsView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [openTab, setOpenTab] = useState('parts');
  const load = useCallback(() => call('vendors').then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (err) return <p style={{ color: '#b91c1c' }}>Could not load vendors: {err}{/does not exist|schema cache/i.test(err) ? ' (the vendor tables have not been added to the database yet)' : ''}</p>;
  if (!data) return <p style={muted}>Loading vendors…</p>;
  const open = data.vendors.find((v) => v.id === openId);
  if (open) {
    return <VendorPage vendor={open} startTab={openTab} canSeePrices={data.canSeePrices} onBack={() => { setOpenId(null); setOpenTab('parts'); load(); }} onChanged={load} />;
  }
  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <p style={{ ...muted, margin: 0 }}>
        Vendors, their catalogs and price lists, and the parts in them. Drop a catalog or price list below and it goes to the right vendor. Parts read from it are in use straight away; check, correct or delete them as you come across them.
      </p>
      <AddFile vendors={data.vendors} canSeePrices={data.canSeePrices} onDone={(id, tab) => load().then(() => { setOpenTab(tab ?? 'parts'); setOpenId(id); })} />
      {adding
        ? <VendorForm onSaved={(v) => { setAdding(false); load().then(() => setOpenId(v.id)); }} onCancel={() => setAdding(false)} />
        : <div><button type="button" style={primary} onClick={() => setAdding(true)}>Add vendor</button></div>}
      {data.vendors.length === 0 && !adding && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #e5e7eb' }}>
          No vendors yet. Drop a catalog above and the vendor is added with it, or add one by hand.
        </div>
      )}
      {data.vendors.map((v) => (
        <button key={v.id} type="button" onClick={() => setOpenId(v.id)} style={{ ...card, textAlign: 'left', cursor: 'pointer', display: 'grid', gap: '4px' }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '15px', color: '#111827' }}>{v.name}</strong>
            <span style={muted}>
              {v.parts} part{v.parts !== 1 ? 's' : ''}
              {v.unchecked > 0 && <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: '#f3f4f6', color: '#4b5563' }}>{v.unchecked} not checked yet</span>}
            </span>
          </span>
          <span style={{ ...muted, fontSize: '12px' }}>
            {v.latestCatalog ? `Catalog: ${v.latestCatalog.title}${v.latestCatalog.edition ? ` (${v.latestCatalog.edition})` : ''}` : 'No catalog yet'}
            {data.canSeePrices && (v.latestPriceList ? ` · Price list ${fmtDay(v.latestPriceList.uploadedAt)}` : ' · No price list')}
          </span>
        </button>
      ))}
    </div>
  );
}

function VendorPage({ vendor, canSeePrices, onBack, onChanged, startTab = 'parts' }) {
  const [tab, setTab] = useState(startTab);
  const [pricesCount, setPricesCount] = useState(null);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(vendor);
  const [reviewCount, setReviewCount] = useState(vendor.unchecked ?? 0);
  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      <div><button type="button" style={ctl} onClick={onBack}>← All vendors</button></div>
      {editing ? (
        <VendorForm vendor={v} onSaved={(nv) => { setV((x) => ({ ...x, ...nv })); setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />
      ) : (
        <div style={{ ...card, display: 'grid', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: '#78350f' }}>{v.name}</h3>
            <button type="button" style={ctl} onClick={() => setEditing(true)}>Edit</button>
          </div>
          {v.website && <span style={muted}>Website: <a href={/^https?:/i.test(v.website) ? v.website : `https://${v.website}`} target="_blank" rel="noreferrer">{v.website}</a></span>}
          {v.orderEmail && <span style={muted}>Ordering email: {v.orderEmail}</span>}
          {v.phone && <span style={muted}>Phone: {v.phone}</span>}
          {v.accountNumber && <span style={muted}>Account: {v.accountNumber}</span>}
          {v.notes && <span style={{ ...muted, whiteSpace: 'pre-wrap' }}>{v.notes}</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[['parts', 'Parts'], ['review', `To check${reviewCount ? ` (${reviewCount})` : ''}`],
          ...(canSeePrices ? [['prices', `Price tables${pricesCount ? ` (${pricesCount} to check)` : ''}`]] : []),
          ['files', 'Catalogs & price books']].map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} style={tab === key ? primary : ctl}>{label}</button>
        ))}
      </div>
      {tab === 'parts' && <PartsPanel vendorId={v.id} canSeePrices={canSeePrices} />}
      {tab === 'review' && <ReviewPanel vendorId={v.id} onCount={setReviewCount} />}
      {tab === 'prices' && canSeePrices && <PricesPanel vendorId={v.id} onCount={setPricesCount} />}
      {tab === 'files' && <FilesPanel vendorId={v.id} canSeePrices={canSeePrices} onImported={() => call('vendors').then((d) => setReviewCount(d.vendors.find((x) => x.id === v.id)?.unchecked ?? 0)).catch(() => {})} />}
    </div>
  );
}

// ── Parts ───────────────────────────────────────────────────────────────────

function Picture({ part, size = 140 }) {
  return part.image
    ? <img src={part.image} alt={part.name} loading="lazy" style={{ width: '100%', height: size, objectFit: 'contain', background: '#f9fafb', borderRadius: '6px' }} />
    : <div style={{ height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', borderRadius: '6px', color: '#9ca3af', fontSize: '12px' }}>No picture</div>;
}

// Loads the next page of parts when this comes into view (the button is there too, in case).
// It is keyed by the number of parts shown, so it fires once per page.
function LoadMore({ onLoad, children }) {
  const ref = useRef(null);
  const latest = useRef(onLoad);
  useEffect(() => { latest.current = onLoad; });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    let fired = false;
    const io = new IntersectionObserver((entries) => {
      if (!fired && entries.some((e) => e.isIntersecting)) { fired = true; latest.current(); }
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref}>{children}</div>;
}

function PartsPanel({ vendorId, canSeePrices }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('active');
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q, 250);
  const seq = useRef(0);

  const loadingMore = useRef(null);
  const load = useCallback(async (offset = 0) => {
    // The next page is asked for once, whether by scrolling or by the button.
    if (offset && loadingMore.current === offset) return;
    if (offset) loadingMore.current = offset;
    const n = ++seq.current;
    try {
      const d = await call('vendor-parts', { params: { vendorId, q: dq, kind, status, offset, limit: 60 } });
      if (n !== seq.current) return; // a newer search has started
      setList((cur) => (offset ? { ...d, parts: [...(cur?.parts ?? []).filter((p) => !d.parts.some((x) => x.id === p.id)), ...d.parts] } : d));
      setErr('');
    } catch (e) { if (n === seq.current) setErr(e.message); }
    finally { if (offset && loadingMore.current === offset) loadingMore.current = null; }
  }, [vendorId, dq, kind, status]);
  useEffect(() => { load(0); }, [load]);

  const replace = (p) => setList((d) => ({ ...d, parts: d.parts.map((x) => (x.id === p.id ? { ...x, ...p } : x)) }));

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input type="search" placeholder="Search by item number or name" aria-label="Search parts" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...field, flex: '1 1 220px', width: 'auto' }} />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" style={{ ...ctl, appearance: 'auto' }}>
          <option value="">All kinds</option>
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ ...ctl, appearance: 'auto' }}>
          <option value="active">In use</option>
          <option value="retired">Retired</option>
          <option value="rejected">Deleted</option>
        </select>
        <button type="button" style={ctl} onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Add part'}</button>
      </div>
      {adding && <PartForm vendorId={vendorId} onSaved={(p) => { setAdding(false); setOpenId(p.id); load(0); }} />}
      <Err text={err} />
      {!list ? <p style={muted}>Loading parts…</p> : (
        <>
          <p style={{ ...muted, margin: 0, fontSize: '12px' }}>
            {list.total} part{list.total !== 1 ? 's' : ''}{dq ? ` matching "${dq}"` : ''}{list.parts.length < list.total ? ` · showing ${list.parts.length}, more load as you scroll` : ''}. Click a part to edit it{canSeePrices ? ' or add its price' : ''}.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
            {list.parts.map((p) => (
              <button key={p.id} type="button" onClick={() => setOpenId(openId === p.id ? null : p.id)} aria-expanded={openId === p.id}
                style={{ ...card, padding: '8px', textAlign: 'left', cursor: 'pointer', display: 'grid', gap: '4px', borderColor: openId === p.id ? '#78350f' : '#e5e7eb' }}>
                <Picture part={p} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{p.name}</span>
                {p.itemNumber && <span style={{ fontSize: '12px', color: '#6b7280' }}>{p.itemNumber}</span>}
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>{kindLabel(p.kind)}{p.page ? ` · p. ${p.page}` : ''}{p.status === 'active' && !p.reviewedAt ? ' · not checked yet' : ''}</span>
                {p.status === 'active' && !p.reviewedAt && nonPartReason(p.name) && <span style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', justifySelf: 'start' }}>Probably not a part: {nonPartReason(p.name)}</span>}
                {canSeePrices && p.price && <span style={{ fontSize: '12px', color: '#166534' }}>{money(p.price.price)} / {p.price.unit} <span style={{ color: '#9ca3af' }}>({fmtDay(p.price.asOf)})</span></span>}
              </button>
            ))}
          </div>
          {openId && (
            <PartWindow onClose={() => setOpenId(null)}>
              <PartDetail id={openId} canSeePrices={canSeePrices} onClose={() => setOpenId(null)} onChanged={(p) => (p.status !== status ? load(0) : replace(p))} />
            </PartWindow>
          )}
          {list.parts.length < list.total && (
            <LoadMore key={list.parts.length} onLoad={() => load(list.parts.length)}>
              <button type="button" style={ctl} onClick={() => load(list.parts.length)}>Show more ({list.total - list.parts.length} left)</button>
            </LoadMore>
          )}
        </>
      )}
    </div>
  );
}

function PartForm({ vendorId, part, onSaved, onCancel }) {
  const [f, setF] = useState({
    kind: part?.kind ?? 'hardware', itemNumber: part?.itemNumber ?? '', name: part?.name ?? '',
    description: part?.description ?? '', category: part?.category ?? '', options: part?.options ?? '', page: part?.page ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onSaved((await call('vendor-part-save', { body: { ...f, id: part?.id, vendorId } })).part); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
      <Labeled label="Name"><input style={field} value={f.name} onChange={set('name')} required maxLength={200} /></Labeled>
      <Labeled label="Item number"><input style={field} value={f.itemNumber} onChange={set('itemNumber')} maxLength={60} /></Labeled>
      <Labeled label="Kind">
        <select style={{ ...field, appearance: 'auto' }} value={f.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </Labeled>
      <Labeled label="Catalog page"><input style={field} inputMode="numeric" value={f.page ?? ''} onChange={set('page')} /></Labeled>
      <Labeled label="Category"><input style={field} value={f.category} onChange={set('category')} maxLength={120} /></Labeled>
      <Labeled label="Description" wide><textarea style={{ ...field, minHeight: '50px' }} value={f.description} onChange={set('description')} /></Labeled>
      <Labeled label="Options (finish, sizes)" wide><textarea style={{ ...field, minHeight: '40px' }} value={f.options} onChange={set('options')} /></Labeled>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button type="submit" style={primary} disabled={busy}>{busy ? 'Saving…' : part ? 'Save' : 'Add part'}</button>
        {onCancel && <button type="button" style={ctl} onClick={onCancel}>Cancel</button>}
        <Err text={err} />
      </div>
    </form>
  );
}

/** Opens a price list kept with its vendor. */
async function openFile(fileId) {
  // Opened before the link arrives, so the browser does not block it as a pop-up.
  const w = window.open('', '_blank');
  try {
    const { url } = await call('vendor-file-link', { params: { id: fileId } });
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) { w?.close(); alert(`Could not open the file: ${e.message}`); }
}

/** A catalog page's picture, shown under the part. */
function CatalogPage({ fileId, page }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    call('vendor-page-image', { params: { fileId, page } }).then((d) => live && setUrl(d.url)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [fileId, page]);
  if (err) return <Err text={err} />;
  if (!url) return <span style={muted}>Loading page {page}…</span>;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Catalog page ${page}`} style={{ width: '100%', maxWidth: '640px', border: '1px solid #e5e7eb', borderRadius: '6px' }} /></a>;
}

function PartDetail({ id, canSeePrices, onClose, onChanged }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [price, setPrice] = useState({ price: '', unit: 'each', asOf: todayIso() });
  const [showPage, setShowPage] = useState(false);
  const pic = useRef(null);
  const load = useCallback(() => call('vendor-part', { params: { id } }).then((d) => { setP(d.part); setErr(''); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setP(null); setEditing(false); setShowPage(false); load(); }, [load]);

  async function setStatus(status) {
    setBusy('status'); setErr('');
    try { const d = await call('vendor-part-status', { body: { id, status } }); setP((x) => ({ ...x, ...d.part })); onChanged(d.part); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function markChecked() {
    setBusy('status'); setErr('');
    try { await call('vendor-parts-review', { body: { ids: [id], decision: 'check' } }); await load(); onChanged({ id, reviewedAt: new Date().toISOString() }); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function addPicture(file) {
    if (!file) return;
    setBusy('picture'); setErr('');
    try {
      const { upload } = await call('vendor-part-image', { body: { id, step: 'start', fileName: file.name } });
      await uploadTo(upload.url, file);
      const d = await call('vendor-part-image', { body: { id, step: 'done', path: upload.path } });
      setP((x) => ({ ...x, ...d.part })); onChanged(d.part);
    } catch (e) { setErr(e.message); } finally { setBusy(''); if (pic.current) pic.current.value = ''; }
  }
  async function addPrice(e) {
    e.preventDefault();
    setBusy('price'); setErr('');
    try { await call('vendor-price-add', { body: { partId: id, ...price } }); setPrice((x) => ({ ...x, price: '' })); await load(); }
    catch (x) { setErr(x.message); } finally { setBusy(''); }
  }

  if (!p) return <div style={card}>{err ? <Err text={err} /> : <span style={muted}>Loading…</span>}</div>;
  return (
    <div style={{ ...card, display: 'grid', gap: '10px', borderColor: '#78350f' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
        <strong style={{ fontSize: '15px' }}>{p.name}{p.itemNumber ? ` · ${p.itemNumber}` : ''}</strong>
        <button type="button" style={ctl} onClick={onClose}>Close</button>
      </div>
      {editing ? (
        <PartForm vendorId={p.vendorId} part={p} onSaved={(np) => { setP((x) => ({ ...x, ...np })); setEditing(false); onChanged(np); }} onCancel={() => setEditing(false)} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: '12px', alignItems: 'start' }}>
          <Picture part={p} size={200} />
          <div style={{ display: 'grid', gap: '4px', fontSize: '13px' }}>
            <span style={muted}>{kindLabel(p.kind)}{p.category ? ` · ${p.category}` : ''} · {p.status === 'active' ? 'In use' : p.status}</span>
            {p.description && <span style={{ whiteSpace: 'pre-wrap' }}>{p.description}</span>}
            {p.options && <span style={{ ...muted, whiteSpace: 'pre-wrap' }}>{p.options}</span>}
            {p.fileId && p.page && p.source === 'catalog' && <span><button type="button" onClick={() => setShowPage((v) => !v)} aria-expanded={showPage} style={{ background: 'none', border: 0, padding: 0, color: '#78350f', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}>{showPage ? 'Hide' : 'See'} catalog page {p.page}</button></span>}
            <span style={{ ...muted, fontSize: '12px' }}>
              {p.source === 'manual' ? 'Added by hand' : p.source === 'price_list' ? 'From a price list' : 'From a catalog'}{p.createdBy ? ` by ${p.createdBy}` : ''}
              {p.reviewedBy && p.source !== 'manual' ? `; checked by ${p.reviewedBy}` : p.source !== 'manual' && p.status === 'active' ? '; not checked yet' : ''}{p.editedBy ? `; last edited by ${p.editedBy}` : ''}
            </span>
          </div>
        </div>
      )}
      {showPage && !editing && <CatalogPage fileId={p.fileId} page={p.page} />}
      {!editing && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={ctl} onClick={() => setEditing(true)}>Edit</button>
          <label style={{ ...ctl, display: 'inline-flex', alignItems: 'center' }}>
            {busy === 'picture' ? 'Uploading…' : p.hasImage ? 'Replace picture' : 'Add picture'}
            <input ref={pic} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(e) => addPicture(e.target.files?.[0])} disabled={!!busy} />
          </label>
          {p.status === 'active' && !p.reviewedAt && <button type="button" style={ctl} disabled={!!busy} onClick={markChecked}>Mark as checked</button>}
          {p.status === 'active' && <button type="button" style={ctl} disabled={!!busy} onClick={() => setStatus('retired')}>Retire</button>}
          {p.status !== 'rejected' && <button type="button" style={ctl} disabled={!!busy} onClick={() => window.confirm(`Delete "${p.name}"? It is hidden, and not added again when the catalog is read again. It can be brought back from the Deleted list.`) && setStatus('rejected')}>Delete</button>}
          {(p.status === 'retired' || p.status === 'rejected') && <button type="button" style={ctl} disabled={!!busy} onClick={() => setStatus('active')}>Put back in use</button>}
        </div>
      )}
      {canSeePrices && (
        <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '8px' }}>
          <PartPriceTables part={p} onChanged={load} />
        </div>
      )}
      {canSeePrices && (
        <div style={{ display: 'grid', gap: '6px', borderTop: '1px solid #f3f4f6', paddingTop: '8px' }}>
          <strong style={{ fontSize: '13px' }}>Price</strong>
          {p.priceHistory?.length ? (
            <table style={{ fontSize: '12px', borderCollapse: 'collapse' }}>
              <tbody>
                {p.priceHistory.map((h, i) => (
                  <tr key={h.id} style={{ color: i ? '#6b7280' : '#111827' }}>
                    <td style={{ padding: '2px 10px 2px 0' }}>{money(h.price)} / {h.unit}</td>
                    <td style={{ padding: '2px 10px 2px 0' }}>as of {fmtDay(h.asOf)}</td>
                    <td style={{ padding: '2px 0' }}>{h.source === 'price_list' ? 'price list' : h.source}{h.enteredBy ? `, ${h.enteredBy}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <span style={muted}>No price yet.</span>}
          <form onSubmit={addPrice} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...field, width: '100px' }} inputMode="decimal" placeholder="Price" aria-label="Price" value={price.price} onChange={(e) => setPrice((x) => ({ ...x, price: e.target.value }))} required />
            <input style={{ ...field, width: '80px' }} aria-label="Unit" value={price.unit} onChange={(e) => setPrice((x) => ({ ...x, unit: e.target.value }))} />
            <input style={{ ...field, width: '150px' }} type="date" aria-label="As of" value={price.asOf} onChange={(e) => setPrice((x) => ({ ...x, asOf: e.target.value }))} required />
            <button type="submit" style={ctl} disabled={!!busy}>{busy === 'price' ? 'Saving…' : 'Add price'}</button>
          </form>
        </div>
      )}
      <Err text={err} />
    </div>
  );
}

// ── To check: parts in use that nobody has checked yet ─────────────────────

function ReviewPanel({ vendorId, onCount }) {
  const [list, setList] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await call('vendor-parts', { params: { vendorId, status: 'active', checked: 'no', limit: 60 } });
      // Pictures that are probably not parts (a size callout, a cut-off caption) start unticked.
      setList(d); setPicked(new Set(d.parts.filter((p) => !nonPartReason(p.name)).map((p) => p.id))); onCount?.(d.total); setErr('');
    } catch (e) { setErr(e.message); }
  }, [vendorId, onCount]);
  useEffect(() => { load(); }, [load]);

  async function decide(decision) {
    const ids = [...picked];
    if (!ids.length) return;
    if (decision === 'reject' && !window.confirm(`Delete ${ids.length} part${ids.length !== 1 ? 's' : ''}? They are hidden, and not added again when the catalog is read again. They can be brought back from the Deleted list.`)) return;
    setBusy(true); setErr('');
    try { await call('vendor-parts-review', { body: { ids, decision } }); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!list) return err ? <Err text={err} /> : <p style={muted}>Loading…</p>;
  if (!list.total) return <p style={muted}>Everything has been checked. Parts read from a new catalog are listed here until someone checks them.</p>;
  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <p style={{ ...muted, margin: 0 }}>
        {list.total} part{list.total !== 1 ? 's' : ''} in use but not checked yet, in catalog order, {list.parts.length} shown. They can be used already; checking is optional and can happen any time. To check a page: fix a name with Edit, untick anything wrong, mark the rest as checked. Ones that look like they are not parts start unticked; delete them, or tick them if they are fine.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', position: 'sticky', top: 0, background: '#f9fafb', padding: '6px 0', zIndex: 2 }}>
        <button type="button" style={primary} disabled={busy || !picked.size} onClick={() => decide('check')}>Mark {picked.size} ticked as checked</button>
        <button type="button" style={ctl} disabled={busy || !picked.size} onClick={() => decide('reject')}>Delete ticked</button>
        <button type="button" style={ctl} onClick={() => setPicked(new Set(picked.size ? [] : list.parts.map((p) => p.id)))}>{picked.size ? 'Untick all' : 'Tick all'}</button>
        <Err text={err} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
        {list.parts.map((p) => (
          <div key={p.id} style={{ ...card, padding: '8px', display: 'grid', gap: '4px', borderColor: picked.has(p.id) ? '#78350f' : '#e5e7eb', opacity: picked.has(p.id) ? 1 : 0.6 }}>
            <label style={{ display: 'grid', gap: '4px', cursor: 'pointer' }}>
              <Picture part={p} />
              <span style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '13px', fontWeight: 600 }}>
                <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} style={{ marginTop: '2px' }} />
                <span>{p.name}{p.itemNumber ? <span style={{ fontWeight: 400, color: '#6b7280' }}> · {p.itemNumber}</span> : null}</span>
              </span>
            </label>
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>{kindLabel(p.kind)}{p.page ? ` · p. ${p.page}` : ''}</span>
            {nonPartReason(p.name) && <span style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', justifySelf: 'start' }}>Probably not a part: {nonPartReason(p.name)}</span>}
            <button type="button" style={{ ...ctl, padding: '3px 8px', minHeight: '26px', fontSize: '12px' }} onClick={() => setEditId(editId === p.id ? null : p.id)}>{editId === p.id ? 'Close' : 'Edit'}</button>
          </div>
        ))}
      </div>
      {editId && (() => {
        const p = list.parts.find((x) => x.id === editId);
        return p ? <PartForm vendorId={vendorId} part={p} onSaved={(np) => { setList((d) => ({ ...d, parts: d.parts.map((x) => (x.id === np.id ? { ...x, ...np } : x)) })); setEditId(null); }} onCancel={() => setEditId(null)} /> : null;
      })()}
    </div>
  );
}

// ── Catalogs and price lists ────────────────────────────────────────────────

function FilesPanel({ vendorId, canSeePrices, onImported }) {
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(null); // 'catalog' | 'price_book' | 'price_list'
  const load = useCallback(() => call('vendor-files', { params: { vendorId } }).then((d) => { setFiles(d.files); setErr(''); }).catch((e) => setErr(e.message)), [vendorId]);
  useEffect(() => { load(); }, [load]);

  async function removeFile(f) {
    if (!window.confirm(`Remove "${f.title}"?${f.unchecked ? ` Its ${f.unchecked} parts that nobody has checked yet go too.` : ''}`)) return;
    try { await call('vendor-file-update', { body: { id: f.id, removed: true } }); load(); onImported?.(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" style={mode === 'catalog' ? primary : ctl} onClick={() => setMode(mode === 'catalog' ? null : 'catalog')}>Read a catalog (PDF)</button>
        {canSeePrices && <button type="button" style={mode === 'price_book' ? primary : ctl} onClick={() => setMode(mode === 'price_book' ? null : 'price_book')}>Read a price book (PDF)</button>}
        {canSeePrices && <button type="button" style={mode === 'price_list' ? primary : ctl} onClick={() => setMode(mode === 'price_list' ? null : 'price_list')}>Import price list (CSV)</button>}
      </div>
      {mode === 'catalog' && <CatalogRead vendorId={vendorId} onDone={() => { setMode(null); load(); onImported?.(); }} />}
      {mode === 'price_book' && <PriceBookRead vendorId={vendorId} onDone={() => { setMode(null); load(); onImported?.(); }} />}
      {mode === 'price_list' && <PriceImport vendorId={vendorId} onDone={() => { setMode(null); load(); onImported?.(); }} />}
      <Err text={err} />
      {!files ? <p style={muted}>Loading…</p> : files.length === 0 ? <p style={muted}>No catalogs or price lists yet.</p> : files.map((f) => {
        const [label, bg, fg] = FILE_STATUS[f.status] ?? [f.status, '#e5e7eb', '#374151'];
        const kept = f.kind === 'price_list' && !['uploading', 'failed'].includes(f.status);
        const stuck = ['uploading', 'extracting', 'failed'].includes(f.status);
        return (
          <div key={f.id} style={{ ...card, display: 'grid', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong style={{ fontSize: '14px' }}>{f.title}{f.edition ? ` (${f.edition})` : ''}</strong>
              <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: bg, color: fg }}>{label}</span>
            </div>
            <span style={{ ...muted, fontSize: '12px' }}>
              {f.kind === 'catalog' ? 'Catalog' : f.kind === 'price_book' ? `Price book${f.supersededBy ? ' (replaced by a newer edition)' : ''}` : 'Price list'} · {f.fileName}{f.sizeBytes ? `, ${fmtSize(f.sizeBytes)}` : ''}{f.pages ? `, ${f.pages} pages` : ''} · {f.kind === 'price_list' ? 'uploaded' : 'read'} {fmtDay(f.uploadedAt)}{f.uploadedBy ? ` by ${f.uploadedBy}` : ''}
            </span>
            {f.kind === 'catalog' && f.parts > 0 && <span style={{ ...muted, fontSize: '12px' }}>{f.parts} parts in use, {f.unchecked} not checked yet</span>}
            {f.kind === 'price_book' && f.tables > 0 && <span style={{ ...muted, fontSize: '12px' }}>{f.tables} price tables, {f.tablesUnchecked} not checked yet</span>}
            {f.kind !== 'price_list' && f.status === 'extracting' && <span style={{ ...muted, fontSize: '12px' }}>The upload stopped before it finished. Remove this and read the catalog again.</span>}
            {f.notes && <span style={{ ...muted, fontSize: '12px' }}>{f.notes}</span>}
            {(kept || stuck) && (
              <div style={{ display: 'flex', gap: '8px' }}>
                {kept && <button type="button" style={{ ...ctl, padding: '4px 10px', minHeight: '28px', fontSize: '12px' }} onClick={() => openFile(f.id)}>Open</button>}
                {stuck && <button type="button" style={{ ...ctl, padding: '4px 10px', minHeight: '28px', fontSize: '12px' }} onClick={() => removeFile(f)}>Remove</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Reads a catalog PDF here in the browser, shows what it found, then uploads the pictures and parts.
function CatalogRead({ vendorId, onDone, initialFile = null, initialReader = 'caldoor' }) {
  const [file, setFile] = useState(initialFile);
  const [title, setTitle] = useState('');
  const [edition, setEdition] = useState('');
  const [reader, setReader] = useState(initialReader in READERS ? initialReader : 'caldoor');
  const [reading, setReading] = useState(null); // { page, pages }
  const [result, setResult] = useState(null);
  const [upload, setUpload] = useState(null); // { done, total, step }
  const [err, setErr] = useState('');
  const stop = useRef(null);
  const thumbs = useRef([]);
  useEffect(() => () => { stop.current?.abort(); thumbs.current.forEach(URL.revokeObjectURL); }, []);

  async function read(e) {
    e.preventDefault();
    if (!file) return;
    setErr(''); setResult(null); setReading({ page: 0, pages: 0 });
    stop.current = new AbortController();
    try {
      const r = await readCaldoor(file, { onProgress: setReading, signal: stop.current.signal });
      thumbs.current.forEach(URL.revokeObjectURL);
      thumbs.current = r.parts.slice(0, 18).map((p) => URL.createObjectURL(p.blob));
      setResult(r);
    } catch (x) {
      setErr(x.message === 'Stopped' ? 'Stopped.' : `Could not read this PDF: ${x.message}`);
    } finally { setReading(null); }
  }

  async function send() {
    const parts = result.parts.map((p, i) => ({ ...p, img: `p${String(p.page).padStart(3, '0')}-${String(i + 1).padStart(4, '0')}.jpg` }));
    const pages = [...result.pageImages.entries()].map(([n, blob]) => ({ name: `page-${String(n).padStart(3, '0')}.jpg`, blob }));
    const total = pages.length + parts.length;
    let done = 0;
    setErr(''); setUpload({ done, total, step: 'Starting' });
    let fileRow = null;
    try {
      fileRow = (await call('vendor-catalog-start', { body: {
        vendorId, title: title || file.name.replace(/\.pdf$/i, ''), edition, fileName: file.name, sizeBytes: file.size, pages: result.pages, reader,
      } })).file;
      const putAll = async (folder, items, nameOf, blobOf, after) => {
        for (let i = 0; i < items.length; i += 100) {
          const chunk = items.slice(i, i + 100);
          const { uploads } = await call('vendor-file-images', { body: { fileId: fileRow.id, folder, names: chunk.map(nameOf) } });
          await pool(chunk, 6, async (item, k) => {
            await uploadTo(uploads[k].url, blobOf(item));
            after?.(item, uploads[k]);
            done += 1; setUpload({ done, total, step: folder === 'pages' ? 'Catalog pages' : 'Part pictures' });
          });
        }
      };
      await putAll('pages', pages, (x) => x.name, (x) => x.blob);
      await putAll('img', parts, (x) => x.img, (x) => x.blob, (item, u) => { item.imagePath = u.path; });
      const sum = { added: 0, updated: 0, skippedRejected: 0, duplicates: 0 };
      for (let i = 0; i < parts.length; i += 200) {
        setUpload({ done, total, step: 'Saving parts' });
        const r = await call('vendor-catalog-parts', { body: { fileId: fileRow.id, parts: parts.slice(i, i + 200).map((p) => ({
          kind: p.kind, name: p.name, category: p.category, options: p.options, page: p.page, imagePath: p.imagePath,
        })) } });
        for (const k of Object.keys(sum)) sum[k] += r[k] ?? 0;
      }
      await call('vendor-file-update', { body: { id: fileRow.id, status: 'extracted', notes: `${sum.added} new parts in use (not checked yet), ${sum.updated} already listed (page and picture updated)${sum.skippedRejected ? `, ${sum.skippedRejected} left out because they were rejected before` : ''}${sum.duplicates ? `, ${sum.duplicates} names that appear twice in the catalog kept once` : ''}.` } });
      onDone();
    } catch (x) {
      setErr(`The upload stopped: ${x.message}`); setUpload(null);
      if (fileRow) call('vendor-file-update', { body: { id: fileRow.id, status: 'failed', notes: `Upload stopped: ${x.message}`.slice(0, 300) } }).catch(() => {});
    }
  }

  const byCategory = result ? Object.entries(result.parts.reduce((m, p) => ({ ...m, [p.category ?? 'No section']: (m[p.category ?? 'No section'] ?? 0) + 1 }), {})) : [];
  return (
    <div style={{ ...card, display: 'grid', gap: '10px' }}>
      <form onSubmit={read} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <DropZone
            title="Drop the catalog PDF here" hint="or click to choose it. It is read on this computer and not uploaded."
            accept="application/pdf,.pdf" file={file} disabled={!!reading || !!upload}
            onFile={(f) => { if (!isPdf(f)) { setErr('That is not a PDF.'); return; } setErr(''); setFile(f); setResult(null); }}
          />
        </div>
        <Labeled label="Title"><input style={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name.replace(/\.pdf$/i, '') ?? 'Product Catalog 2024'} /></Labeled>
        <Labeled label="Edition"><input style={field} value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="2024, 4th edition" /></Labeled>
        <Labeled label="Layout">
          <select style={{ ...field, appearance: 'auto' }} value={reader} onChange={(e) => setReader(e.target.value)}>
            {Object.entries(READERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Labeled>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {!reading && !result && <button type="submit" style={primary} disabled={!file}>Read catalog</button>}
          {reading && (
            <>
              <span style={{ fontSize: '13px' }}>{reading.pages ? `Reading page ${reading.page} of ${reading.pages}…` : 'Opening the PDF…'}</span>
              <progress value={reading.page} max={reading.pages || 1} style={{ flex: '1 1 160px' }} />
              <button type="button" style={ctl} onClick={() => stop.current?.abort()}>Stop</button>
            </>
          )}
        </div>
      </form>
      {file && !reading && !result && <p style={{ ...muted, fontSize: '12px', margin: 0 }}>The PDF is read on this computer and is not uploaded. A large catalog takes a minute or two; keep this page open.</p>}
      {result && (
        <>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Found <strong>{result.parts.length} parts</strong> on {result.pages} pages{result.sections.length ? ` in ${result.sections.length} sections` : ''}.
            {result.parts.length === 0 && ' Nothing was found: this catalog may need a different layout reader.'}
          </p>
          {byCategory.length > 0 && <p style={{ ...muted, fontSize: '12px', margin: 0 }}>{byCategory.map(([c, n]) => `${c}: ${n}`).join(' · ')}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
            {thumbs.current.map((u, i) => (
              <figure key={u} style={{ margin: 0, display: 'grid', gap: '2px' }}>
                <img src={u} alt={result.parts[i].name} style={{ width: '100%', height: '90px', objectFit: 'contain', background: '#f9fafb', borderRadius: '4px' }} />
                <figcaption style={{ fontSize: '11px', color: '#374151' }}>{result.parts[i].name}</figcaption>
              </figure>
            ))}
          </div>
          {result.parts.length > 18 && <span style={{ ...muted, fontSize: '12px' }}>The first 18 shown. After the upload they are all in use; check, correct or delete them as you come across them.</span>}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {!upload && result.parts.length > 0 && <button type="button" style={primary} onClick={send}>Upload {result.parts.length} parts and {result.pageImages.size} page pictures</button>}
            {!upload && <button type="button" style={ctl} onClick={() => setResult(null)}>Start over</button>}
            {upload && (
              <>
                <span style={{ fontSize: '13px' }}>{upload.step}: {upload.done} of {upload.total}</span>
                <progress value={upload.done} max={upload.total} style={{ flex: '1 1 160px' }} />
              </>
            )}
          </div>
        </>
      )}
      <Err text={err} />
    </div>
  );
}

function PriceImport({ vendorId, onDone, initialFile = null }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null); // parsed, header first
  const [cols, setCols] = useState(null);
  const [asOf, setAsOf] = useState(todayIso());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function pick(f) {
    setFile(f); setRows(null); setPreview(null); setErr('');
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) { setErr('Save the price list as CSV first (in Excel: File > Save As > CSV).'); return; }
    if (f.size > 10e6) { setErr('That file is over 10 MB; split it or ask for a smaller export.'); return; }
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2) { setErr('The file has no rows under its header.'); return; }
    setRows(parsed); setCols(guessColumns(parsed[0]));
  }
  // A file dropped on the Vendors tab arrives already chosen.
  useEffect(() => { if (initialFile) pick(initialFile); }, [initialFile]);
  const mapped = () => rows.slice(1).map((r) => ({
    itemNumber: cols.itemNumber >= 0 ? r[cols.itemNumber] : '', name: cols.name >= 0 ? r[cols.name] : '',
    description: cols.description >= 0 ? r[cols.description] : '', price: cols.price >= 0 ? r[cols.price] : '', unit: cols.unit >= 0 ? r[cols.unit] : '',
  }));

  async function check() {
    setBusy('check'); setErr('');
    try { setPreview(await call('vendor-price-import', { body: { vendorId, asOf, rows: mapped(), commit: false } })); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function commit() {
    setBusy('commit'); setErr('');
    try {
      // The file is kept with the vendor, so a price can always be traced back to its list.
      const started = await call('vendor-file-start', { body: { vendorId, kind: 'price_list', title: file.name.replace(/\.(csv|txt)$/i, ''), edition: asOf, fileName: file.name, sizeBytes: file.size } });
      // Windows often gives a CSV no type (or Excel's); the bucket accepts text/csv.
      await uploadTo(started.upload.url, new File([file], file.name, { type: 'text/csv' }));
      await call('vendor-file-done', { body: { id: started.file.id, ok: true } });
      await call('vendor-price-import', { body: { vendorId, fileId: started.file.id, asOf, rows: mapped(), commit: true } });
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  const header = rows?.[0] ?? [];
  const colSelect = (key, label) => (
    <Labeled label={label}>
      <select style={{ ...field, appearance: 'auto' }} value={cols[key]} onChange={(e) => { setCols((c) => ({ ...c, [key]: Number(e.target.value) })); setPreview(null); }}>
        <option value={-1}>(none)</option>
        {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
    </Labeled>
  );
  return (
    <div style={{ ...card, display: 'grid', gap: '10px' }}>
      <DropZone title="Drop the price list (CSV) here" hint="or click to choose it. In Excel: File > Save As > CSV." accept=".csv,text/csv,.txt" file={file} disabled={!!busy} onFile={pick} />
      {rows && cols && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            {colSelect('itemNumber', 'Item number')}
            {colSelect('name', 'Name')}
            {colSelect('description', 'Description')}
            {colSelect('price', 'Price')}
            {colSelect('unit', 'Unit')}
            <Labeled label="Prices as of"><input style={field} type="date" value={asOf} onChange={(e) => { setAsOf(e.target.value); setPreview(null); }} /></Labeled>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '12px', borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead><tr>{header.map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h || `Column ${i + 1}`}</th>)}</tr></thead>
              <tbody>{rows.slice(1, 6).map((r, i) => <tr key={i}>{header.map((_, j) => <td key={j} style={{ padding: '3px 8px', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>{r[j]}</td>)}</tr>)}</tbody>
            </table>
            <span style={{ ...muted, fontSize: '12px' }}>First {Math.min(5, rows.length - 1)} of {rows.length - 1} rows.</span>
          </div>
          {cols.price < 0 || (cols.itemNumber < 0 && cols.name < 0)
            ? <p style={{ ...muted, margin: 0 }}>Pick the price column, and the item number or name column.</p>
            : (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" style={ctl} disabled={!!busy} onClick={check}>{busy === 'check' ? 'Checking…' : 'Check'}</button>
                {preview && (
                  <>
                    <span style={{ fontSize: '13px' }}>
                      {preview.matched} match existing parts ({preview.changed} with a new price), {preview.added} new parts (in use, not checked yet), {preview.skipped} rows skipped.
                    </span>
                    <button type="button" style={primary} disabled={!!busy || (!preview.changed && !preview.added)} onClick={commit}>{busy === 'commit' ? 'Importing…' : 'Import'}</button>
                  </>
                )}
              </div>
            )}
          {preview?.skippedSample?.length > 0 && (
            <details style={{ fontSize: '12px', color: '#6b7280' }}>
              <summary>Skipped rows</summary>
              {preview.skippedSample.map((s) => <div key={s.line}>Row {s.line}: {s.reason}</div>)}
            </details>
          )}
        </>
      )}
      <Err text={err} />
    </div>
  );
}
