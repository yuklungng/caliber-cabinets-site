import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabasePublic = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_LABELS = {
  firstName: 'First Name', lastName: 'Last Name', phone: 'Phone', email: 'Email',
  projectType: 'Project Type', timeline: 'Estimated Timeline', projectAddress: 'Project Address',
  description: 'Project Description', inspiration: 'Inspiration / Style',
  needsDesignServices: 'Needs Design Services', companyName: 'Company / Firm',
  tradeRole: 'Trade Role', licenseNumber: 'License Number', preferredContact: 'Preferred Contact',
  gcNameAndPhone: 'General Contractor', clientFirstName: 'Client First Name',
  clientLastName: 'Client Last Name', partnerFirstName: 'Partner First Name',
  partnerLastName: 'Partner Last Name', streetAddress: 'Street Address', city: 'City',
  state: 'State', zipCode: 'ZIP Code', areasRequiringCabinetry: 'Areas',
  installationTimeline: 'Installation Timeline', constructionMethod: 'Construction Method',
  crownMolding: 'Crown Molding', doorStyle: 'Door Style', woodSpecies: 'Wood Species / Material',
  accessories: 'Accessories & Upgrades', comments: 'Comments', attachments: 'Uploaded Files',
};

const HS_STAGE_COLORS = {
  '3869825744':          { bg: '#fef3c7', color: '#92400e' },
  qualifiedtobuy:        { bg: '#dbeafe', color: '#1e40af' },
  '3869825755':          { bg: '#ede9fe', color: '#5b21b6' },
  appointmentscheduled:  { bg: '#cffafe', color: '#155e75' },
  presentationscheduled: { bg: '#e0f2fe', color: '#0c4a6e' },
  decisionmakerboughtin: { bg: '#dcfce7', color: '#166534' },
  contractsent:          { bg: '#bbf7d0', color: '#14532d' },
  closedwon:             { bg: '#14532d', color: '#ffffff' },
  closedlost:            { bg: '#f3f4f6', color: '#6b7280' },
};

// Ordered pipeline stages — defines the linear lifecycle view
// Appt/Presentation is a combined step (both IDs count toward it)
const HS_PIPELINE = [
  { id: '3869825744',                                          label: 'New Request' },
  { id: 'qualifiedtobuy',                                      label: 'Qualified' },
  { id: '3869825755',                                          label: 'Quote Sent' },
  { id: ['appointmentscheduled', 'presentationscheduled'],     label: 'Appt / Presentation' },
  { id: 'contractsent',                                        label: 'Contract Sent' },
  { id: 'closedwon',                                          label: 'Closed Won' },
];
const HS_CLOSED_LOST = { id: 'closedlost', label: 'Closed Lost' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatPhone(phone) {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return phone;
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
function getToken() { return sessionStorage.getItem('admin_token') ?? ''; }
function getUser() {
  try { return JSON.parse(sessionStorage.getItem('admin_user') ?? '{}'); } catch { return {}; }
}

async function apiCall(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

// ─── Lead sub-components ──────────────────────────────────────────────────────

function HsBadge({ stageId, stageLabel, stageDate }) {
  if (!stageLabel) {
    return (
      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '600', background: '#f3f4f6', color: '#9ca3af' }}>
        Not in HubSpot
      </span>
    );
  }
  const style = HS_STAGE_COLORS[stageId] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', letterSpacing: '0.03em', background: style.bg, color: style.color }}>
      {stageLabel}
      {stageDate && (
        <span style={{ opacity: 0.65, fontWeight: '500', fontSize: '11px' }}>
          · {formatShortDate(stageDate)}
        </span>
      )}
    </span>
  );
}

function TypeBadge({ formType }) {
  const isHomeowner = formType === 'homeowner-consultation';
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.05em', textTransform: 'uppercase', background: isHomeowner ? '#fff7ed' : '#f0fdf4', color: isHomeowner ? '#c2410c' : '#166534' }}>
      {isHomeowner ? 'Homeowner' : 'Trade'}
    </span>
  );
}

// ─── Lead detail sub-components ──────────────────────────────────────────────

function SectionHeading({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
      <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
        {children}
      </span>
      <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
    </div>
  );
}

function FieldCell({ label, children, wide }) {
  if (!children && children !== 0) return null;
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : {}}>
      <dt style={{ fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontSize: '14px', color: '#111827', lineHeight: '1.6' }}>
        {children}
      </dd>
    </div>
  );
}

function fileInfo(filename) {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const types = {
    pdf:  { label: 'PDF',  color: '#dc2626', bg: '#fef2f2' },
    jpg:  { label: 'JPG',  color: '#7c3aed', bg: '#f5f3ff' },
    jpeg: { label: 'JPG',  color: '#7c3aed', bg: '#f5f3ff' },
    png:  { label: 'PNG',  color: '#7c3aed', bg: '#f5f3ff' },
    gif:  { label: 'GIF',  color: '#7c3aed', bg: '#f5f3ff' },
    webp: { label: 'WEBP', color: '#7c3aed', bg: '#f5f3ff' },
    heic: { label: 'HEIC', color: '#7c3aed', bg: '#f5f3ff' },
    dwg:  { label: 'DWG',  color: '#0891b2', bg: '#ecfeff' },
    dxf:  { label: 'DXF',  color: '#0891b2', bg: '#ecfeff' },
    xlsx: { label: 'XLS',  color: '#16a34a', bg: '#f0fdf4' },
    xls:  { label: 'XLS',  color: '#16a34a', bg: '#f0fdf4' },
    csv:  { label: 'CSV',  color: '#16a34a', bg: '#f0fdf4' },
    doc:  { label: 'DOC',  color: '#2563eb', bg: '#eff6ff' },
    docx: { label: 'DOC',  color: '#2563eb', bg: '#eff6ff' },
  };
  return types[ext] ?? { label: ext.toUpperCase() || 'FILE', color: '#6b7280', bg: '#f9fafb' };
}

function AttachmentChip({ path }) {
  const [loading, setLoading] = useState(false);
  const filename = path.split('/').pop().replace(/^\d+-/, '');
  const { label, color, bg } = fileInfo(filename);

  async function open() {
    setLoading(true);
    try {
      const r = await apiCall(`/api/admin-attachment?path=${encodeURIComponent(path)}`);
      const d = await r.json();
      if (d.url) window.open(d.url, '_blank');
      else alert('Could not open file. Try again.');
    } catch {
      alert('Could not open file. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={open}
      disabled={loading}
      title={filename}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 14px', border: `1px solid ${color}40`,
        borderRadius: '8px', background: bg, cursor: 'pointer',
        textAlign: 'left', opacity: loading ? 0.6 : 1,
        transition: 'opacity 150ms, box-shadow 150ms',
        maxWidth: '260px',
      }}
    >
      <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: '10px', fontWeight: '800', color: '#fff', letterSpacing: '0.03em' }}>
          {loading ? '…' : label}
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filename}
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>
          {loading ? 'Opening…' : 'Click to open ↗'}
        </div>
      </div>
    </button>
  );
}

function LeadDetail({ lead }) {
  const f = lead.fields ?? {};
  const isHomeowner = lead.form_type === 'homeowner-consultation';

  const addr = [
    f.streetAddress,
    f.city,
    f.state && f.zipCode ? `${f.state} ${f.zipCode}` : (f.state || f.zipCode),
  ].filter(Boolean).join(', ');

  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 32px' };

  return (
    <div style={{ padding: '28px 32px', background: '#fff', borderTop: '2px solid #f3e8d0' }}>
      <dl style={{ margin: 0, display: 'grid', gap: '32px' }}>

        {/* Contact */}
        <section>
          <SectionHeading>Contact</SectionHeading>
          <div style={grid2}>
            <FieldCell label="Name">
              {[f.firstName, f.lastName].filter(Boolean).join(' ') || null}
            </FieldCell>
            <FieldCell label="Phone">
              {f.phone ? <a href={`tel:${f.phone}`} style={{ color: '#78350f', textDecoration: 'none', fontWeight: '500' }}>{formatPhone(f.phone)}</a> : null}
            </FieldCell>
            <FieldCell label="Email" wide>
              {f.email ? <a href={`mailto:${f.email}`} style={{ color: '#78350f', textDecoration: 'none', fontWeight: '500' }}>{f.email}</a> : null}
            </FieldCell>
          </div>
        </section>

        {/* Trade — Your info */}
        {!isHomeowner && (
          <section>
            <SectionHeading>Your Information</SectionHeading>
            <div style={grid2}>
              <FieldCell label="Company">{f.companyName}</FieldCell>
              <FieldCell label="Trade Role">{f.tradeRole}</FieldCell>
              <FieldCell label="License #">{f.licenseNumber}</FieldCell>
              <FieldCell label="Preferred Contact">{f.preferredContact}</FieldCell>
              {f.gcNameAndPhone && <FieldCell label="General Contractor" wide>{f.gcNameAndPhone}</FieldCell>}
            </div>
          </section>
        )}

        {/* Trade — Client */}
        {!isHomeowner && (f.clientFirstName || f.clientLastName || f.needsDesignServices) && (
          <section>
            <SectionHeading>Client</SectionHeading>
            <div style={grid2}>
              <FieldCell label="Client Name">
                {[f.clientFirstName, f.clientLastName].filter(Boolean).join(' ') || null}
              </FieldCell>
              {f.needsDesignServices && (
                <FieldCell label="Design & Measure">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                    Required — $875 deposit
                  </span>
                </FieldCell>
              )}
            </div>
          </section>
        )}

        {/* Homeowner — Project */}
        {isHomeowner && (
          <section>
            <SectionHeading>Project</SectionHeading>
            <div style={grid2}>
              <FieldCell label="Type">{f.projectType}</FieldCell>
              <FieldCell label="Timeline">{f.timeline}</FieldCell>
              {addr && <FieldCell label="Address" wide>{addr}</FieldCell>}
            </div>
          </section>
        )}

        {/* Trade — Project */}
        {!isHomeowner && (
          <section>
            <SectionHeading>Project</SectionHeading>
            <div style={grid2}>
              {addr && <FieldCell label="Address" wide>{addr}</FieldCell>}
              <FieldCell label="Areas">
                {Array.isArray(f.areasRequiringCabinetry) ? f.areasRequiringCabinetry.join(', ') : f.areasRequiringCabinetry}
              </FieldCell>
              <FieldCell label="Installation Timeline">{f.installationTimeline}</FieldCell>
            </div>
          </section>
        )}

        {/* Trade — Specs */}
        {!isHomeowner && (f.constructionMethod || f.doorStyle || f.woodSpecies || f.crownMolding || f.accessories) && (
          <section>
            <SectionHeading>Specifications</SectionHeading>
            <div style={grid2}>
              <FieldCell label="Construction Method">{f.constructionMethod}</FieldCell>
              <FieldCell label="Crown Molding">{f.crownMolding}</FieldCell>
              <FieldCell label="Door Style">{f.doorStyle}</FieldCell>
              <FieldCell label="Wood / Material">{f.woodSpecies}</FieldCell>
              {f.accessories && (
                <FieldCell label="Accessories & Upgrades" wide>
                  {Array.isArray(f.accessories) ? f.accessories.join(', ') : f.accessories}
                </FieldCell>
              )}
            </div>
          </section>
        )}

        {/* Notes / Description */}
        {(f.description || f.inspiration || f.comments) && (
          <section>
            <SectionHeading>Notes</SectionHeading>
            <div style={{ display: 'grid', gap: '20px' }}>
              {f.description && (
                <FieldCell label="Project Description">
                  <span style={{ whiteSpace: 'pre-wrap' }}>{f.description}</span>
                </FieldCell>
              )}
              {f.inspiration && (
                <FieldCell label="Inspiration / Style Notes">
                  <span style={{ whiteSpace: 'pre-wrap' }}>{f.inspiration}</span>
                </FieldCell>
              )}
              {f.comments && (
                <FieldCell label="Comments">
                  <span style={{ whiteSpace: 'pre-wrap' }}>{f.comments}</span>
                </FieldCell>
              )}
            </div>
          </section>
        )}

        {/* Attachments */}
        {Array.isArray(f.attachments) && f.attachments.length > 0 && (
          <section>
            <SectionHeading>Attachments</SectionHeading>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {f.attachments.map((path) => (
                <AttachmentChip key={path} path={path} />
              ))}
            </div>
          </section>
        )}

      </dl>
    </div>
  );
}

function LeadCard({ lead, isExpanded, onToggle, onDelete }) {
  const f = lead.fields ?? {};
  const name = [f.firstName, f.lastName].filter(Boolean).join(' ') || '(no name)';
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'grid', gap: '12px' }} onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: '700', fontSize: '15px', color: '#111827' }}>{name}</span>
          <TypeBadge formType={lead.form_type} />
          <HsBadge stageId={lead.hs_stage_id} stageLabel={lead.hs_stage_label} stageDate={lead.hs_stage_date} />
          <span style={{ marginLeft: 'auto', fontSize: '13px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
            {formatDate(lead.created_at)} · {formatTime(lead.created_at)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          {f.companyName && <span style={{ fontSize: '13px', color: '#374151' }}>{f.companyName}</span>}
          {f.phone && <a href={`tel:${f.phone}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: '13px', color: '#78350f', textDecoration: 'none' }}>{formatPhone(f.phone)}</a>}
          {f.email && <a href={`mailto:${f.email}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: '13px', color: '#78350f', textDecoration: 'none' }}>{f.email}</a>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            {lead.hs_deal_url && (
              <a href={lead.hs_deal_url} target="_blank" rel="noreferrer" style={{ fontSize: '13px', padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#ffffff', color: '#374151', textDecoration: 'none', fontWeight: '600' }}>
                View in HubSpot ↗
              </a>
            )}
            <button onClick={() => onDelete(lead.id, name)} style={{ background: 'transparent', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: '4px', padding: '4px 8px', fontSize: '13px', cursor: 'pointer' }}>
              Delete
            </button>
          </div>
        </div>
      </div>
      {isExpanded && <LeadDetail lead={lead} />}
    </div>
  );
}

// ─── Settings panels ──────────────────────────────────────────────────────────

function PanelShell({ title, description, children }) {
  return (
    <div style={{ maxWidth: '640px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '700', color: '#111827' }}>{title}</h2>
      <p style={{ margin: '0 0 28px', fontSize: '14px', color: '#6b7280' }}>{description}</p>
      {children}
    </div>
  );
}

function SaveFeedback({ saved }) {
  if (!saved) return null;
  return <span style={{ fontSize: '13px', color: '#166534', marginLeft: '12px' }}>✓ Saved</span>;
}

function NotificationsPanel() {
  const [emails, setEmails] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiCall('/api/admin-settings')
      .then((r) => r.json())
      .then((d) => {
        setEmails(d.settings?.notification_emails ?? []);
        setLoading(false);
      });
  }, []);

  async function save(list) {
    setSaving(true);
    await apiCall('/api/admin-settings', { method: 'PUT', body: { key: 'notification_emails', value: list } });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function add() {
    const val = newEmail.trim().toLowerCase();
    if (!val || emails.includes(val)) return;
    const updated = [...emails, val];
    setEmails(updated);
    setNewEmail('');
    save(updated);
  }

  function remove(email) {
    const updated = emails.filter((e) => e !== email);
    setEmails(updated);
    save(updated);
  }

  if (loading) return <p style={{ color: '#9ca3af' }}>Loading…</p>;

  return (
    <PanelShell title="Notifications" description="These email addresses receive a notification whenever a new form is submitted on the website.">
      <div style={{ display: 'grid', gap: '8px', marginBottom: '20px' }}>
        {emails.length === 0 && <p style={{ color: '#9ca3af', fontSize: '14px', margin: 0 }}>No recipients yet.</p>}
        {emails.map((email) => (
          <div key={email} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
            <span style={{ flex: 1, fontSize: '14px', color: '#111827' }}>{email}</span>
            <button onClick={() => remove(email)} style={{ background: 'transparent', border: 0, color: '#6b7280', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="email"
          placeholder="Add email address"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
        />
        <button onClick={add} disabled={saving} style={{ padding: '8px 18px', background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          Add
        </button>
        <SaveFeedback saved={saved} />
      </div>
    </PanelShell>
  );
}

function RichTextEditor({ value, onChange }) {
  const editorRef = useRef(null);

  // Set initial HTML once on mount
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = value ?? '';
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function exec(cmd, val = null) {
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val);
    editorRef.current.focus();
    onChange(editorRef.current.innerHTML);
  }

  function applyFontSize(px) {
    editorRef.current.focus();
    // execCommand only accepts 1-7; use size=7 as a marker then replace with CSS spans
    document.execCommand('fontSize', false, '7');
    editorRef.current.querySelectorAll('font[size="7"]').forEach((el) => {
      const span = document.createElement('span');
      span.style.fontSize = px;
      span.innerHTML = el.innerHTML;
      el.replaceWith(span);
    });
    onChange(editorRef.current.innerHTML);
  }

  const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'];
  const SIZES = ['10px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'];

  const sepStyle = { width: '1px', background: '#e5e7eb', margin: '0 3px', alignSelf: 'stretch' };
  const btnStyle = { padding: '4px 9px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: '#374151', lineHeight: 1.4 };

  return (
    <div style={{ border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '8px 10px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', alignItems: 'center' }}>

        {/* Font family */}
        <select
          defaultValue=""
          onChange={(e) => { if (e.target.value) exec('fontName', e.target.value); editorRef.current.focus(); }}
          style={{ padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', background: '#fff', cursor: 'pointer' }}
        >
          <option value="" disabled>Font</option>
          {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>

        {/* Font size */}
        <select
          defaultValue=""
          onChange={(e) => { if (e.target.value) applyFontSize(e.target.value); }}
          style={{ padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', background: '#fff', cursor: 'pointer' }}
        >
          <option value="" disabled>Size</option>
          {SIZES.map((s) => <option key={s} value={s}>{s.replace('px', '')}</option>)}
        </select>

        <div style={sepStyle} />

        {/* Style buttons — onMouseDown + preventDefault keeps editor focused */}
        {[
          { label: <strong>B</strong>, cmd: 'bold', title: 'Bold' },
          { label: <em>I</em>, cmd: 'italic', title: 'Italic' },
          { label: <u>U</u>, cmd: 'underline', title: 'Underline' },
        ].map(({ label, cmd, title }) => (
          <button key={cmd} type="button" title={title} onMouseDown={(e) => { e.preventDefault(); exec(cmd); }} style={btnStyle}>
            {label}
          </button>
        ))}

        <div style={sepStyle} />

        {/* Alignment */}
        {[
          { label: '⬛L', cmd: 'justifyLeft', title: 'Align left' },
          { label: '⬛C', cmd: 'justifyCenter', title: 'Center' },
          { label: '⬛R', cmd: 'justifyRight', title: 'Align right' },
        ].map(({ label, cmd, title }) => (
          <button key={cmd} type="button" title={title} onMouseDown={(e) => { e.preventDefault(); exec(cmd); }} style={{ ...btnStyle, fontFamily: 'monospace', letterSpacing: '-1px' }}>
            {title.replace('Align ', '').replace('Center', 'Ctr')}
          </button>
        ))}

        <div style={sepStyle} />

        {/* Text color */}
        <label title="Text color" style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '13px', fontWeight: '600', color: '#374151', cursor: 'pointer', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff' }}>
          A
          <input type="color" defaultValue="#111827" onChange={(e) => exec('foreColor', e.target.value)} style={{ width: '18px', height: '18px', border: 'none', padding: 0, cursor: 'pointer', borderRadius: '2px', background: 'transparent' }} />
        </label>

        {/* Highlight color */}
        <label title="Highlight" style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '13px', fontWeight: '600', color: '#374151', cursor: 'pointer', padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff' }}>
          🖍
          <input type="color" defaultValue="#fef08a" onChange={(e) => exec('hiliteColor', e.target.value)} style={{ width: '18px', height: '18px', border: 'none', padding: 0, cursor: 'pointer', borderRadius: '2px', background: 'transparent' }} />
        </label>

        <div style={sepStyle} />

        {/* Lists */}
        <button type="button" title="Bulleted list" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }} style={btnStyle}>• List</button>
        <button type="button" title="Clear formatting" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} style={{ ...btnStyle, color: '#9ca3af' }}>✕ Clear</button>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(editorRef.current.innerHTML)}
        style={{ minHeight: '200px', padding: '14px 16px', fontSize: '14px', lineHeight: '1.7', outline: 'none', color: '#111827' }}
      />
    </div>
  );
}

function ConfirmationsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiCall('/api/admin-settings')
      .then((r) => r.json())
      .then((d) => {
        const s = d.settings ?? {};
        setEnabled(s.confirmations_enabled === true || s.confirmations_enabled === 'true');
        setSubject(s.confirmation_subject ?? '');
        setMessage(s.confirmation_message ?? '');
        setLoading(false);
      });
  }, []);

  async function save() {
    setSaving(true);
    await Promise.all([
      apiCall('/api/admin-settings', { method: 'PUT', body: { key: 'confirmations_enabled', value: enabled } }),
      apiCall('/api/admin-settings', { method: 'PUT', body: { key: 'confirmation_subject', value: subject } }),
      apiCall('/api/admin-settings', { method: 'PUT', body: { key: 'confirmation_message', value: message } }),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p style={{ color: '#9ca3af' }}>Loading…</p>;

  return (
    <PanelShell title="Confirmations" description="When enabled, leads automatically receive a reply email after submitting the form.">
      <div style={{ display: 'grid', gap: '20px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <div
            onClick={() => setEnabled(!enabled)}
            style={{ width: '44px', height: '24px', borderRadius: '999px', background: enabled ? '#78350f' : '#d1d5db', position: 'relative', transition: 'background 200ms', cursor: 'pointer', flexShrink: 0 }}
          >
            <div style={{ position: 'absolute', top: '3px', left: enabled ? '23px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 200ms', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </div>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>
            {enabled ? 'Auto-reply enabled' : 'Auto-reply disabled'}
          </span>
        </label>

        <div style={{ display: 'grid', gap: '6px', opacity: enabled ? 1 : 0.5 }}>
          <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Subject line</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!enabled}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
          />
        </div>

        <div style={{ display: 'grid', gap: '6px', opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none' }}>
          <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Message body</label>
          <RichTextEditor value={message} onChange={setMessage} />
          <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>HTML email sent from leads@calibercabinetshop.com.</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={save} disabled={saving} style={{ padding: '8px 20px', background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <SaveFeedback saved={saved} />
        </div>
      </div>
    </PanelShell>
  );
}

function UsersPanel({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '', is_super_admin: false });
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const [resetId, setResetId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetSaved, setResetSaved] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    const r = await apiCall('/api/admin-users');
    const d = await r.json();
    setUsers(d.users ?? []);
    setLoading(false);
  }

  async function addUser(e) {
    e.preventDefault();
    setFormError('');
    setAdding(true);
    const r = await apiCall('/api/admin-users', { method: 'POST', body: form });
    const d = await r.json();
    if (!r.ok) { setFormError(d.error ?? 'Failed to add user'); setAdding(false); return; }
    setUsers((prev) => [...prev, d.user]);
    setForm({ name: '', email: '', password: '', is_super_admin: false });
    setAdding(false);
  }

  async function deleteUser(id, name) {
    if (!window.confirm(`Remove ${name}? They will lose admin access immediately.`)) return;
    await apiCall('/api/admin-users', { method: 'DELETE', body: { id } });
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  async function resetPw(id) {
    if (!resetPassword.trim()) return;
    await apiCall('/api/admin-users', { method: 'PATCH', body: { id, password: resetPassword } });
    setResetId(null);
    setResetPassword('');
    setResetSaved(true);
    setTimeout(() => setResetSaved(false), 2500);
  }

  if (loading) return <p style={{ color: '#9ca3af' }}>Loading…</p>;

  const isSuperAdmin = currentUser?.is_super_admin;

  return (
    <PanelShell title="User Access" description="Manage who can log in to this admin panel. Super admins can manage users and settings.">
      {!isSuperAdmin && (
        <p style={{ color: '#6b7280', fontSize: '14px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
          Only super admins can manage users. Contact Morris at NexPerion to add or remove access.
        </p>
      )}

      {isSuperAdmin && (
        <>
          {/* User list */}
          <div style={{ display: 'grid', gap: '8px', marginBottom: '32px' }}>
            {users.map((u) => (
              <div key={u.id} style={{ padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{u.name}</span>
                      {u.is_super_admin && (
                        <span style={{ fontSize: '11px', fontWeight: '700', padding: '1px 8px', borderRadius: '999px', background: '#fef3c7', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Super Admin</span>
                      )}
                    </div>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>{u.email}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => { setResetId(resetId === u.id ? null : u.id); setResetPassword(''); }}
                      style={{ fontSize: '13px', padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff', color: '#374151', cursor: 'pointer' }}
                    >
                      Reset password
                    </button>
                    <button
                      onClick={() => deleteUser(u.id, u.name)}
                      style={{ fontSize: '13px', padding: '4px 10px', border: '1px solid #fca5a5', borderRadius: '4px', background: 'transparent', color: '#dc2626', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {resetId === u.id && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <input
                      type="password"
                      placeholder="New password"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', outline: 'none' }}
                    />
                    <button onClick={() => resetPw(u.id)} style={{ padding: '7px 16px', background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                      Save
                    </button>
                  </div>
                )}
              </div>
            ))}
            {resetSaved && <span style={{ fontSize: '13px', color: '#166534' }}>✓ Password updated</span>}
          </div>

          {/* Add user form */}
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '24px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#111827' }}>Add new user</h3>
            <form onSubmit={addUser} style={{ display: 'grid', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'grid', gap: '5px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Full name</label>
                  <input required type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }} />
                </div>
                <div style={{ display: 'grid', gap: '5px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Email</label>
                  <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gap: '5px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Temporary password</label>
                <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#374151' }}>
                <input type="checkbox" checked={form.is_super_admin} onChange={(e) => setForm({ ...form, is_super_admin: e.target.checked })} />
                Super admin (can manage users and settings)
              </label>
              {formError && <p style={{ margin: 0, color: '#b91c1c', fontSize: '13px' }}>{formError}</p>}
              <div>
                <button type="submit" disabled={adding} style={{ padding: '8px 20px', background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', opacity: adding ? 0.6 : 1 }}>
                  {adding ? 'Adding…' : 'Add user'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </PanelShell>
  );
}

// ─── Site Stats view ─────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StatTile({ label, value, sub, accent }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px', borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: '26px', fontWeight: '700', color: '#111827', lineHeight: 1.2 }}>{value ?? '—'}</p>
      {sub && <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#6b7280' }}>{sub}</p>}
    </div>
  );
}

function MiniBar({ daily, field, color }) {
  if (!daily?.length) return null;
  const values = daily.map((d) => d[field] ?? 0);
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '40px' }}>
      {values.map((v, i) => (
        <div key={i} title={`${daily[i].date}: ${v.toLocaleString()}`} style={{ flex: 1, borderRadius: '2px 2px 0 0', background: color ?? '#78350f', opacity: 0.7 + (v / max) * 0.3, height: `${Math.max(4, Math.round((v / max) * 40))}px` }} />
      ))}
    </div>
  );
}

function EmptyFrame({ label }) {
  return (
    <div style={{ minHeight: '80px', background: '#f9fafb', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontSize: '11px', color: '#d1d5db' }}>{label}</span>
      <span style={{ fontSize: '11px', color: '#d1d5db' }}>Waiting for data…</span>
    </div>
  );
}

function NotConfiguredCard({ service, envVars, hint }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: '8px', padding: '20px 24px' }}>
      <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>{service} — Not connected</p>
      <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#6b7280' }}>{hint}</p>
      <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af', fontFamily: 'monospace' }}>
        {envVars.join(' · ')}
      </p>
    </div>
  );
}

function SiteStatsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

  function loadStats(silent = false) {
    if (!silent) setLoading(true);
    apiCall('/api/admin-analytics')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); setLastUpdated(new Date()); })
      .catch(() => { setError('Failed to load stats.'); setLoading(false); });
  }

  useEffect(() => {
    loadStats();
    const interval = setInterval(() => loadStats(true), REFRESH_MS);
    function onVisibility() { if (!document.hidden) loadStats(true); }
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  if (loading && !data) return <p style={{ color: '#9ca3af', padding: '40px 0', textAlign: 'center' }}>Loading site stats…</p>;
  if (error && !data) return <p style={{ color: '#b91c1c' }}>{error}</p>;

  const { uptime, turnstile, ga, gsc, cloudflare } = data ?? {};

  return (
    <div style={{ display: 'grid', gap: '32px', maxWidth: '860px' }}>

      {/* ── UptimeRobot ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827' }}>Uptime</h2>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>via UptimeRobot</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>
            {loading ? 'Refreshing…' : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
          <button
            onClick={() => loadStats()}
            style={{ fontSize: '12px', color: '#78350f', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px' }}
          >
            ↻
          </button>
        </div>

        {!uptime?.configured && (
          <NotConfiguredCard
            service="UptimeRobot"
            envVars={['UPTIMEROBOT_API_KEY']}
            hint="Add your API key from UptimeRobot › My Settings › API Settings › Main API Key."
          />
        )}

        {uptime?.configured && uptime?.error && (
          <p style={{ color: '#b91c1c', fontSize: '14px' }}>UptimeRobot error: {uptime.error}</p>
        )}

        {uptime?.configured && uptime?.monitors && (
          <div style={{ display: 'grid', gap: '12px' }}>
            {uptime.monitors.map((m) => {
              const statusColor = m.status === 'up' ? '#16a34a' : m.status === 'seems_down' ? '#d97706' : '#dc2626';
              const statusLabel = m.status === 'up' ? '● Up' : m.status === 'seems_down' ? '⚠ Seems Down' : '✕ Down';
              return (
                <div key={m.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '700', color: '#111827' }}>{m.name}</span>
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>{m.url}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: '700', color: statusColor }}>{statusLabel}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                    <div>
                      <p style={{ margin: '0 0 2px', fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>7-day uptime</p>
                      <p style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: m.uptimeRatio7 >= 99.9 ? '#16a34a' : m.uptimeRatio7 >= 99 ? '#d97706' : '#dc2626' }}>
                        {m.uptimeRatio7 != null ? `${m.uptimeRatio7}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 2px', fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>30-day uptime</p>
                      <p style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#111827' }}>
                        {m.uptimeRatio30 != null ? `${m.uptimeRatio30}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 2px', fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg response</p>
                      <p style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#111827' }}>
                        {m.avgResponseMs != null ? `${m.avgResponseMs}ms` : '—'}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 2px', fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>All-time</p>
                      <p style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#111827' }}>
                        {m.uptimeRatioAll != null ? `${m.uptimeRatioAll}%` : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Turnstile ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827' }}>Bot Protection</h2>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>via Cloudflare Turnstile · last 6 days</span>
        </div>

        {!turnstile?.configured && (
          <NotConfiguredCard
            service="Cloudflare Turnstile"
            envVars={['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']}
            hint="Add your Cloudflare Account ID and an API token with Account Analytics:Read permission."
          />
        )}

        {turnstile?.configured && turnstile?.error && (
          <p style={{ color: '#b91c1c', fontSize: '14px', background: '#fef2f2', padding: '12px 16px', borderRadius: '8px' }}>
            Turnstile error: {turnstile.error}
          </p>
        )}

        {turnstile?.configured && turnstile?.totals && (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${turnstile.simpleMode ? 2 : 4}, 1fr)`, gap: '12px' }}>
              <StatTile
                label="Form Loads"
                value={turnstile.totals.pageLoads?.toLocaleString()}
                sub="Times Turnstile ran"
                accent="#6366f1"
              />
              <StatTile
                label="Humans Verified"
                value={turnstile.totals.verified?.toLocaleString()}
                sub="Tokens issued to real users"
                accent="#16a34a"
              />
              {!turnstile.simpleMode && (
                <StatTile
                  label="Bots Blocked"
                  value={turnstile.totals.blocked?.toLocaleString()}
                  sub="Stopped before submit"
                  accent="#dc2626"
                />
              )}
              {!turnstile.simpleMode && (
                <StatTile
                  label="Solve Rate"
                  value={turnstile.totals.solveRate != null ? `${turnstile.totals.solveRate}%` : '—'}
                  sub="Humans / total loads"
                  accent="#f59e0b"
                />
              )}
            </div>

            {turnstile.daily?.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: '20px', marginBottom: '12px' }}>
                  <p style={{ margin: 0, fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Daily breakdown</p>
                  <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: '600' }}>■ Verified</span>
                  <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: '600' }}>■ Blocked</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '48px' }}>
                  {turnstile.daily.slice(-14).map((d) => {
                    const dayTotal = (d.passed ?? 0) + (d.failed ?? 0);
                    const total = Math.max(dayTotal, 1);
                    const maxTotal = Math.max(...turnstile.daily.map((x) => (x.passed ?? 0) + (x.failed ?? 0)), 1);
                    const barH = Math.max(4, Math.round((total / maxTotal) * 48));
                    const verifiedPct = dayTotal > 0 ? (d.passed ?? 0) / dayTotal : 1;
                    return (
                      <div
                        key={d.date}
                        title={`${d.date}: ${(d.passed ?? 0).toLocaleString()} verified, ${(d.failed ?? 0).toLocaleString()} blocked`}
                        style={{ flex: 1, height: `${barH}px`, borderRadius: '2px 2px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse' }}
                      >
                        <div style={{ height: `${Math.round(verifiedPct * 100)}%`, background: '#16a34a', opacity: 0.85 }} />
                        <div style={{ flex: 1, background: '#dc2626', opacity: 0.7 }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#9ca3af' }}>{turnstile.daily.slice(-14)[0]?.date}</span>
                  <span style={{ fontSize: '10px', color: '#9ca3af' }}>{turnstile.daily.slice(-1)[0]?.date}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Google Search Console ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827' }}>Google Search</h2>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>via Search Console · last 28 days</span>
        </div>

        {!gsc?.configured && (
          <NotConfiguredCard
            service="Google Search Console"
            envVars={['SEARCH_CONSOLE_SITE']}
            hint="Set SEARCH_CONSOLE_SITE to sc-domain:calibercabinetshop.com and add the service account to Search Console as a Full user."
          />
        )}

        {gsc?.configured && gsc?.error && (
          <p style={{ color: '#b91c1c', fontSize: '14px', background: '#fef2f2', padding: '12px 16px', borderRadius: '8px' }}>
            Search Console error: {gsc.error}
          </p>
        )}

        {gsc?.configured && gsc?.totals && (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <StatTile label="Total Clicks" value={gsc.totals.clicks?.toLocaleString()} accent="#4285f4" sub="Visits from Google search" />
              <StatTile label="Impressions" value={gsc.totals.impressions?.toLocaleString()} accent="#34a853" sub="Times shown in results" />
              <StatTile label="Click-Through Rate" value={gsc.totals.ctr != null ? `${gsc.totals.ctr}%` : '—'} accent="#fbbc04" sub="Higher is better" />
              <StatTile label="Avg Position" value={gsc.totals.position != null ? `#${gsc.totals.position}` : '—'} accent="#ea4335" sub="Lower # = higher ranking" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 4px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top search queries</p>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#9ca3af' }}>What people type to find the site</p>
                {gsc.queries?.length > 0
                  ? <div style={{ display: 'grid', gap: '10px' }}>
                      {gsc.queries.map((q) => (
                        <div key={q.query} style={{ display: 'grid', gap: '2px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '13px', color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.query}</span>
                            <div style={{ display: 'flex', gap: '10px', flexShrink: 0, fontSize: '11px' }}>
                              <span style={{ color: '#4285f4', fontWeight: '700' }}>{q.clicks} clicks</span>
                              <span style={{ color: '#9ca3af' }}>#{q.position}</span>
                            </div>
                          </div>
                          <div style={{ height: '3px', background: '#f3f4f6', borderRadius: '2px' }}>
                            <div style={{ width: `${Math.round((q.clicks / gsc.queries[0].clicks) * 100)}%`, height: '100%', background: '#4285f4', borderRadius: '2px', opacity: 0.7 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  : <EmptyFrame label="caliber cabinets livermore · custom cabinets…" />
                }
              </div>

              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 4px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pages getting clicks</p>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#9ca3af' }}>Which pages Google sends visitors to</p>
                {gsc.pages?.length > 0
                  ? <div style={{ display: 'grid', gap: '10px' }}>
                      {gsc.pages.map((p) => (
                        <div key={p.page} style={{ display: 'grid', gap: '2px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '13px', color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.page}</span>
                            <div style={{ display: 'flex', gap: '10px', flexShrink: 0, fontSize: '11px' }}>
                              <span style={{ color: '#34a853', fontWeight: '700' }}>{p.clicks} clicks</span>
                              <span style={{ color: '#9ca3af' }}>#{p.position}</span>
                            </div>
                          </div>
                          <div style={{ height: '3px', background: '#f3f4f6', borderRadius: '2px' }}>
                            <div style={{ width: `${Math.round((p.clicks / (gsc.pages[0].clicks || 1)) * 100)}%`, height: '100%', background: '#34a853', borderRadius: '2px', opacity: 0.7 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  : <EmptyFrame label="/ · /gallery · /contact" />
                }
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Google Analytics ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827' }}>Website Traffic</h2>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>via Google Analytics · {ga?.period ?? 'last 28 days'}</span>
        </div>

        {!ga?.configured && (
          <NotConfiguredCard
            service="Google Analytics"
            envVars={['GA_SERVICE_ACCOUNT_JSON', 'GA_PROPERTY_ID']}
            hint="Add the service account JSON and GA4 property ID to Vercel environment variables."
          />
        )}

        {ga?.configured && ga?.error && (
          <p style={{ color: '#b91c1c', fontSize: '14px', background: '#fef2f2', padding: '12px 16px', borderRadius: '8px' }}>
            GA error: {ga.error}
          </p>
        )}

        {ga?.configured && ga?.totals && (
          <div style={{ display: 'grid', gap: '16px' }}>
            {/* Row 1: volume */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <StatTile label="Sessions" value={ga.totals.sessions?.toLocaleString()} accent="#4285f4" />
              <StatTile label="Active Users" value={ga.totals.users?.toLocaleString()} accent="#34a853" />
              <StatTile label="Page Views" value={ga.totals.pageViews?.toLocaleString()} accent="#fbbc04" />
              <StatTile label="New Users" value={ga.totals.newUsers?.toLocaleString()} accent="#ea4335" />
            </div>
            {/* Row 2: quality */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <StatTile
                label="Engagement Rate"
                value={ga.totals.avgEngagement != null ? `${ga.totals.avgEngagement}%` : '—'}
                sub="Visited 2+ pages or 10s+"
                accent="#4285f4"
              />
              <StatTile
                label="Pages / Session"
                value={ga.totals.avgPagesPerSession != null ? ga.totals.avgPagesPerSession.toFixed(1) : '—'}
                sub="Higher = more exploring"
              />
              <StatTile
                label="Avg Session"
                value={ga.totals.avgDuration != null ? `${Math.floor(ga.totals.avgDuration / 60)}m ${ga.totals.avgDuration % 60}s` : '—'}
              />
              <StatTile
                label="Bounce Rate"
                value={ga.totals.avgBounceRate != null ? `${ga.totals.avgBounceRate}%` : '—'}
                sub="Lower is better"
              />
            </div>

            {/* Daily sessions chart */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Daily sessions</p>
              {ga.daily?.length > 0
                ? <>
                    <MiniBar daily={ga.daily} field="sessions" color="#4285f4" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span style={{ fontSize: '10px', color: '#9ca3af' }}>{ga.daily[0]?.date}</span>
                      <span style={{ fontSize: '10px', color: '#9ca3af' }}>{ga.daily[ga.daily.length - 1]?.date}</span>
                    </div>
                  </>
                : <div style={{ height: '40px', background: '#f9fafb', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#d1d5db' }}>Data will appear as traffic comes in</span>
                  </div>
              }
            </div>

            {/* Device split + Traffic sources */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Device split</p>
                {ga.devices?.length > 0
                  ? <div style={{ display: 'grid', gap: '10px' }}>
                      {ga.devices.map((d) => {
                        const total = ga.devices.reduce((a, x) => a + x.sessions, 0);
                        const pct = total > 0 ? Math.round((d.sessions / total) * 100) : 0;
                        const deviceColor = d.device === 'mobile' ? '#4285f4' : d.device === 'desktop' ? '#34a853' : '#fbbc04';
                        const icon = d.device === 'mobile' ? '📱' : d.device === 'desktop' ? '💻' : '📟';
                        return (
                          <div key={d.device} style={{ display: 'grid', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                              <span style={{ color: '#374151', textTransform: 'capitalize' }}>{icon} {d.device}</span>
                              <span style={{ color: '#6b7280', fontWeight: '700' }}>{pct}% <span style={{ fontWeight: '400', fontSize: '11px' }}>({d.sessions.toLocaleString()})</span></span>
                            </div>
                            <div style={{ height: '5px', background: '#f3f4f6', borderRadius: '3px' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: deviceColor, borderRadius: '3px' }} />
                            </div>
                            {d.engagementRate > 0 && <span style={{ fontSize: '11px', color: '#9ca3af' }}>{d.engagementRate}% engagement</span>}
                          </div>
                        );
                      })}
                    </div>
                  : <EmptyFrame label="📱 Mobile · 💻 Desktop · 📟 Tablet" />
                }
              </div>

              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Traffic sources</p>
                {ga.sources?.length > 0
                  ? <div style={{ display: 'grid', gap: '8px' }}>
                      {ga.sources.map((s) => {
                        const total = ga.sources.reduce((a, x) => a + x.sessions, 0);
                        const pct = total > 0 ? Math.round((s.sessions / total) * 100) : 0;
                        return (
                          <div key={s.channel} style={{ display: 'grid', gap: '3px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                              <span style={{ color: '#374151' }}>{s.channel}</span>
                              <span style={{ color: '#6b7280', fontWeight: '700' }}>{pct}%</span>
                            </div>
                            <div style={{ height: '4px', background: '#f3f4f6', borderRadius: '2px' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: '#4285f4', borderRadius: '2px' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  : <EmptyFrame label="Organic · Direct · Referral · Social" />
                }
              </div>
            </div>

            {/* Top pages + Geo breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top pages</p>
                {ga.topPages?.length > 0
                  ? <div style={{ display: 'grid', gap: '8px' }}>
                      {ga.topPages.map((p) => {
                        const maxViews = Math.max(...ga.topPages.map((x) => x.views), 1);
                        const pct = Math.round((p.views / maxViews) * 100);
                        return (
                          <div key={p.page} style={{ display: 'grid', gap: '3px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <span style={{ flex: 1, fontSize: '13px', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.page}</span>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280', flexShrink: 0 }}>{p.views.toLocaleString()}</span>
                            </div>
                            <div style={{ height: '3px', background: '#f3f4f6', borderRadius: '2px' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: '#fbbc04', borderRadius: '2px' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  : <EmptyFrame label="/ · /gallery · /contact" />
                }
              </div>

              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 4px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Visitor cities</p>
                <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#9ca3af' }}>Are locals finding the site?</p>
                {ga.geo?.length > 0
                  ? <div style={{ display: 'grid', gap: '7px' }}>
                      {ga.geo.map((g) => {
                        const maxSessions = Math.max(...ga.geo.map((x) => x.sessions), 1);
                        const pct = Math.round((g.sessions / maxSessions) * 100);
                        return (
                          <div key={`${g.city}-${g.region}`} style={{ display: 'grid', gap: '3px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                              <span style={{ color: '#374151' }}>{g.city}<span style={{ color: '#9ca3af', fontSize: '11px' }}>, {g.region}</span></span>
                              <span style={{ color: '#6b7280', fontWeight: '700' }}>{g.sessions.toLocaleString()}</span>
                            </div>
                            <div style={{ height: '3px', background: '#f3f4f6', borderRadius: '2px' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: '#34a853', borderRadius: '2px' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  : <EmptyFrame label="Livermore · Dublin · Pleasanton" />
                }
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Leads view ───────────────────────────────────────────────────────────────

function LeadsView() {
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const searchRef = useRef(null);

  const [newCount, setNewCount] = useState(0);

  async function loadLeads(silent = false) {
    if (!silent) setIsLoading(true);
    setLoadError('');
    try {
      const r = await apiCall('/api/admin-leads');
      if (r.status === 401) { sessionStorage.clear(); window.location.reload(); return; }
      const d = await r.json();
      setLeads((prev) => {
        const incoming = d.leads ?? [];
        if (silent && prev.length > 0 && incoming.length > prev.length) {
          setNewCount((n) => n + (incoming.length - prev.length));
        }
        return incoming;
      });
    } catch {
      if (!silent) setLoadError('Failed to load submissions. Check your connection and refresh.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }

  useEffect(() => {
    loadLeads();

    // ── Supabase Realtime: fires the moment a new lead is inserted ──
    let channel = null;
    if (supabasePublic) {
      channel = supabasePublic
        .channel('leads-inserts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => {
          loadLeads(true);
        })
        .subscribe();
    }

    // ── Fallback polling every 30s ──
    const pollInterval = setInterval(() => loadLeads(true), 30_000);

    // ── Page Visibility: refresh immediately when tab regains focus ──
    function onVisibility() {
      if (document.visibilityState === 'visible') loadLeads(true);
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (channel) supabasePublic.removeChannel(channel);
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete submission from "${name}"? This cannot be undone.`)) return;
    const r = await apiCall('/api/admin-leads', { method: 'DELETE', body: { id } });
    if (r.ok) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
      if (expandedId === id) setExpandedId(null);
    }
  }

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

  const totalLeads = leads.length;
  const homeownerLeads = leads.filter((l) => l.form_type === 'homeowner-consultation').length;
  const tradeLeads = leads.filter((l) => l.form_type === 'trade-estimate').length;

  // Stage breakdown — count by stage ID across all pipeline stages
  const stageCountById = {};
  for (const l of leads) {
    if (l.hs_stage_id) {
      stageCountById[l.hs_stage_id] = (stageCountById[l.hs_stage_id] ?? 0) + 1;
    }
  }

  // Search suggestions — up to 6 leads matching current query
  const suggestions = searchQuery.trim().length > 0
    ? leads.filter((l) => {
        const q = searchQuery.toLowerCase();
        const f = l.fields ?? {};
        return (
          `${f.firstName ?? ''} ${f.lastName ?? ''}`.toLowerCase().includes(q) ||
          (f.email ?? '').toLowerCase().includes(q) ||
          (f.phone ?? '').toLowerCase().includes(q) ||
          (f.companyName ?? '').toLowerCase().includes(q)
        );
      }).slice(0, 6)
    : [];

  function selectSuggestion(lead) {
    const f = lead.fields ?? {};
    setSearchQuery(`${f.firstName ?? ''} ${f.lastName ?? ''}`.trim() || f.email || '');
    setExpandedId(lead.id);
    setSearchFocused(false);
    // Scroll to card after render
    setTimeout(() => {
      document.getElementById(`lead-${lead.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '12px' }}>
        {[
          { label: 'Total Submissions', value: totalLeads },
          { label: 'Homeowner Consults', value: homeownerLeads },
          { label: 'Trade Estimates', value: tradeLeads },
        ].map((stat) => (
          <div key={stat.label} style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</p>
            <p style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: '#111827' }}>{isLoading ? '–' : stat.value}</p>
          </div>
        ))}
      </div>

      {/* Stage counts */}
      {/* Pipeline stage view */}
      <div style={{ marginBottom: '28px', padding: '14px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${HS_PIPELINE.length + 1}, 1fr)`, gap: '6px', alignItems: 'stretch', gridAutoRows: '1fr' }}>
          {HS_PIPELINE.map((stage, i) => {
            const ids = Array.isArray(stage.id) ? stage.id : [stage.id];
            const count = ids.reduce((sum, id) => sum + (stageCountById[id] ?? 0), 0);
            const primaryId = ids[0];
            const s = HS_STAGE_COLORS[primaryId] ?? { bg: '#f3f4f6', color: '#6b7280' };
            return (
              <div key={Array.isArray(stage.id) ? stage.id.join('-') : stage.id} style={{ display: 'flex', alignItems: 'stretch', gap: '6px' }}>
                <div style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '5px', padding: '10px 6px', borderRadius: '8px', height: '100%', boxSizing: 'border-box',
                  background: s.bg, border: `1.5px solid ${s.color}22`,
                }}>
                  <span style={{ fontSize: '22px', fontWeight: '900', color: s.color, lineHeight: 1 }}>{count}</span>
                  <span style={{ fontSize: '10px', fontWeight: '700', color: s.color, textAlign: 'center', lineHeight: 1.3 }}>{stage.label}</span>
                </div>
                {i < HS_PIPELINE.length - 1 && (
                  <span style={{ fontSize: '12px', color: '#d1d5db', flexShrink: 0 }}>›</span>
                )}
              </div>
            );
          })}
          {/* Closed Lost */}
          {(() => {
            const count = stageCountById[HS_CLOSED_LOST.id] ?? 0;
            return (
              <div style={{ display: 'flex', alignItems: 'stretch', gap: '6px' }}>
                <div style={{ width: '1px', background: '#e5e7eb', flexShrink: 0 }} />
                <div style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '5px', padding: '10px 6px', borderRadius: '8px', height: '100%', boxSizing: 'border-box',
                  background: '#fee2e2', border: '1.5px solid #fca5a522',
                }}>
                  <span style={{ fontSize: '22px', fontWeight: '900', color: '#991b1b', lineHeight: 1 }}>{count}</span>
                  <span style={{ fontSize: '10px', fontWeight: '700', color: '#991b1b', textAlign: 'center', lineHeight: 1.3 }}>Closed Lost</span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Filters + Search */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden', background: '#ffffff' }}>
          {[{ value: 'all', label: 'All Types' }, { value: 'homeowner-consultation', label: 'Homeowner' }, { value: 'trade-estimate', label: 'Trade' }].map((opt) => (
            <button key={opt.value} onClick={() => setFilterType(opt.value)} style={{ padding: '7px 14px', border: 0, borderRight: '1px solid #e5e7eb', background: filterType === opt.value ? '#78350f' : 'transparent', color: filterType === opt.value ? '#ffffff' : '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search with suggestions */}
        <div ref={searchRef} style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <input
            type="search"
            placeholder="Search by name, email, phone, or company…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchFocused(true); }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            style={{ width: '100%', padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
          />
          {searchFocused && suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, overflow: 'hidden' }}>
              {suggestions.map((lead) => {
                const f = lead.fields ?? {};
                const name = [f.firstName, f.lastName].filter(Boolean).join(' ') || '(no name)';
                const sub = f.companyName || f.email || '';
                return (
                  <button
                    key={lead.id}
                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(lead); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '10px 14px', border: 0, borderBottom: '1px solid #f3f4f6', background: '#fff', cursor: 'pointer' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      {sub && <div style={{ fontSize: '12px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
                    </div>
                    {lead.hs_stage_label && (
                      <HsBadge stageId={lead.hs_stage_id} stageLabel={lead.hs_stage_label} />
                    )}
                    <TypeBadge formType={lead.form_type} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button onClick={loadLeads} style={{ padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: '600' }}>
          Refresh
        </button>
      </div>

      {newCount > 0 && (
        <div
          onClick={() => { setNewCount(0); loadLeads(); }}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', padding: '10px 16px', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', color: '#92400e' }}
        >
          <span style={{ fontSize: '18px' }}>🔔</span>
          {newCount} new submission{newCount !== 1 ? 's' : ''} — click to refresh
        </div>
      )}

      <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#9ca3af' }}>
        {filtered.length} submission{filtered.length !== 1 ? 's' : ''}{(filterType !== 'all' || searchQuery) ? ' (filtered)' : ''}
      </p>

      {isLoading && <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>Loading submissions…</p>}
      {loadError && <p style={{ color: '#b91c1c', padding: '16px', background: '#fef2f2', borderRadius: '8px', fontSize: '14px' }}>{loadError}</p>}
      {!isLoading && !loadError && filtered.length === 0 && (
        <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>
          {leads.length === 0 ? 'No submissions yet.' : 'No submissions match your filters.'}
        </p>
      )}
      {!isLoading && (
        <div style={{ display: 'grid', gap: '10px' }}>
          {filtered.map((lead) => (
            <div key={lead.id} id={`lead-${lead.id}`}>
              <LeadCard lead={lead} isExpanded={expandedId === lead.id} onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)} onDelete={handleDelete} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Login / Setup screens ────────────────────────────────────────────────────

function AuthShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f4f0', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '0 16px' }}>
        <div style={{ background: '#ffffff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.1)' }}>
          <div style={{ background: '#78350f', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <img src="https://caliber-cabinets-site.vercel.app/images/caliber-logo.jpg" alt="Caliber Cabinets" style={{ height: '44px', width: 'auto', borderRadius: '4px', objectFit: 'contain' }} />
            <div>
              <p style={{ margin: 0, color: '#ffffff', fontSize: '18px', fontWeight: '700' }}>Caliber Cabinets</p>
              <p style={{ margin: '2px 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>Lead Management</p>
            </div>
          </div>
          <div style={{ padding: '28px 32px' }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function SetupScreen({ onComplete }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const r = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup', ...form }),
    });
    const d = await r.json();
    if (!r.ok) { setError(d.error ?? 'Setup failed'); setLoading(false); return; }
    onComplete();
  }

  return (
    <AuthShell>
      <p style={{ margin: '0 0 20px', fontSize: '15px', fontWeight: '600', color: '#111827' }}>Create first admin account</p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
        {[['name', 'Full name', 'text'], ['email', 'Email', 'email'], ['password', 'Password', 'password']].map(([key, label, type]) => (
          <div key={key} style={{ display: 'grid', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>{label}</label>
            <input type={type} required value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }} />
          </div>
        ))}
        {error && <p style={{ margin: 0, color: '#b91c1c', fontSize: '13px' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: '10px', background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const r = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email, password }),
    });
    const d = await r.json();
    if (!r.ok) { setError(d.error ?? 'Login failed'); setLoading(false); return; }
    onLogin(d.token, d.user);
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
        <div style={{ display: 'grid', gap: '5px' }}>
          <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }} />
        </div>
        <div style={{ display: 'grid', gap: '5px' }}>
          <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none' }} />
        </div>
        {error && <p style={{ margin: 0, color: '#b91c1c', fontSize: '13px' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: '10px', background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </AuthShell>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { key: 'leads', label: 'Leads', section: null },
  { key: 'site-stats', label: 'Site Stats', section: null },
  { key: 'notifications', label: 'Notifications', section: 'Settings' },
  { key: 'confirmations', label: 'Confirmations', section: 'Settings' },
  { key: 'users', label: 'User Access', section: 'Settings', superAdminOnly: false },
];

function Sidebar({ activeView, onNavigate, currentUser }) {
  const sections = [];
  let lastSection = null;

  for (const item of NAV_ITEMS) {
    if (item.section !== lastSection) {
      sections.push({ type: 'heading', label: item.section });
      lastSection = item.section;
    }
    sections.push({ type: 'item', ...item });
  }

  return (
    <nav style={{ width: '200px', flexShrink: 0, paddingTop: '8px' }}>
      {sections.map((entry, i) => {
        if (entry.type === 'heading') {
          return entry.label ? (
            <p key={i} style={{ margin: '20px 0 6px 16px', fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {entry.label}
            </p>
          ) : null;
        }
        const isActive = activeView === entry.key;
        return (
          <button
            key={entry.key}
            onClick={() => onNavigate(entry.key)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 16px', border: 0, borderRadius: '6px',
              background: isActive ? '#78350f' : 'transparent',
              color: isActive ? '#ffffff' : '#374151',
              fontSize: '14px', fontWeight: isActive ? '700' : '500',
              cursor: 'pointer', marginBottom: '2px',
            }}
          >
            {entry.label}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'setup' | 'login' | 'authed'
  const [currentUser, setCurrentUser] = useState(null);
  const [activeView, setActiveView] = useState('leads');

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    const user = (() => { try { return JSON.parse(sessionStorage.getItem('admin_user') ?? ''); } catch { return null; } })();

    if (token && user) {
      setCurrentUser(user);
      setAuthState('authed');
      return;
    }

    // Check if first-time setup is needed
    fetch('/api/admin-auth')
      .then((r) => r.json())
      .then((d) => setAuthState(d.needsSetup ? 'setup' : 'login'))
      .catch(() => setAuthState('login'));
  }, []);

  function handleLogin(token, user) {
    sessionStorage.setItem('admin_token', token);
    sessionStorage.setItem('admin_user', JSON.stringify(user));
    setCurrentUser(user);
    setAuthState('authed');
  }

  async function handleLogout() {
    await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    sessionStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_user');
    setCurrentUser(null);
    setAuthState('login');
  }

  if (authState === 'loading') return null;
  if (authState === 'setup') return <SetupScreen onComplete={() => setAuthState('login')} />;
  if (authState === 'login') return <LoginScreen onLogin={handleLogin} />;

  function renderView() {
    switch (activeView) {
      case 'notifications': return <NotificationsPanel />;
      case 'confirmations': return <ConfirmationsPanel />;
      case 'users': return <UsersPanel currentUser={currentUser} />;
      case 'site-stats': return <SiteStatsView />;
      default: return <LeadsView />;
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* Header */}
      <header style={{ background: '#78350f', padding: '0 24px', display: 'flex', alignItems: 'center', height: '60px', gap: '16px', position: 'sticky', top: 0, zIndex: 10 }}>
        <img src="https://caliber-cabinets-site.vercel.app/images/caliber-logo.jpg" alt="Caliber Cabinets" style={{ height: '38px', width: 'auto', borderRadius: '4px', objectFit: 'contain' }} />
        <p style={{ margin: 0, color: '#ffffff', fontWeight: '700', fontSize: '16px', flex: 1 }}>
          Caliber Cabinets
          <span style={{ opacity: 0.6, fontWeight: '400', fontSize: '13px', marginLeft: '8px' }}>Lead Management</span>
        </p>
        {currentUser?.name && (
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>{currentUser.name}</span>
        )}
        <button onClick={handleLogout} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: 'rgba(255,255,255,0.8)', padding: '6px 14px', borderRadius: '5px', fontSize: '13px', cursor: 'pointer' }}>
          Sign Out
        </button>
      </header>

      {/* Body */}
      <div style={{ display: 'flex', maxWidth: '1100px', margin: '0 auto', padding: '24px 16px', gap: '24px', alignItems: 'flex-start' }}>
        <Sidebar activeView={activeView} onNavigate={setActiveView} currentUser={currentUser} />
        <main style={{ flex: 1, minWidth: 0 }}>
          {renderView()}
        </main>
      </div>
    </div>
  );
}
