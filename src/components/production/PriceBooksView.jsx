import { useCallback, useEffect, useRef, useState } from 'react';
import { bookTitle, readPriceBook } from './priceBookReader.js';
import { call, pool, uploadTo, ctl, primary, field, card, muted, money, fmtDay, isPdf, useDebounced } from './vendorLib.js';
import { Labeled, Err, DropZone, PartWindow } from './vendorUi.jsx';

// Price books on the Vendors tab (db/production/010): reading one in the browser, the list of its price tables, one
// table beside its page, and a part's rates in its window. Only the admin and the bookkeeper get here (the server
// checks too). Tables are in use as soon as they are read and marked "not checked yet" until someone checks one
// against its page.

const VARIANT = { door: 'Door', glass: 'Cut for glass', drawer_front: 'Drawer front', per_inch: 'Per linear inch', per_box: 'Per box', price: 'Price' };
const PRICING = {
  per_sq_ft: 'Prices per sq. ft.',
  linear_inch_plus_box: 'Box perimeter × the rate per linear inch, plus the per-box charge',
  per_length: 'Prices per length (see the page)',
  each: 'Prices each',
  other: 'See the page for how these prices work',
};
const ADDER_UNIT = { per_sq_ft: '/ sq. ft.', per_piece: '/ piece', per_door: '/ door', per_lite: '/ lite', per_box: '/ box', per_opening: '/ opening', per_set: '/ set', each: '' };
const adderText = (a) => (a.kind === 'percent' ? `+${a.value}%` : `+${money(a.value)} ${ADDER_UNIT[a.kind] ?? ''}`.trim());
const rateText = (r, variant) => (r == null ? 'N/A' : variant === 'per_inch' ? `$${Number(r).toFixed(2)}` : money(r));
const small = { ...ctl, padding: '4px 10px', minHeight: '28px', fontSize: '12px' };
const linkBtn = { background: 'none', border: 0, padding: 0, color: '#78350f', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' };
const flagBox = { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', padding: '6px 8px', fontSize: '12px', color: '#92400e' };

/** A price table as a grid. edit: { values: Map key -> text, set(key, text) } turns the numbers into inputs. */
function Grid({ table, edit, highlight }) {
  const cells = new Map((table.cells ?? []).map((c) => [`${c.row}|${c.col}`, c]));
  const th = { padding: '4px 6px', fontWeight: 600, fontSize: '11px', color: '#374151', borderBottom: '1px solid #e5e7eb', verticalAlign: 'bottom', textAlign: 'right' };
  const td = { padding: '3px 6px', fontSize: '12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right', whiteSpace: 'nowrap' };
  return (
    <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>{table.rowLabel ?? ''}</th>
            {table.columns.map((c) => (
              <th key={c.key} style={{ ...th, minWidth: '70px' }}>
                {c.label || VARIANT[c.variant]}
                {c.label && c.variant !== 'price' && <div style={{ fontWeight: 400, color: '#6b7280' }}>{VARIANT[c.variant]}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(table.rowLabels ?? []).map((label, row) => (
            <tr key={row} style={highlight?.(label) ? { background: '#fef3c7' } : undefined}>
              <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: '140px' }}>{label || <em style={{ color: '#b45309' }}>no label</em>}</td>
              {table.columns.map((c) => {
                const key = `${row}|${c.key}`;
                const cell = cells.get(key);
                if (edit) {
                  return (
                    <td key={c.key} style={td}>
                      <input aria-label={`${label} ${c.label}`} inputMode="decimal" value={edit.values.get(key) ?? ''}
                        onChange={(e) => edit.set(key, e.target.value)} placeholder="N/A"
                        style={{ ...field, width: '72px', minHeight: '26px', padding: '2px 4px', textAlign: 'right' }} />
                    </td>
                  );
                }
                const changed = cell?.prevRate != null;
                return (
                  <td key={c.key} style={{ ...td, color: !cell ? '#b45309' : cell.rate == null ? '#9ca3af' : '#111827', fontWeight: changed ? 700 : 400 }}
                    title={changed ? `Was ${rateText(cell.prevRate, c.variant)} in the previous edition` : cell?.editedBy ? `Corrected by ${cell.editedBy}` : undefined}>
                    {!cell ? '—' : rateText(cell.rate, c.variant)}{changed ? ' *' : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Adders({ adders, max = 100 }) {
  const [all, setAll] = useState(false);
  if (!adders?.length) return null;
  const shown = all ? adders : adders.slice(0, max);
  return (
    <div style={{ display: 'grid', gap: '2px' }}>
      <strong style={{ fontSize: '12px' }}>Add-ons</strong>
      {shown.map((a, i) => (
        <span key={i} style={{ fontSize: '12px' }} title={a.raw ?? undefined}>
          <strong style={{ color: '#166534' }}>{adderText(a)}</strong> {a.label}{a.page ? <span style={{ color: '#9ca3af' }}> (p. {a.page})</span> : ''}
        </span>
      ))}
      {adders.length > shown.length && <span><button type="button" style={linkBtn} onClick={() => setAll(true)}>Show all {adders.length}</button></span>}
    </div>
  );
}

/** The page picture(s) of a table, from links in the table or fetched for a book page. */
function PagePictures({ images }) {
  if (!images?.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(260px, 1fr))`, gap: '8px' }}>
      {images.map((im) => (im.url
        ? <a key={im.page} href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt={`Price book page ${im.page}`} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: '6px' }} /></a>
        : <span key={im.page} style={muted}>No picture of page {im.page}</span>))}
    </div>
  );
}

function BookPage({ fileId, page }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    call('vendor-page-image', { params: { fileId, page } }).then((d) => live && setUrl(d.url)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [fileId, page]);
  if (err) return <Err text={err} />;
  return url ? <PagePictures images={[{ page, url }]} /> : <span style={muted}>Loading page {page}…</span>;
}

// ── One table beside its page ───────────────────────────────────────────────

export function PriceTableDetail({ id, onClose, onChanged }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(null); // { values: Map, labels: [] }
  const load = useCallback(() => call('price-table', { params: { id } }).then((d) => { setT(d.table); setErr(''); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setT(null); setEditing(null); load(); }, [load]);

  function startEdit() {
    const values = new Map();
    for (const c of t.cells) values.set(`${c.row}|${c.col}`, c.rate == null ? '' : String(c.rate));
    setEditing({ values, labels: [...t.rowLabels] });
  }
  async function save() {
    setBusy('save'); setErr('');
    try {
      const was = new Map(t.cells.map((c) => [`${c.row}|${c.col}`, c.rate == null ? '' : String(c.rate)]));
      const cells = [];
      for (const [key, v] of editing.values) {
        if ((was.get(key) ?? '') === v.trim()) continue;
        const [row, col] = key.split('|');
        cells.push({ row: Number(row), col, rate: v.trim() === '' ? null : v.trim().replace(/^\$/, '') });
      }
      const labelsChanged = editing.labels.some((l, i) => l !== t.rowLabels[i]);
      const d = await call('price-table-save', { body: { id, cells, ...(labelsChanged ? { rowLabels: editing.labels } : {}) } });
      setT((x) => ({ ...x, ...d.table })); setEditing(null); onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function check(checked) {
    setBusy('check'); setErr('');
    try { await call('price-table-check', { body: { ids: [id], checked } }); await load(); onChanged?.(); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function remove() {
    if (!window.confirm(`Remove "${t.title}"? Use this for something the reader took for prices that isn't a price table (an order form, an index).`)) return;
    setBusy('remove');
    try { await call('price-table-remove', { body: { id } }); onChanged?.(); onClose(); }
    catch (e) { setErr(e.message); setBusy(''); }
  }

  if (!t) return <div style={card}>{err ? <Err text={err} /> : <span style={muted}>Loading…</span>}</div>;
  const changed = t.cells.filter((c) => c.prevRate != null).length;
  return (
    <div style={{ ...card, display: 'grid', gap: '10px', borderColor: '#78350f' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: '2px' }}>
          <strong style={{ fontSize: '15px' }}>{t.title}</strong>
          <span style={{ ...muted, fontSize: '12px' }}>
            {t.book?.title}{t.book?.edition ? ` (${t.book.edition})` : ''} · page {t.page}{t.optionsPage ? ` (options on page ${t.optionsPage})` : ''}{t.book && !t.book.current ? ' · an older edition' : ''}
          </span>
          <span style={{ fontSize: '12px', color: t.checkedAt ? '#166534' : '#92400e' }}>
            {t.checkedAt ? `Checked against the page by ${t.checkedBy}, ${fmtDay(t.checkedAt)}` : 'Not checked yet'}{t.editedBy ? ` · last corrected by ${t.editedBy}` : ''}
          </span>
        </div>
        <button type="button" style={ctl} onClick={onClose}>Close</button>
      </div>
      {t.issues?.length > 0 && (
        <div style={flagBox}>
          <strong>The reader wasn't sure of this table:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>{t.issues.slice(0, 8).map((i) => <li key={i}>{i}</li>)}</ul>
          {t.issues.length > 8 && <span>and {t.issues.length - 8} more.</span>}
        </div>
      )}
      {changed > 0 && <span style={{ fontSize: '12px', color: '#92400e' }}>{changed} number{changed === 1 ? '' : 's'} changed from the previous edition (marked *; hover to see the old price).</span>}
      <span style={{ ...muted, fontSize: '12px' }}>{PRICING[t.pricing]}{t.minSqFt ? ` · doors at least ${t.minSqFt} sq. ft.` : ''}</span>
      {editing && (
        <div style={{ display: 'grid', gap: '4px' }}>
          <span style={{ ...muted, fontSize: '12px' }}>Row labels</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px' }}>
            {editing.labels.map((l, i) => (
              <input key={i} style={{ ...field, minHeight: '26px', padding: '2px 6px' }} aria-label={`Row ${i + 1} label`} value={l}
                onChange={(e) => setEditing((x) => ({ ...x, labels: x.labels.map((y, k) => (k === i ? e.target.value : y)) }))} />
            ))}
          </div>
        </div>
      )}
      <Grid table={editing ? { ...t, rowLabels: editing.labels } : t} edit={editing ? { values: editing.values, set: (k, v) => setEditing((x) => { const m = new Map(x.values); m.set(k, v); return { ...x, values: m }; }) } : null} />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <button type="button" style={primary} disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save corrections'}</button>
            <button type="button" style={ctl} disabled={!!busy} onClick={() => setEditing(null)}>Cancel</button>
          </>
        ) : (
          <>
            {!t.checkedAt
              ? <button type="button" style={primary} disabled={!!busy} onClick={() => check(true)}>Mark as checked</button>
              : <button type="button" style={ctl} disabled={!!busy} onClick={() => check(false)}>Mark as not checked</button>}
            <button type="button" style={ctl} disabled={!!busy} onClick={startEdit}>Correct numbers</button>
            <button type="button" style={ctl} disabled={!!busy} onClick={remove}>Not a price table</button>
          </>
        )}
      </div>
      <Adders adders={t.adders} max={12} />
      {t.notes?.length > 0 && (
        <div style={{ display: 'grid', gap: '2px' }}>
          <strong style={{ fontSize: '12px' }}>Small print</strong>
          {t.notes.map((n) => <span key={n} style={{ fontSize: '12px', color: '#374151' }}>{n}</span>)}
        </div>
      )}
      {t.parts?.length > 0 && (
        <span style={{ fontSize: '12px' }}><strong>Prices these parts:</strong> {t.parts.map((p) => p.name).join(', ')}</span>
      )}
      <PagePictures images={t.pageImages} />
      <Err text={err} />
    </div>
  );
}

// ── The Price tables tab ────────────────────────────────────────────────────

export function PricesPanel({ vendorId, onCount }) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('all'); // 'all' | 'unchecked' | 'flagged'
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(null);
  const dq = useDebounced(q, 250);
  const load = useCallback(() => call('price-tables', { params: { vendorId, q: dq } })
    .then((d) => { setData(d); setErr(''); onCount?.(d.unchecked); }).catch((e) => setErr(e.message)), [vendorId, dq, onCount]);
  useEffect(() => { load(); }, [load]);

  async function checkMany(ids) {
    if (!window.confirm(`Mark ${ids.length} table${ids.length === 1 ? '' : 's'} as checked against the page?`)) return;
    try { for (let i = 0; i < ids.length; i += 200) await call('price-table-check', { body: { ids: ids.slice(i, i + 200), checked: true } }); load(); }
    catch (e) { setErr(e.message); }
  }

  if (!data) return err ? <Err text={err} /> : <p style={muted}>Loading…</p>;
  const tables = data.tables.filter((t) => (only === 'unchecked' ? !t.checkedAt : only === 'flagged' ? t.issues?.length : true));
  const books = data.books.filter((b) => b.current);
  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {books.length === 0 ? (
        <p style={muted}>No price books yet. Drop one on the box at the top of the Vendors tab.</p>
      ) : (
        <p style={{ ...muted, margin: 0 }}>
          {data.books.length ? `From ${books.map((b) => `${b.title}${b.edition ? ` (${b.edition})` : ''}`).join(', ')}. ` : ''}
          {data.unchecked} of {data.all} tables not checked yet{data.flagged ? `, ${data.flagged} the reader wasn't sure of` : ''}. Open a table to see it beside its page.
        </p>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...field, maxWidth: '280px' }} placeholder="Search tables (style, wood, colour…)" aria-label="Search price tables" value={q} onChange={(e) => setQ(e.target.value)} />
        {[['all', 'All'], ['unchecked', 'Not checked'], ['flagged', 'Reader unsure']].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={only === k} style={only === k ? primary : ctl} onClick={() => setOnly(k)}>{l}</button>
        ))}
        {only === 'unchecked' && tables.length > 0 && <button type="button" style={ctl} onClick={() => checkMany(tables.map((t) => t.id))}>Mark these {tables.length} as checked</button>}
      </div>
      <Err text={err} />
      <div style={{ display: 'grid', gap: '6px' }}>
        {tables.length === 0 && <p style={muted}>Nothing to show.</p>}
        {tables.map((t) => (
          <button key={t.id} type="button" onClick={() => setOpenId(t.id)}
            style={{ ...card, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', display: 'grid', gap: '2px', font: 'inherit' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '13px' }}>{t.title}</strong>
              <span style={{ fontSize: '11px', color: t.checkedAt ? '#166534' : '#92400e' }}>{t.checkedAt ? 'Checked' : 'Not checked yet'}</span>
            </span>
            <span style={{ ...muted, fontSize: '12px' }}>
              Page {t.page} · {t.rows} rows × {t.columns.length} columns{t.columns.length ? `: ${t.columns.map((c) => c.label || VARIANT[c.variant]).join(' · ').slice(0, 140)}` : ''}
            </span>
            {t.issues?.length > 0 && <span style={{ fontSize: '12px', color: '#b45309' }}>Reader unsure: {t.issues[0]}{t.issues.length > 1 ? ` (+${t.issues.length - 1} more)` : ''}</span>}
          </button>
        ))}
      </div>
      {openId && (
        <PartWindow onClose={() => setOpenId(null)} wide>
          <PriceTableDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />
        </PartWindow>
      )}
    </div>
  );
}

// ── A part's rates, in its window ───────────────────────────────────────────

export function PartPriceTables({ part, onChanged }) {
  const [openPage, setOpenPage] = useState(null); // table id
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [finding, setFinding] = useState(false);
  const tables = part.priceTables ?? [];

  async function link(tableId, how) {
    setBusy(tableId); setErr('');
    try { await call('part-price-link', { body: { partId: part.id, tableId, link: how } }); await onChanged(); setFinding(false); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <strong style={{ fontSize: '13px' }}>Price book</strong>
      {tables.length === 0 && <span style={muted}>No price table found for this name.</span>}
      {tables.map((t) => (
        <div key={t.id} style={{ display: 'grid', gap: '6px', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span style={{ fontSize: '13px' }}><strong>{t.title}</strong> <span style={muted}>· {t.book?.title}{t.book?.edition ? ` (${t.book.edition})` : ''}</span></span>
            <span style={{ fontSize: '11px', color: t.checkedAt ? '#166534' : '#92400e' }}>{t.checkedAt ? 'Checked' : 'Not checked yet'}</span>
          </div>
          {t.issues?.length > 0 && <span style={{ fontSize: '12px', color: '#b45309' }}>The reader wasn't sure of this table; check it against the page before quoting from it.</span>}
          <span style={{ ...muted, fontSize: '12px' }}>{PRICING[t.pricing]}{t.minSqFt ? ` · doors at least ${t.minSqFt} sq. ft.` : ''}</span>
          <Grid table={t} />
          <Adders adders={t.adders} max={6} />
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" style={linkBtn} onClick={() => setOpenPage(openPage === t.id ? null : t.id)} aria-expanded={openPage === t.id}>
              {openPage === t.id ? 'Hide' : 'See'} price page {t.page}
            </button>
            {t.linkedBy === 'hand'
              ? <button type="button" style={small} disabled={!!busy} onClick={() => link(t.id, 'none')}>Remove this link</button>
              : <button type="button" style={small} disabled={!!busy} onClick={() => link(t.id, 'hidden')} title="This table was matched by the part's name">Not this part's table</button>}
          </div>
          {openPage === t.id && <BookPage fileId={t.fileId} page={t.page} />}
        </div>
      ))}
      {!finding
        ? <span><button type="button" style={small} onClick={() => setFinding(true)}>{tables.length ? 'Link another price table' : 'Link a price table'}</button></span>
        : <FindTable vendorId={part.vendorId} skip={tables.map((t) => t.id)} onPick={(id) => link(id, 'manual')} onCancel={() => setFinding(false)} busy={!!busy} />}
      <Err text={err} />
    </div>
  );
}

// Every current price table of the vendor, grouped by book in page order. The box narrows the list by
// name, style, row or column words, or by page number ("48" or "p48").
function FindTable({ vendorId, skip, onPick, onCancel, busy }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    call('price-tables', { params: { vendorId } }).then((d) => live && setData(d)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [vendorId]);

  const term = q.trim().toLowerCase();
  const pageNo = /^p?\.?\s*(\d+)$/.exec(term)?.[1];
  const hits = (data?.tables ?? []).filter((t) => !skip.includes(t.id) && (!term || (pageNo
    ? String(t.page) === pageNo
    : [t.title, ...(t.styles ?? []), ...(t.rowLabels ?? []), ...(t.columns ?? []).map((c) => c.label)].join(' ').toLowerCase().includes(term))));
  // The Wood book holds most door styles, so it leads; the other books keep the server's order.
  const books = (data?.books ?? []).filter((b) => b.current)
    .sort((a, c) => Number(/^wood\b/i.test(c.title ?? '')) - Number(/^wood\b/i.test(a.title ?? '')));
  const groups = books.map((b) => ({ book: b, tables: hits.filter((t) => t.fileId === b.id).sort((a, c) => a.page - c.page || a.seq - c.seq) }))
    .filter((g) => g.tables.length);

  return (
    <div style={{ display: 'grid', gap: '6px' }}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input style={field} autoFocus placeholder="Narrow by name or page number" aria-label="Narrow the price tables" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" style={ctl} onClick={onCancel}>Cancel</button>
      </div>
      <Err text={err} />
      {!data && !err && <span style={{ ...muted, fontSize: '12px' }}>Loading price tables…</span>}
      {data && (
        <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'grid', gap: '4px', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '6px' }}>
          {groups.map(({ book, tables }) => (
            <div key={book.id} style={{ display: 'grid', gap: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151', paddingTop: '4px' }}>
                {book.title}{book.edition ? ` (${book.edition})` : ''} · {tables.length}
              </span>
              {tables.map((t) => (
                <button key={t.id} type="button" disabled={busy} onClick={() => onPick(t.id)} style={{ ...small, textAlign: 'left' }}>
                  <strong>p. {t.page}</strong> · {t.title}{t.styles?.length ? <span style={muted}> · {t.styles.slice(0, 4).join(', ')}{t.styles.length > 4 ? '…' : ''}</span> : ''}
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <span style={{ ...muted, fontSize: '12px' }}>No table matches.</span>}
        </div>
      )}
    </div>
  );
}

// ── Reading a price book ────────────────────────────────────────────────────

// Reads a price book PDF here in the browser, shows what it found, then uploads the page pictures and tables.
export function PriceBookRead({ vendorId, onDone, initialFile = null }) {
  const [file, setFile] = useState(initialFile);
  const named = bookTitle(file?.name);
  const [title, setTitle] = useState(named.title ?? '');
  const [edition, setEdition] = useState(named.edition ?? '');
  const [reading, setReading] = useState(null);
  const [result, setResult] = useState(null);
  const [upload, setUpload] = useState(null);
  const [look, setLook] = useState(null); // index of a flagged table opened in the preview
  const [err, setErr] = useState('');
  const stop = useRef(null);
  const urls = useRef(new Map());
  useEffect(() => () => { stop.current?.abort(); urls.current.forEach(URL.revokeObjectURL); }, []);

  function choose(f) {
    if (!isPdf(f)) { setErr('That is not a PDF.'); return; }
    const n = bookTitle(f.name);
    setErr(''); setFile(f); setResult(null); setTitle(n.title ?? ''); setEdition(n.edition ?? '');
  }

  async function read(e) {
    e.preventDefault();
    if (!file) return;
    setErr(''); setResult(null); setLook(null); setReading({ page: 0, pages: 0 });
    stop.current = new AbortController();
    try {
      const r = await readPriceBook(file, { onProgress: setReading, signal: stop.current.signal });
      urls.current.forEach(URL.revokeObjectURL);
      urls.current = new Map();
      setResult(r);
    } catch (x) {
      setErr(x.message === 'Stopped' ? 'Stopped.' : `Could not read this PDF: ${x.message}`);
    } finally { setReading(null); }
  }

  const pageUrl = (p) => {
    if (!result?.pageImages.has(p)) return null;
    if (!urls.current.has(p)) urls.current.set(p, URL.createObjectURL(result.pageImages.get(p)));
    return urls.current.get(p);
  };

  async function send() {
    const pages = [...result.pageImages.entries()].map(([n, blob]) => ({ name: `page-${String(n).padStart(3, '0')}.jpg`, blob }));
    const total = pages.length + result.tables.length;
    let done = 0;
    setErr(''); setUpload({ done, total, step: 'Starting' });
    let fileRow = null;
    try {
      const start = await call('price-book-start', { body: { vendorId, title: title || file.name.replace(/\.pdf$/i, ''), edition, fileName: file.name, sizeBytes: file.size, pages: result.pages } });
      fileRow = start.file;
      for (let i = 0; i < pages.length; i += 100) {
        const chunk = pages.slice(i, i + 100);
        const { uploads } = await call('vendor-file-images', { body: { fileId: fileRow.id, folder: 'pages', names: chunk.map((x) => x.name) } });
        await pool(chunk, 6, async (item, k) => {
          await uploadTo(uploads[k].url, item.blob);
          done += 1; setUpload({ done, total, step: 'Price pages' });
        });
      }
      for (let i = 0; i < result.tables.length; i += 20) {
        const chunk = result.tables.slice(i, i + 20);
        await call('price-book-tables', { body: { fileId: fileRow.id, tables: chunk } });
        done += chunk.length; setUpload({ done, total, step: 'Saving tables' });
      }
      const flagged = result.tables.filter((t) => t.issues.length).length;
      const d = await call('price-book-done', { body: {
        fileId: fileRow.id, replaces: start.replaces.map((x) => x.id),
        notes: `${result.tables.length} price tables in use (not checked yet)${flagged ? `, ${flagged} the reader wasn't sure of` : ''}.`,
      } });
      onDone({ ...d, replaced: start.replaces });
    } catch (x) {
      setErr(`The upload stopped: ${x.message}`); setUpload(null);
      if (fileRow) call('vendor-file-update', { body: { id: fileRow.id, status: 'failed', notes: `Upload stopped: ${x.message}`.slice(0, 300) } }).catch(() => {});
    }
  }

  const flagged = result ? result.tables.map((t, i) => [t, i]).filter(([t]) => t.issues.length) : [];
  const numbers = result ? result.tables.reduce((n, t) => n + t.rows.reduce((m, r) => m + Object.keys(r.cells).length, 0), 0) : 0;
  const lookT = look != null ? result.tables[look] : null;
  return (
    <div style={{ ...card, display: 'grid', gap: '10px' }}>
      <form onSubmit={read} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <DropZone title="Drop the price book PDF here" hint="or click to choose it. It is read on this computer and not uploaded."
            accept="application/pdf,.pdf" file={file} disabled={!!reading || !!upload} onFile={choose} />
        </div>
        <Labeled label="Book"><input style={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wood Price Book" /></Labeled>
        <Labeled label="Edition"><input style={field} value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="April 2026" /></Labeled>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {!reading && !result && <button type="submit" style={primary} disabled={!file}>Read price book</button>}
          {reading && (
            <>
              <span style={{ fontSize: '13px' }}>{!reading.pages ? 'Opening the PDF…' : reading.step === 'pictures' ? 'Making pictures of the price pages…' : `Reading page ${reading.page} of ${reading.pages / 2}…`}</span>
              <progress value={reading.page} max={reading.pages || 1} style={{ flex: '1 1 160px' }} />
              <button type="button" style={ctl} onClick={() => stop.current?.abort()}>Stop</button>
            </>
          )}
        </div>
      </form>
      {file && !reading && !result && <p style={{ ...muted, fontSize: '12px', margin: 0 }}>The PDF stays on this computer. Only a picture of each price page and the prices themselves are uploaded. Use the same book name each month, so a new edition replaces the old one.</p>}
      {result && (
        <>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Found <strong>{result.tables.length} price tables</strong> ({numbers.toLocaleString()} prices, {result.tables.reduce((n, t) => n + t.adders.length, 0)} add-ons) on {result.pages} pages.
            {result.tables.length === 0 && ' Nothing was found: this book may be laid out in a way the reader does not know yet.'}
          </p>
          {flagged.length > 0 ? (
            <div style={flagBox}>
              The reader wasn't sure of {flagged.length} table{flagged.length === 1 ? '' : 's'}. They are uploaded too and marked, so you can check them against the page later:
              <div style={{ display: 'grid', gap: '2px', marginTop: '4px' }}>
                {flagged.slice(0, 12).map(([t, i]) => (
                  <span key={i}><button type="button" style={{ ...linkBtn, fontSize: '12px' }} onClick={() => setLook(look === i ? null : i)}>Page {t.page}: {t.title}</button> · {t.issues[0]}</span>
                ))}
                {flagged.length > 12 && <span>and {flagged.length - 12} more.</span>}
              </div>
            </div>
          ) : result.tables.length > 0 && <span style={{ fontSize: '12px', color: '#166534' }}>Every table passed the reader's checks (a number in every cell, every row labelled, nothing far out of line).</span>}
          {result.tables.length > 0 && (
            <Labeled label="Look at a table before uploading">
              <select style={{ ...field, appearance: 'auto' }} value={look ?? ''} onChange={(e) => setLook(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">Choose a table…</option>
                {result.tables.map((t, i) => <option key={i} value={i}>Page {t.page}: {t.title}{t.issues.length ? ' (unsure)' : ''}</option>)}
              </select>
            </Labeled>
          )}
          {lookT && (
            <div style={{ display: 'grid', gap: '8px' }}>
              <Grid table={{
                ...lookT, rowLabels: lookT.rows.map((r) => r.label),
                cells: lookT.rows.flatMap((r, row) => Object.entries(r.cells).map(([col, c]) => ({ row, col, rate: c.rate }))),
              }} />
              <Adders adders={lookT.adders} max={6} />
              <PagePictures images={[{ page: lookT.page, url: pageUrl(lookT.page) }]} />
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {!upload && result.tables.length > 0 && <button type="button" style={primary} onClick={send}>Upload {result.tables.length} tables and {result.pageImages.size} page pictures</button>}
            {!upload && <button type="button" style={ctl} onClick={() => { setResult(null); setLook(null); }}>Start over</button>}
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
