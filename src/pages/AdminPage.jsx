import { useEffect, useState } from 'react';

const FIELD_LABELS = {
  firstName: 'First Name',
  lastName: 'Last Name',
  phone: 'Phone',
  email: 'Email',
  projectType: 'Project Type',
  timeline: 'Estimated Timeline',
  projectAddress: 'Project Address',
  description: 'Project Description',
  inspiration: 'Inspiration / Style',
  needsDesignServices: 'Needs Design Services',
  companyName: 'Company / Firm',
  tradeRole: 'Trade Role',
  licenseNumber: 'License Number',
  preferredContact: 'Preferred Contact',
  gcNameAndPhone: 'General Contractor',
  clientFirstName: 'Client First Name',
  clientLastName: 'Client Last Name',
  partnerFirstName: 'Partner First Name',
  partnerLastName: 'Partner Last Name',
  streetAddress: 'Street Address',
  city: 'City',
  state: 'State',
  zipCode: 'ZIP Code',
  areasRequiringCabinetry: 'Areas',
  installationTimeline: 'Installation Timeline',
  constructionMethod: 'Construction Method',
  crownMolding: 'Crown Molding',
  doorStyle: 'Door Style',
  woodSpecies: 'Wood Species / Material',
  accessories: 'Accessories & Upgrades',
  comments: 'Comments',
  attachments: 'Uploaded Files',
};

// HubSpot stage ID → pill color
const HS_STAGE_COLORS = {
  appointmentscheduled: { bg: '#fef3c7', color: '#92400e' },
  qualifiedtobuy:       { bg: '#dbeafe', color: '#1e40af' },
  presentationscheduled:{ bg: '#ede9fe', color: '#5b21b6' },
  decisionmakerboughtin:{ bg: '#cffafe', color: '#155e75' },
  contractsent:         { bg: '#dcfce7', color: '#166534' },
  closedwon:            { bg: '#14532d', color: '#ffffff' },
  closedlost:           { bg: '#f3f4f6', color: '#6b7280' },
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function formatFieldValue(value) {
  if (value === true) return 'Yes';
  if (value === false || value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  return String(value) || '—';
}

function isEmpty(value) {
  if (value === null || value === undefined || value === '' || value === false) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function HsBadge({ stageId, stageLabel }) {
  if (!stageLabel) {
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: '600',
        letterSpacing: '0.03em',
        background: '#f3f4f6',
        color: '#9ca3af',
      }}>
        Not in HubSpot
      </span>
    );
  }
  const style = HS_STAGE_COLORS[stageId] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '999px',
      fontSize: '12px',
      fontWeight: '700',
      letterSpacing: '0.03em',
      background: style.bg,
      color: style.color,
    }}>
      {stageLabel}
    </span>
  );
}

function TypeBadge({ formType }) {
  const label = formType === 'homeowner-consultation' ? 'Homeowner' : 'Trade';
  const isHomeowner = formType === 'homeowner-consultation';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      background: isHomeowner ? '#fff7ed' : '#f0fdf4',
      color: isHomeowner ? '#c2410c' : '#166534',
    }}>
      {label}
    </span>
  );
}

function LeadDetail({ fields }) {
  return (
    <div style={{ padding: '20px 24px', background: '#fafaf9', borderTop: '1px solid #e5e7eb' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <tbody>
          {Object.entries(fields).map(([k, v]) => {
            if (isEmpty(v)) return null;
            const label = FIELD_LABELS[k] ?? k;
            const value = formatFieldValue(v);
            return (
              <tr key={k} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 16px 8px 0', color: '#6b7280', fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', width: '32%', verticalAlign: 'top' }}>
                  {label}
                </td>
                <td style={{ padding: '8px 0', color: '#111827', verticalAlign: 'top', lineHeight: '1.55' }}>
                  {value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LeadCard({ lead, isExpanded, onToggle, onDelete }) {
  const f = lead.fields ?? {};
  const name = [f.firstName, f.lastName].filter(Boolean).join(' ') || '(no name)';
  const company = f.companyName || null;

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      {/* Card header row */}
      <div
        style={{ padding: '16px 20px', cursor: 'pointer', display: 'grid', gap: '12px' }}
        onClick={onToggle}
      >
        {/* Top row: name + badges + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: '700', fontSize: '15px', color: '#111827' }}>{name}</span>
          <TypeBadge formType={lead.form_type} />
          <HsBadge stageId={lead.hs_stage_id} stageLabel={lead.hs_stage_label} />
          <span style={{ marginLeft: 'auto', fontSize: '13px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
            {formatDate(lead.created_at)} · {formatTime(lead.created_at)}
          </span>
        </div>

        {/* Bottom row: contact info + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          {company && (
            <span style={{ fontSize: '13px', color: '#374151' }}>{company}</span>
          )}
          {f.phone && (
            <a href={`tel:${f.phone}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: '13px', color: '#78350f', textDecoration: 'none' }}>
              {f.phone}
            </a>
          )}
          {f.email && (
            <a href={`mailto:${f.email}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: '13px', color: '#78350f', textDecoration: 'none' }}>
              {f.email}
            </a>
          )}

          {/* HubSpot link + delete */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            {lead.hs_deal_url && (
              <a
                href={lead.hs_deal_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: '13px',
                  padding: '4px 10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  background: '#ffffff',
                  color: '#374151',
                  textDecoration: 'none',
                  fontWeight: '600',
                  lineHeight: 1.5,
                }}
              >
                View in HubSpot ↗
              </a>
            )}
            <button
              onClick={() => onDelete(lead.id, name)}
              title="Delete submission"
              style={{
                background: 'transparent',
                border: '1px solid #fca5a5',
                color: '#dc2626',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '13px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && <LeadDetail fields={lead.fields ?? {}} />}
    </div>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const res = await fetch('/api/admin-leads', {
      headers: { Authorization: `Bearer ${password}` },
    });

    if (res.ok) {
      onLogin(password);
    } else {
      setError('Incorrect password. Try again.');
      setIsLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f4f0', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '380px', padding: '0 16px' }}>
        <div style={{ background: '#ffffff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.1)' }}>
          <div style={{ background: '#78350f', padding: '24px 32px' }}>
            <p style={{ margin: 0, color: '#ffffff', fontSize: '18px', fontWeight: '700' }}>Caliber Cabinets</p>
            <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>Lead Management</p>
          </div>
          <form onSubmit={handleSubmit} style={{ padding: '28px 32px', display: 'grid', gap: '16px' }}>
            <div style={{ display: 'grid', gap: '6px' }}>
              <label htmlFor="admin-password" style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Password</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
              />
            </div>
            {error && <p style={{ margin: 0, color: '#b91c1c', fontSize: '13px' }}>{error}</p>}
            <button
              type="submit"
              disabled={isLoading}
              style={{ padding: '10px', background: '#78350f', color: '#ffffff', border: 0, borderRadius: '6px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', opacity: isLoading ? 0.6 : 1 }}
            >
              {isLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => !!sessionStorage.getItem('admin_token'),
  );
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  function getToken() {
    return sessionStorage.getItem('admin_token') ?? '';
  }

  async function loadLeads(token) {
    setIsLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/admin-leads', {
        headers: { Authorization: `Bearer ${token ?? getToken()}` },
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setLeads(data.leads ?? []);
    } catch {
      setLoadError('Failed to load submissions. Check your connection and refresh.');
    } finally {
      setIsLoading(false);
    }
  }

  function handleLogin(password) {
    sessionStorage.setItem('admin_token', password);
    setIsAuthenticated(true);
    loadLeads(password);
  }

  function handleLogout() {
    sessionStorage.removeItem('admin_token');
    setIsAuthenticated(false);
    setLeads([]);
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete submission from "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/admin-leads', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setLeads((prev) => prev.filter((l) => l.id !== id));
        if (expandedId === id) setExpandedId(null);
      }
    } catch {
      alert('Delete failed. Please try again.');
    }
  }

  useEffect(() => {
    if (isAuthenticated) loadLeads();
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // Filtering + search
  const filtered = leads
    .filter((l) => filterType === 'all' || l.form_type === filterType)
    .filter((l) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const f = l.fields ?? {};
      return (
        `${f.firstName ?? ''} ${f.lastName ?? ''}`.toLowerCase().includes(q) ||
        (f.email ?? '').toLowerCase().includes(q) ||
        (f.phone ?? '').toLowerCase().includes(q) ||
        (f.companyName ?? '').toLowerCase().includes(q)
      );
    });

  // Stats
  const totalLeads = leads.length;
  const homeownerLeads = leads.filter((l) => l.form_type === 'homeowner-consultation').length;
  const tradeLeads = leads.filter((l) => l.form_type === 'trade-estimate').length;

  return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', fontFamily: 'Arial, Helvetica, sans-serif' }}>

      {/* Header */}
      <header style={{ background: '#78350f', padding: '0 24px', display: 'flex', alignItems: 'center', height: '60px', gap: '16px' }}>
        <p style={{ margin: 0, color: '#ffffff', fontWeight: '700', fontSize: '16px', flex: 1 }}>
          Caliber Cabinets <span style={{ opacity: 0.6, fontWeight: '400', fontSize: '13px', marginLeft: '8px' }}>Lead Management</span>
        </p>
        <button
          onClick={() => loadLeads()}
          style={{ background: 'rgba(255,255,255,0.15)', border: 0, color: '#ffffff', padding: '6px 14px', borderRadius: '5px', fontSize: '13px', cursor: 'pointer' }}
        >
          Refresh
        </button>
        <button
          onClick={handleLogout}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: 'rgba(255,255,255,0.8)', padding: '6px 14px', borderRadius: '5px', fontSize: '13px', cursor: 'pointer' }}
        >
          Sign Out
        </button>
      </header>

      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 16px' }}>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>
          {[
            { label: 'Total Submissions', value: totalLeads },
            { label: 'Homeowner Consults', value: homeownerLeads },
            { label: 'Trade Estimates', value: tradeLeads },
          ].map((stat) => (
            <div key={stat.label} style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
              <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</p>
              <p style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: '#111827' }}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Filters + Search */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Type filter */}
          <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden', background: '#ffffff' }}>
            {[
              { value: 'all', label: 'All Types' },
              { value: 'homeowner-consultation', label: 'Homeowner' },
              { value: 'trade-estimate', label: 'Trade' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilterType(opt.value)}
                style={{
                  padding: '7px 14px',
                  border: 0,
                  borderRight: '1px solid #e5e7eb',
                  background: filterType === opt.value ? '#78350f' : 'transparent',
                  color: filterType === opt.value ? '#ffffff' : '#374151',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="search"
            placeholder="Search by name, email, phone, or company…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1, minWidth: '200px', padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', outline: 'none' }}
          />
        </div>

        {/* Results count */}
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#9ca3af' }}>
          {filtered.length} submission{filtered.length !== 1 ? 's' : ''}
          {(filterType !== 'all' || searchQuery) ? ' (filtered)' : ''}
        </p>

        {/* Content */}
        {isLoading && (
          <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>Loading submissions…</p>
        )}

        {loadError && (
          <p style={{ color: '#b91c1c', padding: '16px', background: '#fef2f2', borderRadius: '8px', fontSize: '14px' }}>{loadError}</p>
        )}

        {!isLoading && !loadError && filtered.length === 0 && (
          <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>
            {leads.length === 0 ? 'No submissions yet.' : 'No submissions match your filters.'}
          </p>
        )}

        {!isLoading && (
          <div style={{ display: 'grid', gap: '10px' }}>
            {filtered.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                isExpanded={expandedId === lead.id}
                onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
