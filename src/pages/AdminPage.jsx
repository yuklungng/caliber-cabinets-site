import { createContext, Fragment, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@supabase/supabase-js';
import { FileDropZone } from '../components/FileDropZone.jsx';
import { uploadFiles } from '../lib/uploadFiles.js';

const supabasePublic = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

// ─── Dark mode ──────────────────────────────────────────────────────────────
// Per-browser preference (see AdminPage). Dark mode is a CSS filter invert
// applied to the main content — but `position: fixed` overlays (dropdowns,
// modals, chart tooltips) can't live inside that filtered subtree: a `filter`
// on an ancestor becomes the containing block for fixed descendants, which
// breaks their viewport-relative positioning the moment the page is scrolled.
// FixedOverlay portals them to <body> instead, in their own unfiltered-by-page
// fixed layer, and applies the same invert directly so they still look dark.
const DarkModeContext = createContext(false);

function FixedOverlay({ children }) {
  const darkMode = useContext(DarkModeContext);
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, ...(darkMode ? { filter: 'invert(1) hue-rotate(180deg)' } : {}) }}>
      <div style={{ pointerEvents: 'auto' }}>{children}</div>
    </div>,
    document.body,
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_LABELS = {
  leadSource: 'Lead Source',
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
  '3869825744':          { bg: '#fef3c7', color: '#92400e' },  // New Request
  qualifiedtobuy:        { bg: '#dbeafe', color: '#1e40af' },  // Qualified
  '3869825755':          { bg: '#ede9fe', color: '#5b21b6' },  // Quote Sent
  contractsent:          { bg: '#bbf7d0', color: '#14532d' },  // Contract Sent
  closedwon:             { bg: '#14532d', color: '#ffffff' },  // Closed Won
  // Exit stages — Caliber-initiated decisions
  '3946621638':          { bg: '#fef9c3', color: '#854d0e' },  // Referred Out
  '3945178856':          { bg: '#ccfbf1', color: '#0f766e' },  // Partnered Out
  '3945178857':          { bg: '#f1f5f9', color: '#475569' },  // Declined
  // Exit stage — customer-initiated
  closedlost:            { bg: '#fee2e2', color: '#991b1b' },  // Lost Deal
  // Legacy Appt/PPT/DM stage IDs — kept for badge display on older leads
  appointmentscheduled:  { bg: '#cffafe', color: '#155e75' },
  presentationscheduled: { bg: '#e0f2fe', color: '#0c4a6e' },
  decisionmakerboughtin: { bg: '#dcfce7', color: '#166534' },
};

// Linear pipeline — active deal lifecycle only
const HS_PIPELINE = [
  { id: '3869825744',   label: 'New Request' },
  { id: 'qualifiedtobuy', label: 'Qualified' },
  { id: '3869825755',   label: 'Quote Sent' },
  { id: 'contractsent', label: 'Contract Sent' },
  { id: 'closedwon',    label: 'Closed Won' },
];

// Exit stages — shown separately from the pipeline (not linear steps)
// group: 'neutral' = Caliber chose to redirect (not a loss)
// group: 'loss'    = deal did not convert (Closed Lost)
const HS_EXIT_STAGES = [
  { id: '3946621638', label: 'Referred Out',       group: 'neutral' }, // Caliber sent them to a better-fit provider
  { id: '3945178856', label: 'Partnered Out',       group: 'neutral' }, // Handled via a trade partner
  { id: '3945178857', label: 'Declined',            group: 'loss'    }, // Not the right fit — gracefully closed
  { id: 'closedlost', label: 'Lost Deal',           group: 'loss'    }, // Customer chose not to proceed — reason captured separately (Competitor/Pricing/Value/Other)
];

// Reasons captured when a deal is moved to the "Lost Deal" stage — required.
const LOST_REASON_OPTIONS = ['Competitor', 'Pricing', 'Value', 'Other'];

// Reasons captured when a deal is moved to the "Declined" stage — required.
// Declined is not a competitive loss (see HS_EXIT_STAGES note above), so it
// gets its own category set rather than reusing LOST_REASON_OPTIONS.
const DECLINED_REASON_OPTIONS = ['Out of Service Area', 'Out of Scope', 'Duplicated', 'Other'];
const DECLINED_STAGE_ID = '3945178857';

// Derived set for fast exit-stage membership checks — used in LeadsView and PerformanceView
const EXIT_STAGE_IDS = new Set(HS_EXIT_STAGES.map((s) => s.id));

// Fully closed/exited deals — Closed Won plus every exit stage (Lost Deal,
// Declined, Referred Out, Partnered Out). Hidden from the default Leads view;
// click the matching stage card to bring them back into view.
const CLOSED_STAGE_IDS = new Set(['closedwon', ...EXIT_STAGE_IDS]);

// Activity checklist — tracked per lead, stored in leads.activities JSONB
const LEAD_ACTIVITIES = [
  { key: 'appt_scheduled', label: 'Appointment Scheduled' },
  { key: 'appt_completed', label: 'Appointment Completed' },
];

// Default win-probability % per pipeline stage (editable in Settings > Financial).
// Exit stages (Won/Lost/Declined) are not configurable — they're terminal.
const DEFAULT_STAGE_FORECAST = [
  { id: '3869825744', label: 'New Request',    probability: 15 },
  { id: 'qualifiedtobuy', label: 'Qualified',  probability: 30 },
  { id: '3869825755', label: 'Quote Sent',     probability: 45 },
  { id: 'contractsent', label: 'Contract Sent', probability: 75 },
];

const SORT_OPTIONS = [
  { key: 'newest',     label: '↓ Newest' },
  { key: 'oldest',     label: '↑ Oldest' },
  { key: 'quote-desc', label: '$ High→Low' },
  { key: 'quote-asc',  label: '$ Low→High' },
  { key: 'prob-desc',  label: '% High→Low' },
  { key: 'prob-asc',   label: '% Low→High' },
  { key: 'name-asc',   label: 'A→Z Name' },
  { key: 'name-desc',  label: 'Z→A Name' },
];

const FINANCIAL_SORT_OPTIONS = [
  { key: 'newest',        label: '↓ Newest' },
  { key: 'oldest',        label: '↑ Oldest' },
  { key: 'contract-desc', label: 'Contract High→Low' },
  { key: 'contract-asc',  label: 'Contract Low→High' },
  { key: 'balance-desc',  label: 'Balance High→Low' },
  { key: 'balance-asc',   label: 'Balance Low→High' },
  { key: 'name-asc',      label: 'A→Z Name' },
  { key: 'name-desc',     label: 'Z→A Name' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Business-hours time math ──────────────────────────────────────────────
// All "days" KPIs on this page (response time, time to quote, full cycle,
// stale-deal age, stage velocity) count ONLY business time: Mon–Fri,
// 8:00 AM–5:00 PM Pacific. Evenings, nights, and weekends never accrue.
// A "business day" = 9 hours (8am–5pm). This keeps team-performance metrics
// honest — a lead that sits overnight or over a weekend isn't a slow response.
const BIZ_TZ = 'America/Los_Angeles';
const BIZ_START_HOUR = 8;   // 8:00 AM Pacific
const BIZ_END_HOUR = 17;    // 5:00 PM Pacific
const BIZ_HOURS_PER_DAY = BIZ_END_HOUR - BIZ_START_HOUR; // 9
const BIZ_HOURS_LABEL = 'Mon–Fri, 8am–5pm Pacific';

// Convert Y/M/D + local hour/min/sec in `timeZone` to the equivalent UTC Date.
// Standard double-conversion trick — handles DST correctly since it reads the
// real UTC offset for that specific date rather than assuming a fixed offset.
function zonedTimeToUtc(y, m, d, h, mi, s, timeZone) {
  const asUTC = Date.UTC(y, m - 1, d, h, mi, s);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(asUTC))) if (p.type !== 'literal') map[p.type] = p.value;
  const asIfLocal = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return new Date(asUTC + (asUTC - asIfLocal));
}

// Y/M/D of a UTC instant, as seen in `timeZone`.
function getZonedYMD(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const map = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = p.value;
  return { y: +map.year, m: +map.month, d: +map.day };
}

// Milliseconds of overlap between [startD, endD] and business hours
// (Mon–Fri, 8am–5pm Pacific), summed across every day in the range.
function businessMsBetween(startD, endD) {
  if (endD <= startD) return 0;
  let total = 0;
  const { y: sy, m: sm, d: sd } = getZonedYMD(startD, BIZ_TZ);
  const { y: ey, m: em, d: ed } = getZonedYMD(endD, BIZ_TZ);
  let cursor = Date.UTC(sy, sm - 1, sd);
  const last = Date.UTC(ey, em - 1, ed);

  let guard = 0; // safety cap (~10 years of days) against runaway loops on bad data
  while (cursor <= last && guard < 3700) {
    guard++;
    const cd = new Date(cursor);
    const weekday = cd.getUTCDay(); // 0=Sun..6=Sat — safe: cursor is a plain calendar date
    if (weekday >= 1 && weekday <= 5) {
      const y = cd.getUTCFullYear(), m = cd.getUTCMonth() + 1, d = cd.getUTCDate();
      const dayStart = zonedTimeToUtc(y, m, d, BIZ_START_HOUR, 0, 0, BIZ_TZ);
      const dayEnd = zonedTimeToUtc(y, m, d, BIZ_END_HOUR, 0, 0, BIZ_TZ);
      const overlapStart = dayStart > startD ? dayStart : startD;
      const overlapEnd = dayEnd < endD ? dayEnd : endD;
      if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart);
    }
    cursor += 24 * 60 * 60 * 1000; // next calendar day
  }
  return total;
}

// Business time between two timestamps, in "business day" units where
// 1.0 = one full business day (9 hours). Returns null for missing/invalid
// input (mirrors the old daysBetween contract used to filter bad samples).
function businessDaysBetween(start, end) {
  if (!start) return null;
  const startD = new Date(start);
  const endD = new Date(end ?? Date.now());
  if (isNaN(startD) || isNaN(endD) || endD <= startD) return null;
  return businessMsBetween(startD, endD) / (BIZ_HOURS_PER_DAY * 60 * 60 * 1000);
}
// Best available "last touched" timestamp for stale-lead detection: prefer
// HubSpot's Last Activity Date (note/call/email/meeting/task logged on the
// deal — updates whether that activity was logged from HubSpot directly or
// pushed by this admin panel), fall back to the stage-change timestamp, then
// lead creation date, so a lead with zero logged activity still ages out
// instead of never going stale.
function leadActivityDate(lead) {
  return lead.hs_last_activity_date ?? lead.hs_stage_date ?? lead.created_at ?? null;
}
function formatDays(days) {
  if (days === null || days === undefined) return '—';
  if (days < 1) return `${Math.round(days * BIZ_HOURS_PER_DAY)}h`;
  if (days < 2) return '1d';
  return `${Math.round(days)}d`;
}
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

// ─── Responsive hook ──────────────────────────────────────────────────────────
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < breakpoint);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, [breakpoint]);
  return isMobile;
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

function StagePicker({ lead, pipelineStages, exitStages, onStageChange }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, maxH: 300, flipUp: false });
  const [exitReasonPrompt, setExitReasonPrompt] = useState(null); // pending stage object, or null (closedlost or Declined)
  const triggerRef = useRef(null);
  const allStages = [...(pipelineStages ?? []), ...(exitStages ?? [])];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      const drop = document.getElementById('stage-picker-dropdown');
      if (triggerRef.current && !triggerRef.current.contains(e.target) && !drop?.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  if (!lead.hubspot_deal_id) {
    return <HsBadge stageId={lead.hs_stage_id} stageLabel={lead.hs_stage_label} stageDate={lead.hs_stage_date} />;
  }

  // Actually commits a stage change to the API + local state. `reason`/`detail`
  // are only sent for the closedlost and Declined stages, which each map to
  // their own pair of API fields and Supabase/HubSpot columns.
  async function commitStageChange(stage, reason, detail) {
    setSaving(true);
    try {
      const isLost     = stage.id === 'closedlost';
      const isDeclined = stage.id === DECLINED_STAGE_ID;
      await apiCall('/api/admin-leads', {
        method: 'PATCH',
        body: {
          dealId: lead.hubspot_deal_id, stageId: stage.id, stageLabel: stage.label,
          ...(isLost && reason ? { lostReason: reason, lostReasonDetail: detail } : {}),
          ...(isDeclined && reason ? { declinedReason: reason, declinedReasonDetail: detail } : {}),
        },
      });
      const localUpdate = isLost && reason
        ? { lost_reason: reason, lost_reason_detail: detail?.trim() || null }
        : isDeclined && reason
        ? { declined_reason: reason, declined_reason_detail: detail?.trim() || null }
        : undefined;
      onStageChange(lead.id ?? lead.hubspot_deal_id, stage, localUpdate);
    } catch { /* non-fatal */ }
    setSaving(false);
  }

  async function selectStage(stage) {
    if (stage.id === lead.hs_stage_id) { setOpen(false); return; }
    setOpen(false);
    // Lost Deal and Declined both require a reason first — hold off on the
    // API call until confirmed.
    if (stage.id === 'closedlost' || stage.id === DECLINED_STAGE_ID) { setExitReasonPrompt(stage); return; }
    await commitStageChange(stage);
  }

  function handleClick(e) {
    e.stopPropagation();
    if (saving) return;
    if (!open && triggerRef.current) {
      const rect  = triggerRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const ESTIMATE = Math.min(allStages.length * 41 + 32, 360);
      const flipUp  = below < ESTIMATE && above > below;
      setPos({
        top:    flipUp ? rect.top - Math.min(above, ESTIMATE) - 4 : rect.bottom + 4,
        left:   rect.left,
        maxH:   flipUp ? Math.min(above, ESTIMATE) : Math.min(below, ESTIMATE),
        flipUp,
      });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <span
        ref={triggerRef}
        onClick={handleClick}
        title="Click to change stage"
        style={{ cursor: saving ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      >
        <HsBadge stageId={lead.hs_stage_id} stageLabel={lead.hs_stage_label} stageDate={lead.hs_stage_date} />
        <span style={{ fontSize: '10px', color: '#9ca3af', lineHeight: 1 }}>▾</span>
      </span>
      {open && (
        <FixedOverlay>
        <div
          id="stage-picker-dropdown"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: '200px', maxHeight: `${pos.maxH}px`, overflowY: 'auto' }}
        >
          {/* ── Pipeline stages ── */}
          <div style={{ padding: '6px 12px 4px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Pipeline</div>
          {(pipelineStages ?? []).map((stage) => {
            const isActive = stage.id === lead.hs_stage_id;
            const stageStyle = HS_STAGE_COLORS[stage.id] ?? { bg: '#f3f4f6', color: '#374151' };
            return (
              <button
                key={stage.id}
                onMouseDown={(e) => { e.preventDefault(); selectStage(stage); }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 0, borderBottom: '1px solid #f3f4f6', background: isActive ? '#f9fafb' : '#fff', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stageStyle.bg, border: `2px solid ${stageStyle.color}`, flexShrink: 0 }} />
                <span style={{ fontSize: '13px', fontWeight: isActive ? '700' : '500', color: '#111827' }}>{stage.label}</span>
                {isActive && <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9ca3af' }}>current</span>}
              </button>
            );
          })}
          {/* ── Exit stages ── */}
          <div style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', borderTop: '1px solid #e5e7eb', marginTop: '2px' }}>Close / Exit</div>
          {(exitStages ?? []).map((stage) => {
            const isActive = stage.id === lead.hs_stage_id;
            const stageStyle = HS_STAGE_COLORS[stage.id] ?? { bg: '#f3f4f6', color: '#374151' };
            return (
              <button
                key={stage.id}
                onMouseDown={(e) => { e.preventDefault(); selectStage(stage); }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 0, borderBottom: '1px solid #f3f4f6', background: isActive ? '#f9fafb' : '#fff', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stageStyle.bg, border: `2px solid ${stageStyle.color}`, flexShrink: 0 }} />
                <span style={{ fontSize: '13px', fontWeight: isActive ? '700' : '500', color: '#111827' }}>{stage.label}</span>
                {isActive && <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9ca3af' }}>current</span>}
              </button>
            );
          })}
        </div>
        </FixedOverlay>
      )}
      {exitReasonPrompt && (
        <ReasonPromptModal
          heading={exitReasonPrompt.id === DECLINED_STAGE_ID ? 'Why was this lead declined?' : 'Why was this deal lost?'}
          subheading={exitReasonPrompt.id === DECLINED_STAGE_ID
            ? 'A reason is required so this shows up correctly in the declined-reason breakdown.'
            : 'A reason is required so this shows up correctly in the lost-deal breakdown.'}
          options={exitReasonPrompt.id === DECLINED_STAGE_ID ? DECLINED_REASON_OPTIONS : LOST_REASON_OPTIONS}
          confirmLabel={exitReasonPrompt.id === DECLINED_STAGE_ID ? 'Confirm Declined' : 'Confirm Lost Deal'}
          onCancel={() => setExitReasonPrompt(null)}
          onConfirm={async (reason, detail) => {
            const stage = exitReasonPrompt;
            setExitReasonPrompt(null);
            await commitStageChange(stage, reason, detail);
          }}
        />
      )}
    </>
  );
}

// ─── Reason prompt modal — required when a deal moves to the Lost Deal or ───
// ─── Declined stage. Same UX, different heading/options per stage.        ───

function ReasonPromptModal({ heading, subheading, options, confirmLabel, initialReason = null, initialDetail = '', onCancel, onConfirm }) {
  const [reason, setReason] = useState(initialReason);
  const [detail, setDetail] = useState(initialDetail);
  const [submitting, setSubmitting] = useState(false);

  const needsDetail = reason === 'Other';
  const canConfirm = reason !== null && (!needsDetail || detail.trim().length > 0);

  async function handleConfirm() {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    await onConfirm(reason, detail);
  }

  return (
    <FixedOverlay>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onMouseDown={(e) => e.stopPropagation()}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '28px 24px', maxWidth: '420px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: '700', color: '#111827' }}>{heading}</h3>
        <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#6b7280' }}>
          {subheading}
        </p>
        <div style={{ display: 'grid', gap: '8px', marginBottom: needsDetail ? '14px' : '22px' }}>
          {options.map((opt) => (
            <label
              key={opt}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                border: `1.5px solid ${reason === opt ? '#78350f' : '#e5e7eb'}`,
                background: reason === opt ? '#fff7ed' : '#fff',
                borderRadius: '8px', cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="exit-reason"
                value={opt}
                checked={reason === opt}
                onChange={() => setReason(opt)}
                style={{ accentColor: '#78350f' }}
              />
              <span style={{ fontSize: '14px', fontWeight: reason === opt ? '700' : '500', color: '#111827' }}>{opt}</span>
            </label>
          ))}
        </div>
        {needsDetail && (
          <div style={{ marginBottom: '22px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Please describe the reason
            </label>
            <textarea
              autoFocus
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="What happened?"
              rows={3}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{ padding: '8px 18px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || submitting}
            style={{ padding: '8px 18px', border: 0, borderRadius: '6px', background: canConfirm ? '#78350f' : '#d1d5db', color: '#fff', fontSize: '13px', fontWeight: '700', cursor: canConfirm && !submitting ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </FixedOverlay>
  );
}

// ─── Editable Declined-reason badge — click to correct a mis-picked reason ──
// ─── (e.g. picked "Other" by mistake) without re-running the full stage-   ──
// ─── change flow. Reuses ReasonPromptModal, pre-filled with the current   ──
// ─── reason/detail, and saves via the lightweight declined-reason PATCH.  ──
function EditableDeclinedBadge({ lead, onDeclinedReasonChange }) {
  const [editing, setEditing] = useState(false);
  if (!lead.declined_reason) return null;

  async function handleConfirm(reason, detail) {
    try {
      await apiCall('/api/admin-leads?action=declined-reason', {
        method: 'PATCH',
        body: { dealId: lead.hubspot_deal_id, declinedReason: reason, declinedReasonDetail: detail },
      });
      onDeclinedReasonChange(lead.id ?? lead.hubspot_deal_id, reason, detail?.trim() || null);
    } catch { /* non-fatal */ }
    setEditing(false);
  }

  return (
    <>
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title={`${lead.declined_reason_detail ? `Declined reason: ${lead.declined_reason} — ${lead.declined_reason_detail}` : `Declined reason: ${lead.declined_reason}`} — click to correct`}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '600', color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '4px', padding: '2px 8px', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        Declined: {lead.declined_reason}{lead.declined_reason_detail ? ` — ${lead.declined_reason_detail}` : ''}
        <span style={{ fontSize: '9px', opacity: 0.7, flexShrink: 0 }}>▾</span>
      </span>
      {editing && (
        <ReasonPromptModal
          heading="Correct the declined reason"
          subheading="Pick the right reason — useful if the wrong one was selected by mistake."
          options={DECLINED_REASON_OPTIONS}
          confirmLabel="Save Reason"
          initialReason={lead.declined_reason}
          initialDetail={lead.declined_reason_detail ?? ''}
          onCancel={() => setEditing(false)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

const SOURCE_OPTIONS = ['Website', 'Phone Call', 'Referral', 'Repeat Client', 'Trade Show', 'Walk-in', 'Other'];

// ─── Add Lead Modal ───────────────────────────────────────────────────────────

const MANUAL_SOURCE_OPTIONS = ['Phone Call', 'Referral', 'Repeat Client', 'Trade Show', 'Walk-in', 'HubSpot (Direct)', 'Other'];

const AL_PROJECT_TYPES    = ['Kitchen', 'Bathroom', 'Closet', 'Garage', 'Entertainment Center', 'Other'];
const AL_TIMELINE_OPTIONS = ['As soon as possible', '1–3 months', '3–6 months', '6+ months'];
const AL_TRADE_TYPES      = ['Interior Designer', 'General Contractor', 'Architect', 'Builder / Developer', 'Remodeling Contractor', 'Other'];
const AL_PREFERRED_CONTACT = ['Phone', 'Email', 'Either'];
const AL_INSTALL_TIMELINE  = ['1-2 Months', '3-6 Months', '6-12 Months', 'Other'];
const AL_CONSTRUCTION      = ['Face Frame, 1/8" Reveal, Full Overlay', 'Flush Inset Doors / Drawer Fronts', 'Frame-less (European Style), Full Overlay', 'Other (explain in comments)'];
const AL_CROWN             = ['Traditional Crown Molding', 'Flat Crown Molding', 'No Molding / Shadow Line', 'Other (explain in comments)'];
const AL_DOOR_STYLE        = ['Slab Door', 'Shaker Door / Flat Panel', 'Raised Panel', 'Other (attach photo or explain)'];
const AL_WOOD_SPECIES      = ['Painted Cabinetry', 'Maple', 'Cherry', 'Alder', 'Beech', 'Hickory / Pecan', 'Red Oak', 'White Oak', 'Rift Oak', 'Quarter Sawn Oak', 'Walnut', 'Bamboo', 'Cleaf / Laminate', 'Vertical Grain Fir', 'Other (explain in comments)'];
const AL_AREAS             = ['Kitchen', 'Bathroom(s)', 'Entertainment Center', 'Closet Cabinetry', 'Fireplace Mantle', 'Garage', 'Other'];
const AL_ACCESSORIES       = ['Panelized Ends', 'Base Pull-Outs', 'Spice Rack / Drawers', 'Solid Wood Dovetail Drawer Boxes', 'Roll-Out Drawers', 'Two-Tier Silverware Drawer', 'LED Lighting', 'Lazy Susan', 'Lemans II', 'Other (explain in comments)'];
const AL_STATES            = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','American Samoa','Guam','Northern Mariana Islands','Puerto Rico','U.S. Virgin Islands'];

/** Auto-formats a phone string to (###)###-#### as the user types */
function formatPhoneInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ── Shared styles for AddLeadModal — defined at module level so extracted sub-components
// can reference them without re-creating objects on every render.
const AL_INP  = { width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#fff' };
const AL_LBL  = { display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' };
const AL_G2   = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' };
const AL_SEC  = { margin: '16px 0 10px', fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #f3f4f6', paddingBottom: '6px' };
const AL_MB12 = { marginBottom: '12px' };

// Must be defined outside AddLeadModal — inline component definitions cause remount on every
// keystroke, losing focus after a single character.
function AddressBlock({ fields, setF }) {
  return (
    <>
      <div style={AL_MB12}>
        <label style={AL_LBL}>Street Address</label>
        <input style={AL_INP} autoComplete="off" value={fields.streetAddress || ''} onChange={(e) => setF('streetAddress', e.target.value)} />
      </div>
      <div style={AL_G2}>
        <div>
          <label style={AL_LBL}>City</label>
          <input style={AL_INP} autoComplete="off" value={fields.city || ''} onChange={(e) => setF('city', e.target.value)} />
        </div>
        <div>
          <label style={AL_LBL}>State</label>
          <select style={AL_INP} value={fields.state || 'California'} onChange={(e) => setF('state', e.target.value)}>
            {AL_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div style={AL_MB12}>
        <label style={AL_LBL}>ZIP Code</label>
        <input style={AL_INP} autoComplete="off" value={fields.zipCode || ''} onChange={(e) => setF('zipCode', e.target.value)} />
      </div>
    </>
  );
}

function AddLeadCheckGrid({ options, cols = 2, values, onToggle }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '6px', marginTop: '6px' }}>
      {options.map((o) => (
        <label key={o} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '12px', cursor: 'pointer', lineHeight: 1.4 }}>
          <input type="checkbox" style={{ marginTop: '2px', flexShrink: 0 }} checked={(values || []).includes(o)} onChange={() => onToggle(o)} />
          {o}
        </label>
      ))}
    </div>
  );
}

function AddLeadModal({ onClose, onAdded }) {
  const [formType, setFormType]       = useState('homeowner-consultation');
  const [fields, setFields]           = useState({ leadSource: 'Phone Call', state: 'California' });
  const [phone, setPhone]             = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const [isSaving, setIsSaving]       = useState(false);
  const [error, setError]             = useState('');

  function setF(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }
  function toggleArr(key, value) {
    setFields((prev) => {
      const arr = Array.isArray(prev[key]) ? prev[key] : [];
      return { ...prev, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  }
  function switchType(type) {
    setFormType(type);
    setPhone('');
    setSelectedFiles([]);
    setUploadError('');
    setFields({ leadSource: fields.leadSource || 'Phone Call', state: 'California' });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setUploadError('');
    setIsSaving(true);
    try {
      let attachments = [];
      if (selectedFiles.length > 0) {
        try {
          attachments = await uploadFiles(selectedFiles, formType);
        } catch (uploadErr) {
          setUploadError(uploadErr.message);
          setIsSaving(false);
          return;
        }
      }
      const r = await apiCall('/api/admin-leads?action=add-lead', {
        method: 'POST',
        body: { formType, fields: { ...fields, phone, attachments } },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to add lead');
      onAdded(data.lead);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  // Alias module-level style constants with short names used throughout this component's JSX
  const inp  = AL_INP;
  const lbl  = AL_LBL;
  const g2   = AL_G2;
  const sec  = AL_SEC;
  const mb12 = AL_MB12;
  const req  = <span style={{ color: '#b91c1c' }}> *</span>;

  return (
    <FixedOverlay>
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          <span style={{ fontSize: '16px', fontWeight: '700', color: '#111827' }}>Add Lead</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>

          {/* Form type toggle */}
          <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden', marginBottom: '16px' }}>
            {[['homeowner-consultation', '🏠 Homeowner'], ['trade-estimate', '🔧 Trade Partner']].map(([type, label]) => (
              <button key={type} onClick={() => switchType(type)}
                style={{ flex: 1, padding: '8px', border: 0, background: formType === type ? '#78350f' : 'transparent', color: formType === type ? '#fff' : '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>

          {/* Lead Source — highlighted at top */}
          <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
            <label style={lbl}>Lead Source{req}</label>
            <select value={fields.leadSource || ''} onChange={(e) => setF('leadSource', e.target.value)} required style={inp}>
              {MANUAL_SOURCE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <form id="add-lead-form" autoComplete="off" onSubmit={handleSubmit}>
            {formType === 'homeowner-consultation' ? (
              <>
                <p style={sec}>Contact Information</p>
                <div style={g2}>
                  <div><label style={lbl}>First Name{req}</label><input style={inp} required value={fields.firstName || ''} onChange={(e) => setF('firstName', e.target.value)} /></div>
                  <div><label style={lbl}>Last Name{req}</label><input style={inp} required value={fields.lastName || ''} onChange={(e) => setF('lastName', e.target.value)} /></div>
                </div>
                <div style={g2}>
                  <div><label style={lbl}>Phone{req}</label><input style={inp} required type="tel" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} placeholder="(925)555-1234" pattern="\(\d{3}\)\d{3}-\d{4}" title="10-digit US phone" maxLength={13} /></div>
                  <div><label style={lbl}>Email{req}</label><input style={inp} required type="email" value={fields.email || ''} onChange={(e) => setF('email', e.target.value)} /></div>
                </div>

                <p style={sec}>Project Details</p>
                <div style={g2}>
                  <div>
                    <label style={lbl}>Project Type</label>
                    <select style={inp} value={fields.projectType || ''} onChange={(e) => setF('projectType', e.target.value)}>
                      <option value="">Select type</option>
                      {AL_PROJECT_TYPES.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Timeline</label>
                    <select style={inp} value={fields.timeline || ''} onChange={(e) => setF('timeline', e.target.value)}>
                      <option value="">Select timeline</option>
                      {AL_TIMELINE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                <AddressBlock fields={fields} setF={setF} />
                <div style={mb12}><label style={lbl}>Description</label><textarea style={{ ...inp, resize: 'vertical' }} rows={3} value={fields.description || ''} onChange={(e) => setF('description', e.target.value)} /></div>
                <div style={mb12}><label style={lbl}>Inspiration / Links</label><textarea style={{ ...inp, resize: 'vertical' }} rows={2} placeholder="Links, style references, or description of vision" value={fields.inspiration || ''} onChange={(e) => setF('inspiration', e.target.value)} /></div>

                <p style={sec}>Photos &amp; Files</p>
                <FileDropZone
                  accept=".jpg,.jpeg,.png,.pdf"
                  multiple
                  hint="JPG, PNG, or PDF — up to 10MB each, max 5 files"
                  selectedFiles={selectedFiles}
                  onChange={(files) => { setSelectedFiles(files); setUploadError(''); }}
                  error={uploadError}
                />
              </>
            ) : (
              <>
                <p style={sec}>Trade Professional</p>
                <div style={{ ...mb12, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                    <input type="checkbox" style={{ marginTop: '2px' }} checked={!!fields.needsDesignServices} onChange={(e) => setF('needsDesignServices', e.target.checked)} />
                    <span><strong>Client needs Design &amp; Measure services</strong> — $875 deposit (5 hrs × $175/hr), credited toward purchase</span>
                  </label>
                </div>
                <div style={g2}>
                  <div><label style={lbl}>First Name{req}</label><input style={inp} required value={fields.firstName || ''} onChange={(e) => setF('firstName', e.target.value)} /></div>
                  <div><label style={lbl}>Last Name{req}</label><input style={inp} required value={fields.lastName || ''} onChange={(e) => setF('lastName', e.target.value)} /></div>
                </div>
                <div style={mb12}><label style={lbl}>Company / Firm Name</label><input style={inp} value={fields.companyName || ''} onChange={(e) => setF('companyName', e.target.value)} /></div>
                <div style={g2}>
                  <div><label style={lbl}>Phone{req}</label><input style={inp} required type="tel" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} placeholder="(925)555-1234" pattern="\(\d{3}\)\d{3}-\d{4}" title="10-digit US phone" maxLength={13} /></div>
                  <div><label style={lbl}>Email{req}</label><input style={inp} required type="email" value={fields.email || ''} onChange={(e) => setF('email', e.target.value)} /></div>
                </div>
                <div style={g2}>
                  <div>
                    <label style={lbl}>Trade Role</label>
                    <select style={inp} value={fields.tradeRole || ''} onChange={(e) => setF('tradeRole', e.target.value)}>
                      <option value="">Select role</option>
                      {AL_TRADE_TYPES.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div><label style={lbl}>License #</label><input style={inp} value={fields.licenseNumber || ''} onChange={(e) => setF('licenseNumber', e.target.value)} /></div>
                </div>
                <div style={g2}>
                  <div>
                    <label style={lbl}>Preferred Contact</label>
                    <select style={inp} value={fields.preferredContact || ''} onChange={(e) => setF('preferredContact', e.target.value)}>
                      <option value="">Select</option>
                      {AL_PREFERRED_CONTACT.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div><label style={lbl}>GC Name &amp; Phone <span style={{ fontWeight: 400, color: '#9ca3af' }}>(if different)</span></label><input style={inp} value={fields.gcNameAndPhone || ''} onChange={(e) => setF('gcNameAndPhone', e.target.value)} /></div>
                </div>

                <p style={sec}>Client Information</p>
                <div style={g2}>
                  <div><label style={lbl}>Client First Name</label><input style={inp} value={fields.clientFirstName || ''} onChange={(e) => setF('clientFirstName', e.target.value)} /></div>
                  <div><label style={lbl}>Client Last Name</label><input style={inp} value={fields.clientLastName || ''} onChange={(e) => setF('clientLastName', e.target.value)} /></div>
                </div>
                <AddressBlock fields={fields} setF={setF} />

                <p style={sec}>Project Scope</p>
                <div style={mb12}>
                  <label style={lbl}>Areas Requiring Cabinetry</label>
                  <AddLeadCheckGrid options={AL_AREAS} cols={2} values={fields.areasRequiringCabinetry} onToggle={(v) => toggleArr('areasRequiringCabinetry', v)} />
                </div>
                <div style={mb12}>
                  <label style={lbl}>Installation Timeline</label>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {AL_INSTALL_TIMELINE.map((o) => (
                      <label key={o} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', cursor: 'pointer' }}>
                        <input type="radio" name="al-install-timeline" checked={fields.installationTimeline === o} onChange={() => setF('installationTimeline', o)} />
                        {o.replace(/-/g, '–')}
                      </label>
                    ))}
                  </div>
                </div>

                <p style={sec}>Materials &amp; Specifications</p>
                <div style={g2}>
                  <div>
                    <label style={lbl}>Construction Method</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                      {AL_CONSTRUCTION.map((o) => (
                        <label key={o} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '12px', cursor: 'pointer', lineHeight: 1.4 }}>
                          <input type="radio" name="al-construction" style={{ marginTop: '2px', flexShrink: 0 }} checked={fields.constructionMethod === o} onChange={() => setF('constructionMethod', o)} />
                          {o}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Crown Molding</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                      {AL_CROWN.map((o) => (
                        <label key={o} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '12px', cursor: 'pointer', lineHeight: 1.4 }}>
                          <input type="radio" name="al-crown" style={{ marginTop: '2px', flexShrink: 0 }} checked={fields.crownMolding === o} onChange={() => setF('crownMolding', o)} />
                          {o}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={mb12}>
                  <label style={lbl}>Door Style</label>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {AL_DOOR_STYLE.map((o) => (
                      <label key={o} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', cursor: 'pointer' }}>
                        <input type="radio" name="al-door-style" checked={fields.doorStyle === o} onChange={() => setF('doorStyle', o)} />
                        {o}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={mb12}>
                  <label style={lbl}>Wood Species / Material <span style={{ fontWeight: 400, color: '#9ca3af' }}>(select all that apply)</span></label>
                  <AddLeadCheckGrid options={AL_WOOD_SPECIES} cols={2} values={fields.woodSpecies} onToggle={(v) => toggleArr('woodSpecies', v)} />
                </div>

                <p style={sec}>Accessories &amp; Notes</p>
                <div style={mb12}>
                  <label style={lbl}>Accessories &amp; Upgrades</label>
                  <AddLeadCheckGrid options={AL_ACCESSORIES} cols={2} values={fields.accessories} onToggle={(v) => toggleArr('accessories', v)} />
                </div>
                <div style={mb12}><label style={lbl}>Comments</label><textarea style={{ ...inp, resize: 'vertical' }} rows={3} value={fields.comments || ''} onChange={(e) => setF('comments', e.target.value)} /></div>

                <p style={sec}>Files</p>
                <FileDropZone
                  accept=".pdf,.dwg,.jpg,.jpeg,.png"
                  multiple
                  hint="PDF, DWG, JPG, or PNG — up to 10MB each, max 5 files"
                  selectedFiles={selectedFiles}
                  onChange={(files) => { setSelectedFiles(files); setUploadError(''); }}
                  error={uploadError}
                />
              </>
            )}
          </form>
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
          {error && <span style={{ flex: 1, fontSize: '13px', color: '#b91c1c' }}>{error}</span>}
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', fontSize: '13px', cursor: 'pointer', color: '#374151' }}>Cancel</button>
          <button form="add-lead-form" type="submit" disabled={isSaving} style={{ padding: '8px 20px', border: 0, borderRadius: '6px', background: '#78350f', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.7 : 1 }}>
            {isSaving ? 'Saving…' : '+ Add Lead'}
          </button>
        </div>
      </div>
    </div>
    </FixedOverlay>
  );
}

// ─── Quote Amount — inline-editable dollar field that syncs to HubSpot deal amount ──
function QuoteAmountField({ lead, onAmountChange }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw]         = useState('');
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef(null);

  // Only Supabase-backed leads have a local id to write to
  if (!lead.id) return null;

  const current = lead.fields?.quote_amount;

  function startEdit(e) {
    e.stopPropagation();
    setRaw(current != null ? String(current) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function save(e) {
    e?.stopPropagation();
    setEditing(false);
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const parsed  = cleaned !== '' ? parseFloat(cleaned) : null;
    const amount  = parsed != null && parsed > 0 ? parsed : null; // 0 or blank → clear
    // Skip API call if nothing changed
    if (amount === (current ?? null)) return;
    setSaving(true);
    try {
      await apiCall('/api/admin-leads?action=quote-amount', {
        method: 'PATCH',
        body: { id: lead.id, hubspot_deal_id: lead.hubspot_deal_id ?? null, quote_amount: amount },
      });
      onAmountChange(lead.id, amount);
    } catch (err) {
      console.error('[QuoteAmountField] save failed:', err);
    }
    setSaving(false);
  }

  function handleKeyDown(e) {
    e.stopPropagation();
    if (e.key === 'Enter')  save(e);
    if (e.key === 'Escape') { setEditing(false); }
  }

  const formatted = current != null
    ? `$${Number(current).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : null;

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }} onClick={(e) => e.stopPropagation()}>
        <span style={{ fontSize: '13px', color: '#374151', fontWeight: '600' }}>$</span>
        <input
          ref={inputRef}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          placeholder="0"
          style={{ width: '88px', padding: '2px 6px', border: '1px solid #78350f', borderRadius: '4px', fontSize: '13px', outline: 'none', color: '#111827' }}
        />
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      disabled={saving}
      title="Set quote amount — syncs to HubSpot deal amount"
      style={{
        background: formatted ? '#fef9ee' : 'transparent',
        border: formatted ? '1px solid #fde68a' : '1px dashed #d1d5db',
        borderRadius: '4px',
        padding: '2px 9px',
        fontSize: '13px',
        fontWeight: formatted ? '700' : '400',
        color: formatted ? '#92400e' : '#9ca3af',
        cursor: saving ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {saving ? '…' : (formatted ?? '+ Quote')}
    </button>
  );
}

// ─── Per-deal probability — shows resolved % (stage default or per-deal override) ──
function ProbabilityField({ lead, stageProbabilities, onProbabilityChange }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw]         = useState('');
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef(null);

  // Only for Supabase-backed leads with a quote amount on active pipeline stages
  if (!lead.id || !lead.fields?.quote_amount) return null;
  if (EXIT_STAGE_IDS.has(lead.hs_stage_id)) return null;

  const override     = lead.fields?.probability; // explicit per-deal value, or null
  const stageDef     = DEFAULT_STAGE_FORECAST.find((s) => s.id === lead.hs_stage_id);
  const stageDefault = stageProbabilities?.[lead.hs_stage_id] ?? stageDef?.probability ?? null;
  const effective    = override ?? stageDefault; // what the forecast actually uses
  const isOverride   = override != null;

  function startEdit(e) {
    e.stopPropagation();
    // Pre-fill with whatever is currently displayed so user can adjust from there
    setRaw(effective != null ? String(effective) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function save(e) {
    e?.stopPropagation();
    setEditing(false);
    const cleaned = raw.replace(/[^0-9.]/g, '');
    // If user entered the exact stage default value, treat as "no override" (null) to keep it dynamic
    const parsed  = cleaned !== '' ? Math.min(100, Math.max(0, parseFloat(cleaned))) : null;
    const newVal  = parsed === stageDefault ? null : parsed; // clear override when it matches default
    if (newVal === (override ?? null)) return; // no change
    setSaving(true);
    try {
      await apiCall('/api/admin-leads?action=probability', {
        method: 'PATCH',
        body: { id: lead.id, probability: newVal },
      });
      onProbabilityChange(lead.id, newVal);
    } catch (err) {
      console.error('[ProbabilityField] save failed:', err);
    }
    setSaving(false);
  }

  function handleKeyDown(e) {
    e.stopPropagation();
    if (e.key === 'Enter')  save(e);
    if (e.key === 'Escape') setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          placeholder="—"
          style={{ width: '52px', padding: '2px 6px', border: '1px solid #78350f', borderRadius: '4px', fontSize: '13px', outline: 'none', textAlign: 'right' }}
        />
        <span style={{ fontSize: '13px', color: '#374151', fontWeight: '600' }}>%</span>
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      disabled={saving}
      title={isOverride
        ? `Win probability: ${effective}% (deal override — click to change or clear)`
        : `Win probability: ${effective}% (stage default — click to override for this deal)`}
      style={{
        // Green border = explicit override; muted dashed = using stage default
        background:   isOverride ? '#ecfdf5' : '#f9fafb',
        border:       isOverride ? '1px solid #6ee7b7' : '1px solid #e5e7eb',
        borderRadius: '4px',
        padding:      '2px 8px',
        fontSize:     '13px',
        fontWeight:   isOverride ? '700' : '500',
        color:        isOverride ? '#065f46' : '#6b7280',
        cursor:       saving ? 'wait' : 'pointer',
        whiteSpace:   'nowrap',
      }}
    >
      {saving ? '…' : effective != null ? `${effective}%` : '—'}
    </button>
  );
}

function SourcePicker({ lead, onSourceChange }) {
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef(null);
  const current = lead.fields?.leadSource || 'Website';
  const isNonWeb = current !== 'Website';

  useEffect(() => {
    if (!open) return;
    function handle(e) {
      const drop = document.getElementById('source-picker-dropdown');
      if (triggerRef.current && !triggerRef.current.contains(e.target) && !drop?.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Only editable for Supabase-backed leads
  if (lead.source === 'hubspot') return null;

  async function select(src) {
    if (src === current) { setOpen(false); return; }
    setSaving(true);
    setOpen(false);
    try {
      await apiCall('/api/admin-leads?action=lead-source', { method: 'PATCH', body: { id: lead.id, leadSource: src } });
      onSourceChange(lead.id, src);
    } catch { /* non-fatal */ }
    setSaving(false);
  }

  const badgeBase = {
    display: 'inline-flex', alignItems: 'center', gap: '3px',
    fontSize: '11px', fontWeight: '700', borderRadius: '4px',
    padding: '2px 7px', cursor: 'pointer', whiteSpace: 'nowrap', border: 'none',
    background: isNonWeb ? '#f3e8ff' : '#f9fafb',
    color: isNonWeb ? '#6b21a8' : '#6b7280',
    outline: '1px solid ' + (isNonWeb ? '#d8b4fe' : '#e5e7eb'),
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={triggerRef}>
      <button onClick={(e) => { e.stopPropagation(); if (!saving) setOpen((o) => !o); }} style={badgeBase}>
        {saving ? '…' : current}
        <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <FixedOverlay>
        <div id="source-picker-dropdown" onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', zIndex: 9999, background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: '160px',
            top: (() => { const r = triggerRef.current?.getBoundingClientRect(); return r ? r.bottom + 4 : 0; })(),
            left: (() => { const r = triggerRef.current?.getBoundingClientRect(); return r ? r.left : 0; })(),
          }}>
          <div style={{ padding: '6px 12px 4px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Lead Source</div>
          {SOURCE_OPTIONS.map((src) => (
            <button key={src} onMouseDown={(e) => { e.preventDefault(); select(src); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 0, borderBottom: '1px solid #f3f4f6', background: src === current ? '#f3e8ff' : '#fff', color: '#111827', fontSize: '13px', fontWeight: src === current ? '700' : '400', cursor: 'pointer' }}>
              {src}{src === current && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#9ca3af' }}>current</span>}
            </button>
          ))}
        </div>
        </FixedOverlay>
      )}
    </div>
  );
}

function TypeBadge({ formType, source }) {
  if (source === 'hubspot') {
    return (
      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.05em', textTransform: 'uppercase', background: '#f5f3ff', color: '#6d28d9' }}>
        HubSpot
      </span>
    );
  }
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

function ActivityChecklist({ lead, onActivityChange }) {
  const [saving, setSaving] = useState(false);
  // Only available for Supabase-backed leads (HubSpot-only leads have no local id)
  if (!lead.id) return null;
  const activities = lead.activities ?? {};

  async function toggle(key) {
    const current  = activities[key];
    const newDone  = !current?.done;
    const newAt    = newDone ? new Date().toISOString() : null;
    const updated  = { ...activities, [key]: { done: newDone, at: newAt } };
    onActivityChange(lead.id, updated); // optimistic update
    setSaving(true);
    try {
      await apiCall('/api/admin-leads?action=activities', {
        method: 'PATCH',
        // change tells the server exactly what was toggled so it can post a HubSpot note
        body: { id: lead.id, activities: updated, change: { key, done: newDone, at: newAt } },
      });
    } catch { /* non-fatal — optimistic state is already set */ }
    setSaving(false);
  }

  return (
    <section>
      <SectionHeading>Activities</SectionHeading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {LEAD_ACTIVITIES.map(({ key, label }) => {
          const act = activities[key] ?? { done: false, at: null };
          return (
            <label
              key={key}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: saving ? 'wait' : 'pointer', userSelect: 'none' }}
            >
              <input
                type="checkbox"
                checked={act.done}
                onChange={() => toggle(key)}
                disabled={saving}
                style={{ width: '16px', height: '16px', accentColor: '#78350f', cursor: saving ? 'wait' : 'pointer', flexShrink: 0 }}
              />
              <span style={{
                fontSize: '14px',
                fontWeight: act.done ? '600' : '400',
                color: act.done ? '#111827' : '#374151',
                textDecoration: act.done ? 'line-through' : 'none',
                opacity: act.done ? 0.7 : 1,
              }}>
                {label}
              </span>
              {act.done && act.at && (
                <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {new Date(act.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}

function LeadDetail({ lead, onActivityChange }) {
  const f = lead.fields ?? {};

  // HubSpot-only deals have no web form data — show a minimal summary instead
  if (lead.source === 'hubspot') {
    return (
      <div style={{ padding: '20px 32px', background: '#fff', borderTop: '2px solid #f3e8d0' }}>
        <SectionHeading>Deal Details</SectionHeading>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 32px' }}>
          {f.dealName && <FieldCell label="Deal Name">{f.dealName}</FieldCell>}
          {f.firstName || f.lastName
            ? <FieldCell label="Contact">{[f.firstName, f.lastName].filter(Boolean).join(' ')}</FieldCell>
            : null}
          {f.email && <FieldCell label="Email"><a href={`mailto:${f.email}`} style={{ color: '#78350f' }}>{f.email}</a></FieldCell>}
          {f.phone && <FieldCell label="Phone"><a href={`tel:${f.phone}`} style={{ color: '#78350f' }}>{formatPhone(f.phone)}</a></FieldCell>}
        </dl>
        {lead.hs_deal_url && (
          <p style={{ margin: '20px 0 0', fontSize: '13px', color: '#6b7280' }}>
            Full deal details are in HubSpot.{' '}
            <a href={lead.hs_deal_url} target="_blank" rel="noreferrer" style={{ color: '#78350f', fontWeight: '600' }}>
              Open deal ↗
            </a>
          </p>
        )}
      </div>
    );
  }

  const isHomeowner = lead.form_type === 'homeowner-consultation';

  // Homeowner: single projectAddress field. Trade: separate address components (project site).
  const addr = f.projectAddress || [
    f.streetAddress,
    f.city,
    f.state && f.zipCode ? `${f.state} ${f.zipCode}` : (f.state || f.zipCode),
  ].filter(Boolean).join(', ');

  const mapUrl = (f.projectAddress || f.zipCode)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        f.projectAddress || [f.streetAddress, f.city, f.state, f.zipCode].filter(Boolean).join(', ')
      )}`
    : null;

  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 32px' };

  return (
    <div style={{ padding: '28px 32px', background: '#fff', borderTop: '2px solid #f3e8d0' }}>
      <dl style={{ margin: 0, display: 'grid', gap: '32px' }}>

        {/* Activity checklist */}
        <ActivityChecklist lead={lead} onActivityChange={onActivityChange} />

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
              {addr && (
                <FieldCell label="Address" wide>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span>{addr}</span>
                    {mapUrl && (
                      <a href={mapUrl} target="_blank" rel="noopener noreferrer"
                         style={{ fontSize: '11px', color: '#78350f', fontWeight: '700', textDecoration: 'none',
                                  border: '1px solid #e5c99a', borderRadius: '4px', padding: '2px 8px',
                                  whiteSpace: 'nowrap', background: '#fef9f0' }}>
                        📍 Map
                      </a>
                    )}
                    {f.distance_miles != null && (
                      <span style={{ fontSize: '11px', color: '#1e40af', fontWeight: '700',
                                     border: '1px solid #bfdbfe', borderRadius: '4px', padding: '2px 8px',
                                     whiteSpace: 'nowrap', background: '#eff6ff' }}>
                        📏 {f.distance_rough ? `roughly ${f.distance_miles}` : f.distance_miles} mi
                      </span>
                    )}
                  </span>
                </FieldCell>
              )}
            </div>
          </section>
        )}

        {/* Trade — Project */}
        {!isHomeowner && (
          <section>
            <SectionHeading>Project</SectionHeading>
            <div style={grid2}>
              {addr && (
                <FieldCell label="Address" wide>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span>{addr}</span>
                    {mapUrl && (
                      <a href={mapUrl} target="_blank" rel="noopener noreferrer"
                         style={{ fontSize: '11px', color: '#78350f', fontWeight: '700', textDecoration: 'none',
                                  border: '1px solid #e5c99a', borderRadius: '4px', padding: '2px 8px',
                                  whiteSpace: 'nowrap', background: '#fef9f0' }}>
                        📍 Map
                      </a>
                    )}
                    {f.distance_miles != null && (
                      <span style={{ fontSize: '11px', color: '#1e40af', fontWeight: '700',
                                     border: '1px solid #bfdbfe', borderRadius: '4px', padding: '2px 8px',
                                     whiteSpace: 'nowrap', background: '#eff6ff' }}>
                        📏 {f.distance_rough ? `roughly ${f.distance_miles}` : f.distance_miles} mi
                      </span>
                    )}
                  </span>
                </FieldCell>
              )}
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

function LeadCard({ lead, isExpanded, onToggle, onDelete, isStale, pipelineStages, exitStages, onStageChange, onActivityChange, onSourceChange, onAmountChange, onProbabilityChange, onDeclinedReasonChange, stageProbabilities, isSuperAdmin }) {
  const f = lead.fields ?? {};
  const contactName = [f.firstName, f.lastName].filter(Boolean).join(' ');
  const clientName  = [f.clientFirstName, f.clientLastName].filter(Boolean).join(' ');
  const isTrade     = lead.form_type === 'trade-estimate';
  // Trade leads: "Client Name (Trade Pro Name)" — client is the primary identifier
  // HubSpot-only deals may have no contact name — fall back to the deal name
  const name = isTrade && clientName
    ? `${clientName} (${contactName || 'Unknown'})`
    : contactName || f.dealName || '(no name)';
  const isHubSpotOnly = lead.source === 'hubspot';
  return (
    <div style={{ background: '#ffffff', border: `1px solid ${isStale ? '#fde68a' : '#e5e7eb'}`, borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', cursor: 'pointer', display: 'grid', gap: '12px' }} onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: '700', fontSize: '15px', color: '#111827' }}>{name}</span>
          <TypeBadge formType={lead.form_type} source={lead.source} />
          <SourcePicker lead={lead} onSourceChange={onSourceChange} />
          <StagePicker lead={lead} pipelineStages={pipelineStages ?? []} exitStages={exitStages ?? []} onStageChange={onStageChange} />
          {lead.hs_stage_id === 'closedlost' && lead.lost_reason && (
            <span
              title={lead.lost_reason_detail ? `Lost reason: ${lead.lost_reason} — ${lead.lost_reason_detail}` : `Lost reason: ${lead.lost_reason}`}
              style={{ fontSize: '11px', fontWeight: '600', color: '#991b1b', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '4px', padding: '2px 8px', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              Lost: {lead.lost_reason}{lead.lost_reason_detail ? ` — ${lead.lost_reason_detail}` : ''}
            </span>
          )}
          {lead.hs_stage_id === DECLINED_STAGE_ID && (
            <EditableDeclinedBadge lead={lead} onDeclinedReasonChange={onDeclinedReasonChange} />
          )}
          <QuoteAmountField lead={lead} onAmountChange={onAmountChange} />
          <ProbabilityField lead={lead} stageProbabilities={stageProbabilities} onProbabilityChange={onProbabilityChange} />
          {isStale && (
            <span
              title={`Business days since last logged activity — note, call, email, meeting, or task (${BIZ_HOURS_LABEL}) — weekends and off-hours don't count.`}
              style={{ fontSize: '11px', fontWeight: '700', color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px', padding: '2px 8px' }}
            >
              ⚠ Stale · {Math.floor(businessDaysBetween(leadActivityDate(lead), null))}d
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '13px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
            {formatDate(lead.created_at)} · {formatTime(lead.created_at)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          {/* Show deal name as subtitle when contact name is the fallback display */}
          {isHubSpotOnly && contactName && f.dealName && (
            <span style={{ fontSize: '13px', color: '#6b7280', fontStyle: 'italic' }}>{f.dealName}</span>
          )}
          {f.companyName && <span style={{ fontSize: '13px', color: '#374151' }}>{f.companyName}</span>}
          {f.phone && <a href={`tel:${f.phone}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: '13px', color: '#78350f', textDecoration: 'none' }}>{formatPhone(f.phone)}</a>}
          {f.email && <a href={`mailto:${f.email}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: '13px', color: '#78350f', textDecoration: 'none' }}>{f.email}</a>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            {lead.hs_deal_url && (
              <a href={lead.hs_deal_url} target="_blank" rel="noreferrer" style={{ fontSize: '13px', padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#ffffff', color: '#374151', textDecoration: 'none', fontWeight: '600' }}>
                View in HubSpot ↗
              </a>
            )}
            {/* Delete — super admins only; HubSpot-only deals don't exist in Supabase */}
            {isSuperAdmin && !isHubSpotOnly && (
              <button onClick={() => onDelete(lead.id, name)} style={{ background: 'transparent', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: '4px', padding: '4px 8px', fontSize: '13px', cursor: 'pointer' }}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
      {isExpanded && <LeadDetail lead={lead} onActivityChange={onActivityChange} />}
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
  const [tab, setTab] = useState('html');
  const [visualKey, setVisualKey] = useState(0);
  const previewIframeRef = useRef(null);

  function switchTab(id) {
    // Force RichTextEditor to remount with latest HTML when switching to Visual
    if (id === 'visual') setVisualKey((k) => k + 1);
    setTab(id);
  }

  useEffect(() => {
    if (tab === 'preview' && previewIframeRef.current) {
      const doc = previewIframeRef.current.contentDocument;
      doc.open(); doc.write(message); doc.close();
    }
  }, [tab, message]);

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

        <div style={{ display: 'grid', gap: '0', opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '8px' }}>
            {[['html', 'HTML Edit'], ['visual', 'Visual'], ['preview', 'Preview']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => switchTab(id)}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: tab === id ? '#78350f' : '#6b7280',
                  background: 'none',
                  border: 'none',
                  borderBottom: tab === id ? '2px solid #78350f' : '2px solid transparent',
                  cursor: 'pointer',
                  marginBottom: '-1px',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* HTML Edit — raw textarea, preserves HTML exactly as typed/pasted */}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            spellCheck={false}
            style={{
              display: tab === 'html' ? 'block' : 'none',
              width: '100%',
              minHeight: '260px',
              padding: '12px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '12px',
              fontFamily: 'monospace',
              lineHeight: '1.6',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              color: '#111827',
            }}
          />

          {/* Visual — rich text editor; key forces remount with latest HTML on each switch */}
          <div style={{ display: tab === 'visual' ? 'block' : 'none' }}>
            <RichTextEditor key={visualKey} value={message} onChange={setMessage} />
          </div>

          {/* Preview — live iframe render of the current HTML */}
          <iframe
            ref={previewIframeRef}
            title="Email preview"
            style={{ display: tab === 'preview' ? 'block' : 'none', width: '100%', minHeight: '480px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#f9fafb' }}
            onLoad={() => {
              if (tab === 'preview' && previewIframeRef.current) {
                const doc = previewIframeRef.current.contentDocument;
                doc.open(); doc.write(message); doc.close();
              }
            }}
          />

          <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#9ca3af' }}>HTML email sent from info@calibercabinetshop.com.</p>
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
  const [form, setForm] = useState({ name: '', email: '', password: '', is_super_admin: false, role: 'staff' });
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
    setForm({ name: '', email: '', password: '', is_super_admin: false, role: 'staff' });
    setAdding(false);
  }

  async function changeRole(id, role) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u))); // optimistic
    const r = await apiCall('/api/admin-users', { method: 'PATCH', body: { id, role } });
    if (!r.ok) loadUsers(); // revert on failure by re-fetching truth
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
                      {!u.is_super_admin && u.role === 'bookkeeper' && (
                        <span style={{ fontSize: '11px', fontWeight: '700', padding: '1px 8px', borderRadius: '999px', background: '#e0f2fe', color: '#075985', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Bookkeeper</span>
                      )}
                    </div>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>{u.email}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {!u.is_super_admin && (
                      <select
                        value={u.role ?? 'staff'}
                        onChange={(e) => changeRole(u.id, e.target.value)}
                        title="Role controls what this user sees in the sidebar"
                        style={{ fontSize: '13px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff', color: '#374151', cursor: 'pointer' }}
                      >
                        <option value="staff">Staff (full access)</option>
                        <option value="bookkeeper">Bookkeeper (Financial only)</option>
                      </select>
                    )}
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
              {!form.is_super_admin && (
                <div style={{ display: 'grid', gap: '5px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Role</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', outline: 'none', background: '#fff', color: '#374151' }}
                  >
                    <option value="staff">Staff (full access)</option>
                    <option value="bookkeeper">Bookkeeper (Financial only)</option>
                  </select>
                </div>
              )}
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

function ChartTooltip({ tip }) {
  if (!tip) return null;
  return (
    <FixedOverlay>
    <div style={{
      position: 'fixed',
      left: tip.x + 14,
      top: tip.y - 44,
      background: 'rgba(17,24,39,0.92)',
      color: '#fff',
      padding: '7px 11px',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: '500',
      lineHeight: '1.65',
      pointerEvents: 'none',
      zIndex: 9999,
      whiteSpace: 'pre',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    }}>
      {tip.content}
    </div>
    </FixedOverlay>
  );
}

function MiniBar({ daily, field, color }) {
  const [tip, setTip] = useState(null);
  if (!daily?.length) return null;
  const values = daily.map((d) => d[field] ?? 0);
  const max = Math.max(...values, 1);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '40px' }}>
        {values.map((v, i) => (
          <div
            key={i}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, content: `${daily[i].date}\n${v.toLocaleString()}` })}
            onMouseMove={(e) => setTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
            onMouseLeave={() => setTip(null)}
            style={{ flex: 1, borderRadius: '2px 2px 0 0', background: color ?? '#78350f', opacity: 0.7 + (v / max) * 0.3, height: `${Math.max(4, Math.round((v / max) * 40))}px`, cursor: 'crosshair' }}
          />
        ))}
      </div>
      <ChartTooltip tip={tip} />
    </>
  );
}

// TrendChart — SVG area/line chart, supports 1 or 2 independently-scaled lines
function TrendChart({ daily, lines, height = 90 }) {
  const [tip, setTip] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!daily?.length) return <EmptyFrame label="No trend data yet" />;
  const allZero = lines.every((l) => daily.every((d) => !d[l.key]));
  if (allZero) return <EmptyFrame label="Data will appear as traffic accumulates" />;

  const W = 600;
  const H = height;
  const PL = 4; const PR = 4; const PT = 8; const PB = 18;
  const cW = W - PL - PR;
  const cH = H - PT - PB;
  const n = daily.length;

  const rendered = lines.map((line) => {
    const values = daily.map((d) => Number(d[line.key] ?? 0));
    const max = Math.max(...values, 1);
    const pts = values.map((v, i) => ({
      x: PL + (n === 1 ? cW / 2 : (i / (n - 1)) * cW),
      y: PT + cH - (v / max) * cH,
      v, date: daily[i].date,
    }));
    const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const area = `${pts[0].x},${PT + cH} ${poly} ${pts[pts.length - 1].x},${PT + cH}`;
    return { ...line, pts, poly, area };
  });

  function handleEnter(e, i) {
    const parts = [daily[i].date, ...rendered.map((l) => `${l.label}: ${l.pts[i].v.toLocaleString()}`)];
    setTip({ x: e.clientX, y: e.clientY, content: parts.join('\n') });
    setHoverIdx(i);
  }

  // Build one hit-area strip per data point (full column height)
  const strips = rendered[0]?.pts.map((p, i) => {
    const prevX = i > 0 ? (p.x + rendered[0].pts[i - 1].x) / 2 : PL;
    const nextX = i < n - 1 ? (p.x + rendered[0].pts[i + 1].x) / 2 : W - PR;
    return { x: prevX, width: nextX - prevX, i };
  }) ?? [];

  return (
    <>
      <div>
        {/* Legend */}
        {lines.length > 1 && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '6px' }}>
            {lines.map((l) => (
              <span key={l.key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#6b7280' }}>
                <span style={{ width: '20px', height: '3px', background: l.color, borderRadius: '2px', display: 'inline-block' }} />
                {l.label}
                {lines.length > 1 && <span style={{ color: '#9ca3af', fontSize: '10px' }}>(own scale)</span>}
              </span>
            ))}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: `${H}px`, display: 'block' }} preserveAspectRatio="none">
          {rendered.map((line) => (
            <g key={line.key}>
              <polygon points={line.area} fill={line.color} opacity={0.12} />
              <polyline points={line.poly} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {/* Visible dot on hover */}
              {hoverIdx !== null && (
                <circle cx={line.pts[hoverIdx].x} cy={line.pts[hoverIdx].y} r="4.5" fill={line.color} stroke="white" strokeWidth="1.5" />
              )}
            </g>
          ))}
          {/* Invisible hit-area strips for hover detection */}
          {strips.map((s) => (
            <rect key={s.i} x={s.x} y={PT} width={s.width} height={cH}
              fill="transparent" style={{ cursor: 'crosshair' }}
              onMouseEnter={(e) => handleEnter(e, s.i)}
              onMouseMove={(e) => setTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
              onMouseLeave={() => { setTip(null); setHoverIdx(null); }}
            />
          ))}
          {/* Date labels */}
          <text x={PL} y={H - 2} fontSize="9" fill="#9ca3af">{daily[0]?.date}</text>
          <text x={W - PR} y={H - 2} fontSize="9" fill="#9ca3af" textAnchor="end">{daily[daily.length - 1]?.date}</text>
        </svg>
      </div>
      <ChartTooltip tip={tip} />
    </>
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

function TurnstileBarsChart({ daily }) {
  const [tip, setTip] = useState(null);
  const last14 = daily.slice(-14);
  const maxTotal = Math.max(...last14.map((x) => (x.passed ?? 0) + (x.failed ?? 0)), 1);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '48px' }}>
        {last14.map((d) => {
          const dayTotal = (d.passed ?? 0) + (d.failed ?? 0);
          const total = Math.max(dayTotal, 1);
          const barH = Math.max(4, Math.round((total / maxTotal) * 48));
          const verifiedPct = dayTotal > 0 ? (d.passed ?? 0) / dayTotal : 1;
          return (
            <div
              key={d.date}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, content: `${d.date}\n✓ ${(d.passed ?? 0).toLocaleString()} verified\n✗ ${(d.failed ?? 0).toLocaleString()} blocked` })}
              onMouseMove={(e) => setTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
              onMouseLeave={() => setTip(null)}
              style={{ flex: 1, height: `${barH}px`, borderRadius: '2px 2px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse', cursor: 'crosshair' }}
            >
              <div style={{ height: `${Math.round(verifiedPct * 100)}%`, background: '#16a34a', opacity: 0.85 }} />
              <div style={{ flex: 1, background: '#dc2626', opacity: 0.7 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af' }}>{last14[0]?.date}</span>
        <span style={{ fontSize: '10px', color: '#9ca3af' }}>{last14[last14.length - 1]?.date}</span>
      </div>
      <ChartTooltip tip={tip} />
    </>
  );
}

function SiteStatsView() {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
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

  function loadHistory() {
    apiCall('/api/admin-analytics-history?months=12')
      .then((r) => r.json())
      .then((d) => setHistory(d))
      .catch(() => {}); // history is best-effort; don't surface errors
  }

  useEffect(() => {
    loadStats();
    loadHistory();
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

      {/* ── Page header ── */}
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '700', color: '#111827' }}>Site Health</h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
          Uptime, traffic, search visibility, and security for calibercabinetshop.com.
        </p>
      </div>

      {/* ── Uptime ── */}
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
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
            {/* Column header row */}
            {!isMobile && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(4, 80px)', gap: '10px', padding: '8px 20px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                <span style={{ fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monitor</span>
                {['7-day', '30-day', 'Avg resp.', 'All-time'].map((h) => (
                  <span key={h} style={{ fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>{h}</span>
                ))}
              </div>
            )}
            {uptime.monitors.map((m, idx) => {
              const statusColor = m.status === 'up' ? '#16a34a' : m.status === 'seems_down' ? '#d97706' : '#dc2626';
              const statusDot   = m.status === 'up' ? '●' : m.status === 'seems_down' ? '⚠' : '✕';
              const pct7Color   = m.uptimeRatio7 >= 99.9 ? '#16a34a' : m.uptimeRatio7 >= 99 ? '#d97706' : '#dc2626';
              return (
                <div key={m.id} style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '1fr repeat(4, 80px)',
                  gap: isMobile ? '8px' : '10px',
                  padding: '14px 20px',
                  alignItems: 'center',
                  borderTop: idx > 0 ? '1px solid #f3f4f6' : 'none',
                }}>
                  {/* Name + URL + status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '700', color: statusColor, flexShrink: 0 }}>{statusDot}</span>
                    <div>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: '#111827' }}>{m.name}</p>
                      <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>{m.url}</p>
                    </div>
                  </div>
                  {/* Stat cells */}
                  {isMobile ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginLeft: '24px' }}>
                      {[
                        { label: '7-day', value: m.uptimeRatio7 != null ? `${m.uptimeRatio7}%` : '—', color: pct7Color },
                        { label: '30-day', value: m.uptimeRatio30 != null ? `${m.uptimeRatio30}%` : '—', color: '#111827' },
                        { label: 'Avg resp.', value: m.avgResponseMs != null ? `${m.avgResponseMs}ms` : '—', color: '#111827' },
                        { label: 'All-time', value: m.uptimeRatioAll != null ? `${m.uptimeRatioAll}%` : '—', color: '#111827' },
                      ].map((s) => (
                        <div key={s.label}>
                          <p style={{ margin: '0 0 1px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</p>
                          <p style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: s.color }}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: pct7Color, textAlign: 'right' }}>{m.uptimeRatio7 != null ? `${m.uptimeRatio7}%` : '—'}</p>
                      <p style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#111827', textAlign: 'right' }}>{m.uptimeRatio30 != null ? `${m.uptimeRatio30}%` : '—'}</p>
                      <p style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#111827', textAlign: 'right' }}>{m.avgResponseMs != null ? `${m.avgResponseMs}ms` : '—'}</p>
                      <p style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#111827', textAlign: 'right' }}>{m.uptimeRatioAll != null ? `${m.uptimeRatioAll}%` : '—'}</p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Website Traffic (GA) ── */}
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
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px' }}>
              <StatTile label="Sessions" value={ga.totals.sessions?.toLocaleString()} accent="#4285f4" />
              <StatTile label="Active Users" value={ga.totals.users?.toLocaleString()} accent="#34a853" />
              <StatTile label="Page Views" value={ga.totals.pageViews?.toLocaleString()} accent="#fbbc04" />
              <StatTile label="New Users" value={ga.totals.newUsers?.toLocaleString()} accent="#ea4335" />
            </div>
            {/* Row 2: quality */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px' }}>
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

            {/* Traffic trend chart */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sessions over time · last 28 days</p>
              <TrendChart
                daily={ga.daily}
                lines={[
                  { key: 'sessions', label: 'Sessions', color: '#4285f4' },
                  { key: 'pageViews', label: 'Page Views', color: '#34a853' },
                ]}
              />
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
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px' }}>
              <StatTile label="Total Clicks" value={gsc.totals.clicks?.toLocaleString()} accent="#4285f4" sub="Visits from Google search" />
              <StatTile label="Impressions" value={gsc.totals.impressions?.toLocaleString()} accent="#34a853" sub="Times shown in results" />
              <StatTile label="Click-Through Rate" value={gsc.totals.ctr != null ? `${gsc.totals.ctr}%` : '—'} accent="#fbbc04" sub="Higher is better" />
              <StatTile label="Avg Position" value={gsc.totals.position != null ? `#${gsc.totals.position}` : '—'} accent="#ea4335" sub="Lower # = higher ranking" />
            </div>

            {/* Search trend chart */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clicks &amp; impressions over time · last 28 days</p>
              <TrendChart
                daily={gsc.daily}
                lines={[
                  { key: 'clicks', label: 'Clicks', color: '#4285f4' },
                  { key: 'impressions', label: 'Impressions', color: '#34a853' },
                ]}
              />
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

      {/* ── Bot Protection (Turnstile) ── */}
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
                <TurnstileBarsChart daily={turnstile.daily} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Historical Trends ────────────────────────────────────────────────── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827' }}>Historical Trends</h2>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>stored in Supabase · last 12 months</span>
        </div>

        {(() => {
          // Aggregate daily Supabase rows into monthly buckets
          function toMonthly(rows, sumFields, avgFields = []) {
            if (!rows?.length) return [];
            const byMonth = {};
            for (const row of rows) {
              const d = new Date(row.date + 'T12:00:00');
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              if (!byMonth[key]) {
                byMonth[key] = {
                  key,
                  label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                  _rows: [],
                };
              }
              byMonth[key]._rows.push(row);
            }
            return Object.values(byMonth)
              .sort((a, b) => a.key.localeCompare(b.key))
              .map((m) => {
                const out = { key: m.key, label: m.label };
                for (const f of sumFields) out[f] = m._rows.reduce((s, r) => s + (r[f] ?? 0), 0);
                for (const f of avgFields) {
                  const vals = m._rows.map((r) => r[f]).filter((v) => v != null);
                  out[f] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
                }
                return out;
              });
          }

          const gaMonthly  = toMonthly(history?.ga,        ['sessions', 'users', 'page_views', 'new_users'], ['bounce_rate', 'engagement_rate']);
          const gscMonthly = toMonthly(history?.gsc,       ['clicks', 'impressions'], ['position']);
          const tsMonthly  = toMonthly(history?.turnstile, ['passed', 'failed']);

          const noHistory = !history || (gaMonthly.length === 0 && gscMonthly.length === 0 && tsMonthly.length === 0);

          if (noHistory) {
            return (
              <div style={{ background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: '8px', padding: '28px 24px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>No history yet</p>
                <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
                  Data accumulates automatically every time the Site Stats page loads. Run the Supabase migration SQL first, then come back after your next visit here.
                </p>
              </div>
            );
          }

          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

              {/* GA Sessions */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>Monthly Sessions</p>
                <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>from Google Analytics</p>
                {gaMonthly.length > 0
                  ? <MonthlyLineChart
                      data={gaMonthly}
                      lines={[{ key: 'sessions', label: 'Sessions', color: '#7c3aed' }]}
                      formatTip={(v) => v.toLocaleString()}
                    />
                  : <EmptyFrame label="No GA history yet" />}
              </div>

              {/* GSC Clicks + Impressions */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>Organic Clicks &amp; Impressions</p>
                <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>
                  <span style={{ color: '#059669', fontWeight: '700' }}>■</span> Clicks &nbsp;
                  <span style={{ color: '#4285f4', fontWeight: '700' }}>■</span> Impressions · from Google Search Console
                </p>
                {gscMonthly.length > 0
                  ? <MonthlyLineChart
                      data={gscMonthly}
                      lines={[
                        { key: 'clicks',      label: 'Clicks',      color: '#059669' },
                        { key: 'impressions', label: 'Impressions', color: '#4285f4' },
                      ]}
                      formatTip={(v) => v.toLocaleString()}
                    />
                  : <EmptyFrame label="No GSC history yet" />}
              </div>

              {/* GSC Avg Position */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>Avg Search Position</p>
                <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>monthly average — lower is better</p>
                {gscMonthly.length > 0
                  ? <MonthlyLineChart
                      data={gscMonthly}
                      lines={[{ key: 'position', label: 'Avg position', color: '#d97706' }]}
                      formatTip={(v) => `#${Math.round(v * 10) / 10}`}
                    />
                  : <EmptyFrame label="No GSC history yet" />}
              </div>

              {/* Turnstile security */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
                <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>Form Security (Turnstile)</p>
                <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>
                  <span style={{ color: '#16a34a', fontWeight: '700' }}>■</span> Passed &nbsp;
                  <span style={{ color: '#dc2626', fontWeight: '700' }}>■</span> Blocked · monthly totals
                </p>
                {tsMonthly.length > 0
                  ? <MonthlyLineChart
                      data={tsMonthly}
                      lines={[
                        { key: 'passed', label: 'Passed', color: '#16a34a' },
                        { key: 'failed', label: 'Blocked', color: '#dc2626' },
                      ]}
                      formatTip={(v) => v.toLocaleString()}
                    />
                  : <EmptyFrame label="No Turnstile history yet" />}
              </div>
            </div>
          );
        })()}
      </section>
    </div>
  );
}

// ─── Lightweight hover tooltip for non-KpiCard elements ─────────────────────
function WithTip({ tip, children, style }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ position: 'relative', ...style }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && tip && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%',
          transform: 'translateX(-50%)', zIndex: 200, background: '#1f2937',
          borderRadius: '8px', padding: '10px 14px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)', width: '230px', pointerEvents: 'none',
        }}>
          <span style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0, borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent', borderTop: '7px solid #1f2937',
          }} />
          <p style={{ margin: 0, fontSize: '12px', color: '#f3f4f6', lineHeight: 1.5 }}>{tip}</p>
        </div>
      )}
    </div>
  );
}

// ─── Metric cards with hover tooltip bubbles ─────────────────────────────────

function Pill({ children, bg = '#f3f4f6', color = '#6b7280' }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
      fontSize: '11px', fontWeight: '600', background: bg, color, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function KpiCard({ title, value, valueColor = '#111827', border = '1px solid #e5e7eb', bg = '#ffffff', tooltip, compact = false, onClick = null, active = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick ?? undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
      style={{
        position: 'relative', background: bg,
        border: active ? '1px solid #78350f' : border,
        boxShadow: active ? '0 0 0 2px rgba(120,53,15,0.25)' : 'none',
        borderRadius: '8px', padding: compact ? '10px 8px' : '14px 18px',
        cursor: onClick ? 'pointer' : 'default', textAlign: 'center',
      }}
    >
      <p style={{ margin: '0 0 2px', fontSize: compact ? '10px' : '11px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={title}>
        {title}
      </p>
      <p style={{ margin: 0, fontSize: compact ? '22px' : '26px', fontWeight: '700', color: valueColor, lineHeight: 1.2 }}>
        {value}
      </p>
      {/* Hover tooltip bubble — renders below the card to avoid viewport clipping */}
      {hovered && tooltip && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
          background: '#1f2937', borderRadius: '10px', padding: '10px 14px',
          zIndex: 50, boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
          minWidth: '200px', maxWidth: '280px',
        }}>
          {/* Caret pointing up at the card */}
          <span style={{
            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '7px solid transparent', borderRight: '7px solid transparent',
            borderBottom: '7px solid #1f2937',
          }} />
          {tooltip}
        </div>
      )}
    </div>
  );
}

// Tooltip layout: description line + row of pills
function TipBody({ desc, children }) {
  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#f3f4f6', lineHeight: 1.5 }}>{desc}</p>
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function MetricCards({
  isLoading,
  activeCount, homeownerLeads, tradeLeads,
  leadToQuoteRate, quotedCount, totalLeads,
  thisMonthCount, now,
  avgResponseDays, responseSamples,
  avgTimeToQuoteDays, quoteSamples,
  quoteAcceptRate, contractOrWonCount, quoteOrLaterCount,
  staleCount, STALE_DAYS, onStaleClick, staleActive,
}) {
  const isMobile = useIsMobile();
  const dash = isLoading ? '–' : '—';
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    // Single compact row — Win Rate in nav, Avg Full Cycle on Performance page
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(7, 1fr)', gap: '10px', marginBottom: '12px' }}>
      <KpiCard compact
        title="Active Pipeline"
        value={isLoading ? dash : activeCount}
        tooltip={!isLoading && (
          <TipBody desc="Deals currently in progress — any stage except Closed Won or Closed Lost.">
            <Pill bg="#78350f" color="#fed7aa">{homeownerLeads} homeowner</Pill>
            <Pill bg="#14532d" color="#bbf7d0">{tradeLeads} trade</Pill>
            <Pill bg="#374151" color="#f3f4f6">{activeCount} total active</Pill>
          </TipBody>
        )}
      />
      <KpiCard compact
        title="Lead → Quote"
        value={isLoading ? dash : leadToQuoteRate !== null ? `${leadToQuoteRate}%` : '—'}
        tooltip={!isLoading && (
          <TipBody desc="Percentage of all leads that reached Quote Sent or a later stage. Measures how many inquiries become real proposals.">
            <Pill bg="#4c1d95" color="#ddd6fe">{quotedCount} reached Quote Sent</Pill>
            <Pill bg="#374151" color="#f3f4f6">{totalLeads} total leads</Pill>
          </TipBody>
        )}
      />
      <KpiCard compact
        title="This Month"
        value={isLoading ? dash : thisMonthCount}
        tooltip={!isLoading && (
          <TipBody desc={`New lead submissions received so far in ${monthLabel}, from both web forms and HubSpot.`}>
            <Pill bg="#374151" color="#f3f4f6">{monthLabel}</Pill>
            <Pill bg="#374151" color="#f3f4f6">{thisMonthCount} submission{thisMonthCount !== 1 ? 's' : ''}</Pill>
          </TipBody>
        )}
      />
      <KpiCard compact
        title="Avg Response"
        value={isLoading ? dash : formatDays(avgResponseDays)}
        valueColor={isLoading || avgResponseDays === null ? '#9ca3af' : avgResponseDays <= 1 ? '#16a34a' : avgResponseDays <= 3 ? '#d97706' : '#dc2626'}
        tooltip={!isLoading && (
          <TipBody desc={`Average time from a lead entering New Request to being moved to Qualified. Measures how quickly the team follows up. Counts business hours only (${BIZ_HOURS_LABEL}) — nights, weekends, and off-hours don't count against response time.`}>
            {responseSamples.length > 0 ? (
              <>
                <Pill bg="#14532d" color="#bbf7d0">New Request → Qualified</Pill>
                <Pill bg="#374151" color="#f3f4f6">avg of {responseSamples.length} deal{responseSamples.length !== 1 ? 's' : ''}</Pill>
              </>
            ) : <Pill bg="#374151" color="#f3f4f6">No deals have reached Qualified yet</Pill>}
          </TipBody>
        )}
      />
      <KpiCard compact
        title="Time to Quote"
        value={isLoading ? dash : formatDays(avgTimeToQuoteDays)}
        valueColor={isLoading || avgTimeToQuoteDays === null ? '#9ca3af' : '#111827'}
        tooltip={!isLoading && (
          <TipBody desc={`Average time from first contact to Quote Sent. Measures how efficiently the team turns an inquiry into a formal proposal. Counts business hours only (${BIZ_HOURS_LABEL}).`}>
            {quoteSamples.length > 0 ? (
              <>
                <Pill bg="#4c1d95" color="#ddd6fe">New Request → Quote Sent</Pill>
                <Pill bg="#374151" color="#f3f4f6">avg of {quoteSamples.length} deal{quoteSamples.length !== 1 ? 's' : ''}</Pill>
              </>
            ) : <Pill bg="#374151" color="#f3f4f6">No deals have reached Quote Sent yet</Pill>}
          </TipBody>
        )}
      />
      <KpiCard compact
        title="Quote Accept"
        value={isLoading ? dash : quoteAcceptRate !== null ? `${quoteAcceptRate}%` : '—'}
        valueColor={isLoading || quoteAcceptRate === null ? '#9ca3af' : quoteAcceptRate >= 50 ? '#16a34a' : '#d97706'}
        tooltip={!isLoading && (
          <TipBody desc="Of all leads that reached Quote Sent or later, how many advanced to Contract Sent or Closed Won. A low rate may indicate pricing, scope, or follow-up issues.">
            {quoteOrLaterCount > 0 ? (
              <>
                <Pill bg="#14532d" color="#bbf7d0">{contractOrWonCount} reached Contract Sent or Won</Pill>
                <Pill bg="#374151" color="#f3f4f6">{quoteOrLaterCount} at Quote Sent or later</Pill>
              </>
            ) : <Pill bg="#374151" color="#f3f4f6">No quotes sent yet</Pill>}
          </TipBody>
        )}
      />
      <KpiCard compact
        title="Stale Leads"
        value={isLoading ? dash : staleCount}
        valueColor={isLoading ? '#9ca3af' : staleCount > 0 ? '#d97706' : '#16a34a'}
        bg={staleCount > 0 ? '#fffbeb' : '#ffffff'}
        border={`1px solid ${staleCount > 0 ? '#fde68a' : '#e5e7eb'}`}
        onClick={!isLoading && staleCount > 0 ? onStaleClick : null}
        active={staleActive}
        tooltip={!isLoading && (
          <TipBody desc={`Active deals with no logged activity (note, call, email, meeting, or task — in HubSpot or the admin panel) in ${STALE_DAYS} or more business days (${BIZ_HOURS_LABEL}). These likely need a follow-up or a decision.${staleCount > 0 ? ' Click to filter the list below.' : ''}`}>
            {staleCount > 0
              ? <Pill bg="#92400e" color="#fde68a">{staleCount} deal{staleCount !== 1 ? 's' : ''} stuck {STALE_DAYS}+ business days</Pill>
              : <Pill bg="#14532d" color="#bbf7d0">All active deals moving within {STALE_DAYS} business days ✓</Pill>
            }
          </TipBody>
        )}
      />
    </div>
  );
}

// ─── Leads view ───────────────────────────────────────────────────────────────

function LeadsView({ currentUser, onWinRateUpdate }) {
  const isMobile = useIsMobile();
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStage, setFilterStage] = useState(null); // null = all stages
  const [filterStale, setFilterStale] = useState(false); // true = only stale leads
  const [sortKey, setSortKey] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const searchRef = useRef(null);

  const isSuperAdmin = currentUser?.is_super_admin ?? false;
  const [newCount, setNewCount] = useState(0);
  const [stageProbabilities, setStageProbabilities] = useState({});

  // Load stage probability config once on mount
  useEffect(() => {
    apiCall('/api/admin-settings')
      .then((r) => r.json())
      .then((d) => setStageProbabilities(d?.settings?.stage_probabilities ?? {}))
      .catch(() => {});
  }, []);

  // Use local constants — no API call needed; we control which stages are selectable.
  // Legacy Appt/PPT/DM stages are intentionally excluded (activity, not pipeline stage).
  const pipelineStages = HS_PIPELINE;
  const exitStages     = HS_EXIT_STAGES;

  function handleStageChange(leadKey, stage, extra) {
    setLeads((prev) =>
      prev.map((l) =>
        (l.id === leadKey || l.hubspot_deal_id === leadKey)
          ? { ...l, hs_stage_id: stage.id, hs_stage_label: stage.label, ...(extra ?? {}) }
          : l,
      ),
    );
  }

  // Local-state update after a Declined lead's reason is corrected in place
  // (see EditableDeclinedBadge) — the API call itself already happened.
  function handleDeclinedReasonChange(leadKey, declinedReason, declinedReasonDetail) {
    setLeads((prev) =>
      prev.map((l) =>
        (l.id === leadKey || l.hubspot_deal_id === leadKey)
          ? { ...l, declined_reason: declinedReason, declined_reason_detail: declinedReasonDetail }
          : l,
      ),
    );
  }

  function handleActivityChange(leadId, activities) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, activities } : l)),
    );
  }

  function handleSourceChange(leadId, leadSource) {
    setLeads((prev) =>
      prev.map((l) => l.id === leadId ? { ...l, fields: { ...l.fields, leadSource } } : l),
    );
  }

  function handleAmountChange(leadId, amount) {
    setLeads((prev) =>
      prev.map((l) => l.id === leadId ? { ...l, fields: { ...l.fields, quote_amount: amount } } : l),
    );
  }

  function handleProbabilityChange(leadId, probability) {
    setLeads((prev) =>
      prev.map((l) => l.id === leadId ? { ...l, fields: { ...l.fields, probability } } : l),
    );
  }

  function handleLeadAdded(newLead) {
    setLeads((prev) => [newLead, ...prev]);
    setExpandedId(newLead.id);
    // Scroll to the new card after render
    setTimeout(() => {
      document.getElementById(`lead-${newLead.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }

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

  const closedCount = leads.filter((l) => l.hs_stage_id && CLOSED_STAGE_IDS.has(l.hs_stage_id)).length;

  // Stale leads: active (non-closed) stage, no logged activity (note/call/
  // email/meeting/task — see leadActivityDate) in ≥7 days. Excludes
  // CLOSED_STAGE_IDS (not just EXIT_STAGE_IDS) — that's Closed Won too, and
  // a won deal doesn't need a "follow-up or a decision". Must match the
  // hide-closed filter `filtered` applies below, or the KPI count and the
  // list it filters to disagree (closed deals counted here, then hidden there).
  // (computed here, ahead of `filtered`, since the Stale Leads KPI card filter reads this set)
  const STALE_DAYS = 7;
  const staleLeadIds = new Set(
    leads
      .filter((l) => {
        if (!l.hs_stage_id || CLOSED_STAGE_IDS.has(l.hs_stage_id)) return false;
        const d = businessDaysBetween(leadActivityDate(l), null);
        return d !== null && d >= STALE_DAYS;
      })
      .map((l) => l.id),
  );
  const staleCount = staleLeadIds.size;

  const filtered = leads
    .filter((l) => {
      if (filterType === 'all') return true;
      if (filterType === 'hubspot') return l.source === 'hubspot' || l.form_type === 'hubspot_direct';
      return l.form_type === filterType;
    })
    .filter((l) => {
      if (!filterStage) return true;
      const ids = Array.isArray(filterStage) ? filterStage : [filterStage];
      return ids.includes(l.hs_stage_id);
    })
    .filter((l) => {
      // Hide closed/exited deals (Won, Lost Deal, Declined, Referred Out,
      // Partnered Out) from the default view. Click the matching stage card
      // above — that sets filterStage explicitly, which overrides this.
      if (filterStage) return true;
      return !l.hs_stage_id || !CLOSED_STAGE_IDS.has(l.hs_stage_id);
    })
    .filter((l) => !filterStale || staleLeadIds.has(l.id))
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
    })
    .sort((a, b) => {
      if (sortKey === 'newest' || sortKey === 'oldest') {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return sortKey === 'newest' ? tb - ta : ta - tb;
      }
      if (sortKey === 'quote-desc' || sortKey === 'quote-asc') {
        const qa = a.fields?.quote_amount ?? -1;
        const qb = b.fields?.quote_amount ?? -1;
        return sortKey === 'quote-desc' ? qb - qa : qa - qb;
      }
      if (sortKey === 'prob-desc' || sortKey === 'prob-asc') {
        const pa = a.fields?.probability ?? -1;
        const pb = b.fields?.probability ?? -1;
        return sortKey === 'prob-desc' ? pb - pa : pa - pb;
      }
      if (sortKey === 'name-asc' || sortKey === 'name-desc') {
        const na = `${a.fields?.firstName ?? ''} ${a.fields?.lastName ?? ''}`.trim().toLowerCase();
        const nb = `${b.fields?.firstName ?? ''} ${b.fields?.lastName ?? ''}`.trim().toLowerCase();
        return sortKey === 'name-asc' ? na.localeCompare(nb) : nb.localeCompare(na);
      }
      return 0;
    });

  const totalLeads = leads.length;
  const homeownerLeads = leads.filter((l) => l.form_type === 'homeowner-consultation').length;
  const tradeLeads = leads.filter((l) => l.form_type === 'trade-estimate').length;
  const hubspotLeads = leads.filter((l) => l.source === 'hubspot' || l.form_type === 'hubspot_direct').length;

  // Stage breakdown — count by stage ID across all pipeline stages
  const stageCountById = {};
  for (const l of leads) {
    if (l.hs_stage_id) {
      stageCountById[l.hs_stage_id] = (stageCountById[l.hs_stage_id] ?? 0) + 1;
    }
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const wonCount  = stageCountById['closedwon']  ?? 0;
  // Win Rate: only counts competitive outcomes (Won vs. Lost Deal)
  // Declined = client chose not to proceed (not a competitive loss) — excluded
  // Referred Out / Partnered Out are Caliber-initiated exits — excluded
  const lostCount = stageCountById['closedlost'] ?? 0;
  const closedTotal = wonCount + lostCount;
  const winRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 100) : null;

  // Bubble win rate up to the persistent nav so it shows on all tabs
  useEffect(() => {
    if (onWinRateUpdate) onWinRateUpdate(winRate);
  }, [winRate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active = has a stage but not Won or Lost
  const activeCount = leads.filter(
    (l) => l.hs_stage_id && !EXIT_STAGE_IDS.has(l.hs_stage_id)
  ).length;

  // Lead-to-Quote = reached Quote Sent or any later stage
  const quoteOrBeyond = new Set(['3869825755', 'contractsent', 'closedwon']);
  const quotedCount = leads.filter((l) => quoteOrBeyond.has(l.hs_stage_id)).length;
  const leadToQuoteRate = totalLeads > 0 ? Math.round((quotedCount / totalLeads) * 100) : null;

  // New this calendar month
  const now = new Date();
  const thisMonthCount = leads.filter((l) => {
    const d = new Date(l.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // ── Operational metrics ───────────────────────────────────────────────────
  // Use hs_date_entered_new_request if set; fall back to created_at (form submission time)
  function startDate(l) { return l.hs_date_entered_new_request ?? l.created_at; }

  // Avg response time: New Request → Qualified
  const responseSamples = leads
    .filter((l) => l.hs_date_entered_qualified)
    .map((l) => businessDaysBetween(startDate(l), l.hs_date_entered_qualified))
    .filter((d) => d !== null && d >= 0);
  const avgResponseDays = responseSamples.length > 0
    ? responseSamples.reduce((a, b) => a + b, 0) / responseSamples.length : null;

  // Avg time to quote: New Request → Quote Sent
  const quoteSamples = leads
    .filter((l) => l.hs_date_entered_quote_sent)
    .map((l) => businessDaysBetween(startDate(l), l.hs_date_entered_quote_sent))
    .filter((d) => d !== null && d >= 0);
  const avgTimeToQuoteDays = quoteSamples.length > 0
    ? quoteSamples.reduce((a, b) => a + b, 0) / quoteSamples.length : null;

  // Quote acceptance: (Contract Sent + Closed Won) / (Quote Sent + all later stages)
  const quotesSentCount    = leads.filter((l) => l.hs_date_entered_quote_sent).length;
  const contractsSentCount = leads.filter((l) => l.hs_date_entered_contract_sent).length;

  const contractOrWonCount = leads.filter(
    (l) => l.hs_date_entered_contract_sent || l.hs_date_entered_closed_won,
  ).length;

  const QUOTE_OR_LATER_IDS = new Set([
    '3869825755', 'contractsent', 'closedwon', 'closedlost',
    'referred_out', 'partnered_out', 'declined',
  ]);
  const quoteOrLaterCount = leads.filter(
    (l) => l.hs_date_entered_quote_sent ||
           l.hs_date_entered_contract_sent ||
           l.hs_date_entered_closed_won ||
           l.hs_date_entered_closed_lost ||
           QUOTE_OR_LATER_IDS.has(l.hs_stage_id),
  ).length;

  const quoteAcceptRate = quoteOrLaterCount > 0
    ? Math.round((contractOrWonCount / quoteOrLaterCount) * 100) : null;

  // ── Tier 3: Avg Full Cycle (New Request → Closed Won) ────────────────────
  const fullCycleSamples = leads
    .filter((l) => l.hs_date_entered_closed_won)
    .map((l) => businessDaysBetween(startDate(l), l.hs_date_entered_closed_won))
    .filter((d) => d !== null && d >= 0);
  const avgFullCycleDays = fullCycleSamples.length > 0
    ? fullCycleSamples.reduce((a, b) => a + b, 0) / fullCycleSamples.length : null;

  // Search suggestions — up to 6 leads matching current query
  const suggestions = searchQuery.trim().length > 0
    ? leads.filter((l) => {
        const q = searchQuery.toLowerCase();
        const f = l.fields ?? {};
        return (
          `${f.firstName ?? ''} ${f.lastName ?? ''}`.toLowerCase().includes(q) ||
          (f.email ?? '').toLowerCase().includes(q) ||
          (f.phone ?? '').toLowerCase().includes(q) ||
          (f.companyName ?? '').toLowerCase().includes(q) ||
          (f.dealName ?? '').toLowerCase().includes(q)
        );
      }).slice(0, 6)
    : [];

  function selectSuggestion(lead) {
    const f = lead.fields ?? {};
    setSearchQuery(`${f.firstName ?? ''} ${f.lastName ?? ''}`.trim() || f.dealName || f.email || '');
    setExpandedId(lead.id);
    setSearchFocused(false);
    // Scroll to card after render
    setTimeout(() => {
      document.getElementById(`lead-${lead.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  return (
    <div>
      {/* KPIs + Ops metrics — cards show title + number; hover reveals detail bubble */}
      <MetricCards
        isLoading={isLoading}
        activeCount={activeCount} homeownerLeads={homeownerLeads} tradeLeads={tradeLeads}
        leadToQuoteRate={leadToQuoteRate} quotedCount={quotedCount} totalLeads={totalLeads}
        thisMonthCount={thisMonthCount} now={now}
        avgResponseDays={avgResponseDays} responseSamples={responseSamples}
        avgTimeToQuoteDays={avgTimeToQuoteDays} quoteSamples={quoteSamples}
        quoteAcceptRate={quoteAcceptRate} contractOrWonCount={contractOrWonCount} quoteOrLaterCount={quoteOrLaterCount}
        staleCount={staleCount} STALE_DAYS={STALE_DAYS}
        staleActive={filterStale}
        onStaleClick={() => {
          setFilterStale((prev) => !prev);
          setFilterStage(null); // stale isn't tied to one stage — clear any stage filter so it doesn't fight this one
        }}
      />

      {/* Stage counts */}
      {/* Pipeline stage view */}
      <div style={{ marginBottom: '28px', padding: '14px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: isMobile ? '480px' : 'auto' }}>
        {/* Active pipeline */}
        <p style={{ margin: '0 0 8px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pipeline</p>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${HS_PIPELINE.length}, 1fr)`, gap: '6px', alignItems: 'stretch', gridAutoRows: '1fr', marginBottom: '16px' }}>
          {HS_PIPELINE.map((stage, i) => {
            const s = HS_STAGE_COLORS[stage.id] ?? { bg: '#f3f4f6', color: '#6b7280' };
            const count = stageCountById[stage.id] ?? 0;
            const isActive = filterStage === stage.id;
            return (
              <div key={stage.id} style={{ display: 'flex', alignItems: 'stretch', gap: '6px' }}>
                <div
                  onClick={() => { setFilterStage(isActive ? null : stage.id); setFilterStale(false); }}
                  title={isActive ? 'Click to clear filter' : `Click to filter by ${stage.label}`}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '5px', padding: '10px 6px', borderRadius: '8px', height: '100%', boxSizing: 'border-box',
                    background: s.bg, border: isActive ? `2px solid ${s.color}` : `1.5px solid ${s.color}22`,
                    cursor: 'pointer', outline: isActive ? `2px solid ${s.color}66` : 'none', outlineOffset: '1px',
                  }}
                >
                  <span style={{ fontSize: '22px', fontWeight: '900', color: s.color, lineHeight: 1 }}>{count}</span>
                  <span style={{ fontSize: '10px', fontWeight: '700', color: s.color, textAlign: 'center', lineHeight: 1.3 }}>{stage.label}</span>
                </div>
                {i < HS_PIPELINE.length - 1 && (
                  <span style={{ fontSize: '12px', color: '#d1d5db', alignSelf: 'center', flexShrink: 0 }}>›</span>
                )}
              </div>
            );
          })}
        </div>
        {/* Exit stages — side by side in one row, visually grouped */}
        {(() => {
          const neutralStages = HS_EXIT_STAGES.filter((s) => s.group === 'neutral');
          const lossStages    = HS_EXIT_STAGES.filter((s) => s.group === 'loss');
          const ExitGroup = ({ stages }) => (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: '6px' }}>
              {stages.map((stage) => {
                const s = HS_STAGE_COLORS[stage.id] ?? { bg: '#f3f4f6', color: '#6b7280' };
                const count = stageCountById[stage.id] ?? 0;
                const isActive = filterStage === stage.id;
                return (
                  <div
                    key={stage.id}
                    onClick={() => { setFilterStage(isActive ? null : stage.id); setFilterStale(false); }}
                    title={isActive ? 'Click to clear filter' : `Click to filter by ${stage.label}`}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: '4px', padding: '8px 6px', borderRadius: '8px', boxSizing: 'border-box',
                      background: s.bg, border: isActive ? `2px solid ${s.color}` : `1.5px solid ${s.color}22`,
                      cursor: 'pointer', outline: isActive ? `2px solid ${s.color}66` : 'none', outlineOffset: '1px',
                    }}
                  >
                    <span style={{ fontSize: '18px', fontWeight: '900', color: s.color, lineHeight: 1 }}>{count}</span>
                    <span style={{ fontSize: '10px', fontWeight: '700', color: s.color, textAlign: 'center', lineHeight: 1.3 }}>{stage.label}</span>
                  </div>
                );
              })}
            </div>
          );
          return (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 8px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Referral / Partner Exit</p>
                <ExitGroup stages={neutralStages} />
              </div>
              <div style={{ width: '1px', background: '#e5e7eb', alignSelf: 'stretch', marginTop: '22px' }} />
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 8px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Closed Lost</p>
                <ExitGroup stages={lossStages} />
              </div>
            </div>
          );
        })()}
        </div>{/* end minWidth scroll wrapper */}
      </div>

      {/* Filters + Search */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: '7px 30px 7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#ffffff', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, appearance: 'auto' }}
        >
          <option value="all">All Types ({totalLeads})</option>
          <option value="homeowner-consultation">Homeowner ({homeownerLeads})</option>
          <option value="trade-estimate">Trade ({tradeLeads})</option>
          <option value="hubspot">HubSpot ({hubspotLeads})</option>
        </select>

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
                    <TypeBadge formType={lead.form_type} source={lead.source} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => setSortKey((k) => {
            const idx = SORT_OPTIONS.findIndex((o) => o.key === k);
            return SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length].key;
          })}
          title={`Sort: ${SORT_OPTIONS.find((o) => o.key === sortKey)?.label} — click to cycle`}
          style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: '600', flexShrink: 0, whiteSpace: 'nowrap', width: '120px', textAlign: 'center' }}
        >
          {SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? 'Sort'}
        </button>

        <button onClick={() => { loadLeads(); setFilterStage(null); setFilterStale(false); }} style={{ padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: '600' }}>
          Reset
        </button>

        <button
          onClick={() => {
            const a = document.createElement('a');
            a.href = '/api/admin-backup?action=export-csv';
            // Pass token via URL is not secure; instead open via fetch with auth header
            apiCall('/api/admin-backup?action=export-csv')
              .then((r) => r.blob())
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                a.href = url;
                a.download = `caliber-leads-${new Date().toISOString().slice(0,10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              })
              .catch(() => alert('Export failed. Please try again.'));
          }}
          title="Download all leads as CSV"
          style={{ padding: '7px 14px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          ↓ Export CSV
        </button>

        <button
          onClick={() => setShowAddModal(true)}
          style={{ padding: '7px 16px', border: 0, borderRadius: '6px', background: '#78350f', color: '#fff', fontSize: '13px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}
        >
          + Add Lead
        </button>
      </div>

      {showAddModal && (
        <AddLeadModal onClose={() => setShowAddModal(false)} onAdded={handleLeadAdded} />
      )}

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
        {filtered.length} submission{filtered.length !== 1 ? 's' : ''}{(filterType !== 'all' || searchQuery || filterStage || filterStale) ? ' (filtered)' : ''}
        {filterStale && (
          <>
            {' · showing stale leads only — '}
            <a href="#" onClick={(e) => { e.preventDefault(); setFilterStale(false); }} style={{ color: '#78350f', fontWeight: '600' }}>clear</a>
          </>
        )}
        {!filterStage && !filterStale && closedCount > 0 && (
          <span> · {closedCount} closed deal{closedCount !== 1 ? 's' : ''} hidden — click a stage above to view</span>
        )}
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
              <LeadCard lead={lead} isExpanded={expandedId === lead.id} onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)} onDelete={handleDelete} isStale={staleLeadIds.has(lead.id)} pipelineStages={pipelineStages} exitStages={exitStages} onStageChange={handleStageChange} onActivityChange={handleActivityChange} onSourceChange={handleSourceChange} onAmountChange={handleAmountChange} onProbabilityChange={handleProbabilityChange} onDeclinedReasonChange={handleDeclinedReasonChange} stageProbabilities={stageProbabilities} isSuperAdmin={isSuperAdmin} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Performance view ─────────────────────────────────────────────────────────

const PERF_STAGE_VELOCITY_DEFS = [
  { label: 'New Request',   startKey: 'hs_date_entered_new_request',   endKey: 'hs_date_entered_qualified',     id: '3869825744' },
  { label: 'Qualified',     startKey: 'hs_date_entered_qualified',      endKey: 'hs_date_entered_quote_sent',    id: 'qualifiedtobuy' },
  { label: 'Quote Sent',    startKey: 'hs_date_entered_quote_sent',     endKey: 'hs_date_entered_contract_sent', id: '3869825755' },
  { label: 'Contract Sent', startKey: 'hs_date_entered_contract_sent',  endKey: 'hs_date_entered_closed_won',    id: 'contractsent' },
];

const PERF_STAGE_REACH_ORDER = [
  { key: 'hs_date_entered_contract_sent', label: 'Contract Sent', id: 'contractsent' },
  { key: 'hs_date_entered_quote_sent',    label: 'Quote Sent',    id: '3869825755' },
  { key: 'hs_date_entered_qualified',     label: 'Qualified',     id: 'qualifiedtobuy' },
  { key: 'hs_date_entered_new_request',   label: 'New Request',   id: '3869825744' },
];

const PERF_QUOTE_OR_BEYOND = new Set(['3869825755', 'contractsent', 'closedwon']);

// Monthly stacked bar chart (Homeowner vs Trade volume)
function MonthlyVolumeBars({ data }) {
  const [tip, setTip] = useState(null);
  if (!data?.length || data.every((d) => d.newLeads === 0)) return <EmptyFrame label="No leads submitted yet" />;
  const maxVal = Math.max(...data.map((d) => d.newLeads), 1);
  return (
    <>
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '90px' }}>
          {data.map((d) => {
            const barH = Math.max(d.newLeads > 0 ? 4 : 0, Math.round((d.newLeads / maxVal) * 90));
            const trH = d.newLeads > 0 ? Math.round((d.tradeLeads / d.newLeads) * barH) : 0;
            const hwH = barH - trH;
            return (
              <div key={d.key}
                onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, content: `${d.label}\n${d.newLeads} total\n${d.homeownerLeads} homeowner · ${d.tradeLeads} trade` })}
                onMouseMove={(e) => setTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
                onMouseLeave={() => setTip(null)}
                style={{ flex: 1, height: `${barH}px`, borderRadius: '2px 2px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'crosshair' }}
              >
                {trH > 0 && <div style={{ height: `${trH}px`, background: '#166534', opacity: 0.8 }} />}
                {hwH > 0 && <div style={{ height: `${hwH}px`, background: '#c2410c', opacity: 0.8 }} />}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '3px', marginTop: '5px' }}>
          {data.map((d) => (
            <span key={d.key} style={{ flex: 1, fontSize: '8px', color: '#9ca3af', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{d.label}</span>
          ))}
        </div>
      </div>
      <ChartTooltip tip={tip} />
    </>
  );
}

// Monthly line chart with gap support for null months
function MonthlyLineChart({ data, lines, height = 120, formatTip }) {
  const [tip, setTip] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!data?.length) return <EmptyFrame label="No trend data yet" />;
  const hasAny = lines.some((l) => data.some((d) => d[l.key] !== null && d[l.key] !== undefined));
  if (!hasAny) return <EmptyFrame label="Data will appear as deals progress and close" />;

  const W = 600; const H = height;
  const PL = 6; const PR = 6; const PT = 10; const PB = 22;
  const cW = W - PL - PR; const cH = H - PT - PB;
  const n = data.length;

  // Thin x-axis labels on dense charts (e.g. 28 daily points) so they don't
  // crowd into an unreadable smear. Charts with few points (12 monthly labels
  // and under) are untouched — every label already fits comfortably there.
  // Always keep the first and last point visible for date-range context.
  const LABEL_DENSE_THRESHOLD = 15;
  const labelStep = n > LABEL_DENSE_THRESHOLD ? Math.ceil(n / 7) : 1;

  const rendered = lines.map((line) => {
    const defined = data.map((d) => d[line.key]).filter((v) => v !== null && v !== undefined);
    if (!defined.length) return { ...line, segments: [], dots: [], pts: [] };
    const max = Math.max(...defined, 1);
    const pts = data.map((d, i) => ({
      x: PL + (n <= 1 ? cW / 2 : (i / (n - 1)) * cW),
      y: d[line.key] != null ? PT + cH - (d[line.key] / max) * cH : null,
      v: d[line.key], label: d.label,
    }));
    const segments = [];
    let seg = [];
    for (const p of pts) {
      if (p.y !== null) { seg.push(p); } else { if (seg.length) { segments.push(seg); seg = []; } }
    }
    if (seg.length) segments.push(seg);
    return { ...line, segments, dots: pts.filter((p) => p.y !== null), pts };
  });

  function handleEnter(e, i) {
    const parts = [data[i].label];
    for (const line of rendered) {
      const pt = line.pts[i];
      if (pt?.v != null) parts.push(`${line.label}: ${formatTip ? formatTip(pt.v) : pt.v}`);
    }
    setTip({ x: e.clientX, y: e.clientY, content: parts.join('\n') });
    setHoverIdx(i);
  }

  // Build hit-area strips using first line with data
  const refLine = rendered.find((l) => l.pts.length > 0);
  const strips = refLine?.pts.map((p, i) => {
    const prevX = i > 0 ? (p.x + refLine.pts[i - 1].x) / 2 : PL;
    const nextX = i < n - 1 ? (p.x + refLine.pts[i + 1].x) / 2 : W - PR;
    return { x: prevX, width: nextX - prevX, i };
  }) ?? [];

  return (
    <>
      <div>
        {lines.length > 1 && (
          <div style={{ display: 'flex', gap: '14px', marginBottom: '8px' }}>
            {lines.map((l) => (
              <span key={l.key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#6b7280' }}>
                <span style={{ width: '18px', height: '3px', background: l.color, borderRadius: '2px', display: 'inline-block' }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: `${H}px`, display: 'block' }} preserveAspectRatio="none">
          {rendered.map((line) => (
            <g key={line.key}>
              {line.segments.map((sg, si) => (
                <polyline key={si} points={sg.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={line.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {line.dots.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={line.color} />
              ))}
              {/* Enlarged dot on hovered index */}
              {hoverIdx !== null && line.pts[hoverIdx]?.y != null && (
                <circle cx={line.pts[hoverIdx].x} cy={line.pts[hoverIdx].y} r="5.5" fill={line.color} stroke="white" strokeWidth="1.5" />
              )}
            </g>
          ))}
          {/* Invisible hit-area strips for hover detection */}
          {strips.map((s) => (
            <rect key={s.i} x={s.x} y={PT} width={s.width} height={cH}
              fill="transparent" style={{ cursor: 'crosshair' }}
              onMouseEnter={(e) => handleEnter(e, s.i)}
              onMouseMove={(e) => setTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
              onMouseLeave={() => { setTip(null); setHoverIdx(null); }}
            />
          ))}
          {data.map((d, i) => {
            if (labelStep > 1 && i !== 0 && i !== n - 1 && i % labelStep !== 0) return null;
            return (
              <text key={i} x={PL + (n <= 1 ? cW / 2 : (i / (n - 1)) * cW)} y={H - 4}
                fontSize="9" fill="#9ca3af" textAnchor="middle">{d.label}</text>
            );
          })}
        </svg>
      </div>
      <ChartTooltip tip={tip} />
    </>
  );
}

// ─── Cashflow Forecast ────────────────────────────────────────────────────────
// Won deals only in the cash timeline (no speculative projection from pipeline dates).
// Pipeline deals appear in the weighted table — probability × quote amount — but
// are not placed in any calendar month.
//
// The cash timeline is built from each deal's real 3-stage payment schedule
// (Financial Management), not a hardcoded split — a stage lands in the month of
// its paid_date if it's been paid, otherwise its est_date (still forecasted).
const FORECAST_STAGE_LABELS = {
  initial_deposit: 'Initial Deposit',
  production_payment: 'Production Payment',
  final_payment: 'Final Payment',
};
const PAYMENT_STAGE_ORDER = Object.keys(FORECAST_STAGE_LABELS); // mirrors STAGE_ORDER in api/admin-cashflow.js

// Reusable cash-inflow bar chart — used on the Performance page (alongside the
// weighted pipeline table) and directly in Financial Management (where Brianna,
// the bookkeeper, actually lives — she has no access to Performance).
function CashInflowChart({
  deals,
  title = 'Cash Inflow · Won Deals',
  subtitle = 'Initial Deposit · Production Payment · Final Payment — per deal\'s own schedule',
}) {
  const [cashTip, setCashTip] = useState(null);
  const wonDeals = deals ?? [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build month buckets: 3 months back + current + 5 ahead = 9 total.
  // Every stage lands in a bucket by year+month only — the axis (and every
  // past/future comparison below) treats each bucket as spanning the whole
  // month, 1st through last day, never a specific date. Labels are built from
  // a fixed month-abbreviation table rather than toLocaleDateString so the
  // x-axis always reads "Mon 'YY" — never a day-of-month — regardless of the
  // browser's locale settings.
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PAST_MONTHS = 3;
  const FWD_MONTHS  = 5;
  const monthBuckets = [];
  for (let i = -PAST_MONTHS; i <= FWD_MONTHS; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    monthBuckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_ABBR[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`,
      year: d.getFullYear(),
      month: d.getMonth(),
      received: 0,   // stages already paid
      expected: 0,   // stages scheduled (est. date) but not yet paid
      items: [],     // per-stage detail for the hover tooltip
    });
  }
  const bucketMap = Object.fromEntries(monthBuckets.map((b) => [b.key, b]));

  // Parse a plain "YYYY-MM-DD" as a local calendar date, not UTC midnight —
  // otherwise it can land in the wrong month in US timezones.
  function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
    if (!y) return null;
    return new Date(y, m - 1, d);
  }

  function addToBucket(dateObj, field, amount, item) {
    const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    if (!bucketMap[key]) return;
    bucketMap[key][field] += amount;
    if (item) bucketMap[key].items.push(item);
  }

  for (const deal of wonDeals) {
    for (const stage of deal.stages ?? []) {
      const effectiveDateStr = stage.paid_date ?? stage.est_date;
      if (!effectiveDateStr) continue;
      const dateObj = parseLocalDate(effectiveDateStr);
      if (!dateObj) continue;
      const isPaid = !!stage.paid_date;
      addToBucket(dateObj, isPaid ? 'received' : 'expected', stage.amount, {
        label: FORECAST_STAGE_LABELS[stage.stage] ?? stage.stage,
        dealName: deal.name,
        amount: stage.amount,
        status: isPaid ? 'Paid' : (stage.invoice_date ? 'Invoiced' : 'Estimated'),
      });
    }
  }

  const maxBarAmt = Math.max(...monthBuckets.map((b) => b.received + b.expected), 1);
  const fmtCurrency = (n) => n >= 1000
    ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
    : `$${Math.round(n).toLocaleString()}`;
  const fmtFull = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
        {subtitle && <span style={{ fontSize: '11px', color: '#9ca3af' }}>{subtitle}</span>}
        <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
      </div>
      {wonDeals.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>No won deals with a payment schedule yet.</p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '140px' }}>
          {monthBuckets.map((b) => {
            const total   = b.received + b.expected;
            const barH    = total > 0 ? Math.max(4, Math.round((total / maxBarAmt) * 120)) : 0;
            const recH    = total > 0 ? Math.round((b.received / total) * barH) : 0;
            const expH    = barH - recH;
            const isCur   = b.key === currentMonthKey;
            const isPast  = new Date(b.year, b.month + 1, 0) < today;
            const itemsText = b.items
              .slice(0, 6)
              .map((it) => `${it.label} (${it.dealName}): ${fmtFull(it.amount)} — ${it.status}`)
              .join('\n') + (b.items.length > 6 ? `\n+${b.items.length - 6} more` : '');
            return (
              <div
                key={b.key}
                onMouseEnter={(e) => total > 0 && setCashTip({ x: e.clientX, y: e.clientY, content: `${b.label}\nTotal: ${fmtFull(total)}${b.received > 0 ? `\nReceived: ${fmtFull(b.received)}` : ''}${b.expected > 0 ? `\nExpected: ${fmtFull(b.expected)}` : ''}${itemsText ? `\n\n${itemsText}` : ''}` })}
                onMouseMove={(e) => setCashTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
                onMouseLeave={() => setCashTip(null)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: total > 0 ? 'crosshair' : 'default' }}
              >
                {total > 0 && (
                  <span style={{ fontSize: '9px', color: '#6b7280', fontWeight: '600', whiteSpace: 'nowrap' }}>
                    {fmtCurrency(total)}
                  </span>
                )}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '120px' }}>
                  {total > 0 && (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
                      {expH > 0 && (
                        <div style={{ height: `${expH}px`, background: isPast ? '#d1d5db' : '#d97706', opacity: isCur ? 1 : isPast ? 0.5 : 0.7 }} />
                      )}
                      {recH > 0 && (
                        <div style={{ height: `${recH}px`, background: isPast ? '#9ca3af' : '#15803d', opacity: isCur ? 1 : isPast ? 0.5 : 0.8 }} />
                      )}
                    </div>
                  )}
                  {total === 0 && (
                    <div style={{ height: '3px', background: '#f3f4f6', borderRadius: '2px' }} />
                  )}
                </div>
                <span style={{ fontSize: '9px', color: isCur ? '#78350f' : '#9ca3af', fontWeight: isCur ? '800' : '500', whiteSpace: 'nowrap' }}>
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {wonDeals.length > 0 && (
        <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#6b7280' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#15803d', display: 'inline-block' }} />Received
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#6b7280' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#d97706', display: 'inline-block' }} />Expected (est. date)
          </span>
        </div>
      )}
      <ChartTooltip tip={cashTip} />
    </div>
  );
}

function CashflowForecastSection({ leads, stageProbabilities, financialDeals }) {
  const wonDeals = financialDeals ?? [];

  // ── Weighted pipeline table (active pipeline deals with quote amounts) ──────
  const pipelineRows = DEFAULT_STAGE_FORECAST.map((stageDef) => {
    const stageLeads = leads.filter(
      (l) => l.hs_stage_id === stageDef.id && l.fields?.quote_amount > 0
    );
    const totalQuoted = stageLeads.reduce((s, l) => s + (l.fields?.quote_amount ?? 0), 0);
    const expectedValue = stageLeads.reduce((s, l) => {
      const p = l.fields?.probability != null ? l.fields.probability / 100
        : ((stageProbabilities?.[stageDef.id] ?? stageDef.probability) / 100);
      return s + (l.fields?.quote_amount ?? 0) * p;
    }, 0);
    const prob = stageProbabilities?.[stageDef.id] ?? stageDef.probability;
    return { ...stageDef, prob, count: stageLeads.length, totalQuoted, expectedValue };
  }).filter((r) => r.count > 0);

  const totalExpected = pipelineRows.reduce((s, r) => s + r.expectedValue, 0);
  const totalQuotedAll = pipelineRows.reduce((s, r) => s + r.totalQuoted, 0);

  // ── Cash inflow totals — won deals only (the chart itself is <CashInflowChart>) ──
  const totalCommitted = wonDeals.reduce((s, d) => s + (d.contract_amount ?? 0), 0);
  const depositsDue    = wonDeals.reduce((s, d) => s + Math.max(0, d.balance ?? 0), 0);
  const fmtFull = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

  const sectionLabel = (text, sub) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
      <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{text}</span>
      {sub && <span style={{ fontSize: '11px', color: '#9ca3af' }}>{sub}</span>}
      <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
    </div>
  );

  return (
    <section>
      {/* ── Top KPIs ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cashflow Forecast</span>
        <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Won — Total Contract Value', value: fmtFull(totalCommitted), sub: `${wonDeals.length} deal${wonDeals.length !== 1 ? 's' : ''}`, color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
          { label: 'Won — Cash Still Incoming', value: fmtFull(depositsDue),     sub: 'unpaid across all schedule stages', color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
          { label: 'Pipeline — Weighted Expected', value: totalExpected > 0 ? fmtFull(totalExpected) : '—', sub: totalQuotedAll > 0 ? `of ${fmtFull(totalQuotedAll)} quoted` : 'no quoted pipeline deals', color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
        ].map(({ label, value, sub, color, bg, border }) => (
          <div key={label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: '8px', padding: '14px 16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
            <p style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '800', color, lineHeight: 1.1 }}>{value}</p>
            <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>{sub}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        <CashInflowChart deals={wonDeals} />

        {/* ── Weighted pipeline table ── */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
          {sectionLabel('Weighted Pipeline', 'probability × quote amount per stage')}
          {pipelineRows.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>No active pipeline deals with quote amounts yet. Set quote amounts from the Leads view.</p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                    {['Stage', 'Deals', 'Quoted', 'Prob', 'Expected'].map((h) => (
                      <th key={h} style={{ padding: '4px 8px 8px', textAlign: h === 'Stage' ? 'left' : 'right', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pipelineRows.map((row) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                      <td style={{ padding: '8px', color: '#374151', fontWeight: '500' }}>{row.label}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#6b7280' }}>{row.count}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#374151' }}>{fmtFull(row.totalQuoted)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#6b7280' }}>{row.prob}%</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: '700', color: '#78350f' }}>{fmtFull(row.expectedValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #f3e8d0' }}>
                    <td colSpan={2} style={{ padding: '10px 8px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>Total</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: '700', color: '#374151' }}>{fmtFull(totalQuotedAll)}</td>
                    <td />
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: '800', color: '#78350f', fontSize: '14px' }}>{fmtFull(totalExpected)}</td>
                  </tr>
                </tfoot>
              </table>
              <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>
                Probabilities are stage defaults. Override per-deal from the Leads view.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function PerformanceView() {
  const isMobile = useIsMobile();
  const [leads, setLeads] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [stageProbabilities, setStageProbabilities] = useState(null);
  const [financialDeals, setFinancialDeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      apiCall('/api/admin-leads').then((r) => {
        if (r.status === 401) { sessionStorage.clear(); window.location.reload(); }
        return r.json();
      }),
      apiCall('/api/admin-analytics').then((r) => r.json()).catch(() => null),
      apiCall('/api/admin-settings').then((r) => r.json()).catch(() => null),
      // Real per-deal payment schedule (Initial Deposit/Production Payment/Final
      // Payment) — powers the Cashflow Forecast timeline below instead of a guess.
      apiCall('/api/admin-cashflow').then((r) => r.json()).catch(() => null),
    ])
      .then(([leadsData, analyticsData, settingsData, financialData]) => {
        setLeads(leadsData.leads ?? []);
        setAnalytics(analyticsData);
        setStageProbabilities(settingsData?.settings?.stage_probabilities ?? {});
        setFinancialDeals(financialData?.deals ?? []);
        setIsLoading(false);
      })
      .catch(() => { setLoadError('Failed to load performance data.'); setIsLoading(false); });
  }, []);

  function startDate(l) { return l.hs_date_entered_new_request ?? l.created_at; }

  // Build last-12-month buckets
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      year: d.getFullYear(),
      month: d.getMonth(),
    });
  }

  const monthlyStats = months.map(({ key, label, year, month }) => {
    const newLeads = leads.filter((l) => {
      const d = new Date(l.created_at);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const wonThisMonth = leads.filter((l) => {
      if (!l.hs_date_entered_closed_won) return false;
      const d = new Date(l.hs_date_entered_closed_won);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const lostThisMonth = leads.filter((l) => {
      if (!l.hs_date_entered_closed_lost) return false;
      const d = new Date(l.hs_date_entered_closed_lost);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const closedCount = wonThisMonth.length + lostThisMonth.length;
    // Require ≥2 closed to avoid 100%/0% noise from single deals
    const winRate = closedCount >= 2 ? Math.round((wonThisMonth.length / closedCount) * 100) : null;

    // Lead→Quote: of leads created this month, how many eventually reached Quote Sent or beyond
    const leadToQuote = newLeads.length >= 2
      ? Math.round((newLeads.filter((l) => PERF_QUOTE_OR_BEYOND.has(l.hs_stage_id)).length / newLeads.length) * 100)
      : null;

    const quotedThisMonth = leads.filter((l) => {
      if (!l.hs_date_entered_quote_sent) return false;
      const d = new Date(l.hs_date_entered_quote_sent);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const timeToQuoteSamples = quotedThisMonth
      .map((l) => businessDaysBetween(startDate(l), l.hs_date_entered_quote_sent))
      .filter((d) => d !== null && d >= 0);
    const avgTimeToQuote = timeToQuoteSamples.length > 0
      ? timeToQuoteSamples.reduce((a, b) => a + b, 0) / timeToQuoteSamples.length : null;

    const fullCycleSamplesMonth = wonThisMonth
      .map((l) => businessDaysBetween(startDate(l), l.hs_date_entered_closed_won))
      .filter((d) => d !== null && d >= 0);
    const avgFullCycle = fullCycleSamplesMonth.length > 0
      ? fullCycleSamplesMonth.reduce((a, b) => a + b, 0) / fullCycleSamplesMonth.length : null;

    return {
      key, label,
      newLeads: newLeads.length,
      homeownerLeads: newLeads.filter((l) => l.form_type === 'homeowner-consultation').length,
      tradeLeads: newLeads.filter((l) => l.form_type === 'trade-estimate').length,
      wonCount: wonThisMonth.length,
      lostCount: lostThisMonth.length,
      closedCount,
      winRate,
      leadToQuote,
      avgTimeToQuote,
      avgFullCycle,
    };
  });

  // Stage Velocity
  const stageVelocity = PERF_STAGE_VELOCITY_DEFS.map((def) => {
    const samples = leads
      .filter((l) => l[def.startKey] && l[def.endKey])
      .map((l) => businessDaysBetween(l[def.startKey], l[def.endKey]))
      .filter((d) => d !== null && d >= 0);
    const avg = samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    const activeInStage = leads.filter(
      (l) => l.hs_stage_id === def.id && l[def.startKey] && !l[def.endKey]
    ).length;
    return { ...def, avg, n: samples.length, activeInStage };
  });

  // Lost-Stage Distribution
  const lostLeads = leads.filter((l) => l.hs_stage_id === 'closedlost');
  const lostByStage = {};
  for (const lead of lostLeads) {
    const reached = PERF_STAGE_REACH_ORDER.find((s) => lead[s.key]);
    if (reached) lostByStage[reached.id] = (lostByStage[reached.id] ?? 0) + 1;
  }

  // Lost-Reason Distribution — Competitor / Pricing / Value / Other
  const lostByReason = {};
  let lostReasonMissing = 0;
  for (const lead of lostLeads) {
    if (lead.lost_reason) lostByReason[lead.lost_reason] = (lostByReason[lead.lost_reason] ?? 0) + 1;
    else lostReasonMissing++;
  }

  // Declined-Reason Distribution — Out of Service Area / Out of Scope / Other
  const declinedLeads = leads.filter((l) => l.hs_stage_id === DECLINED_STAGE_ID);
  const declinedByReason = {};
  let declinedReasonMissing = 0;
  for (const lead of declinedLeads) {
    if (lead.declined_reason) declinedByReason[lead.declined_reason] = (declinedByReason[lead.declined_reason] ?? 0) + 1;
    else declinedReasonMissing++;
  }

  // Conversion by Lead Type
  function typeStats(type) {
    const subset = type === 'all' ? leads : leads.filter((l) => l.form_type === type);
    const won  = subset.filter((l) => l.hs_stage_id === 'closedwon').length;
    const lost = subset.filter((l) => l.hs_stage_id === 'closedlost').length;
    const closed = won + lost;
    const quoted = subset.filter((l) => PERF_QUOTE_OR_BEYOND.has(l.hs_stage_id)).length;
    const active = subset.filter(
      (l) => l.hs_stage_id && !EXIT_STAGE_IDS.has(l.hs_stage_id)
    ).length;
    return {
      total: subset.length, active, won, lost, closed,
      winRate: closed > 0 ? Math.round((won / closed) * 100) : null,
      quoted,
      quoteRate: subset.length > 0 ? Math.round((quoted / subset.length) * 100) : null,
    };
  }
  const homeownerStats = typeStats('homeowner-consultation');
  const tradeStats     = typeStats('trade-estimate');

  // Avg Full Cycle (all-time)
  const fullCycleSamples = leads
    .filter((l) => l.hs_date_entered_closed_won)
    .map((l) => businessDaysBetween(startDate(l), l.hs_date_entered_closed_won))
    .filter((d) => d !== null && d >= 0);
  const avgFullCycleDays = fullCycleSamples.length > 0
    ? fullCycleSamples.reduce((a, b) => a + b, 0) / fullCycleSamples.length : null;

  // Avg Time to Quote (all-time)
  const avgTimeToQuoteSamples = leads
    .filter((l) => l.hs_date_entered_quote_sent)
    .map((l) => businessDaysBetween(startDate(l), l.hs_date_entered_quote_sent))
    .filter((d) => d !== null && d >= 0);
  const avgTimeToQuoteAllTime = avgTimeToQuoteSamples.length > 0
    ? avgTimeToQuoteSamples.reduce((a, b) => a + b, 0) / avgTimeToQuoteSamples.length : null;

  const sectionLabel = (text) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
      <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{text}</span>
      <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
    </div>
  );

  const chartCard = (title, sub, content) => (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
      <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>{title}</p>
      {sub && <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#9ca3af' }}>{sub}</p>}
      {!sub && <div style={{ marginBottom: '10px' }} />}
      {content}
    </div>
  );

  // ── Marketing computations (last 28 days) ───────────────────────────────────
  // Marketing stats only count web-sourced leads so manually-entered leads don't
  // skew click-to-lead ratios and the traffic/leads overlay chart.
  const isWebLead = (l) => !l.fields?.leadSource || l.fields?.leadSource === 'Website';
  const cutoff28 = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const leads28 = leads.filter((l) => isWebLead(l) && new Date(l.created_at) >= cutoff28).length;

  // Web leads per calendar day for the last 28 days (for trend chart)
  const leadsByDay = {};
  for (const l of leads) {
    if (!isWebLead(l)) continue;
    const d = new Date(l.created_at);
    if (d >= cutoff28) {
      const key = d.toISOString().split('T')[0];
      leadsByDay[key] = (leadsByDay[key] ?? 0) + 1;
    }
  }

  const ga  = analytics?.ga;
  const gsc = analytics?.gsc;
  const gaTotal  = ga?.totals  ?? {};
  const gscTotal = gsc?.totals ?? {};

  // Merge GA sessions + GSC clicks/impressions by date for the overlay chart
  const gaDailyMap  = {};
  const gscDailyMap = {};
  for (const d of ga?.daily  ?? []) gaDailyMap[d.date]  = d;
  for (const d of gsc?.daily ?? []) gscDailyMap[d.date] = d;
  const allDates = [...new Set([
    ...(ga?.daily  ?? []).map((d) => d.date),
    ...(gsc?.daily ?? []).map((d) => d.date),
  ])].sort();
  const mktDailyData = allDates.map((date) => ({
    key:         date,
    label:       new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    impressions: gscDailyMap[date]?.impressions ?? null,
    clicks:      gscDailyMap[date]?.clicks      ?? null,
    sessions:    gaDailyMap[date]?.sessions     ?? null,
    leadsCount:  leadsByDay[date]               ?? 0,
  }));

  // Derived funnel rates
  const organicCTR         = gscTotal.ctr ?? null;                         // % impressions→clicks
  const clickToLeadRate    = (gscTotal.clicks > 0 && leads28 > 0)
    ? Math.round((leads28 / gscTotal.clicks) * 100) : null;                // % clicks→leads
  const sessionToLeadRate  = (gaTotal.sessions > 0 && leads28 > 0)
    ? Math.round((leads28 / gaTotal.sessions) * 100) : null;               // % all sessions→leads

  if (isLoading) return <p style={{ color: '#9ca3af', padding: '40px 0', textAlign: 'center' }}>Loading performance data…</p>;
  if (loadError) return <p style={{ color: '#b91c1c' }}>{loadError}</p>;

  return (
    <div style={{ display: 'grid', gap: '28px' }}>
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '700', color: '#111827' }}>Pipeline Performance</h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
          Monthly trends, stage-by-stage velocity, and lead-type breakdowns.
        </p>
      </div>

      {/* ── Cashflow Forecast ── */}
      {!isLoading && (
        <CashflowForecastSection leads={leads} stageProbabilities={stageProbabilities ?? {}} financialDeals={financialDeals} />
      )}

      {/* ── Pipeline Health ───────────────────────────────────────────────────── */}
      <section>
        {sectionLabel('Pipeline Health')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Stage Velocity</span>
              <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
              <WithTip tip={`Average business days a deal spends in each stage before moving on. Counts business hours only (${BIZ_HOURS_LABEL}) — nights, weekends, and off-hours don't accrue.`}>
                <span style={{ fontSize: '11px', color: '#9ca3af', cursor: 'default', borderBottom: '1px dotted #d1d5db' }}>avg business days per stage</span>
              </WithTip>
            </div>
            {stageVelocity.every((s) => s.n === 0 && s.activeInStage === 0) ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>Not enough data yet — needs deals that have progressed through multiple stages.</p>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {stageVelocity.map((stage) => {
                  const maxAvg = Math.max(...stageVelocity.map((s) => s.avg ?? 0), 1);
                  const barPct = stage.avg !== null ? Math.max(4, Math.round((stage.avg / maxAvg) * 100)) : 0;
                  const s = HS_STAGE_COLORS[stage.id] ?? { bg: '#f3f4f6', color: '#6b7280' };
                  return (
                    <div key={stage.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>{stage.label}</span>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {stage.avg !== null
                            ? <span style={{ fontSize: '13px', fontWeight: '700', color: s.color }}>{formatDays(stage.avg)}</span>
                            : <span style={{ fontSize: '12px', color: '#9ca3af' }}>—</span>}
                          {stage.n > 0 && <span style={{ fontSize: '10px', color: '#9ca3af' }}>n={stage.n}</span>}
                          {stage.activeInStage > 0 && (
                            <span style={{ fontSize: '10px', background: '#fef3c7', color: '#92400e', borderRadius: '4px', padding: '1px 5px', fontWeight: '600' }}>
                              {stage.activeInStage} active
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ height: '6px', background: '#f3f4f6', borderRadius: '3px' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: s.color, borderRadius: '3px', opacity: 0.75, transition: 'width 400ms ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Where Deals Are Lost</span>
              <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>{lostLeads.length} lost · {declinedLeads.length} declined</span>
            </div>
            {lostLeads.length === 0 && declinedLeads.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>No closed-lost or declined deals yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {lostLeads.length > 0 && PERF_STAGE_REACH_ORDER.slice().reverse().map((stageDef) => {
                  const count = lostByStage[stageDef.id] ?? 0;
                  const pct = lostLeads.length > 0 ? Math.round((count / lostLeads.length) * 100) : 0;
                  const barPct = Math.max(count > 0 ? 4 : 0, pct);
                  return (
                    <div key={stageDef.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>{stageDef.label}</span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: count > 0 ? '#991b1b' : '#9ca3af' }}>{count}</span>
                          {count > 0 && <span style={{ fontSize: '10px', color: '#9ca3af' }}>{pct}%</span>}
                        </div>
                      </div>
                      <div style={{ height: '6px', background: '#f3f4f6', borderRadius: '3px' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: count > 0 ? '#dc2626' : '#f3f4f6', borderRadius: '3px', opacity: 0.6, transition: 'width 400ms ease' }} />
                      </div>
                    </div>
                  );
                })}
                {lostLeads.length > 0 && (
                  <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>
                    {Object.keys(lostByStage).length === 0 ? 'Stage reached unknown for these deals.' :
                     lostByStage['3869825755'] > 0 ? 'Most losses after Quote Sent — review pricing or proposal quality.' :
                     lostByStage['qualifiedtobuy'] > 0 ? 'Losses at Qualified — may indicate fit or follow-up issues.' :
                     'Losses at early stages — lead quality or response time may be the issue.'}
                  </p>
                )}
                {/* ── Lost Reason breakdown ── */}
                {lostLeads.length > 0 && (
                <div style={{ marginTop: '4px', paddingTop: '12px', borderTop: '1px solid #f3f4f6' }}>
                  <p style={{ margin: '0 0 8px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>By Reason</p>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {LOST_REASON_OPTIONS.map((reason) => {
                      const count = lostByReason[reason] ?? 0;
                      if (count === 0) return null;
                      return <Pill key={reason} bg="#fee2e2" color="#991b1b">{count} {reason}</Pill>;
                    })}
                    {lostReasonMissing > 0 && (
                      <Pill bg="#f3f4f6" color="#6b7280">{lostReasonMissing} no reason on file</Pill>
                    )}
                    {Object.keys(lostByReason).length === 0 && lostReasonMissing === 0 && (
                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>—</span>
                    )}
                  </div>
                </div>
                )}
                {/* ── Declined Reason breakdown — separate from Lost Deal above, ── */}
                {/* ── since Declined isn't a competitive loss.                   ── */}
                {declinedLeads.length > 0 && (
                  <div style={{ marginTop: '4px', paddingTop: '12px', borderTop: '1px solid #f3f4f6' }}>
                    <p style={{ margin: '0 0 8px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Declined Reasons <span style={{ fontWeight: '500', textTransform: 'none' }}>({declinedLeads.length} declined)</span>
                    </p>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {DECLINED_REASON_OPTIONS.map((reason) => {
                        const count = declinedByReason[reason] ?? 0;
                        if (count === 0) return null;
                        return <Pill key={reason} bg="#fef3c7" color="#92400e">{count} {reason}</Pill>;
                      })}
                      {declinedReasonMissing > 0 && (
                        <Pill bg="#f3f4f6" color="#6b7280">{declinedReasonMissing} no reason on file</Pill>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Conversion by Lead Type ───────────────────────────────────────────── */}
      <section>
        {sectionLabel('Conversion by Lead Type')}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
          {[
            { label: 'Homeowner', stats: homeownerStats, bg: '#fff7ed', accent: '#c2410c' },
            { label: 'Trade Partner', stats: tradeStats, bg: '#f0fdf4', accent: '#166534' },
          ].map(({ label, stats, bg, accent }) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
                <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
                <span style={{ fontSize: '11px', padding: '2px 8px', background: bg, color: accent, borderRadius: '999px', fontWeight: '600' }}>{stats.total} total</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                {[
                  { label: 'Win Rate', value: stats.winRate !== null ? `${stats.winRate}%` : '—', sub: stats.closed > 0 ? `${stats.won}W · ${stats.lost}L` : 'No closed deals', color: stats.winRate !== null ? (stats.winRate >= 50 ? '#16a34a' : '#dc2626') : '#9ca3af', tip: 'Won deals ÷ total closed (Won + Lost). Only fully closed deals count — active leads in the pipeline aren\'t included yet.' },
                  { label: 'Lead → Quote', value: stats.quoteRate !== null ? `${stats.quoteRate}%` : '—', sub: `${stats.quoted} of ${stats.total} leads`, color: '#111827', tip: 'Of all leads in this category, the % that reached Quote Sent or later. Shows how many inquiries are converting to real proposals.' },
                  { label: 'Active Now', value: stats.active, sub: `${stats.total - stats.active - stats.closed} untracked`, color: accent, tip: 'Leads currently in the HubSpot pipeline — they have an active stage and haven\'t been marked Won or Lost yet.' },
                ].map((cell) => (
                  <WithTip key={cell.label} tip={cell.tip}>
                    <div style={{ textAlign: 'center', padding: '10px 6px', background: bg, borderRadius: '6px' }}>
                      <p style={{ margin: '0 0 2px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{cell.label}</p>
                      <p style={{ margin: '0 0 2px', fontSize: '20px', fontWeight: '700', color: cell.color, lineHeight: 1.1 }}>{cell.value}</p>
                      <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af' }}>{cell.sub}</p>
                    </div>
                  </WithTip>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Velocity Stats ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginTop: '12px' }}>
          <WithTip tip={`Average business time from first contact (New Request) to Quote Sent, across all deals that have been quoted. Lower = faster proposal turnaround. Counts business hours only (${BIZ_HOURS_LABEL}).`}>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 24px', display: 'flex', alignItems: 'baseline', gap: '14px' }}>
              <span style={{ fontSize: '36px', fontWeight: '700', color: avgTimeToQuoteAllTime !== null ? '#78350f' : '#9ca3af', lineHeight: 1 }}>
                {avgTimeToQuoteAllTime !== null ? formatDays(avgTimeToQuoteAllTime) : '—'}
              </span>
              <div>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#374151' }}>Avg Time to Quote</p>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#9ca3af' }}>New Request → Quote Sent</p>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#9ca3af' }}>
                  {avgTimeToQuoteSamples.length > 0
                    ? `Based on ${avgTimeToQuoteSamples.length} quoted deal${avgTimeToQuoteSamples.length !== 1 ? 's' : ''}`
                    : 'No quoted deals yet'}
                </p>
              </div>
            </div>
          </WithTip>
          <WithTip tip={`Average business time from first contact (New Request) to Closed Won, across all won deals with complete stage history. Lower = faster sales cycle. Counts business hours only (${BIZ_HOURS_LABEL}).`}>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 24px', display: 'flex', alignItems: 'baseline', gap: '14px' }}>
              <span style={{ fontSize: '36px', fontWeight: '700', color: avgFullCycleDays !== null ? '#111827' : '#9ca3af', lineHeight: 1 }}>
                {avgFullCycleDays !== null ? formatDays(avgFullCycleDays) : '—'}
              </span>
              <div>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#374151' }}>Avg Full Cycle</p>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#9ca3af' }}>New Request → Closed Won</p>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#9ca3af' }}>
                  {fullCycleSamples.length > 0
                    ? `Based on ${fullCycleSamples.length} won deal${fullCycleSamples.length !== 1 ? 's' : ''} with full history`
                    : 'No won deals with full history yet'}
                </p>
              </div>
            </div>
          </WithTip>
        </div>
      </section>

      {/* ── Trend Charts ─────────────────────────────────────────────────────── */}
      <section>
        {sectionLabel('Trends · Last 12 Months')}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>

          {chartCard(
            'New Leads per Month',
            <><span style={{ color: '#c2410c', fontWeight: '700' }}>■</span> Homeowner &nbsp;<span style={{ color: '#166534', fontWeight: '700' }}>■</span> Trade</>,
            <MonthlyVolumeBars data={monthlyStats} />,
          )}

          {chartCard(
            'Conversion Rates',
            'Win Rate % and Lead → Quote % by month  ·  min. 2 data points to plot',
            <MonthlyLineChart
              data={monthlyStats}
              lines={[
                { key: 'winRate',     label: 'Win Rate',     color: '#16a34a' },
                { key: 'leadToQuote', label: 'Lead → Quote', color: '#7c3aed' },
              ]}
              formatTip={(v) => `${v}%`}
            />,
          )}

          {chartCard(
            'Avg Time to Quote',
            'Business days from New Request → Quote Sent (Mon–Fri, 8am–5pm PT), grouped by month the quote was sent',
            <MonthlyLineChart
              data={monthlyStats}
              lines={[{ key: 'avgTimeToQuote', label: 'Avg days', color: '#78350f' }]}
              formatTip={(v) => `${Math.round(v)}d`}
            />,
          )}

          {chartCard(
            'Avg Full Cycle',
            'Business days from New Request → Closed Won (Mon–Fri, 8am–5pm PT), grouped by month the deal was won',
            <MonthlyLineChart
              data={monthlyStats}
              lines={[{ key: 'avgFullCycle', label: 'Avg days', color: '#b45309' }]}
              formatTip={(v) => `${Math.round(v)}d`}
            />,
          )}
        </div>
      </section>

      {/* ── Marketing Effectiveness ───────────────────────────────────────────── */}
      <section>
        {sectionLabel('Marketing Effectiveness · Last 28 Days')}

        {/* Funnel: Impressions → Clicks → Leads */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px 24px', marginBottom: '12px' }}>
          <p style={{ margin: '0 0 16px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>Organic Search Funnel</p>
          {(!gsc?.configured && !ga?.configured) ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>Connect Google Search Console and Google Analytics to see marketing data.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
              {[
                {
                  label: 'Impressions',
                  value: gscTotal.impressions != null ? gscTotal.impressions.toLocaleString() : '—',
                  sub: 'times shown in Google search',
                  color: '#4285f4',
                  bg: '#eff6ff',
                  noData: !gsc?.configured,
                  badge: null,
                  tip: 'How many times your website appeared in Google search results over the last 28 days. More impressions means better search visibility — people are finding you when they search for cabinets.',
                },
                {
                  label: 'Clicks',
                  value: gscTotal.clicks != null ? gscTotal.clicks.toLocaleString() : '—',
                  sub: 'clicked through from search',
                  color: '#059669',
                  bg: '#f0fdf4',
                  noData: !gsc?.configured,
                  badge: organicCTR != null ? `${organicCTR}% CTR` : null,
                  badgeBg: '#d1fae5', badgeColor: '#065f46',
                  tip: 'How many people clicked your site from Google search results. CTR (click-through rate) = Clicks ÷ Impressions. A higher CTR means your titles and descriptions are compelling enough to click.',
                },
                {
                  label: 'Form Leads',
                  value: leads28.toLocaleString(),
                  sub: 'form submissions · last 28 days',
                  color: '#78350f',
                  bg: '#fff7ed',
                  noData: false,
                  badge: clickToLeadRate != null
                    ? `${clickToLeadRate}% click → lead`
                    : sessionToLeadRate != null
                      ? `${sessionToLeadRate}% session → lead`
                      : null,
                  badgeBg: '#fed7aa', badgeColor: '#92400e',
                  tip: 'Design consultation and trade estimate form submissions in the last 28 days. This is where site traffic converts to actual sales opportunities.',
                },
              ].map((step, i) => (
                <div key={step.label} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                  {/* Arrow between steps */}
                  {i > 0 && (
                    <span style={{ fontSize: '18px', color: '#d1d5db', padding: '0 6px', flexShrink: 0, lineHeight: 1 }}>›</span>
                  )}
                  <WithTip tip={step.noData ? null : step.tip} style={{ flex: 1 }}>
                    <div style={{
                      textAlign: 'center', padding: '14px 10px', borderRadius: '8px',
                      background: step.noData ? '#f9fafb' : step.bg,
                      border: `1px solid ${step.noData ? '#e5e7eb' : step.color}22`,
                    }}>
                      <p style={{ margin: '0 0 6px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{step.label}</p>
                      <p style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: '700', color: step.noData ? '#d1d5db' : step.color, lineHeight: 1 }}>
                        {step.noData ? '—' : step.value}
                      </p>
                      {!step.noData && step.badge && (
                        <p style={{ margin: '0 0 6px' }}>
                          <span style={{
                            display: 'inline-block', padding: '4px 12px', borderRadius: '999px',
                            fontSize: '13px', fontWeight: '700',
                            background: step.badgeBg, color: step.badgeColor,
                            border: `1px solid ${step.badgeColor}44`,
                          }}>
                            {step.badge}
                          </span>
                        </p>
                      )}
                      <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>
                        {step.noData ? 'Not connected' : step.sub}
                      </p>
                    </div>
                  </WithTip>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Two charts side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '12px' }}>

          {/* Search visibility trend */}
          {chartCard(
            'Search Visibility',
            gsc?.configured
              ? <>
                  <span style={{ color: '#4285f4', fontWeight: '700' }}>■</span> Impressions&nbsp;&nbsp;
                  <span style={{ color: '#059669', fontWeight: '700' }}>■</span> Clicks · last 28 days
                </>
              : 'Google Search Console not connected',
            gsc?.configured && mktDailyData.length > 0
              ? <MonthlyLineChart
                  data={mktDailyData}
                  lines={[
                    { key: 'impressions', label: 'Impressions', color: '#4285f4' },
                    { key: 'clicks',      label: 'Clicks',      color: '#059669' },
                  ]}
                  formatTip={(v) => v.toLocaleString()}
                />
              : <EmptyFrame label={gsc?.configured ? 'No GSC data yet' : 'Connect Google Search Console'} />,
          )}

          {/* Sessions → Leads trend */}
          {chartCard(
            'Sessions → Leads',
            ga?.configured
              ? <>
                  <span style={{ color: '#7c3aed', fontWeight: '700' }}>■</span> Sessions (GA)&nbsp;&nbsp;
                  <span style={{ color: '#78350f', fontWeight: '700' }}>■</span> Form submissions · last 28 days
                </>
              : 'Google Analytics not connected',
            ga?.configured && mktDailyData.length > 0
              ? <MonthlyLineChart
                  data={mktDailyData}
                  lines={[
                    { key: 'sessions',   label: 'Sessions', color: '#7c3aed' },
                    { key: 'leadsCount', label: 'Leads',    color: '#78350f' },
                  ]}
                  formatTip={(v) => v.toLocaleString()}
                />
              : <EmptyFrame label={ga?.configured ? 'No GA data yet' : 'Connect Google Analytics'} />,
          )}
        </div>

        {/* Traffic sources + top pages */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>

          {/* Traffic Sources */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
            <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>Traffic by Source</p>
            {!ga?.configured ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>Google Analytics not connected.</p>
            ) : !ga.sources?.length ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>No source data yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {ga.sources.map((s) => {
                  const total = ga.sources.reduce((sum, x) => sum + x.sessions, 0);
                  const pct = total > 0 ? Math.round((s.sessions / total) * 100) : 0;
                  const channelColors = {
                    'Organic Search': '#4285f4', 'Direct': '#6b7280',
                    'Organic Social': '#ec4899', 'Referral': '#f59e0b',
                    'Email': '#10b981', 'Paid Search': '#ef4444',
                  };
                  const color = channelColors[s.channel] ?? '#9ca3af';
                  return (
                    <div key={s.channel}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                        <span style={{ fontSize: '12px', color: '#374151' }}>{s.channel}</span>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280' }}>{pct}% <span style={{ fontWeight: '400', color: '#9ca3af' }}>({s.sessions.toLocaleString()})</span></span>
                      </div>
                      <div style={{ height: '5px', background: '#f3f4f6', borderRadius: '3px' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', opacity: 0.8 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top Organic Pages */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
            <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: '700', color: '#374151' }}>Top Pages by Organic Clicks</p>
            {!gsc?.configured ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>Google Search Console not connected.</p>
            ) : !gsc.pages?.length ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>No page data yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {gsc.pages.map((p) => {
                  const maxClicks = Math.max(...gsc.pages.map((x) => x.clicks), 1);
                  const barPct = Math.max(p.clicks > 0 ? 4 : 0, Math.round((p.clicks / maxClicks) * 100));
                  return (
                    <div key={p.page}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px' }}>
                        <span style={{ fontSize: '12px', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }} title={p.page}>{p.page || '/'}</span>
                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: '#059669' }}>{p.clicks.toLocaleString()} clicks</span>
                          <span style={{ fontSize: '11px', color: '#9ca3af' }}>#{p.position}</span>
                        </div>
                      </div>
                      <div style={{ height: '4px', background: '#f3f4f6', borderRadius: '2px' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: '#059669', borderRadius: '2px', opacity: 0.7 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

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
            <img src="/images/caliber-logo-brand.webp" alt="Caliber Cabinets" style={{ height: '44px', width: 'auto', borderRadius: '4px', objectFit: 'contain' }} />
            <div>
              <p style={{ margin: 0, color: '#ffffff', fontSize: '18px', fontWeight: '700' }}>Caliber Cabinets</p>
              <p style={{ margin: '2px 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>Admin</p>
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

// ─── Financial Settings Panel ─────────────────────────────────────────────────

const DEFAULT_PAYMENT_SCHEDULE_SETTINGS = {
  initialDepositPct: 50,
  productionPaymentPct: 45,
  finalPaymentPct: 5,
  initialDepositDaysAfterClose: 3,
  productionPaymentWeeksAfterDeposit: 8,
  finalPaymentWeeksAfterProduction: 2,
};

function FinancialSettingsPanel({ banner, onDismissBanner }) {
  const [probs, setProbs] = useState(null); // stageId → probability number
  const [sched, setSched] = useState(null); // payment schedule defaults
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  const [qb, setQb] = useState(null); // { connected, companyName, realmId, connectedAt }
  const [qbLoading, setQbLoading] = useState(true);
  const [qbBusy, setQbBusy] = useState(false);

  function loadQbStatus() {
    setQbLoading(true);
    apiCall('/api/admin-cashflow?action=qb-status')
      .then((r) => r.json())
      .then((d) => setQb(d))
      .catch(() => setQb({ connected: false }))
      .finally(() => setQbLoading(false));
  }

  useEffect(() => { loadQbStatus(); }, []);

  async function handleQbConnect() {
    setQbBusy(true);
    try {
      const res = await apiCall('/api/admin-cashflow?action=qb-connect', { method: 'POST' });
      const data = await res.json();
      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl; // full-page nav to Intuit's consent screen
        return;
      }
    } catch { /* ignore — button just stops spinning */ }
    setQbBusy(false);
  }

  async function handleQbDisconnect() {
    if (!window.confirm('Disconnect QuickBooks? Nothing already synced is affected, but automatic invoice/payment matching will stop until reconnected.')) return;
    setQbBusy(true);
    try {
      await apiCall('/api/admin-cashflow?action=qb-disconnect', { method: 'POST' });
      loadQbStatus();
    } catch { /* ignore */ }
    setQbBusy(false);
  }

  useEffect(() => {
    apiCall('/api/admin-settings')
      .then((r) => r.json())
      .then((d) => {
        const storedProbs = d.settings?.stage_probabilities ?? {};
        const mergedProbs = {};
        for (const stage of DEFAULT_STAGE_FORECAST) {
          mergedProbs[stage.id] = storedProbs[stage.id] ?? stage.probability;
        }
        setProbs(mergedProbs);
        setSched({ ...DEFAULT_PAYMENT_SCHEDULE_SETTINGS, ...(d.settings?.payment_schedule_defaults ?? {}) });
      })
      .catch(() => {
        const mergedProbs = {};
        for (const stage of DEFAULT_STAGE_FORECAST) mergedProbs[stage.id] = stage.probability;
        setProbs(mergedProbs);
        setSched({ ...DEFAULT_PAYMENT_SCHEDULE_SETTINGS });
      });
  }, []);

  const pctTotal = sched ? (Number(sched.initialDepositPct) || 0) + (Number(sched.productionPaymentPct) || 0) + (Number(sched.finalPaymentPct) || 0) : 100;

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await Promise.all([
        apiCall('/api/admin-settings', { method: 'PUT', body: { key: 'stage_probabilities', value: probs } }),
        apiCall('/api/admin-settings', { method: 'PUT', body: { key: 'payment_schedule_defaults', value: sched } }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    setSaving(false);
  }

  if (!probs || !sched) return <p style={{ fontSize: '14px', color: '#9ca3af' }}>Loading…</p>;

  const numField = (key, width = '56px') => (
    <input
      type="number"
      min="0"
      value={sched[key]}
      onChange={(e) => setSched((s) => ({ ...s, [key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
      style={{ width, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', textAlign: 'right', outline: 'none' }}
    />
  );

  return (
    <PanelShell
      title="Financial Settings"
      description="Defaults used across Leads forecasting and the Financial Management payment schedule."
    >
      {banner && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', padding: '10px 14px',
          borderRadius: '6px', fontSize: '13px', maxWidth: '520px',
          background: banner.type === 'success' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${banner.type === 'success' ? '#bbf7d0' : '#fca5a5'}`,
          color: banner.type === 'success' ? '#166534' : '#b91c1c',
        }}>
          <span style={{ flex: 1 }}>{banner.type === 'success' ? '✓' : '⚠'} {banner.message}</span>
          <span onClick={onDismissBanner} style={{ cursor: 'pointer', opacity: 0.6, fontWeight: '700' }}>✕</span>
        </div>
      )}

      <div style={{ display: 'grid', gap: '32px', maxWidth: '520px' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '700', color: '#111827' }}>
            QuickBooks Online
            {qb?.environment === 'sandbox' && (
              <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.05em', color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '4px', padding: '2px 7px' }}>
                SANDBOX — TEST DATA ONLY
              </span>
            )}
            {qb?.environment === 'production' && qb?.connected && (
              <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.05em', color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '4px', padding: '2px 7px' }}>
                LIVE
              </span>
            )}
          </h3>
          <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#9ca3af' }}>
            Connects Brianna's QuickBooks company so invoices and payments recorded there can be automatically matched to Financial Management's payment schedule.
            {qb?.environment === 'sandbox' && ' Currently wired to Intuit’s development keys, so connecting goes to a fake test company — not Mike’s real QuickBooks — and nothing here touches real financial records yet.'}
            {qb?.environment === 'production' && qb?.connected && ' Connected to Mike\'s live QuickBooks company — changes and lookups here reflect real financial records.'}
          </p>
          {qbLoading ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>Checking connection…</p>
          ) : qb?.connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', color: '#166534', fontWeight: '600' }}>
                ✓ Connected to {qb.companyName || 'QuickBooks'}
              </span>
              <button
                onClick={handleQbDisconnect}
                disabled={qbBusy}
                style={{ padding: '6px 14px', background: '#fff', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: qbBusy ? 'wait' : 'pointer' }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={handleQbConnect}
              disabled={qbBusy}
              style={{ padding: '9px 20px', background: '#2ca01c', color: '#fff', border: 0, borderRadius: '6px', fontWeight: '700', fontSize: '14px', cursor: qbBusy ? 'wait' : 'pointer', opacity: qbBusy ? 0.6 : 1 }}
            >
              {qbBusy ? 'Connecting…' : 'Connect to QuickBooks'}
            </button>
          )}
        </div>

        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '700', color: '#111827' }}>Win Probability by Stage</h3>
          <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#9ca3af' }}>
            Used to weight expected deal value in the Leads cashflow forecast. Override individual deals from the Leads view.
          </p>
          <div style={{ display: 'grid', gap: '10px' }}>
            {DEFAULT_STAGE_FORECAST.map((stage) => (
              <div key={stage.id} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ flex: 1, fontSize: '14px', color: '#374151', fontWeight: '500' }}>{stage.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={probs[stage.id] ?? stage.probability}
                    onChange={(e) => setProbs((p) => ({ ...p, [stage.id]: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)) }))}
                    style={{ width: '64px', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', textAlign: 'right', outline: 'none' }}
                  />
                  <span style={{ fontSize: '14px', color: '#6b7280' }}>%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '700', color: '#111827' }}>Payment Schedule Defaults</h3>
          <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#9ca3af' }}>
            Applied automatically when a deal first reaches Closed Won, per the Master Cabinetry Construction Agreement (Section 7.2–7.3). Editing a deal's own schedule in Financial Management never gets overwritten by these.
          </p>
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ width: '150px', fontSize: '14px', color: '#374151', fontWeight: '500' }}>Initial Deposit</span>
              {numField('initialDepositPct', '52px')}<span style={{ fontSize: '13px', color: '#6b7280' }}>% · due</span>
              {numField('initialDepositDaysAfterClose')}<span style={{ fontSize: '13px', color: '#6b7280' }}>days after Closed Won date</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ width: '150px', fontSize: '14px', color: '#374151', fontWeight: '500' }}>Production Payment</span>
              {numField('productionPaymentPct', '52px')}<span style={{ fontSize: '13px', color: '#6b7280' }}>% · due</span>
              {numField('productionPaymentWeeksAfterDeposit')}<span style={{ fontSize: '13px', color: '#6b7280' }}>weeks after Initial Deposit date</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ width: '150px', fontSize: '14px', color: '#374151', fontWeight: '500' }}>Final Payment</span>
              {numField('finalPaymentPct', '52px')}<span style={{ fontSize: '13px', color: '#6b7280' }}>% · due</span>
              {numField('finalPaymentWeeksAfterProduction')}<span style={{ fontSize: '13px', color: '#6b7280' }}>weeks after Production Payment date</span>
            </div>
            {pctTotal !== 100 && (
              <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>⚠ Percentages add up to {pctTotal}%, not 100%. Amounts will still save, but double-check the split.</p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '9px 20px', background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', fontWeight: '700', fontSize: '14px', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span style={{ fontSize: '13px', color: '#166534' }}>✓ Saved</span>}
        </div>
      </div>
    </PanelShell>
  );
}

// ─── Projects Panel ───────────────────────────────────────────────────────────

function ProjectsPanel() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Add form
  const [imageFile, setImageFile] = useState(null);       // always the WebP-converted File
  const [imagePreview, setImagePreview] = useState(null); // data URL for thumbnail
  const [conversionInfo, setConversionInfo] = useState(null); // { originalKB, convertedKB }
  const [converting, setConverting] = useState(false);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [featured, setFeatured] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [fileError, setFileError] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const r = await fetch('/api/admin-projects', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json();
      setProjects(d.projects || []);
    } catch {
      setListError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  }

  // Convert any image to WebP via Canvas API — runs in the browser, no server needed
  async function convertToWebP(file, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('Conversion failed')); return; }
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' }));
          },
          'image/webp',
          quality,
        );
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read image')); };
      img.src = objectUrl;
    });
  }

  async function handleFileSelect(files) {
    const raw = files[0];
    if (!raw) return;
    setFileError('');
    setConversionInfo(null);
    setImagePreview(null);
    setImageFile(null);
    setConverting(true);
    try {
      const webp = await convertToWebP(raw);
      const preview = await new Promise((res) => {
        const reader = new FileReader();
        reader.onload = (e) => res(e.target.result);
        reader.readAsDataURL(webp);
      });
      setImageFile(webp);
      setImagePreview(preview);
      setConversionInfo({
        originalKB: Math.round(raw.size / 1024),
        convertedKB: Math.round(webp.size / 1024),
        savings: Math.round((1 - webp.size / raw.size) * 100),
      });
    } catch {
      // Fallback: use original if conversion fails
      setImageFile(raw);
      setFileError('');
    } finally {
      setConverting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setUploadError('');
    setFileError('');
    if (!imageFile) { setFileError('Please select an image'); return; }
    if (!title.trim() || !location.trim()) { setUploadError('Title and location are required'); return; }
    setSubmitting(true);
    try {
      // 1. Get signed upload URL
      const urlRes = await fetch('/api/admin-projects', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-upload-url', filename: imageFile.name }),
      });
      const { signedUrl, publicUrl, error: urlErr } = await urlRes.json();
      if (urlErr) throw new Error(urlErr);

      // 2. PUT file directly to Supabase storage
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': imageFile.type || 'application/octet-stream' },
        body: imageFile,
      });
      if (!uploadRes.ok) throw new Error('Image upload failed');

      // 3. Save project record
      const createRes = await fetch('/api/admin-projects', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', title: title.trim(), location: location.trim(), image_url: publicUrl, featured }),
      });
      const { error: createErr } = await createRes.json();
      if (createErr) throw new Error(createErr);

      setImageFile(null);
      setImagePreview(null);
      setConversionInfo(null);
      setTitle('');
      setLocation('');
      setFeatured(false);
      await loadProjects();
    } catch (err) {
      setUploadError(err.message || 'Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(project) {
    if (!window.confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
    await fetch('/api/admin-projects', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project.id, image_url: project.image_url }),
    });
    setProjects((p) => p.filter((x) => x.id !== project.id));
  }

  async function handleToggleFeatured(project) {
    const r = await fetch('/api/admin-projects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: project.id, featured: !project.featured }),
    });
    const { project: updated } = await r.json();
    if (updated) setProjects((p) => p.map((x) => (x.id === project.id ? updated : x)));
  }

  function startEdit(project) {
    setEditingId(project.id);
    setEditTitle(project.title);
    setEditLocation(project.location);
  }

  async function saveEdit(project) {
    setEditSaving(true);
    const r = await fetch('/api/admin-projects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: project.id, title: editTitle.trim(), location: editLocation.trim() }),
    });
    const { project: updated } = await r.json();
    if (updated) setProjects((p) => p.map((x) => (x.id === project.id ? updated : x)));
    setEditingId(null);
    setEditSaving(false);
  }

  const inputSt = { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' };
  const labelSt = { display: 'block', fontSize: '12px', fontWeight: '700', color: '#6b7280', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' };
  const cardSt = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '28px', marginBottom: '24px' };

  return (
    <div>
      {/* Add project */}
      <div style={cardSt}>
        <h2 style={{ margin: '0 0 22px', fontSize: '16px', fontWeight: '700', color: '#111827' }}>Add New Project</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelSt}>Project Photo</label>
            <FileDropZone
              accept="image/*"
              multiple={false}
              hint="Any format — automatically converted to WebP for optimal performance"
              selectedFiles={converting ? [{ name: 'Converting to WebP…', size: 0 }] : imageFile ? [imageFile] : []}
              onChange={handleFileSelect}
              error={fileError}
            />
            {/* Preview + conversion savings */}
            {imagePreview && conversionInfo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px', padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                <img src={imagePreview} alt="Preview" style={{ width: '56px', height: '42px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: '#166534' }}>Converted to WebP ✓</p>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#15803d' }}>
                    {conversionInfo.originalKB} KB → {conversionInfo.convertedKB} KB
                    <span style={{ marginLeft: '6px', fontWeight: '700' }}>({conversionInfo.savings}% smaller)</span>
                  </p>
                </div>
              </div>
            )}
            {converting && (
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#6b7280' }}>Converting to WebP…</p>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={labelSt}>Title</label>
              <input style={inputSt} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Modern White Kitchen" />
            </div>
            <div>
              <label style={labelSt}>Location</label>
              <input style={inputSt} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Pleasanton, CA" />
            </div>
          </div>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="proj-featured"
                checked={featured}
                onChange={(e) => setFeatured(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="proj-featured" style={{ fontSize: '14px', color: '#374151', cursor: 'pointer' }}>
                Show on homepage (Featured)
              </label>
            </div>
            <p style={{ margin: '4px 0 0 24px', fontSize: '12px', color: '#9ca3af' }}>
              The homepage randomly picks 3 featured projects on each visit.
            </p>
          </div>
          {uploadError && <p style={{ color: '#b91c1c', fontSize: '13px', margin: '0 0 12px' }}>{uploadError}</p>}
          <button type="submit" disabled={submitting} style={{ background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', padding: '10px 22px', fontWeight: '700', fontSize: '14px', cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Uploading…' : 'Add Project'}
          </button>
        </form>
      </div>

      {/* Project list */}
      <div style={cardSt}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827' }}>
            All Projects <span style={{ fontWeight: '400', color: '#9ca3af' }}>({projects.length})</span>
          </h2>
          <span style={{ fontSize: '12px', fontWeight: '700', padding: '3px 10px', borderRadius: '12px', background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }}>
            {projects.filter((p) => p.featured).length} featured · 3 shown randomly
          </span>
        </div>
        {loading ? (
          <p style={{ color: '#9ca3af' }}>Loading…</p>
        ) : listError ? (
          <p style={{ color: '#b91c1c' }}>{listError}</p>
        ) : projects.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No projects yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {projects.map((project) => (
              <div key={project.id} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', padding: '14px', border: '1px solid #f3f4f6', borderRadius: '8px', background: '#fafafa' }}>
                <img src={project.image_url} alt={project.title} style={{ width: '80px', height: '60px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0, background: '#e5e7eb' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === project.id ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <input style={{ ...inputSt, padding: '6px 10px' }} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
                      <input style={{ ...inputSt, padding: '6px 10px' }} value={editLocation} onChange={(e) => setEditLocation(e.target.value)} placeholder="City, State" />
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '14px', color: '#111827' }}>{project.title}</p>
                      <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>{project.location}</p>
                    </>
                  )}
                  <div style={{ marginTop: '6px' }}>
                    <button
                      onClick={() => handleToggleFeatured(project)}
                      style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px', border: '1px solid',
                        cursor: 'pointer',
                        background: project.featured ? '#fef3c7' : '#f3f4f6',
                        color: project.featured ? '#92400e' : '#6b7280',
                        borderColor: project.featured ? '#fbbf24' : '#d1d5db',
                      }}
                    >
                      {project.featured ? '★ Featured' : '☆ Not featured'}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  {editingId === project.id ? (
                    <>
                      <button onClick={() => saveEdit(project)} disabled={editSaving} style={{ fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '5px', border: 0, background: '#78350f', color: '#fff', cursor: 'pointer' }}>
                        {editSaving ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingId(null)} style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '5px', border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(project)} style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '5px', border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(project)} style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '5px', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BackupRestoreView ────────────────────────────────────────────────────────

function BackupRestoreView({ isSuperAdmin }) {
  const isMobile = useIsMobile();
  const [backups, setBackups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionState, setActionState] = useState('idle'); // idle | working | done | error
  const [actionMsg, setActionMsg]   = useState('');
  const [confirmRestore, setConfirmRestore] = useState(null); // filename to confirm
  const [restoreHelpFor, setRestoreHelpFor] = useState(null); // SQL backup filename, or null

  async function loadBackups() {
    setIsLoading(true);
    setLoadError('');
    try {
      const r = await apiCall('/api/admin-backup?action=list');
      if (!r.ok) throw new Error((await r.json()).error ?? 'Failed to load');
      const d = await r.json();
      setBackups(d.files ?? []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { loadBackups(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    setActionState('working');
    setActionMsg('Creating backup…');
    try {
      const r = await apiCall('/api/admin-backup?action=create', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Backup failed');
      setActionState('done');
      setActionMsg(`Backup created: ${d.filename} (${d.lead_count} leads)`);
      loadBackups();
    } catch (err) {
      setActionState('error');
      setActionMsg(err.message);
    }
  }

  async function handleRestore(filename) {
    setConfirmRestore(null);
    setActionState('working');
    setActionMsg('Restoring… (creating safety snapshot first)');
    try {
      const r = await apiCall(
        `/api/admin-backup?action=restore&filename=${encodeURIComponent(filename)}`,
        { method: 'POST' },
      );
      const d = await r.json();
      if (!r.ok && r.status !== 207) throw new Error(d.error ?? 'Restore failed');
      if (d.errors?.length > 0) {
        setActionState('error');
        setActionMsg(`Partial restore — errors: ${d.errors.join('; ')}. Safety backup: ${d.safety_backup}`);
      } else {
        setActionState('done');
        setActionMsg(`Restored from ${filename} (${d.lead_count} leads). Safety snapshot: ${d.safety_backup}`);
      }
      loadBackups();
    } catch (err) {
      setActionState('error');
      setActionMsg(err.message);
    }
  }

  function formatBytes(n) {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const isSafetyFile = (name) => name?.startsWith('pre-restore-');
  const isBackupFile  = (name) => name?.startsWith('backup-');
  const isSqlDumpFile = (name) => name?.endsWith('.sql.gz');

  const regularBackups = backups.filter((f) => isBackupFile(f.name));
  const safetyBackups  = backups.filter((f) => isSafetyFile(f.name));
  const sqlBackups     = backups.filter((f) => isSqlDumpFile(f.name))
    .sort((a, b) => (b.name ?? '').localeCompare(a.name ?? ''));

  const statusColor = { idle: '#374151', working: '#d97706', done: '#16a34a', error: '#dc2626' };
  const statusBg    = { idle: '#f9fafb', working: '#fffbeb', done: '#f0fdf4', error: '#fef2f2' };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '700', color: '#111827' }}>Backup &amp; Restore</h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
          Create JSON snapshots of leads, settings, and users — stored in Supabase. Restore replaces data by ID (upsert).
        </p>
      </div>

      {/* Action feedback banner */}
      {actionState !== 'idle' && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '8px', background: statusBg[actionState], border: `1px solid ${statusColor[actionState]}33`, display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          {actionState === 'working' && (
            <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid #d97706', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0, marginTop: '1px' }} />
          )}
          <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: statusColor[actionState], flex: 1 }}>{actionMsg}</p>
          {actionState !== 'working' && (
            <button onClick={() => setActionState('idle')} style={{ background: 'none', border: 0, color: '#9ca3af', cursor: 'pointer', padding: 0, fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>×</button>
          )}
        </div>
      )}

      {/* Create backup button */}
      <div style={{ marginBottom: '24px', padding: '20px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', gap: '12px' }}>
        <div>
          <p style={{ margin: '0 0 3px', fontSize: '14px', fontWeight: '700', color: '#111827' }}>Create Backup Now</p>
          <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>Snapshot leads, admin settings, and user records to Supabase Storage.</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={actionState === 'working'}
          style={{ padding: '9px 20px', border: 0, borderRadius: '6px', background: actionState === 'working' ? '#d1d5db' : '#78350f', color: '#fff', fontSize: '13px', fontWeight: '700', cursor: actionState === 'working' ? 'not-allowed' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {actionState === 'working' ? 'Working…' : '↑ Create Backup'}
        </button>
      </div>

      {/* Backup list */}
      {loadError ? (
        <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#b91c1c', fontSize: '13px' }}>
          {loadError} — <button onClick={loadBackups} style={{ background: 'none', border: 0, color: '#b91c1c', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px', padding: 0 }}>Retry</button>
        </div>
      ) : isLoading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>Loading backups…</div>
      ) : (
        <>
          {/* Regular backups */}
          <div style={{ marginBottom: '24px' }}>
            <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Backups ({regularBackups.length})
            </p>
            {regularBackups.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #e5e7eb' }}>
                No backups yet — click "Create Backup Now" to make your first one.
              </div>
            ) : (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 120px', gap: '8px', padding: '8px 16px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                    {['File', 'Size', 'Created', ''].map((h) => (
                      <span key={h} style={{ fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === '' ? 'right' : 'left' }}>{h}</span>
                    ))}
                  </div>
                )}
                {regularBackups.map((f, idx) => (
                  <div key={f.name} style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 90px 90px 120px',
                    gap: isMobile ? '6px' : '8px',
                    padding: '12px 16px',
                    alignItems: 'center',
                    borderTop: idx > 0 ? '1px solid #f3f4f6' : 'none',
                    background: '#fff',
                  }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#111827', wordBreak: 'break-all' }}>{f.name}</p>
                      {isMobile && (
                        <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                          {formatBytes(f.metadata?.size)} · {formatDate(f.created_at)}
                        </p>
                      )}
                    </div>
                    {!isMobile && (
                      <>
                        <span style={{ fontSize: '13px', color: '#6b7280' }}>{formatBytes(f.metadata?.size)}</span>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>{formatDate(f.created_at)}</span>
                      </>
                    )}
                    <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                      <button
                        onClick={() => setConfirmRestore(f.name)}
                        disabled={actionState === 'working'}
                        style={{ padding: '5px 14px', border: '1px solid #fca5a5', borderRadius: '5px', background: '#fff', color: '#b91c1c', fontSize: '12px', fontWeight: '600', cursor: actionState === 'working' ? 'not-allowed' : 'pointer' }}
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Safety / pre-restore backups */}
          {safetyBackups.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Auto-Safety Snapshots ({safetyBackups.length})
              </p>
              <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#9ca3af' }}>
                Automatically created before each restore operation.
              </p>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                {safetyBackups.map((f, idx) => (
                  <div key={f.name} style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 90px 90px 120px',
                    gap: isMobile ? '6px' : '8px',
                    padding: '12px 16px',
                    alignItems: 'center',
                    borderTop: idx > 0 ? '1px solid #f3f4f6' : 'none',
                    background: '#fffbeb',
                  }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#92400e', wordBreak: 'break-all' }}>{f.name}</p>
                      {isMobile && (
                        <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                          {formatBytes(f.metadata?.size)} · {formatDate(f.created_at)}
                        </p>
                      )}
                    </div>
                    {!isMobile && (
                      <>
                        <span style={{ fontSize: '13px', color: '#6b7280' }}>{formatBytes(f.metadata?.size)}</span>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>{formatDate(f.created_at)}</span>
                      </>
                    )}
                    <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                      <button
                        onClick={() => setConfirmRestore(f.name)}
                        disabled={actionState === 'working'}
                        style={{ padding: '5px 14px', border: '1px solid #fca5a5', borderRadius: '5px', background: '#fff', color: '#b91c1c', fontSize: '12px', fontWeight: '600', cursor: actionState === 'working' ? 'not-allowed' : 'pointer' }}
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Full database SQL dumps (Daily DB Backup GitHub Action → private Storage) ── */}
          <div style={{ marginTop: '32px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <p style={{ margin: 0, fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Full Database Snapshots (SQL) {sqlBackups.length > 0 && `(${sqlBackups.length})`}
              </p>
              <WithTip tip="Full pg_dump SQL dumps, uploaded daily to this same private Storage bucket by the Daily DB Backup GitHub Action. Disaster-recovery snapshots of the whole database — not the same as the JSON snapshots above. Restoring one means running it manually with psql against the target database (see 'How to restore'), since a full SQL replay isn't safe to upsert automatically.">
                <span style={{ fontSize: '11px', color: '#9ca3af', cursor: 'default', borderBottom: '1px dotted #d1d5db' }}>what's this?</span>
              </WithTip>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#9ca3af' }}>
              Full-database SQL dumps. Download only — restoring requires running the file manually via <code>psql</code>.
            </p>
            {sqlBackups.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #e5e7eb' }}>
                No SQL dumps found yet — the Daily DB Backup workflow hasn't run since it started uploading here, or hasn't run at all yet.
              </div>
            ) : (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px 190px', gap: '8px', padding: '8px 16px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                    {['File', 'Size', 'Created', ''].map((h) => (
                      <span key={h} style={{ fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === '' ? 'right' : 'left' }}>{h}</span>
                    ))}
                  </div>
                )}
                {sqlBackups.map((f, idx) => (
                  <div key={f.name} style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '1fr 90px 110px 190px',
                    gap: isMobile ? '6px' : '8px',
                    padding: '12px 16px',
                    alignItems: 'center',
                    borderTop: idx > 0 ? '1px solid #f3f4f6' : 'none',
                    background: '#fff',
                  }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#111827', wordBreak: 'break-all' }}>{f.name}</p>
                      {isMobile && (
                        <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                          {formatBytes(f.metadata?.size)} · {formatDate(f.created_at)}
                        </p>
                      )}
                    </div>
                    {!isMobile && (
                      <>
                        <span style={{ fontSize: '13px', color: '#6b7280' }}>{formatBytes(f.metadata?.size)}</span>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>{formatDate(f.created_at)}</span>
                      </>
                    )}
                    <div style={{ textAlign: isMobile ? 'left' : 'right', display: 'flex', gap: '6px', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                      <button
                        onClick={() => setRestoreHelpFor(f.name)}
                        style={{ padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: '5px', background: '#fff', color: '#6b7280', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                      >
                        How to restore
                      </button>
                      <button
                        onClick={() => {
                          apiCall(`/api/admin-backup?action=download&filename=${encodeURIComponent(f.name)}`)
                            .then((r) => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
                            .then((blob) => {
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = f.name;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                            })
                            .catch(() => alert('Download failed. Please try again.'));
                        }}
                        style={{ padding: '5px 14px', border: '1px solid #d1d5db', borderRadius: '5px', background: '#fff', color: '#374151', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Restore confirmation modal */}
      {confirmRestore && (
        <FixedOverlay>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '28px 24px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '17px', fontWeight: '700', color: '#111827' }}>Confirm Restore</h3>
            <p style={{ margin: '0 0 6px', fontSize: '14px', color: '#374151' }}>
              Restore from <strong>{confirmRestore}</strong>?
            </p>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#6b7280' }}>
              A safety snapshot of the current data will be created automatically before restoring. Existing records are updated by ID — no rows are deleted.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmRestore(null)}
                style={{ padding: '8px 18px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(confirmRestore)}
                style={{ padding: '8px 18px', border: 0, borderRadius: '6px', background: '#b91c1c', color: '#fff', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
              >
                Yes, Restore
              </button>
            </div>
          </div>
        </div>
        </FixedOverlay>
      )}

      {/* Restore-instructions modal (git SQL backups — no in-app restore, just the runbook) */}
      {restoreHelpFor && (
        <RestoreHelpModal filename={restoreHelpFor} onClose={() => setRestoreHelpFor(null)} />
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── RestoreHelpModal — copy-paste runbook for restoring a git SQL dump ────────

function RestoreHelpModal({ filename, onClose }) {
  const [copied, setCopied] = useState(false);
  const cmd = `gunzip -c ${filename} | psql "<SUPABASE_DB_URL>"`;

  function handleCopy() {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <FixedOverlay>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onMouseDown={onClose}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '28px 24px', maxWidth: '520px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: '700', color: '#111827' }}>Restoring {filename}</h3>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#6b7280' }}>
          This is a full database SQL dump — there's no one-click restore button on purpose. Which path applies depends on whether the live database still has data in it.
        </p>

        <div style={{ padding: '12px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', marginBottom: '16px' }}>
          <p style={{ margin: 0, fontSize: '12px', color: '#991b1b', lineHeight: 1.5 }}>
            This file has no DROP statements. Running it against a database that still has the same tables will throw "already exists" / duplicate-key errors instead of cleanly restoring — it will not silently overwrite anything, but it also won't do what you want.
          </p>
        </div>

        <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: '700', color: '#111827' }}>Disaster recovery (database is empty or gone)</p>
        <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#6b7280' }}>
          Click "Download" above first, so the file is in your Downloads folder. Then replay it straight into the target database from a terminal in that folder. Needs <code>psql</code> installed. Use the direct connection string from Supabase (Project Settings → Database → Connection string → URI, port 5432), not the pooler.
        </p>
        <div style={{ position: 'relative', marginBottom: '18px' }}>
          <pre style={{ margin: 0, padding: '12px 14px', background: '#111827', color: '#e5e7eb', borderRadius: '8px', fontSize: '12px', fontFamily: 'ui-monospace, Menlo, monospace', overflowX: 'auto' }}>
{cmd}
          </pre>
          <button
            onClick={handleCopy}
            style={{ position: 'absolute', top: '8px', right: '8px', padding: '4px 10px', border: '1px solid #4b5563', borderRadius: '5px', background: '#1f2937', color: '#e5e7eb', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: '700', color: '#111827' }}>Recovering specific data (production is alive)</p>
        <p style={{ margin: '0 0 20px', fontSize: '12px', color: '#6b7280', lineHeight: 1.6 }}>
          Don't replay this file into production. Restore it into a temporary Supabase branch instead, pull just the rows you need from there, and upsert those into production (the admin panel's JSON Backup &amp; Restore above does safe upserts if you export the recovered rows in that format). Ask Claude to run this end-to-end if you'd rather not do it by hand.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 18px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
    </FixedOverlay>
  );
}

// ─── FinancialView ────────────────────────────────────────────────────────────
// Independent of the Leads pipeline on purpose: reads Closed Won deals
// read-only (name, contract amount, close date) and stores the payment
// schedule in its own table. Nothing here writes to `leads`, changes a stage,
// or touches HubSpot. This is the only view the Bookkeeper role can see.
//
// Each deal gets exactly 3 rows — Initial Deposit, Production Payment, Final
// Payment — per the Master Cabinetry Construction Agreement. Rows are
// auto-created server-side with default amounts/dates the first time a deal
// is loaded here; editing a field from then on is permanent (server never
// overwrites an existing row). Defaults are configurable in Settings > Financial.

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// One editable date cell within a stage row. Always-visible <input type="date">
// (not click-to-edit) since this is meant to read like a spreadsheet.
// `locked` grays it out and blocks edits — used once a row's group is linked
// to a QuickBooks invoice, since QBO owns invoice_date/paid_date from then on.
function StageDateInput({ value, onSave, accent = '#374151', locked = false }) {
  const [local, setLocal] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setLocal(value ?? ''); }, [value]);

  async function commit(next) {
    if (locked) return;
    if (next === (value ?? '')) return;
    setSaving(true);
    try { await onSave(next || null); } finally { setSaving(false); }
  }

  return (
    <input
      type="date"
      value={local}
      disabled={saving || locked}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => commit(local)}
      title={locked ? 'Synced from QuickBooks — unlink the invoice to edit manually' : undefined}
      style={{
        width: '100%', padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '5px',
        fontSize: '12.5px', color: locked ? '#9ca3af' : accent, background: locked ? '#f3f4f6' : (saving ? '#f9fafb' : '#fff'), outline: 'none',
        boxSizing: 'border-box', cursor: locked ? 'not-allowed' : 'text',
      }}
    />
  );
}

// Editable dollar amount cell. `locked` — see StageDateInput above; applies
// once QBO owns this row's amount.
function StageAmountInput({ value, onSave, locked = false }) {
  const [local, setLocal] = useState(value != null ? String(value) : '0');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setLocal(value != null ? String(value) : '0'); }, [value]);

  async function commit() {
    if (locked) return;
    const cleaned = local.replace(/[^0-9.]/g, '');
    const parsed = cleaned !== '' ? parseFloat(cleaned) : 0;
    if (parsed === (Number(value) || 0)) return;
    setSaving(true);
    try { await onSave(parsed); } finally { setSaving(false); }
  }

  return (
    <div
      title={locked ? 'Synced from QuickBooks — unlink the invoice to edit manually' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: '3px', border: '1px solid #e5e7eb', borderRadius: '5px', padding: '0 8px', background: locked ? '#f3f4f6' : (saving ? '#f9fafb' : '#fff') }}
    >
      <span style={{ fontSize: '12px', color: '#9ca3af' }}>$</span>
      <input
        value={local}
        disabled={saving || locked}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{ width: '100%', padding: '6px 0', border: 0, fontSize: '12.5px', color: locked ? '#9ca3af' : '#111827', outline: 'none', background: 'transparent', cursor: locked ? 'not-allowed' : 'text' }}
      />
    </div>
  );
}

function stagePaymentStatus(stage) {
  if (stage.paid_date) return { label: 'Paid', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' };
  if (stage.invoice_date) return { label: 'Invoiced', bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
  return { label: 'Pending', bg: '#f9fafb', color: '#9ca3af', border: '#e5e7eb' };
}

// The payment schedule table for a single deal, grouped into one section per
// room/split (each with its own Initial Deposit / Production Payment / Final
// Payment) so a project spanning several segments — kitchen, bathroom, home
// office — can be invoiced separately with its own timing.
const SCHEDULE_GRID_COLS = '175px 110px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 130px';

function groupStagesByRoom(stages) {
  const map = new Map();
  for (const s of stages) {
    const key = s.room || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  for (const rows of map.values()) {
    rows.sort((a, b) => PAYMENT_STAGE_ORDER.indexOf(a.stage) - PAYMENT_STAGE_ORDER.indexOf(b.stage));
  }
  // Default (unnamed) group first, then named rooms alphabetically.
  return [...map.entries()].sort(([a], [b]) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });
}

function RoomLabelInput({ value, onSave }) {
  const [val, setVal] = useState(value || '');
  useEffect(() => { setVal(value || ''); }, [value]);
  return (
    <input
      placeholder="Room / split (optional)"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { if (val.trim() !== (value || '')) onSave(val.trim()); }}
      style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '12px', fontWeight: '700', color: '#78350f', width: '220px', outline: 'none' }}
    />
  );
}

function AddRoomSplitForm({ dealId, onAdded, isMobile }) {
  const [room, setRoom] = useState('');
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!room.trim()) { alert('Enter a name for this room/split first (e.g. Kitchen, Primary Bath).'); return; }
    setAdding(true);
    try {
      const r = await apiCall('/api/admin-cashflow?action=add-room', {
        method: 'POST',
        body: { hubspot_deal_id: dealId, room: room.trim() },
      });
      if (!r.ok) { alert((await r.json().catch(() => ({}))).error ?? 'Failed to add room/split — please try again.'); return; }
      const { rows } = await r.json();
      onAdded(dealId, rows);
      setRoom('');
    } finally {
      setAdding(false);
    }
  }

  const inputStyle = { padding: '7px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', outline: 'none' };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #e5e7eb' }}>
      <input
        placeholder="Room / split name (e.g. Kitchen)"
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        style={{ ...inputStyle, width: isMobile ? '100%' : '220px' }}
      />
      <button
        onClick={handleAdd}
        disabled={adding}
        style={{ padding: '7px 14px', background: '#78350f', color: '#fff', border: 0, borderRadius: '6px', fontWeight: '700', fontSize: '13px', cursor: adding ? 'wait' : 'pointer', opacity: adding ? 0.6 : 1 }}
      >
        {adding ? 'Adding…' : '+ Add Room/Split'}
      </button>
    </div>
  );
}

// One QuickBooks invoice per deal/room group (Brianna's model — the 3 stages
// are partial payments against a single invoice, not 3 separate invoices), so
// this renders once per room section and links/unlinks/refreshes all 3 stage
// rows in that group at once via the group-scoped backend actions.
function QbInvoiceLinkControl({ dealId, room, rows, onSynced }) {
  const linked = rows[0]?.qb_invoice_id;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  async function runSearch() {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/admin-cashflow?action=qb-search-invoices&q=${encodeURIComponent(query.trim())}`);
      if (!r.ok) { alert('QuickBooks search failed — please try again.'); return; }
      const { invoices } = await r.json();
      setResults(invoices);
    } finally {
      setBusy(false);
    }
  }

  async function pick(invoiceId) {
    setBusy(true);
    try {
      const r = await apiCall('/api/admin-cashflow?action=link-invoice', {
        method: 'POST',
        body: { hubspot_deal_id: dealId, room: room || null, qb_invoice_id: invoiceId },
      });
      if (!r.ok) { alert((await r.json().catch(() => ({}))).error ?? 'Failed to link invoice.'); return; }
      const { rows: updated } = await r.json();
      onSynced(dealId, updated);
      setSearching(false);
      setQuery('');
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      const r = await apiCall('/api/admin-cashflow?action=qb-refresh-invoice', {
        method: 'POST',
        body: { hubspot_deal_id: dealId, room: room || null },
      });
      if (!r.ok) { alert('Failed to refresh from QuickBooks.'); return; }
      const { rows: updated } = await r.json();
      onSynced(dealId, updated);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!window.confirm('Unlink this QuickBooks invoice? (This only removes the reference here — nothing changes in QuickBooks.)')) return;
    setBusy(true);
    try {
      const r = await apiCall('/api/admin-cashflow?action=unlink-invoice', {
        method: 'POST',
        body: { hubspot_deal_id: dealId, room: room || null },
      });
      if (!r.ok) { alert('Failed to unlink.'); return; }
      const { rows: updated } = await r.json();
      onSynced(dealId, updated);
    } finally {
      setBusy(false);
    }
  }

  if (linked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
        <span style={{ fontWeight: '700', color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '5px', padding: '3px 8px' }}>
          QB #{rows[0].qb_invoice_number ?? rows[0].qb_invoice_id}
        </span>
        <span style={{ color: '#374151' }}>Total {formatMoney(rows[0].qb_total)} · Balance {formatMoney(rows[0].qb_balance)}</span>
        <button onClick={refresh} disabled={busy} title="Refresh from QuickBooks" style={{ border: 'none', background: 'none', cursor: busy ? 'wait' : 'pointer', fontSize: '13px', padding: 0 }}>🔄</button>
        <button onClick={unlink} disabled={busy} style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: busy ? 'wait' : 'pointer', fontSize: '11px', padding: 0, textDecoration: 'underline' }}>Unlink</button>
      </div>
    );
  }

  if (!searching) {
    return (
      <button onClick={() => setSearching(true)} style={{ border: '1px dashed #d1d5db', background: 'none', color: '#78350f', cursor: 'pointer', fontSize: '12px', padding: '3px 8px', borderRadius: '5px' }}>
        + Link QuickBooks Invoice
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '420px' }}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          placeholder="Customer name or invoice #"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
          style={{ flex: 1, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '12px', outline: 'none' }}
        />
        <button onClick={runSearch} disabled={busy} style={{ padding: '5px 10px', background: '#78350f', color: '#fff', border: 0, borderRadius: '5px', fontSize: '12px', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? '…' : 'Search'}
        </button>
        <button onClick={() => { setSearching(false); setResults(null); setQuery(''); }} style={{ padding: '5px 8px', background: 'none', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
      {results && (
        results.length === 0 ? (
          <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>No matching invoices in QuickBooks.</p>
        ) : (
          <div style={{ display: 'grid', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
            {results.map((inv) => (
              <button
                key={inv.id}
                onClick={() => pick(inv.id)}
                disabled={busy}
                style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '5px', background: '#f9fafb', cursor: busy ? 'wait' : 'pointer', fontSize: '12px' }}
              >
                <strong>#{inv.docNumber ?? inv.id}</strong> — {inv.customerName ?? 'Unknown customer'} — {formatMoney(inv.totalAmt)} (bal {formatMoney(inv.balance)}){inv.txnDate ? ` · ${inv.txnDate}` : ''}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function PaymentScheduleTable({ deal, isMobile, onRowSaved, onRoomAdded, onRowDeleted, onRoomDeleted, onInvoiceSynced }) {
  async function saveField(rowId, patch) {
    const r = await apiCall('/api/admin-cashflow', { method: 'PATCH', body: { id: rowId, ...patch } });
    if (!r.ok) { alert('Failed to save — please try again.'); return; }
    const { row } = await r.json();
    onRowSaved(deal.hubspot_deal_id, row);
  }

  async function saveRoomName(rows, newRoom) {
    for (const row of rows) await saveField(row.id, { room: newRoom });
  }

  async function handleDelete(rowId) {
    if (!window.confirm('Delete this invoice row? This cannot be undone.')) return;
    const r = await apiCall('/api/admin-cashflow?action=delete-row', { method: 'POST', body: { id: rowId } });
    if (!r.ok) { alert('Failed to delete — please try again.'); return; }
    onRowDeleted(deal.hubspot_deal_id, rowId);
  }

  // Bulk counterpart to handleDelete — removes every row in a room/split at
  // once, matching how add-room creates all 3 rows at once.
  async function handleDeleteRoom(room, rows) {
    const label = room || 'this section';
    if (!window.confirm(`Delete ${label} (all ${rows.length} rows: ${rows.map((r) => FORECAST_STAGE_LABELS[r.stage] ?? r.stage).join(', ')})? This cannot be undone.`)) return;
    const r = await apiCall('/api/admin-cashflow?action=delete-room', { method: 'POST', body: { hubspot_deal_id: deal.hubspot_deal_id, room: room || null } });
    if (!r.ok) { alert('Failed to delete — please try again.'); return; }
    const { deletedIds } = await r.json();
    onRoomDeleted(deal.hubspot_deal_id, deletedIds ?? rows.map((row) => row.id));
  }

  const groups = groupStagesByRoom(deal.stages);
  // Only surface the room-name field once there's actually more than one
  // section — the common single-project deal stays exactly as simple as
  // before. The moment a split is added, every section (including the
  // original, previously-unlabeled one) gets the same editable field so
  // they read consistently.
  const showRoomLabels = groups.length > 1;

  if (isMobile) {
    return (
      <div style={{ display: 'grid', gap: '20px' }}>
        {groups.map(([room, rows]) => (
          <div key={room || '__default__'}>
            {showRoomLabels && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <RoomLabelInput value={room} onSave={(v) => saveRoomName(rows, v)} />
                <button onClick={() => handleDeleteRoom(room, rows)} title="Delete this whole split" style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '6px', fontSize: '11px', fontWeight: '600', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  🗑️ Delete Split
                </button>
              </div>
            )}
            <div style={{ marginTop: showRoomLabels ? '6px' : 0, marginBottom: '8px' }}>
              <QbInvoiceLinkControl dealId={deal.hubspot_deal_id} room={room} rows={rows} onSynced={onInvoiceSynced} />
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              {rows.map((s) => {
                const status = stagePaymentStatus(s);
                return (
                  <div key={s.id} style={{ background: '#f9fafb', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>{FORECAST_STAGE_LABELS[s.stage] ?? s.stage}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', background: status.bg, color: status.color, border: `1px solid ${status.border}` }}>{status.label}</span>
                        <span onClick={() => handleDelete(s.id)} title="Delete this row" style={{ cursor: 'pointer', fontSize: '13px', lineHeight: 1 }}>🗑️</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <p style={{ margin: '0 0 3px', fontSize: '10px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase' }}>Amount</p>
                        <StageAmountInput value={s.amount} onSave={(v) => saveField(s.id, { amount: v })} locked={!!s.qb_invoice_id} />
                      </div>
                      <div>
                        <p style={{ margin: '0 0 3px', fontSize: '10px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase' }}>Est. Date</p>
                        <StageDateInput value={s.est_date} onSave={(v) => saveField(s.id, { est_date: v })} />
                      </div>
                      <div>
                        <p style={{ margin: '0 0 3px', fontSize: '10px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase' }}>Invoiced</p>
                        <StageDateInput value={s.invoice_date} onSave={(v) => saveField(s.id, { invoice_date: v })} accent="#b45309" locked={!!s.qb_invoice_id} />
                      </div>
                      <div>
                        <p style={{ margin: '0 0 3px', fontSize: '10px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase' }}>Paid</p>
                        <StageDateInput value={s.paid_date} onSave={(v) => saveField(s.id, { paid_date: v })} accent="#15803d" locked={!!s.qb_invoice_id} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <AddRoomSplitForm dealId={deal.hubspot_deal_id} onAdded={onRoomAdded} isMobile />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: SCHEDULE_GRID_COLS, gap: '10px', marginBottom: '2px' }}>
        {['Stage', 'Amount', 'Est. Date', 'Invoice Date', 'Paid Date', 'Status'].map((h) => (
          <p key={h} style={{ margin: 0, fontSize: '10px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</p>
        ))}
      </div>
      {groups.map(([room, rows]) => (
        <div key={room || '__default__'} style={{ marginTop: showRoomLabels ? '14px' : '0' }}>
          {showRoomLabels && (
            <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <RoomLabelInput value={room} onSave={(v) => saveRoomName(rows, v)} />
              <button onClick={() => handleDeleteRoom(room, rows)} title="Delete this whole split" style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '6px', fontSize: '11px', fontWeight: '600', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                🗑️ Delete Split
              </button>
            </div>
          )}
          <div style={{ marginBottom: '8px' }}>
            <QbInvoiceLinkControl dealId={deal.hubspot_deal_id} room={room} rows={rows} onSynced={onInvoiceSynced} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: SCHEDULE_GRID_COLS, gap: '10px', alignItems: 'center' }}>
            {rows.map((s) => {
              const status = stagePaymentStatus(s);
              return (
                <Fragment key={s.id}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#111827' }}>{FORECAST_STAGE_LABELS[s.stage] ?? s.stage}</span>
                  <StageAmountInput value={s.amount} onSave={(v) => saveField(s.id, { amount: v })} locked={!!s.qb_invoice_id} />
                  <StageDateInput value={s.est_date} onSave={(v) => saveField(s.id, { est_date: v })} />
                  <StageDateInput value={s.invoice_date} onSave={(v) => saveField(s.id, { invoice_date: v })} accent="#b45309" locked={!!s.qb_invoice_id} />
                  <StageDateInput value={s.paid_date} onSave={(v) => saveField(s.id, { paid_date: v })} accent="#15803d" locked={!!s.qb_invoice_id} />
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{ fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: '999px', background: status.bg, color: status.color, border: `1px solid ${status.border}`, whiteSpace: 'nowrap' }}>{status.label}</span>
                    <span onClick={() => handleDelete(s.id)} title="Delete this row" style={{ cursor: 'pointer', fontSize: '14px', lineHeight: 1, flexShrink: 0 }}>🗑️</span>
                  </span>
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
      <AddRoomSplitForm dealId={deal.hubspot_deal_id} onAdded={onRoomAdded} isMobile={false} />
    </div>
  );
}

// ─── Action Items — reminders for Brianna, color-coded by urgency ─────────────
// One item per unpaid stage. Three cases:
//  - Not invoiced at all yet → "Send invoice", anchored on est_date (the
//    original guess of when this stage should be billed).
//  - Manually invoiced (no QBO link) → "Follow up on payment", anchored on
//    invoice_date — that's a real event Brianna caused by billing this
//    specific stage, so it's the right signal for "how long has this been
//    outstanding."
//  - QBO-linked → also "Follow up on payment", but anchored on est_date
//    instead. Once a group is linked, invoice_date is synced identically
//    across all 3 stages from one shared QuickBooks invoice — it no longer
//    means "we just billed this stage," so it can't drive urgency without
//    making every future stage look overdue the moment the first one is
//    billed. est_date is what actually represents Caliber's 50/45/5 payment
//    schedule for a linked deal.
// Paid stages never appear here; there's nothing left to act on.
function parseLocalDateAM(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  if (!y) return null;
  return new Date(y, m - 1, d);
}

function computeActionItems(deals) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const items = [];

  for (const deal of deals ?? []) {
    for (const stage of deal.stages ?? []) {
      if (stage.paid_date) continue; // done — nothing to act on

      if (!stage.invoice_date) {
        const est = parseLocalDateAM(stage.est_date);
        if (!est) continue;
        const days = Math.round((est - today) / 86400000);
        const urgency = days < 0 ? 'overdue' : days <= 7 ? 'dueSoon' : 'upcoming';
        items.push({
          key: `${stage.id ?? `${deal.hubspot_deal_id}-${stage.stage}`}-invoice`,
          dealId: deal.hubspot_deal_id,
          dealName: deal.name,
          stageLabel: stage.label,
          amount: stage.amount,
          urgency,
          action: 'Send invoice',
          message: days < 0
            ? `Invoice was due ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago`
            : days === 0
              ? 'Invoice due today'
              : `Invoice due in ${days} day${days !== 1 ? 's' : ''}`,
          sortDate: est,
        });
      } else if (stage.qb_invoice_id) {
        const est = parseLocalDateAM(stage.est_date);
        if (!est) continue;
        const days = Math.round((est - today) / 86400000);
        const urgency = days < 0 ? 'overdue' : days <= 7 ? 'dueSoon' : 'upcoming';
        items.push({
          key: `${stage.id ?? `${deal.hubspot_deal_id}-${stage.stage}`}-followup`,
          dealId: deal.hubspot_deal_id,
          dealName: deal.name,
          stageLabel: stage.label,
          amount: stage.amount,
          urgency,
          action: 'Follow up on payment',
          message: days < 0
            ? `Payment was due ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago`
            : days === 0
              ? 'Payment due today'
              : `Payment due in ${days} day${days !== 1 ? 's' : ''}`,
          sortDate: est,
        });
      } else {
        const inv = parseLocalDateAM(stage.invoice_date);
        if (!inv) continue;
        const daysSince = Math.round((today - inv) / 86400000);
        const urgency = daysSince > 14 ? 'overdue' : daysSince > 7 ? 'dueSoon' : 'upcoming';
        items.push({
          key: `${stage.id ?? `${deal.hubspot_deal_id}-${stage.stage}`}-followup`,
          dealId: deal.hubspot_deal_id,
          dealName: deal.name,
          stageLabel: stage.label,
          amount: stage.amount,
          urgency,
          action: 'Follow up on payment',
          message: daysSince <= 0
            ? 'Invoiced today — awaiting payment'
            : `Invoiced ${daysSince} day${daysSince !== 1 ? 's' : ''} ago — awaiting payment`,
          sortDate: inv,
        });
      }
    }
  }

  const order = { overdue: 0, dueSoon: 1, upcoming: 2 };
  items.sort((a, b) => order[a.urgency] - order[b.urgency] || a.sortDate - b.sortDate);
  return items;
}

const URGENCY_STYLE = {
  overdue:  { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c', dot: '#dc2626', tag: 'Overdue' },
  dueSoon:  { bg: '#fffbeb', border: '#fde68a', text: '#92400e', dot: '#d97706', tag: 'Due Soon' },
  upcoming: { bg: '#f9fafb', border: '#e5e7eb', text: '#374151', dot: '#9ca3af', tag: 'Upcoming' },
};

function ActionItemsList({ deals, onSelectDeal }) {
  const items = computeActionItems(deals);
  const overdueCount = items.filter((i) => i.urgency === 'overdue').length;

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span style={{ fontSize: '11px', fontWeight: '800', color: '#78350f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Action Items</span>
        {overdueCount > 0 && (
          <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '999px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' }}>
            {overdueCount} overdue
          </span>
        )}
        <div style={{ flex: 1, height: '1px', background: '#f3e8d0' }} />
      </div>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>Nothing needs attention — every stage is either paid or not due yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
          {items.map((item) => {
            const s = URGENCY_STYLE[item.urgency];
            return (
              <div
                key={item.key}
                onClick={() => onSelectDeal?.(item.dealId)}
                title="Click to jump to this deal's payment schedule below"
                style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: s.bg, border: `1px solid ${s.border}`, borderRadius: '6px', cursor: onSelectDeal ? 'pointer' : 'default' }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.dot, marginTop: '5px', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: '700', color: '#111827' }}>
                    {item.action} — {item.dealName}
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: s.text }}>
                    {item.stageLabel} ({formatMoney(item.amount)}) · {item.message}
                  </p>
                </div>
                <span style={{ fontSize: '9px', fontWeight: '800', color: s.text, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', marginTop: '3px' }}>
                  {s.tag}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FinancialView() {
  const isMobile = useIsMobile();
  const [deals, setDeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('newest');
  const [exporting, setExporting] = useState(false);

  async function loadDeals() {
    setIsLoading(true);
    setLoadError('');
    try {
      // syncQbo=1 tells the backend to auto-refresh QBO-linked invoices on
      // this load (throttled to once/day per invoice) — only this view
      // needs invoice-level freshness, so only this view asks for it.
      const r = await apiCall('/api/admin-cashflow?syncQbo=1');
      if (!r.ok) throw new Error((await r.json()).error ?? 'Failed to load');
      const d = await r.json();
      setDeals(d.deals ?? []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { loadDeals(); }, []);

  // Jump from an Action Item to the matching deal below: expand its schedule,
  // clear any search that might be hiding it, and scroll it into view.
  function handleSelectDeal(dealId) {
    if (!dealId) return;
    setSearchQuery('');
    setExpandedId(dealId);
    setTimeout(() => {
      document.getElementById(`financial-deal-${dealId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  function handleRowSaved(dealId, updatedRow) {
    setDeals((prev) => prev.map((d) => {
      if (d.hubspot_deal_id !== dealId) return d;
      const stages = d.stages.map((s) => (s.id === updatedRow.id ? {
        ...s,
        amount: Number(updatedRow.amount) || 0,
        est_date: updatedRow.est_date,
        invoice_date: updatedRow.invoice_date,
        paid_date: updatedRow.paid_date,
        room: updatedRow.room ?? s.room,
        label: updatedRow.label ?? s.label,
      } : s));
      const invoiced = stages.filter((s) => s.invoice_date).reduce((sum, s) => sum + s.amount, 0);
      const received = stages.filter((s) => s.paid_date).reduce((sum, s) => sum + s.amount, 0);
      return { ...d, stages, invoiced, received, balance: d.contract_amount - received };
    }));
  }

  // A room/split adds all 3 stage rows (deposit/production/final) at once —
  // recompute invoiced/received the same way handleRowSaved does;
  // contract_amount/balance are untouched since they're driven by the deal
  // itself, not its schedule rows.
  function handleRoomAdded(dealId, newRows) {
    setDeals((prev) => prev.map((d) => {
      if (d.hubspot_deal_id !== dealId) return d;
      const added = newRows.map((newRow) => ({
        id: newRow.id,
        stage: newRow.stage,
        room: newRow.room ?? null,
        label: newRow.label,
        amount: Number(newRow.amount) || 0,
        est_date: newRow.est_date ?? null,
        invoice_date: newRow.invoice_date ?? null,
        paid_date: newRow.paid_date ?? null,
        note: newRow.note ?? '',
      }));
      const stages = [...d.stages, ...added]
        .sort((a, b) => PAYMENT_STAGE_ORDER.indexOf(a.stage) - PAYMENT_STAGE_ORDER.indexOf(b.stage) || (a.room ?? '').localeCompare(b.room ?? ''));
      const invoiced = stages.filter((s) => s.invoice_date).reduce((sum, s) => sum + s.amount, 0);
      const received = stages.filter((s) => s.paid_date).reduce((sum, s) => sum + s.amount, 0);
      return { ...d, stages, invoiced, received, balance: d.contract_amount - received };
    }));
  }

  // QBO link/unlink/refresh return the full updated row(s) for a room group.
  // Merges qb_* fields plus amount/invoice_date/paid_date — unlink-invoice
  // resets the latter three back to blank (see admin-cashflow.js), and
  // without merging them here the reset wouldn't show until the next full
  // page load. Recomputes invoiced/received since those fields now can
  // change through this path too.
  function handleRowsSynced(dealId, updatedRows) {
    setDeals((prev) => prev.map((d) => {
      if (d.hubspot_deal_id !== dealId) return d;
      const byId = new Map((updatedRows ?? []).map((r) => [r.id, r]));
      const stages = d.stages.map((s) => {
        const u = byId.get(s.id);
        if (!u) return s;
        return {
          ...s,
          amount: u.amount != null ? Number(u.amount) : s.amount,
          invoice_date: u.invoice_date ?? null,
          paid_date: u.paid_date ?? null,
          qb_invoice_id: u.qb_invoice_id ?? null,
          qb_invoice_number: u.qb_invoice_number ?? null,
          qb_total: u.qb_total != null ? Number(u.qb_total) : null,
          qb_balance: u.qb_balance != null ? Number(u.qb_balance) : null,
          qb_synced_at: u.qb_synced_at ?? null,
        };
      });
      const invoiced = stages.filter((s) => s.invoice_date).reduce((sum, s) => sum + s.amount, 0);
      const received = stages.filter((s) => s.paid_date).reduce((sum, s) => sum + s.amount, 0);
      return { ...d, stages, invoiced, received, balance: d.contract_amount - received };
    }));
  }

  function handleRowDeleted(dealId, rowId) {
    setDeals((prev) => prev.map((d) => {
      if (d.hubspot_deal_id !== dealId) return d;
      const stages = d.stages.filter((s) => s.id !== rowId);
      const invoiced = stages.filter((s) => s.invoice_date).reduce((sum, s) => sum + s.amount, 0);
      const received = stages.filter((s) => s.paid_date).reduce((sum, s) => sum + s.amount, 0);
      return { ...d, stages, invoiced, received, balance: d.contract_amount - received };
    }));
  }

  // Bulk counterpart to handleRowDeleted — removes every row in a room/split
  // at once (matches add-room creating all 3 at once).
  function handleRoomDeleted(dealId, deletedIds) {
    setDeals((prev) => prev.map((d) => {
      if (d.hubspot_deal_id !== dealId) return d;
      const idSet = new Set(deletedIds);
      const stages = d.stages.filter((s) => !idSet.has(s.id));
      const invoiced = stages.filter((s) => s.invoice_date).reduce((sum, s) => sum + s.amount, 0);
      const received = stages.filter((s) => s.paid_date).reduce((sum, s) => sum + s.amount, 0);
      return { ...d, stages, invoiced, received, balance: d.contract_amount - received };
    }));
  }

  const totals = deals.reduce((acc, d) => ({
    contract: acc.contract + d.contract_amount,
    invoiced: acc.invoiced + d.invoiced,
    received: acc.received + d.received,
    balance: acc.balance + d.balance,
  }), { contract: 0, invoiced: 0, received: 0, balance: 0 });

  // Search + sort don't touch the totals above (those stay whole-book figures,
  // same as the Leads KPI cards) — they only affect which deals are listed below.
  const filteredDeals = deals
    .filter((d) => !searchQuery.trim() || d.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .slice()
    .sort((a, b) => {
      if (sortKey === 'newest' || sortKey === 'oldest') {
        const ta = new Date(a.closed_at).getTime() || 0;
        const tb = new Date(b.closed_at).getTime() || 0;
        return sortKey === 'newest' ? tb - ta : ta - tb;
      }
      if (sortKey === 'contract-desc' || sortKey === 'contract-asc') {
        return sortKey === 'contract-desc' ? b.contract_amount - a.contract_amount : a.contract_amount - b.contract_amount;
      }
      if (sortKey === 'balance-desc' || sortKey === 'balance-asc') {
        return sortKey === 'balance-desc' ? b.balance - a.balance : a.balance - b.balance;
      }
      if (sortKey === 'name-asc' || sortKey === 'name-desc') {
        return sortKey === 'name-asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      return 0;
    });

  function handleReset() {
    setSearchQuery('');
    setSortKey('newest');
    loadDeals();
  }

  function handleExportCSV() {
    setExporting(true);
    apiCall('/api/admin-cashflow?action=export-csv')
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `caliber-financial-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(() => alert('Export failed. Please try again.'))
      .finally(() => setExporting(false));
  }

  if (isLoading) return <p style={{ color: '#9ca3af', padding: '40px 0', textAlign: 'center' }}>Loading financials…</p>;
  if (loadError) return (
    <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#b91c1c', fontSize: '13px' }}>
      {loadError} — <button onClick={loadDeals} style={{ background: 'none', border: 0, color: '#b91c1c', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px', padding: 0 }}>Retry</button>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '700', color: '#111827' }}>Financial Management</h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
          Payment schedule against Closed Won deals — Initial Deposit, Production Payment, Final Payment. Deals appear here automatically once won; editing dates or amounts never changes a deal's stage or any HubSpot data.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Total Contract Value', value: totals.contract, color: '#111827' },
          { label: 'Total Invoiced', value: totals.invoiced, color: '#b45309' },
          { label: 'Total Received', value: totals.received, color: '#15803d' },
          { label: 'Total Outstanding', value: totals.balance, color: totals.balance > 0 ? '#b45309' : '#6b7280' },
        ].map((k) => (
          <div key={k.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</p>
            <p style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: k.color }}>{formatMoney(k.value)}</p>
          </div>
        ))}
      </div>

      {deals.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          <CashInflowChart deals={deals} />
          <ActionItemsList deals={deals} onSelectDeal={handleSelectDeal} />
        </div>
      )}

      {deals.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <input
              type="search"
              placeholder="Search by deal name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <button
            onClick={() => setSortKey((k) => {
              const idx = FINANCIAL_SORT_OPTIONS.findIndex((o) => o.key === k);
              return FINANCIAL_SORT_OPTIONS[(idx + 1) % FINANCIAL_SORT_OPTIONS.length].key;
            })}
            title={`Sort: ${FINANCIAL_SORT_OPTIONS.find((o) => o.key === sortKey)?.label} — click to cycle`}
            style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: '600', flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {FINANCIAL_SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? 'Sort'}
          </button>

          <button onClick={handleReset} style={{ padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: '600' }}>
            Reset
          </button>

          <button
            onClick={handleExportCSV}
            disabled={exporting}
            title="Download the payment schedule for every Closed Won deal as CSV"
            style={{ padding: '7px 14px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: exporting ? 'wait' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap', opacity: exporting ? 0.6 : 1 }}
          >
            {exporting ? 'Exporting…' : '↓ Export CSV'}
          </button>
        </div>
      )}

      {deals.length > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#9ca3af' }}>
          {filteredDeals.length} deal{filteredDeals.length !== 1 ? 's' : ''}{searchQuery.trim() ? ' (filtered)' : ''}
        </p>
      )}

      {deals.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #e5e7eb' }}>
          No Closed Won deals yet. They'll show up here automatically as they close.
        </div>
      ) : filteredDeals.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #e5e7eb' }}>
          No deals match "{searchQuery}". <button onClick={handleReset} style={{ background: 'none', border: 0, color: '#78350f', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px', padding: 0 }}>Clear search</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {filteredDeals.map((d) => {
            const isExpanded = expandedId === d.hubspot_deal_id;
            const isPaid = d.balance <= 0 && d.contract_amount > 0;
            return (
              <div key={d.hubspot_deal_id} id={`financial-deal-${d.hubspot_deal_id}`} style={{ background: '#fff', border: isExpanded ? '1px solid #78350f' : '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', transition: 'border-color 0.2s' }}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : d.hubspot_deal_id)}
                  style={{ padding: '16px 20px', cursor: 'pointer', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.5fr 1fr 1fr 1fr 90px', gap: '10px', alignItems: 'center' }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: '#111827' }}>{d.name}</p>
                    <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#9ca3af' }}>Closed {formatDate(d.closed_at)}</p>
                  </div>
                  {!isMobile && (
                    <>
                      <div>
                        <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: '700' }}>Contract</p>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#111827' }}>{formatMoney(d.contract_amount)}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: '700' }}>Received</p>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#15803d' }}>{formatMoney(d.received)}</p>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: '700' }}>Balance</p>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: isPaid ? '#15803d' : '#b45309' }}>
                          {isPaid ? 'Paid in full' : formatMoney(d.balance)}
                        </p>
                      </div>
                    </>
                  )}
                  <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>{isExpanded ? '▴ Hide' : '▾ Schedule'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '4px 20px 20px', borderTop: '1px solid #f3f4f6' }} onClick={(e) => e.stopPropagation()}>
                    <p style={{ margin: '14px 0 10px', fontSize: '12px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Payment Schedule
                    </p>
                    <PaymentScheduleTable deal={d} isMobile={isMobile} onRowSaved={handleRowSaved} onRoomAdded={handleRoomAdded} onRowDeleted={handleRowDeleted} onRoomDeleted={handleRoomDeleted} onInvoiceSynced={handleRowsSynced} />
                    {d.hs_deal_url && (
                      <p style={{ margin: '14px 0 0' }}>
                        <a href={d.hs_deal_url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: '#78350f', textDecoration: 'none', fontWeight: '600' }}>View deal in HubSpot ↗</a>
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

// `bookkeeperHidden: true` items are hidden from the restricted Bookkeeper
// role (Brianna's account) — she only sees Financial Management. Super admins
// and regular staff are unaffected by that flag; it's purely for the bookkeeper persona.
const NAV_ITEMS = [
  { key: 'leads', label: 'Leads', section: null, bookkeeperHidden: true },
  { key: 'performance', label: 'Performance', section: null, bookkeeperHidden: true },
  { key: 'site-stats', label: 'Site Stats', section: null, bookkeeperHidden: true },
  { key: 'cashflow', label: 'Financial', section: null },
  { key: 'projects', label: 'Projects', section: 'Content', bookkeeperHidden: true },
  { key: 'backup', label: 'Backup', section: 'Settings', superAdminOnly: true, bookkeeperHidden: true },
  { key: 'notifications', label: 'Notifications', section: 'Settings', superAdminOnly: true, bookkeeperHidden: true },
  { key: 'confirmations', label: 'Confirmations', section: 'Settings', superAdminOnly: true, bookkeeperHidden: true },
  { key: 'financial-settings', label: 'Financial', section: 'Settings', superAdminOnly: true, bookkeeperHidden: true },
  { key: 'users', label: 'User Access', section: 'Settings', superAdminOnly: true, bookkeeperHidden: true },
];

function Sidebar({ activeView, onNavigate, currentUser, winRate }) {
  const isMobile = useIsMobile();
  const [winTipOpen, setWinTipOpen] = useState(false);
  const isSuperAdmin = currentUser?.is_super_admin;
  const isBookkeeper = !isSuperAdmin && currentUser?.role === 'bookkeeper';
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (isBookkeeper && item.bookkeeperHidden) return false;
    return true;
  });

  // Collapsible sections (Settings especially — 5 items and growing). Persisted
  // per-browser; a section auto-expands if the active view lives inside it,
  // even if the user previously collapsed it, so navigation never gets "stuck" hidden.
  const [collapsed, setCollapsed] = useState(() => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('admin_nav_collapsed_sections') ?? '{}'); } catch { /* ignore */ }
    // Settings collapses by default (it's the crowded one) unless the user has
    // already expressed a preference by toggling it themselves.
    return { Settings: true, ...stored };
  });
  useEffect(() => {
    try { localStorage.setItem('admin_nav_collapsed_sections', JSON.stringify(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);
  function toggleSection(section) {
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  // Group consecutive items sharing a section label into one block.
  const groups = [];
  for (const item of visibleItems) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }

  const hasData = winRate !== null;
  const winColor = !hasData ? '#9ca3af' : winRate >= 50 ? '#15803d' : winRate >= 30 ? '#b45309' : '#b91c1c';
  const winBg    = !hasData ? '#f9fafb'  : winRate >= 50 ? '#f0fdf4'  : winRate >= 30 ? '#fffbeb'  : '#fef2f2';
  const winBorder= !hasData ? '#e5e7eb'  : winRate >= 50 ? '#bbf7d0'  : winRate >= 30 ? '#fde68a'  : '#fecaca';
  const winStatus= !hasData ? 'No closed deals yet' : winRate >= 50 ? 'Healthy' : winRate >= 30 ? 'Needs attention' : 'Action required';

  // ── Mobile: compact banner + horizontal tab strip ────────────────────────
  if (isMobile) {
    return (
      <nav style={{ width: '100%' }}>
        {/* Compact Win Rate banner — not relevant to the Bookkeeper role */}
        {!isBookkeeper && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: '8px 12px', marginBottom: '8px',
          background: winBg, border: `1.5px solid ${winBorder}`, borderRadius: '8px',
        }}>
          <span style={{ fontSize: '10px', fontWeight: '800', color: winColor, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Win Rate</span>
          <span style={{ fontSize: '20px', fontWeight: '900', color: winColor, lineHeight: 1 }}>
            {hasData ? `${winRate}%` : '—'}
          </span>
          <span style={{ fontSize: '11px', color: winColor, opacity: 0.75, fontWeight: '500' }}>{winStatus}</span>
        </div>
        )}
        {/* Horizontal scrollable tab strip */}
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '2px' }}>
          {visibleItems.map((item) => {
            const isActive = activeView === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                style={{
                  flexShrink: 0, padding: '7px 14px', border: 0, borderRadius: '6px',
                  background: isActive ? '#78350f' : '#f3f4f6',
                  color: isActive ? '#ffffff' : '#374151',
                  fontSize: '13px', fontWeight: isActive ? '700' : '500',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  // ── Desktop: 200px left sidebar ───────────────────────────────────────────
  return (
    <nav style={{ width: '200px', flexShrink: 0, paddingTop: '8px' }}>
      {/* ── Win Rate — north star metric for everyone except the Bookkeeper role ── */}
      {!isBookkeeper && (
      <div
        style={{ position: 'relative', margin: '0 0 20px', padding: '14px 16px', background: winBg, border: `1.5px solid ${winBorder}`, borderRadius: '10px', cursor: 'default', textAlign: 'center' }}
        onMouseEnter={() => setWinTipOpen(true)}
        onMouseLeave={() => setWinTipOpen(false)}
      >
        <p style={{ margin: '0 0 6px', fontSize: '10px', fontWeight: '800', color: winColor, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Win Rate
        </p>
        <p style={{ margin: 0, fontSize: '36px', fontWeight: '900', color: winColor, lineHeight: 1 }}>
          {hasData ? `${winRate}%` : '—'}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: '11px', color: winColor, opacity: 0.75, fontWeight: '500' }}>
          {winStatus}
        </p>
        {/* Tooltip — appears to the right of the sidebar block */}
        {winTipOpen && (
          <div style={{
            position: 'absolute', left: 'calc(100% + 12px)', top: 0,
            zIndex: 200, background: '#1f2937', borderRadius: '10px', padding: '12px 14px',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)', width: '230px', pointerEvents: 'none',
          }}>
            {/* Caret pointing left toward the card */}
            <span style={{
              position: 'absolute', right: '100%', top: '20px',
              width: 0, height: 0,
              borderTop: '7px solid transparent',
              borderBottom: '7px solid transparent',
              borderRight: '7px solid #1f2937',
            }} />
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#f3f4f6', lineHeight: 1.5 }}>
              Closed Won ÷ total closed deals. Referred Out and Partnered Out don&apos;t count against this — only Declined and Lost Deal do.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ fontSize: '11px', color: '#bbf7d0', fontWeight: '600' }}>≥ 50% — Healthy</span>
              <span style={{ fontSize: '11px', color: '#fde68a', fontWeight: '600' }}>30–49% — Needs attention</span>
              <span style={{ fontSize: '11px', color: '#fca5a5', fontWeight: '600' }}>&lt; 30% — Action required</span>
            </div>
          </div>
        )}
      </div>
      )}
      {/* ── Nav items, grouped by section — each section header toggles collapse ── */}
      {groups.map((g, gi) => {
        const hasActiveChild = g.items.some((it) => it.key === activeView);
        const isCollapsed = g.section && !!collapsed[g.section] && !hasActiveChild;
        return (
          <div key={gi}>
            {g.section && (
              <button
                onClick={() => toggleSection(g.section)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  margin: '20px 0 6px', padding: '0 16px', background: 'none', border: 0, cursor: 'pointer',
                }}
                title={isCollapsed ? `Expand ${g.section}` : `Collapse ${g.section}`}
              >
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {g.section}
                </span>
                <span style={{ fontSize: '9px', color: '#9ca3af', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>
                  ▾
                </span>
              </button>
            )}
            {!isCollapsed && g.items.map((item) => {
              const isActive = activeView === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 16px', border: 0, borderRadius: '6px',
                    background: isActive ? '#78350f' : 'transparent',
                    color: isActive ? '#ffffff' : '#374151',
                    fontSize: '14px', fontWeight: isActive ? '700' : '500',
                    cursor: 'pointer', marginBottom: '2px',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
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
  const [navWinRate, setNavWinRate] = useState(null); // bubbled up from LeadsView, shown in nav on all tabs
  const [qbBanner, setQbBanner] = useState(null); // { type: 'success' | 'error', message }

  // Dark mode — per-browser preference (each person's own toggle, stored locally).
  // Implemented as a CSS filter invert rather than per-element theming, since this
  // page has no color-token system. See the wrapper style below for why it's
  // position:fixed + internal scroll while dark: `filter` on an ancestor makes it
  // the containing block for `position: fixed` descendants (dropdowns, modals,
  // tooltips), so the wrapper itself must occupy the true viewport at all times
  // for those to stay positioned correctly.
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('admin_dark_mode') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('admin_dark_mode', String(darkMode)); } catch { /* ignore */ }
  }, [darkMode]);

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

  // Land back here after the QuickBooks OAuth redirect (api/admin-quickbooks-callback.js
  // sends the browser to /admin?qb=connected or /admin?qb=error&msg=...). Jump straight
  // to Financial Settings so the result is visible without hunting for it, and strip the
  // query string so a refresh doesn't re-show the banner.
  useEffect(() => {
    if (authState !== 'authed') return;
    const params = new URLSearchParams(window.location.search);
    const qb = params.get('qb');
    if (!qb) return;
    setActiveView('financial-settings');
    setQbBanner(
      qb === 'connected'
        ? { type: 'success', message: 'QuickBooks connected.' }
        : { type: 'error', message: params.get('msg') || 'QuickBooks connection failed.' },
    );
    window.history.replaceState({}, '', window.location.pathname);
  }, [authState]);

  const isMobile = useIsMobile();

  if (authState === 'loading') return null;
  if (authState === 'setup') return <SetupScreen onComplete={() => setAuthState('login')} />;
  if (authState === 'login') return <LoginScreen onLogin={handleLogin} />;

  const isSuperAdmin = currentUser?.is_super_admin;
  const isBookkeeper = !isSuperAdmin && currentUser?.role === 'bookkeeper';

  function renderView() {
    const settingsViews = ['notifications', 'confirmations', 'financial-settings', 'users', 'backup'];
    if (settingsViews.includes(activeView) && !isSuperAdmin) {
      return isBookkeeper ? <FinancialView /> : <LeadsView currentUser={currentUser} onWinRateUpdate={setNavWinRate} />;
    }
    // Bookkeeper role only ever sees Financial Management — redirect away from anything else,
    // regardless of how activeView got set (e.g. a stale nav state).
    const bookkeeperBlockedViews = ['leads', 'performance', 'site-stats', 'projects'];
    if (isBookkeeper && bookkeeperBlockedViews.includes(activeView)) return <FinancialView />;
    switch (activeView) {
      case 'cashflow': return <FinancialView />;
      case 'performance': return <PerformanceView />;
      case 'notifications': return <NotificationsPanel />;
      case 'confirmations': return <ConfirmationsPanel />;
      case 'financial-settings': return <FinancialSettingsPanel banner={qbBanner} onDismissBanner={() => setQbBanner(null)} />;
      case 'users': return <UsersPanel currentUser={currentUser} />;
      case 'site-stats': return <SiteStatsView />;
      case 'projects': return <ProjectsPanel />;
      case 'backup': return <BackupRestoreView isSuperAdmin={isSuperAdmin} />;
      default: return isBookkeeper ? <FinancialView /> : <LeadsView currentUser={currentUser} onWinRateUpdate={setNavWinRate} />;
    }
  }

  return (
    <DarkModeContext.Provider value={darkMode}>
    <div style={{
      minHeight: '100vh', background: '#f5f4f0', fontFamily: 'Arial, Helvetica, sans-serif',
      ...(darkMode ? { filter: 'invert(1) hue-rotate(180deg)' } : {}),
    }}>
      {/* Header */}
      <header style={{ background: '#78350f', padding: '0 16px', display: 'flex', alignItems: 'center', height: '52px', gap: '12px', position: 'sticky', top: 0, zIndex: 10 }}>
        <img
          src="/images/caliber-logo-brand.webp"
          alt="Caliber Cabinets"
          style={{ height: '34px', width: 'auto', borderRadius: '4px', objectFit: 'contain', filter: darkMode ? 'invert(1) hue-rotate(180deg)' : 'none' }}
        />
        <p style={{ margin: 0, color: '#ffffff', fontWeight: '700', fontSize: isMobile ? '14px' : '16px', flex: 1 }}>
          Caliber Cabinets
          <span style={{ opacity: 0.6, fontWeight: '400', fontSize: '13px', marginLeft: '8px' }}>Admin</span>
        </p>
        {!isMobile && currentUser?.name && (
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>{currentUser.name}</span>
        )}
        <button
          onClick={() => setDarkMode((d) => !d)}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: 'rgba(255,255,255,0.8)', padding: isMobile ? '5px 8px' : '6px 10px', borderRadius: '5px', fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1 }}
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
        <button onClick={handleLogout} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: 'rgba(255,255,255,0.8)', padding: isMobile ? '5px 10px' : '6px 14px', borderRadius: '5px', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Sign Out
        </button>
      </header>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '12px' : '24px 16px', gap: isMobile ? '12px' : '24px', alignItems: 'flex-start' }}>
        <Sidebar activeView={activeView} onNavigate={setActiveView} currentUser={currentUser} winRate={navWinRate} />
        <main style={{ flex: 1, minWidth: 0, width: '100%' }}>
          {renderView()}
        </main>
      </div>
    </div>
    </DarkModeContext.Provider>
  );
}
