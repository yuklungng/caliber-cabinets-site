import { useEffect, useMemo, useRef, useState } from 'react';

// Read-only job list for the Production module. Data comes from the tidy tables the sheet sync fills
// (/api/admin-settings?resource=production&action=jobs); nothing on this screen can change a sheet or a record.
// It only renders when the server reports PRODUCTION_MODULE_ENABLED and the user is a super admin.
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

function JobCard({ job, open, onToggle }) {
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
                    {o.parts.map((p, j) => <div key={j}>{p}</div>)}
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

export default function ProductionView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [section, setSection] = useState('all');
  const [sortKey, setSortKey] = useState('newest');
  const [openId, setOpenId] = useState(null);
  const scrollTimer = useRef(null);

  useEffect(() => {
    fetch('/api/admin-settings?resource=production&action=jobs', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message));
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
      && (!q || `${j.name} ${j.jobRef} ${sectionLabel(j.section)}`.toLowerCase().includes(q))
    ));
  }, [ordered, searchQuery, section]);

  // Up to 6 jobs matching the search, from every section, like the Leads suggestions.
  const suggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return ordered.filter((j) => `${j.name} ${j.jobRef}`.toLowerCase().includes(q)).slice(0, 6);
  }, [ordered, searchQuery]);

  function selectSuggestion(job) {
    setSearchQuery(job.name || job.jobRef);
    setSection('all');
    setOpenId(job.id);
    setSearchFocused(false);
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      document.getElementById(`production-job-${job.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  function handleReset() {
    setSearchQuery('');
    setSection('all');
    setSortKey('newest');
    setOpenId(null);
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? 'Sort';
  const isFiltered = Boolean(searchQuery.trim()) || section !== 'all';

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
                <JobCard key={j.id} job={j} open={openId === j.id} onToggle={() => setOpenId(openId === j.id ? null : j.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
