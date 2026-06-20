import { useEffect, useRef, useState } from 'react';

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

  async function loadLeads() {
    setIsLoading(true);
    setLoadError('');
    try {
      const r = await apiCall('/api/admin-leads');
      if (r.status === 401) { sessionStorage.clear(); window.location.reload(); return; }
      const d = await r.json();
      setLeads(d.leads ?? []);
    } catch {
      setLoadError('Failed to load submissions. Check your connection and refresh.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { loadLeads(); }, []);

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

  // Stage breakdown — count by hs_stage_label
  const stageCounts = {};
  for (const l of leads) {
    if (l.hs_stage_label) {
      stageCounts[l.hs_stage_label] = (stageCounts[l.hs_stage_label] ?? 0) + 1;
      if (!stageCounts.__ids) stageCounts.__ids = {};
      stageCounts.__ids[l.hs_stage_label] = l.hs_stage_id;
    }
  }
  const stageEntries = Object.entries(stageCounts).filter(([k]) => k !== '__ids').sort((a, b) => b[1] - a[1]);

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: stageEntries.length > 0 ? '12px' : '28px' }}>
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
      {!isLoading && stageEntries.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '28px', padding: '14px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'center', marginRight: '4px' }}>By Stage</span>
          {stageEntries.map(([label, count]) => {
            const stageId = stageCounts.__ids?.[label];
            const style = HS_STAGE_COLORS[stageId] ?? { bg: '#f3f4f6', color: '#374151' };
            return (
              <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '999px', background: style.bg, color: style.color, fontSize: '12px', fontWeight: '700' }}>
                {label}
                <span style={{ background: style.color, color: style.bg, borderRadius: '999px', padding: '0 5px', fontSize: '11px', fontWeight: '800', lineHeight: '18px', minWidth: '18px', textAlign: 'center' }}>{count}</span>
              </span>
            );
          })}
        </div>
      )}

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
          <div style={{ background: '#78350f', padding: '24px 32px' }}>
            <p style={{ margin: 0, color: '#ffffff', fontSize: '18px', fontWeight: '700' }}>Caliber Cabinets</p>
            <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>Lead Management</p>
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
      default: return <LeadsView />;
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* Header */}
      <header style={{ background: '#78350f', padding: '0 24px', display: 'flex', alignItems: 'center', height: '60px', gap: '16px', position: 'sticky', top: 0, zIndex: 10 }}>
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
