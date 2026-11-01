import { useEffect, useMemo, useState } from 'react';

// Read-only job list for the Production module. Data comes from the tidy tables the sheet sync fills
// (/api/admin-settings?resource=production&action=jobs); nothing on this screen can change a sheet or a record.
// It only renders when the server reports PRODUCTION_MODULE_ENABLED and the user is a super admin.

const authHeaders = () => ({ Authorization: `Bearer ${sessionStorage.getItem('admin_token') ?? ''}` });

const fmtDate = (iso, text) => {
  if (iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return text ?? '';
};

const sectionLabel = (s) => (s ? s.trim() : 'No section');

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

function JobCard({ job, open, onToggle }) {
  const nextEvent = job.installs.find((e) => (e.installOn ?? e.deliveryOn) && !e.completed) ?? job.installs[job.installs.length - 1];
  const nextWhen = nextEvent && (nextEvent.installOn || nextEvent.installText || nextEvent.deliveryOn || nextEvent.deliveryText);
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', marginBottom: '10px' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '12px 14px', cursor: 'pointer', minHeight: '44px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
          <strong style={{ fontSize: '15px', color: '#111827', wordBreak: 'break-word' }}>{job.name || job.jobRef}</strong>
          <span
            title={job.isTemp ? 'No invoice number yet: temporary label' : 'QuickBooks invoice number'}
            style={{
              fontSize: '11px', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap',
              background: job.isTemp ? '#fef3c7' : '#e5e7eb', color: job.isTemp ? '#92400e' : '#374151',
            }}
          >
            {job.jobRef}
          </span>
        </div>
        <div style={{ margin: '8px 0 4px' }}><Progress done={job.stepsDone} total={job.stepsTotal} /></div>
        <div style={{ fontSize: '12px', color: '#6b7280', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          <span>{sectionLabel(job.section)}</span>
          {nextWhen && <span>{(nextEvent.installOn || nextEvent.installText) ? 'Install' : 'Delivery'}: {fmtDate(nextEvent.installOn ?? nextEvent.deliveryOn, nextEvent.installText ?? nextEvent.deliveryText)}</span>}
          {job.hardwareOrders > 0 && <span>Hardware orders: {job.hardwareOrders}</span>}
        </div>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid #f3f4f6', padding: '10px 14px 12px', display: 'grid', gap: '4px' }}>
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
          <Line label="Hardware">{job.hardwareOrders ? `${job.hardwareOrders} order${job.hardwareOrders === 1 ? '' : 's'}${job.lastHardwareOrderOn ? `, latest ${fmtDate(job.lastHardwareOrderOn)}` : ''}` : ''}</Line>
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

export default function ProductionView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('all');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    fetch('/api/admin-settings?resource=production&action=jobs', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const sections = useMemo(() => {
    const seen = new Map();
    for (const j of data?.jobs ?? []) {
      const key = sectionLabel(j.section);
      if (!seen.has(key)) seen.set(key, j.rowNumber ?? 0);
    }
    return [...seen.keys()];
  }, [data]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.jobs ?? []).filter((j) => (
      (section === 'all' || sectionLabel(j.section) === section)
      && (!q || `${j.name} ${j.jobRef}`.toLowerCase().includes(q))
    ));
  }, [data, query, section]);

  const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '16px', border: '1px solid #d1d5db', borderRadius: '8px', background: '#fff' };

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '16px' }}>
      <h2 style={{ margin: '0 0 4px', color: '#78350f' }}>Production</h2>
      <p style={{ margin: '0 0 12px', color: '#6b7280', fontSize: '13px' }}>
        Read-only view of a copy of the production sheets{data ? ` (${data.mode} tables)` : ''}. Changes still go in the Google Sheets.
      </p>
      {error && <p style={{ color: '#b91c1c' }}>Could not load jobs: {error}</p>}
      {!data && !error && <p style={{ color: '#6b7280' }}>{'Loading jobs…'}</p>}
      {data && (
        <>
          <div style={{ display: 'grid', gap: '8px', margin: '0 0 12px' }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search job name or number"
              aria-label="Search jobs"
              style={field}
            />
            <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section" style={field}>
              <option value="all">All sections ({data.jobs.length})</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>
            {shown.length} job{shown.length === 1 ? '' : 's'}, in the sheet's order. Progress counts the step boxes ticked on the sheet.
          </p>
          {shown.map((j) => (
            <JobCard key={j.id} job={j} open={openId === j.id} onToggle={() => setOpenId(openId === j.id ? null : j.id)} />
          ))}
          {shown.length === 0 && <p style={{ color: '#6b7280' }}>No jobs match.</p>}
        </>
      )}
    </div>
  );
}
