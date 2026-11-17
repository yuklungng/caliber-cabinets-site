import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, jobTouchesYear, mondayOf, todayIso, weekDays } from './weekSchedule.js';
import { UNUSUAL_QTY, daysBefore, flattenOrders, isReceived, ordersSince, qtyToCheck, searchParts } from './partsIndex.js';

// Job list for the Production module. Data comes from the tidy tables the sheet sync fills
// (/api/admin-settings?resource=production&action=jobs). Two things can be edited: a hardware order's part list
// (qty and name, saved to dev_hardware_parts) and a job's HubSpot deal link (saved to dev_job_links). Nothing on
// this screen can change a sheet, a deal, an invoice or any other record.
// It only renders when the server reports PRODUCTION_MODULE_ENABLED and the user is a super admin.
// A "This week" tab lists the week's deliveries and installs by day (read-only, from the schedule dates).
// A "Parts" tab lists hardware orders across jobs, newest first, with a part search (read-only).
// The toolbar (search with suggestions, sort button, Reset, "(filtered)" count) follows Leads and Financial.

const authHeaders = () => ({ Authorization: `Bearer ${sessionStorage.getItem('admin_token') ?? ''}` });

// The sheet runs oldest to newest from top to bottom, so "newest first" is its order reversed.
const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'sheet', label: 'Sheet order' },
];

const fmtDate = (iso, text) => {
  if (iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return text ?? '';
};

const sectionLabel = (s) => (s ? s.trim() : 'No section');

const controlStyle = { padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' };

function Progress({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title={`${done} of ${total} steps checked`}>
      <div style={{ flex: 1, height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#b45309' }} />
      </div>
      <span style={{ fontSize: '12px', color: '#6b7280', minWidth: '34px', textAlign: 'right' }}>{done}/{total}</span>
    </div>
  );
}

function Line({ label, children }) {
  if (!children) return null;
  return (
    <div style={{ display: 'flex', gap: '8px', fontSize: '13px', lineHeight: 1.5 }}>
      <span style={{ color: '#6b7280', minWidth: '96px' }}>{label}</span>
      <span style={{ color: '#111827' }}>{children}</span>
    </div>
  );
}

function RefBadge({ job }) {
  return (
    <span
      title={job.isTemp ? 'No invoice number yet: temporary label' : 'QuickBooks invoice number'}
      style={{
        fontSize: '11px', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap',
        background: job.isTemp ? '#fef3c7' : '#e5e7eb', color: job.isTemp ? '#92400e' : '#374151',
      }}
    >
      {job.jobRef}
    </span>
  );
}

const smallBtn = { padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', color: '#374151', fontSize: '12px', fontWeight: '600', cursor: 'pointer', minHeight: '32px' };
const fieldStyle = { padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', minHeight: '32px' };

// Amber marker on a quantity over UNUSUAL_QTY that nobody has checked. Saving the part (changed or not) clears it.
function CheckQty() {
  return (
    <span
      title={`Over ${UNUSUAL_QTY}: the photo reader may have joined the size to the quantity. Tap the part on the job card and save it (corrected or as is) to clear this.`}
      style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap', marginLeft: '6px' }}
    >
      check qty
    </span>
  );
}

// One hardware order's parts, each editable in place: tap a part to change its quantity or name, or remove it.
// Saves go to dev_hardware_parts only (the sheet is never touched). An order whose parts have not been
// through the normalize step yet has no ids and is shown read-only.
function PartsList({ order, onChange }) {
  const [editing, setEditing] = useState(null); // a part id, 'new', or null
  const [draft, setDraft] = useState({ qty: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const editable = Boolean(order.id) && order.parts.every((p) => p.id);

  async function call(action, body) {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/admin-settings?resource=production&action=${action}`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Status ${r.status}`);
      return j;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }

  const start = (p) => { setErr(''); setEditing(p ? p.id : 'new'); setDraft({ qty: p?.qty ?? '', name: p?.name ?? '' }); };

  async function save() {
    const body = { qty: draft.qty === '' ? null : Number(draft.qty), name: draft.name };
    const j = await call('part-save', editing === 'new' ? { ...body, orderId: order.id } : { ...body, id: editing });
    if (!j) return;
    onChange((parts) => (editing === 'new' ? [...parts, j.part] : parts.map((p) => (p.id === j.part.id ? j.part : p))));
    setEditing(null);
  }

  async function remove() {
    const j = await call('part-remove', { id: editing });
    if (!j) return;
    onChange((parts) => parts.filter((p) => p.id !== editing));
    setEditing(null);
  }

  const form = (
    <div style={{ margin: '4px 0', padding: '8px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <input
          type="number" inputMode="numeric" min="0" max="9999" placeholder="Qty" aria-label="Quantity"
          value={draft.qty} onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))}
          style={{ ...fieldStyle, width: '64px' }}
        />
        <input
          type="text" placeholder="Part name" aria-label="Part name" maxLength={200}
          value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
        />
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" disabled={busy || !draft.name.trim()} onClick={save} style={{ ...smallBtn, background: '#78350f', color: '#fff', borderColor: '#78350f' }}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={busy} onClick={() => setEditing(null)} style={smallBtn}>Cancel</button>
        {editing !== 'new' && <button type="button" disabled={busy} onClick={remove} style={{ ...smallBtn, color: '#b91c1c' }}>Remove</button>}
      </div>
      {err && <div style={{ color: '#b91c1c', fontSize: '12px', marginTop: '6px' }}>{err}</div>}
    </div>
  );

  return (
    <div>
      {order.parts.map((p, j) => (editing === p.id ? <div key={p.id ?? j}>{form}</div> : (
        <div
          key={p.id ?? j}
          onClick={editable && editing === null ? () => start(p) : undefined}
          style={{ display: 'flex', gap: '8px', padding: '2px 0', cursor: editable ? 'pointer' : 'default' }}
        >
          <span style={{ minWidth: '28px', textAlign: 'right', fontWeight: '600', color: p.qty === null ? '#9ca3af' : '#374151' }}>{p.qty ?? '–'}</span>
          <span>
            {p.name}
            {p.fromNotes && <span style={{ color: '#9ca3af', fontSize: '11px' }}> (from notes)</span>}
            {p.edited && <span style={{ color: '#9ca3af', fontSize: '11px' }}> (edited)</span>}
            {qtyToCheck(p) && <CheckQty />}
          </span>
        </div>
      )))}
      {editable && editing === 'new' && form}
      {editable && editing === null && (
        <button type="button" onClick={() => start(null)} style={{ ...smallBtn, marginTop: '6px' }}>+ Add part</button>
      )}
      {editable && editing === null && err && <div style={{ color: '#b91c1c', fontSize: '12px', marginTop: '6px' }}>{err}</div>}
    </div>
  );
}

const weekLabel = (start) => {
  const f = (iso, o) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', o); };
  return `${f(start, { month: 'short', day: 'numeric' })} – ${f(addDays(start, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;
};

// Deliveries and installs for one Monday-to-Sunday week, read from the schedule dates on the sheet. Tapping a job opens it in the list.
function WeekView({ jobs, onOpenJob }) {
  const today = todayIso();
  const thisMonday = mondayOf(today);
  const [start, setStart] = useState(thisMonday);
  const days = useMemo(() => weekDays(jobs, start), [jobs, start]);
  const total = days.reduce((n, d) => n + d.items.length, 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setStart(addDays(start, -7))} style={controlStyle} aria-label="Previous week">‹</button>
        <strong style={{ flex: 1, textAlign: 'center', fontSize: '14px', color: '#111827', minWidth: '180px' }}>{weekLabel(start)}</strong>
        <button type="button" onClick={() => setStart(addDays(start, 7))} style={controlStyle} aria-label="Next week">›</button>
        <button type="button" onClick={() => setStart(thisMonday)} disabled={start === thisMonday} style={{ ...controlStyle, opacity: start === thisMonday ? 0.5 : 1 }}>This week</button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#9ca3af' }}>
        {total} scheduled. Only rows with a real date on the Install Schedule sheet show here; rows with free text such as "TBD" are in the job lists.
      </p>
      <div style={{ display: 'grid', gap: '8px' }}>
        {days.map((d) => {
          const [y, m, dd] = d.date.split('-').map(Number);
          const label = new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          const isToday = d.date === today;
          return (
            <div key={d.date} style={{ background: '#fff', border: isToday ? '1px solid #78350f' : '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 14px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: isToday ? '#78350f' : '#374151', marginBottom: d.items.length ? '6px' : 0 }}>
                {label}{isToday ? ' · today' : ''}
                {!d.items.length && <span style={{ fontWeight: '400', color: '#9ca3af' }}> · nothing scheduled</span>}
              </div>
              {d.items.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onOpenJob(it.jobId)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderTop: i ? '1px solid #f3f4f6' : 0, padding: '8px 0', cursor: 'pointer', minHeight: '44px', opacity: it.completed ? 0.6 : 1 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '14px', color: '#111827', wordBreak: 'break-word' }}>
                      <strong>{it.kind}</strong> · {it.jobName}
                    </span>
                    <RefBadge job={{ jobRef: it.jobRef, isTemp: it.isTemp }} />
                  </div>
                  {(it.details || it.confirmed || it.completed) && (
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                      {[it.details, it.confirmed && 'confirmed', it.completed && 'completed'].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Payment stage chips, same colours as Financial Management.
const STATUS_STYLE = {
  Paid: { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  'Partially Paid': { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  Invoiced: { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' },
  Pending: { background: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb' },
};

function StageChips({ stages }) {
  if (!stages?.length) return <div style={{ fontSize: '12px', color: '#9ca3af' }}>No payment schedule for this deal yet.</div>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {stages.map((s) => (
        <span key={s.stage} style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '999px', ...(STATUS_STYLE[s.status] ?? STATUS_STYLE.Pending) }}>
          {s.label}: {s.status}
        </span>
      ))}
    </div>
  );
}

// HubSpot deal names start with the form they came from ("Design Consultation – Peter & Deme"); the client is what matters here.
const shortDealName = (name) => String(name ?? '').replace(/^(Design Consultation|Trade Estimate|Estimate Request)\s*[–-]\s*/i, '').trim();
// A timestamp shown as the viewer's local date (slicing the UTC string shows tomorrow's date in the evening).
const fmtStamp = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const dealLine = (l) => [shortDealName(l.name) || `Deal ${l.dealId}`, l.room, l.invoiceNumber && `Invoice #${l.invoiceNumber}`].filter(Boolean).join(' · ');

// Picker options are the same for every job, so they are fetched once per page load.
let candidatesPromise = null;
function loadCandidates() {
  candidatesPromise ??= fetch('/api/admin-settings?resource=production&action=link-candidates', { headers: authHeaders() })
    .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || `Status ${r.status}`)))))
    .catch((e) => { candidatesPromise = null; throw e; });
  return candidatesPromise;
}

function DealPicker({ onPick, onCancel, busy }) {
  const [options, setOptions] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    loadCandidates().then((d) => setOptions(d.options ?? [])).catch((e) => setErr(e.message));
  }, []);
  const needle = q.trim().toLowerCase();
  const shown = (options ?? []).filter((o) => `${o.name} ${o.room ?? ''} ${o.invoiceNumber ?? ''}`.toLowerCase().includes(needle)).slice(0, 30);
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px', marginTop: '6px' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
        <input type="search" autoFocus placeholder="Search won deals by name or invoice #" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...fieldStyle, flex: 1, minWidth: 0 }} aria-label="Search deals" />
        <button type="button" onClick={onCancel} style={smallBtn}>Cancel</button>
      </div>
      {err && <div style={{ fontSize: '12px', color: '#b91c1c' }}>Could not load deals: {err}</div>}
      {!options && !err && <div style={{ fontSize: '12px', color: '#6b7280' }}>{'Loading deals…'}</div>}
      {options && shown.length === 0 && <div style={{ fontSize: '12px', color: '#6b7280' }}>No won deal matches.</div>}
      <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
        {shown.map((o) => (
          <button
            key={`${o.dealId}|${o.room ?? ''}`}
            type="button"
            disabled={busy}
            onClick={() => onPick(o)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 0, borderBottom: '1px solid #f3f4f6', background: '#fff', cursor: 'pointer', fontSize: '13px', minHeight: '40px' }}
          >
            <div style={{ fontWeight: '600', color: '#111827' }}>{shortDealName(o.name)}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              {[o.room, o.invoiceNumber ? `Invoice #${o.invoiceNumber}` : 'No invoice linked yet', o.closedAt && `won ${fmtStamp(o.closedAt)}`].filter(Boolean).join(' · ')}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// The job's HubSpot deal and its payment status. Links are saved to dev_job_links only.
function DealPanel({ job, onLinked }) {
  const link = job.link ?? { state: 'unlinked' };
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function decide(decision, target, basis) {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/admin-settings?resource=production&action=link-decide', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobRef: job.jobRef, dealId: target.dealId, room: target.room ?? null, decision, basis }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Status ${r.status}`);
      setPicking(false);
      await onLinked();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const primaryBtn = { ...smallBtn, background: '#78350f', color: '#fff', borderColor: '#78350f' };
  return (
    <div style={{ border: '1px solid #f3f4f6', borderRadius: '6px', padding: '8px 10px', margin: '0 0 8px', display: 'grid', gap: '6px' }}>
      <div style={{ fontSize: '12px', fontWeight: '600', color: '#78350f' }}>Deal</div>
      {link.state === 'linked' && (
        <>
          <div style={{ fontSize: '13px', color: '#111827' }}>{dealLine(link)}</div>
          <StageChips stages={link.stages} />
          <div style={{ fontSize: '11px', color: '#9ca3af' }}>
            Linked{link.decidedBy ? ` by ${link.decidedBy}` : ''}{link.decidedAt ? ` on ${fmtStamp(link.decidedAt)}` : ''}{link.basis === 'invoice number' ? ' (invoice number matched)' : ''}
          </div>
          {!picking && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" style={smallBtn} disabled={busy} onClick={() => setPicking(true)}>Change deal</button>
              <button type="button" style={smallBtn} disabled={busy} onClick={() => decide('unlink', link, link.basis)}>Unlink</button>
            </div>
          )}
        </>
      )}
      {link.state === 'suggested' && (
        <>
          <div style={{ fontSize: '13px', color: '#111827' }}>
            <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', marginRight: '6px' }}>Suggested</span>
            {dealLine(link)}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>The job number matches this deal&apos;s invoice in Financial Management.</div>
          <StageChips stages={link.stages} />
          {!picking && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" style={primaryBtn} disabled={busy} onClick={() => decide('confirm', link, 'invoice number')}>Confirm</button>
              <button type="button" style={smallBtn} disabled={busy} onClick={() => decide('reject', link, 'invoice number')}>Not this one</button>
              <button type="button" style={smallBtn} disabled={busy} onClick={() => setPicking(true)}>Pick another deal</button>
            </div>
          )}
        </>
      )}
      {link.state === 'unlinked' && !picking && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>No deal linked.</span>
          <button type="button" style={smallBtn} disabled={busy} onClick={() => setPicking(true)}>Link to a deal</button>
        </div>
      )}
      {picking && <DealPicker busy={busy} onCancel={() => setPicking(false)} onPick={(o) => decide('confirm', o, 'manual')} />}
      {err && <div style={{ fontSize: '12px', color: '#b91c1c' }}>{err}</div>}
    </div>
  );
}

function JobCard({ job, open, onToggle, onParts, onLinked }) {
  const nextEvent = job.installs.find((e) => (e.installOn ?? e.deliveryOn) && !e.completed) ?? job.installs[job.installs.length - 1];
  const nextWhen = nextEvent && (nextEvent.installOn || nextEvent.installText || nextEvent.deliveryOn || nextEvent.deliveryText);
  return (
    <div id={`production-job-${job.id}`} style={{ background: '#fff', border: open ? '1px solid #78350f' : '1px solid #e5e7eb', borderRadius: '10px' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '12px 14px', cursor: 'pointer', minHeight: '44px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
          <strong style={{ fontSize: '15px', color: '#111827', wordBreak: 'break-word' }}>{job.name || job.jobRef}</strong>
          <RefBadge job={job} />
        </div>
        <div style={{ margin: '8px 0 4px' }}><Progress done={job.stepsDone} total={job.stepsTotal} /></div>
        <div style={{ fontSize: '12px', color: '#6b7280', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          <span>{sectionLabel(job.section)}</span>
          {nextWhen && <span>{(nextEvent.installOn || nextEvent.installText) ? 'Install' : 'Delivery'}: {fmtDate(nextEvent.installOn ?? nextEvent.deliveryOn, nextEvent.installText ?? nextEvent.deliveryText)}</span>}
          {job.hardwareOrders > 0 && <span>Hardware orders: {job.hardwareOrders}</span>}
          {job.link?.state === 'linked' && <span style={{ color: '#15803d' }}>Deal: {shortDealName(job.link.name) || 'linked'}</span>}
          {job.link?.state === 'suggested' && <span style={{ color: '#92400e' }}>Deal suggested</span>}
        </div>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid #f3f4f6', padding: '10px 14px 12px', display: 'grid', gap: '4px' }}>
          <DealPanel job={job} onLinked={onLinked} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '0 0 6px' }}>
            {Object.entries(job.steps).map(([k, v]) => (
              <span key={k} style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '999px', background: v ? '#dcfce7' : '#f3f4f6', color: v ? '#166534' : '#6b7280' }}>
                {v ? '✓ ' : ''}{k}
              </span>
            ))}
          </div>
          <Line label="Paint / stain">{job.paintColor}</Line>
          <Line label="PVC tape">{job.pvcTapeColor}</Line>
          <Line label="Paint ordered">{job.paintOrdered === null ? '' : job.paintOrdered ? 'Yes' : 'No'}</Line>
          <Line label="Paint arrives">{fmtDate(job.paintArrives.on, job.paintArrives.text)}</Line>
          <Line label="Doors arrive">{fmtDate(job.doorsArrive.on, job.doorsArrive.text)}</Line>
          {job.hardware.length > 0 && (
            <div style={{ margin: '6px 0 2px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#78350f', marginBottom: '4px' }}>
                Hardware orders ({job.hardware.length})
              </div>
              {job.hardware.map((o, i) => {
                const received = fmtDate(o.receivedOn, o.receivedText);
                return (
                  <div key={i} style={{ border: '1px solid #f3f4f6', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px', fontSize: '13px', color: '#374151' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: '12px', color: '#6b7280', marginBottom: o.parts.length || o.notes ? '4px' : 0 }}>
                      <span>Ordered: {fmtDate(o.orderedOn, o.orderedText) || 'no date'}</span>
                      <span>{received ? `Received: ${received}` : 'Not marked received'}</span>
                      {o.status && <span>Status: {o.status}</span>}
                    </div>
                    {o.photoUrl && (
                      <div style={{ margin: '0 0 4px' }}>
                        <a href={o.photoUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#b45309' }}>View photo</a>
                      </div>
                    )}
                    <PartsList order={o} onChange={(fn) => onParts(i, fn)} />
                    {o.notes && <div style={{ marginTop: '4px', fontSize: '12px', color: '#6b7280' }}>Notes: {o.notes}</div>}
                  </div>
                );
              })}
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>Parts are read from the sheet photos and may contain misread text.</div>
            </div>
          )}
          {job.installs.map((e, i) => (
            <Line key={i} label={e.details || 'Schedule'}>
              {[
                (e.deliveryOn || e.deliveryText) && `delivery ${fmtDate(e.deliveryOn, e.deliveryText)}`,
                (e.installOn || e.installText) && `install ${fmtDate(e.installOn, e.installText)}`,
                e.confirmed && 'confirmed',
                e.completed && 'completed',
              ].filter(Boolean).join(' · ')}
            </Line>
          ))}
        </div>
      )}
    </div>
  );
}

// Parts tab: every hardware order across jobs (newest first) and a part search. Read-only; parts are edited
// on the job card. Tapping a job name opens that job in the Jobs list.
const PARTS_RANGES = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
  { key: 'all', label: 'All orders', days: null },
];
const PARTS_SHOWN = 100;

function ReceivedChip({ order }) {
  const got = isReceived(order);
  const when = fmtDate(order.receivedOn, order.receivedText);
  return (
    <span
      title={got ? 'Marked received on the hardware sheet' : 'The sheet has no received date for this order (not tracked since 2021)'}
      style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', ...(got ? { background: '#f0fdf4', color: '#15803d' } : { background: '#f3f4f6', color: '#6b7280' }) }}
    >
      {got ? `Received${when ? ` ${when}` : ''}` : 'Receipt not recorded'}
    </span>
  );
}

const jobLinkStyle = { background: 'none', border: 0, padding: 0, color: '#78350f', fontWeight: '600', fontSize: '13px', cursor: 'pointer', textAlign: 'left', textDecoration: 'underline' };

// A job name that opens the job, or, for an order that matches no job, its own label marked as such.
function JobName({ order, onOpenJob }) {
  if (order.jobId) return <button type="button" style={jobLinkStyle} onClick={() => onOpenJob(order.jobId)}>{order.jobName}</button>;
  return (
    <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
      {order.jobName}
      <span title="This order's job name or number does not match a job on the Production Status sheet (orders from before 2019 never will)." style={{ fontSize: '11px', padding: '1px 5px', borderRadius: '4px', background: '#f3f4f6', color: '#6b7280', marginLeft: '6px', fontWeight: '400' }}>no matching job</span>
    </span>
  );
}

function PartsView({ jobs, orphans, onOpenJob }) {
  const [range, setRange] = useState('365');
  const [q, setQ] = useState('');
  const [showOrphans, setShowOrphans] = useState(true);
  const all = useMemo(() => flattenOrders(jobs, showOrphans ? orphans : []), [jobs, orphans, showOrphans]);
  const orphanCount = orphans?.length ?? 0;
  const days = PARTS_RANGES.find((r) => r.key === range)?.days ?? null;
  const since = days ? daysBefore(todayIso(), days) : null;
  const orders = useMemo(() => ordersSince(all, since), [all, since]);
  const found = useMemo(() => searchParts(orders, q), [orders, q]);
  const searching = Boolean(q.trim());

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Find a part (e.g. hinge, slide, pull)"
          aria-label="Find a part"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: '1 1 100%', padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
        />
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          aria-label="Order date range"
          style={{ ...controlStyle, padding: '7px 30px 7px 12px', appearance: 'auto' }}
        >
          {PARTS_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {orphanCount > 0 && (
          <label style={{ fontSize: '12px', color: '#374151', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} />
            Include orders with no matching job ({orphanCount})
          </label>
        )}
        <span style={{ fontSize: '12px', color: '#6b7280' }}>
          {searching
            ? `${found.lines.length} part line${found.lines.length === 1 ? '' : 's'} on ${found.jobs} job${found.jobs === 1 ? '' : 's'}${found.noJob ? ` (+${found.noJob} with no matching job)` : ''}${found.lines.length ? ` · total qty ${found.totalQty}${found.uncounted ? ` (+${found.uncounted} with no qty)` : ''}${found.toCheck ? ` · includes ${found.toCheck} to check` : ''}` : ''}`
            : `${orders.length} hardware order${orders.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {searching && (
        <div style={{ display: 'grid', gap: '6px' }}>
          {found.lines.length === 0 && <p style={{ color: '#6b7280', fontSize: '13px' }}>No part matches in this date range. Try All orders, or fewer words.</p>}
          {found.lines.slice(0, PARTS_SHOWN).map((l, i) => (
            <div key={`${l.order.key}:${i}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', display: 'grid', gap: '2px' }}>
              <div style={{ fontSize: '14px', color: '#111827' }}><strong>{l.qty ?? '?'}</strong> × {l.name}{l.check && <CheckQty />}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', fontSize: '12px', color: '#6b7280' }}>
                <JobName order={l.order} onOpenJob={onOpenJob} />
                <span>Ordered {fmtDate(l.order.orderedOn, l.order.orderedText) || 'no date'}</span>
                <ReceivedChip order={l.order} />
              </div>
            </div>
          ))}
          {found.lines.length > PARTS_SHOWN && <p style={{ color: '#6b7280', fontSize: '12px' }}>Showing the newest {PARTS_SHOWN}. Add a word to narrow the search.</p>}
        </div>
      )}

      {!searching && (
        <div style={{ display: 'grid', gap: '8px' }}>
          {orders.length === 0 && <p style={{ color: '#6b7280', fontSize: '13px' }}>No hardware orders in this date range.</p>}
          {orders.slice(0, PARTS_SHOWN).map((o) => (
            <div key={o.key} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <JobName order={o} onOpenJob={onOpenJob} />
                <span style={{ fontSize: '12px', color: '#6b7280' }}>Ordered {fmtDate(o.orderedOn, o.orderedText) || 'no date'}</span>
              </div>
              <div style={{ margin: '6px 0', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <ReceivedChip order={o} />
                {o.photoUrl && <a href={o.photoUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#b45309' }}>View photo</a>}
              </div>
              {o.parts.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#374151' }}>
                  {o.parts.map((p, i) => <li key={p.id ?? i}>{p.qty ?? '?'} × {p.name}{qtyToCheck(p) && <CheckQty />}</li>)}
                </ul>
              ) : <div style={{ fontSize: '12px', color: '#9ca3af' }}>No parts read from this order.</div>}
              {o.notes && <div style={{ marginTop: '4px', fontSize: '12px', color: '#6b7280' }}>Notes: {o.notes}</div>}
            </div>
          ))}
          {orders.length > PARTS_SHOWN && <p style={{ color: '#6b7280', fontSize: '12px' }}>Showing the newest {PARTS_SHOWN} of {orders.length}. Use a shorter range or search for a part.</p>}
          <div style={{ fontSize: '11px', color: '#9ca3af' }}>Parts are read from the sheet photos and may contain misread text. Edit them on the job card.</div>
        </div>
      )}
    </div>
  );
}

export default function ProductionView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [section, setSection] = useState('all');
  const [sortKey, setSortKey] = useState('newest');
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState('jobs'); // 'jobs' | 'week' | 'parts'
  const [thisYear, setThisYear] = useState(false); // only jobs with a real date in the current year
  const [dealFilter, setDealFilter] = useState('all'); // 'all' | 'linked' | 'suggested' | 'unlinked'
  const year = new Date().getFullYear();
  const scrollTimer = useRef(null);

  // Reloaded after a deal link changes, so suggestions and payment status stay in step with the server.
  const loadJobs = () => fetch('/api/admin-settings?resource=production&action=jobs', { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`))))
    .then(setData)
    .catch((e) => setError(e.message));

  useEffect(() => {
    loadJobs();
    return () => clearTimeout(scrollTimer.current);
  }, []);

  // Jobs in the chosen order. The API sends them in sheet order.
  const ordered = useMemo(() => {
    const jobs = data?.jobs ?? [];
    return sortKey === 'newest' ? [...jobs].reverse() : jobs;
  }, [data, sortKey]);

  const sections = useMemo(() => [...new Set(ordered.map((j) => sectionLabel(j.section)))], [ordered]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ordered.filter((j) => (
      (section === 'all' || sectionLabel(j.section) === section)
      && (!thisYear || jobTouchesYear(j, year))
      && (dealFilter === 'all' || (j.link?.state ?? 'unlinked') === dealFilter)
      && (!q || `${j.name} ${j.jobRef} ${sectionLabel(j.section)}`.toLowerCase().includes(q))
    ));
  }, [ordered, searchQuery, section, thisYear, year, dealFilter]);

  const yearCount = useMemo(() => ordered.filter((j) => jobTouchesYear(j, year)).length, [ordered, year]);
  const dealCounts = useMemo(() => {
    const c = { linked: 0, suggested: 0, unlinked: 0 };
    for (const j of ordered) c[j.link?.state ?? 'unlinked'] += 1;
    return c;
  }, [ordered]);

  // Up to 6 jobs matching the search, from every section, like the Leads suggestions.
  const suggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return ordered.filter((j) => `${j.name} ${j.jobRef}`.toLowerCase().includes(q)).slice(0, 6);
  }, [ordered, searchQuery]);

  function selectSuggestion(job) {
    setSearchQuery(job.name || job.jobRef);
    openJob(job.id);
  }

  // Shows one job open in the list, scrolled into view (used by search suggestions and the week view).
  function openJob(id) {
    setView('jobs');
    setSection('all');
    setOpenId(id);
    setSearchFocused(false);
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      document.getElementById(`production-job-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  // Applies a saved edit to the loaded list, so the screen updates without reloading every job.
  function updateParts(jobId, orderIdx, fn) {
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) => (j.id !== jobId ? j : {
        ...j, hardware: j.hardware.map((o, i) => (i !== orderIdx ? o : { ...o, parts: fn(o.parts) })),
      })),
    }));
  }

  function handleReset() {
    setSearchQuery('');
    setSection('all');
    setThisYear(false);
    setDealFilter('all');
    setSortKey('newest');
    setOpenId(null);
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? 'Sort';
  const isFiltered = Boolean(searchQuery.trim()) || section !== 'all' || thisYear || dealFilter !== 'all';

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '16px' }}>
      <h2 style={{ margin: '0 0 4px', color: '#78350f' }}>Production</h2>
      <p style={{ margin: '0 0 12px', color: '#6b7280', fontSize: '13px' }}>
        A copy of the production sheets{data ? ` (${data.mode} tables)` : ''}. Only hardware part lists and deal links can be changed here; all other changes still go in the Google Sheets.
      </p>
      {error && <p style={{ color: '#b91c1c' }}>Could not load jobs: {error}</p>}
      {data?.linkError && <p style={{ color: '#b45309', fontSize: '13px' }}>Deal links could not be loaded, so jobs show without them. ({data.linkError})</p>}
      {!data && !error && <p style={{ color: '#6b7280' }}>{'Loading jobs…'}</p>}
      {data && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {[['jobs', 'Jobs'], ['week', 'This week'], ['parts', 'Parts']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              style={{ ...controlStyle, ...(view === key ? { background: '#78350f', color: '#fff', borderColor: '#78350f' } : {}) }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {data && view === 'week' && <WeekView jobs={data.jobs} onOpenJob={openJob} />}
      {data && view === 'parts' && <PartsView jobs={data.jobs} orphans={data.orphanOrders ?? []} onOpenJob={openJob} />}
      {data && view === 'jobs' && (
        <>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              aria-label="Section"
              style={{ ...controlStyle, padding: '7px 30px 7px 12px', flexShrink: 0, appearance: 'auto', maxWidth: '100%' }}
            >
              <option value="all">All Sections ({data.jobs.length})</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <button
              type="button"
              onClick={() => setThisYear((v) => !v)}
              aria-pressed={thisYear}
              disabled={!yearCount}
              title={yearCount ? `Only jobs with an install, delivery, paint, doors or hardware date in ${year}` : `No job has a date in ${year}`}
              style={{ ...controlStyle, flexShrink: 0, whiteSpace: 'nowrap', opacity: yearCount ? 1 : 0.5, ...(thisYear ? { background: '#78350f', color: '#fff', borderColor: '#78350f' } : {}) }}
            >
              This year ({yearCount})
            </button>

            <select
              value={dealFilter}
              onChange={(e) => setDealFilter(e.target.value)}
              aria-label="Deal link"
              style={{ ...controlStyle, padding: '7px 30px 7px 12px', flexShrink: 0, appearance: 'auto', maxWidth: '100%' }}
            >
              <option value="all">Any deal link</option>
              <option value="suggested">Deal suggested ({dealCounts.suggested})</option>
              <option value="linked">Deal linked ({dealCounts.linked})</option>
              <option value="unlinked">No deal ({dealCounts.unlinked})</option>
            </select>

            {/* Search with suggestions */}
            <div style={{ flex: '1 1 100%', order: -1, position: 'relative' }}>
              <input
                type="search"
                placeholder="Search jobs"
                aria-label="Search jobs"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchFocused(true); }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                style={{ width: '100%', padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
              />
              {searchFocused && suggestions.length > 0 && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, overflow: 'hidden' }}>
                  {suggestions.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectSuggestion(job); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '10px 14px', border: 0, borderBottom: '1px solid #f3f4f6', background: '#fff', cursor: 'pointer' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.name || job.jobRef}</div>
                        <div style={{ fontSize: '12px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sectionLabel(job.section)}</div>
                      </div>
                      <RefBadge job={job} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSortKey((k) => SORT_OPTIONS[(SORT_OPTIONS.findIndex((o) => o.key === k) + 1) % SORT_OPTIONS.length].key)}
              title={`Sort: ${sortLabel} — click to cycle`}
              style={{ ...controlStyle, flexShrink: 0, whiteSpace: 'nowrap', width: '120px', textAlign: 'center' }}
            >
              {sortLabel}
            </button>

            <button type="button" onClick={handleReset} style={controlStyle}>Reset</button>
          </div>

          <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#9ca3af' }}>
            {filtered.length} job{filtered.length !== 1 ? 's' : ''}{isFiltered ? ' (filtered)' : ''}. Progress counts the step boxes ticked on the sheet.
          </p>

          {data.jobs.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #e5e7eb' }}>
              No jobs yet. They appear here once the sheet sync has filled the tables.
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #e5e7eb' }}>
              No jobs match{searchQuery.trim() ? ` "${searchQuery}"` : ''}.{' '}
              <button type="button" onClick={handleReset} style={{ background: 'none', border: 0, color: '#78350f', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px', padding: 0 }}>Clear search</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {filtered.map((j) => (
                <JobCard key={j.id} job={j} open={openId === j.id} onToggle={() => setOpenId(openId === j.id ? null : j.id)} onParts={(orderIdx, fn) => updateParts(j.id, orderIdx, fn)} onLinked={loadJobs} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
