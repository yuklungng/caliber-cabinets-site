import { useMemo, useState } from 'react';

// Executive win/loss view: how each inbound route performs and why deals are lost.
// Pure SVG/CSS (no chart dependency) to match the rest of the admin panel.

const WON = 'closedwon';
const LOST = 'closedlost';
const MIN_N = 5; // below this many closed deals a rate is shown but flagged low-sample

const C = {
  won: '#16a34a',
  lost: '#dc2626',
  ink: '#111827',
  body: '#374151',
  muted: '#6b7280',
  faint: '#9ca3af',
  line: '#e5e7eb',
  track: '#f3f4f6',
  brand: '#78350f',
  brandLine: '#f3e8d0',
};

const REASON_COLORS = {
  Pricing: '#dc2626',
  Competitor: '#ea580c',
  Value: '#7c3aed',
  Other: '#9ca3af',
  'No reason': '#d1d5db',
};

const RANGES = [
  { id: 'all', label: 'All time', days: null },
  { id: '365', label: '12 mo', days: 365 },
  { id: '180', label: '6 mo', days: 180 },
  { id: '90', label: '90 days', days: 90 },
];

const money = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
};
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Single normalized "inbound route" per lead. Web leads carry no leadSource,
// so the form they came through (homeowner vs trade) is their route.
function leadRoute(lead) {
  const src = lead.fields?.leadSource;
  if (src && src !== 'Website') return src;
  if (lead.form_type === 'trade-estimate') return 'Web · Trade';
  if (lead.form_type === 'homeowner-consultation') return 'Web · Homeowner';
  if (lead.form_type === 'hubspot_direct' || lead.source === 'hubspot') return 'HubSpot (Direct)';
  return 'Other';
}

function closedDate(lead) {
  const d = lead.hs_stage_id === WON ? lead.hs_date_entered_closed_won : lead.hs_date_entered_closed_lost;
  return new Date(d ?? lead.last_modified_at ?? lead.created_at);
}

const QUOTE_BANDS = [
  { label: 'Under $10k', test: (q) => q < 10_000 },
  { label: '$10k–25k', test: (q) => q >= 10_000 && q < 25_000 },
  { label: '$25k–50k', test: (q) => q >= 25_000 && q < 50_000 },
  { label: '$50k+', test: (q) => q >= 50_000 },
];
const DISTANCE_BANDS = [
  { label: 'Under 5 mi', test: (d) => d < 5 },
  { label: '5–15 mi', test: (d) => d >= 5 && d < 15 },
  { label: '15–30 mi', test: (d) => d >= 15 && d < 30 },
  { label: '30+ mi', test: (d) => d >= 30 },
];

const SEGMENTS = [
  {
    id: 'quote', label: 'Quote size',
    note: 'Deals with a recorded quote amount',
    bucket: (l) => {
      const q = num(l.fields?.quote_amount);
      return q === null || q <= 0 ? null : QUOTE_BANDS.find((b) => b.test(q))?.label;
    },
    order: QUOTE_BANDS.map((b) => b.label),
  },
  {
    id: 'distance', label: 'Distance',
    note: 'Miles from the shop, where the address was geocoded',
    bucket: (l) => {
      const d = num(l.fields?.distance_miles);
      return d === null ? null : DISTANCE_BANDS.find((b) => b.test(d))?.label;
    },
    order: DISTANCE_BANDS.map((b) => b.label),
  },
  {
    id: 'timeline', label: 'Timeline',
    note: 'Stated project timeline on the form',
    bucket: (l) => (l.fields?.timeline || l.fields?.installationTimeline || '').trim() || null,
    order: null,
  },
  {
    id: 'project', label: 'Project type',
    note: 'Homeowner form only; trade leads have no project type',
    bucket: (l) => (l.fields?.projectType || '').trim() || null,
    order: null,
  },
];

function Card({ title, sub, right, children, style }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: '10px', padding: '18px 22px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: C.ink }}>{title}</p>
          {sub && <p style={{ margin: '2px 0 0', fontSize: '11px', color: C.faint }}>{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, color = C.ink, accent, tip, WithTip }) {
  const card = (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderTop: `3px solid ${accent ?? C.line}`, borderRadius: '10px', padding: '14px 16px', height: '100%', boxSizing: 'border-box', cursor: tip ? 'help' : 'default' }}>
      <p style={{ margin: 0, fontSize: '10px', fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
      <p style={{ margin: '6px 0 2px', fontSize: '26px', fontWeight: 700, color, lineHeight: 1.05, letterSpacing: '-0.02em' }}>{value}</p>
      <p style={{ margin: 0, fontSize: '11px', color: C.muted }}>{sub}</p>
    </div>
  );
  // Hover explanation uses the admin panel's shared tooltip when provided.
  return tip && WithTip ? <WithTip tip={tip} style={{ height: '100%' }}>{card}</WithTip> : card;
}

function Segmented({ options, value, onChange }) {
  return (
    <div role="tablist" style={{ display: 'inline-flex', background: C.track, borderRadius: '8px', padding: '2px' }}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          style={{
            border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: '5px 12px', borderRadius: '6px',
            background: value === o.id ? '#fff' : 'transparent',
            color: value === o.id ? C.ink : C.muted,
            boxShadow: value === o.id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: C.muted }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: i.color, display: 'inline-block' }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

function RouteOutcomeBars({ rows, avgRate }) {
  const max = Math.max(...rows.map((r) => r.closed), 1);
  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {rows.map((r) => {
        const low = r.closed < MIN_N;
        return (
          <div key={r.route} style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 150px) 1fr 92px', alignItems: 'center', gap: '12px' }}>
            <div>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: C.body }}>{r.route}</p>
              <p style={{ margin: 0, fontSize: '10px', color: C.faint }}>{r.active} still active</p>
            </div>
            <div
              title={`${r.route}: ${r.won} won, ${r.lost} lost`}
              style={{ display: 'flex', height: '22px', width: `${Math.max(8, (r.closed / max) * 100)}%`, borderRadius: '5px', overflow: 'hidden', opacity: low ? 0.55 : 1 }}
            >
              {r.won > 0 && <div style={{ flex: r.won, background: C.won, color: '#fff', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.won}</div>}
              {r.lost > 0 && <div style={{ flex: r.lost, background: C.lost, color: '#fff', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.lost}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: r.rate === null ? C.faint : r.rate >= avgRate ? C.won : C.lost }}>
                {r.rate === null ? '—' : `${r.rate}%`}
              </span>
              <span style={{ display: 'block', fontSize: '10px', color: C.faint }}>{low ? `low sample · n=${r.closed}` : `n=${r.closed}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReasonDonut({ slices, total }) {
  const R = 52;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Lost deals by reason">
        <circle cx="70" cy="70" r={R} fill="none" stroke={C.track} strokeWidth="18" />
        {slices.map((s) => {
          const len = (s.count / total) * CIRC;
          const el = (
            <circle
              key={s.reason} cx="70" cy="70" r={R} fill="none" stroke={REASON_COLORS[s.reason] ?? C.faint} strokeWidth="18"
              strokeDasharray={`${len} ${CIRC - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)"
            >
              <title>{`${s.reason}: ${s.count} (${pct(s.count, total)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" fontSize="24" fontWeight="700" fill={C.ink}>{total}</text>
        <text x="70" y="86" textAnchor="middle" fontSize="10" fill={C.faint}>LOST DEALS</text>
      </svg>
      <div style={{ display: 'grid', gap: '8px', flex: 1, minWidth: '140px' }}>
        {slices.map((s) => (
          <div key={s.reason} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: REASON_COLORS[s.reason] ?? C.faint }} />
            <span style={{ flex: 1, color: C.body }}>{s.reason}</span>
            <span style={{ fontWeight: 700, color: C.ink }}>{s.count}</span>
            <span style={{ width: 36, textAlign: 'right', color: C.faint }}>{pct(s.count, total)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReasonHeatmap({ rows, reasons }) {
  const max = Math.max(...rows.flatMap((r) => reasons.map((x) => r.reasons[x] ?? 0)), 1);
  const cols = `minmax(96px, 150px) repeat(${reasons.length}, minmax(52px, 1fr)) 48px`;
  return (
    <div style={{ display: 'grid', gap: '4px', overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: '4px', alignItems: 'end' }}>
        <span />
        {reasons.map((x) => (
          <span key={x} style={{ fontSize: '10px', fontWeight: 700, color: C.faint, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{x}</span>
        ))}
        <span style={{ fontSize: '10px', fontWeight: 700, color: C.faint, textAlign: 'center', textTransform: 'uppercase' }}>Lost</span>
      </div>
      {rows.map((r) => (
        <div key={r.route} style={{ display: 'grid', gridTemplateColumns: cols, gap: '4px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: C.body }}>{r.route}</span>
          {reasons.map((x) => {
            const v = r.reasons[x] ?? 0;
            const a = v === 0 ? 0 : 0.12 + 0.78 * (v / max);
            return (
              <div
                key={x}
                title={`${r.route} · ${x}: ${v} of ${r.lost} lost`}
                style={{
                  height: '30px', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: v === 0 ? C.track : `rgba(220,38,38,${a})`,
                  color: v === 0 ? '#d1d5db' : a > 0.5 ? '#fff' : '#7f1d1d',
                  fontSize: '12px', fontWeight: 700,
                }}
              >
                {v === 0 ? '·' : v}
              </div>
            );
          })}
          <span style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: C.ink }}>{r.lost}</span>
        </div>
      ))}
    </div>
  );
}

function SegmentBars({ rows, avgRate }) {
  if (rows.length === 0) return <p style={{ margin: 0, fontSize: '13px', color: C.faint }}>Not enough closed deals with this field yet.</p>;
  return (
    <div style={{ display: 'grid', gap: '10px', position: 'relative' }}>
      {rows.map((r) => {
        const low = r.closed < MIN_N;
        const rate = r.rate ?? 0;
        return (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(86px, 130px) 1fr 84px', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: C.body }}>{r.label}</span>
            <div style={{ position: 'relative', height: '16px', background: C.track, borderRadius: '4px' }} title={`${r.label}: ${r.won} won / ${r.lost} lost`}>
              <div style={{ width: `${rate}%`, height: '100%', background: rate >= avgRate ? C.won : C.lost, borderRadius: '4px', opacity: low ? 0.4 : 0.9, transition: 'width 400ms ease' }} />
              <div style={{ position: 'absolute', left: `${avgRate}%`, top: '-3px', bottom: '-3px', width: '2px', background: C.ink, opacity: 0.55 }} title={`Overall win rate ${avgRate}%`} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: C.ink }}>{rate}%</span>
              <span style={{ fontSize: '10px', color: C.faint }}> {r.won}W·{r.lost}L</span>
            </div>
          </div>
        );
      })}
      <p style={{ margin: '4px 0 0', fontSize: '10px', color: C.faint }}>
        Black marker = overall win rate ({avgRate}%). Faded bars have fewer than {MIN_N} closed deals.
      </p>
    </div>
  );
}

// Each closed deal with a quote amount as a dot on a log-ish scale; won above, lost below.
function QuoteStrip({ deals }) {
  const W = 640, H = 150, PAD = 36;
  if (deals.length === 0) return <p style={{ margin: 0, fontSize: '13px', color: C.faint }}>No closed deals with a quote amount yet.</p>;
  const lo = Math.log10(Math.max(1000, Math.min(...deals.map((d) => d.q))));
  const hi = Math.log10(Math.max(...deals.map((d) => d.q)));
  const x = (q) => PAD + ((Math.log10(Math.max(q, 1000)) - lo) / Math.max(hi - lo, 0.01)) * (W - PAD * 2);
  const ticks = [1000, 5000, 10000, 25000, 50000, 100000].filter((t) => Math.log10(t) >= lo - 0.05 && Math.log10(t) <= hi + 0.05);
  // Deterministic jitter so dots don't jump between renders.
  const jitter = (i) => ((i * 37) % 21) - 10;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Quote amounts of won and lost deals">
      <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke={C.line} />
      <text x={6} y={H / 2 - 28} fontSize="10" fontWeight="700" fill={C.won}>WON</text>
      <text x={6} y={H / 2 + 38} fontSize="10" fontWeight="700" fill={C.lost}>LOST</text>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={14} y2={H - 26} stroke={C.track} />
          <text x={x(t)} y={H - 10} textAnchor="middle" fontSize="10" fill={C.faint}>{money(t)}</text>
        </g>
      ))}
      {deals.map((d, i) => (
        <circle
          key={i} cx={x(d.q)} cy={d.won ? H / 2 - 22 + jitter(i) : H / 2 + 22 + jitter(i)} r="5.5"
          fill={d.won ? C.won : C.lost} fillOpacity="0.7" stroke="#fff" strokeWidth="1"
        >
          <title>{`${d.route} · ${money(d.q)} · ${d.won ? 'Won' : 'Lost' + (d.reason ? ` (${d.reason})` : '')}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function WinLossInsights({ leads, lostReasonOptions = ['Competitor', 'Pricing', 'Value', 'Other'], WithTip }) {
  const [range, setRange] = useState('all');
  const [segmentId, setSegmentId] = useState('quote');

  const data = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)?.days;
    const cutoff = days ? Date.now() - days * 86_400_000 : null;

    const closed = leads.filter((l) => (l.hs_stage_id === WON || l.hs_stage_id === LOST) && (!cutoff || closedDate(l).getTime() >= cutoff));
    const won = closed.filter((l) => l.hs_stage_id === WON);
    const lost = closed.filter((l) => l.hs_stage_id === LOST);

    const reasonOf = (l) => l.lost_reason || 'No reason';
    const reasons = [...lostReasonOptions];
    if (lost.some((l) => !l.lost_reason)) reasons.push('No reason');
    for (const l of lost) if (l.lost_reason && !reasons.includes(l.lost_reason)) reasons.push(l.lost_reason);

    // Routes
    const byRoute = new Map();
    const bump = (route) => {
      if (!byRoute.has(route)) byRoute.set(route, { route, won: 0, lost: 0, active: 0, reasons: {} });
      return byRoute.get(route);
    };
    for (const l of closed) {
      const r = bump(leadRoute(l));
      if (l.hs_stage_id === WON) r.won++;
      else { r.lost++; r.reasons[reasonOf(l)] = (r.reasons[reasonOf(l)] ?? 0) + 1; }
    }
    // Active (open) deals per route, so volume that hasn't resolved yet is visible.
    for (const l of leads) {
      if (!l.hs_stage_id || l.hs_stage_id === WON || l.hs_stage_id === LOST) continue;
      if (l.hs_stage_id === '3945178857') continue; // Declined isn't an open deal
      if (byRoute.has(leadRoute(l))) byRoute.get(leadRoute(l)).active++;
    }
    const routes = [...byRoute.values()]
      .map((r) => ({ ...r, closed: r.won + r.lost, rate: pct(r.won, r.won + r.lost) }))
      .sort((a, b) => b.closed - a.closed);

    const rate = pct(won.length, closed.length) ?? 0;

    // Dollar view (quote_amount is only recorded on quoted deals)
    const withQuote = closed
      .map((l) => ({ q: num(l.fields?.quote_amount), won: l.hs_stage_id === WON, route: leadRoute(l), reason: l.lost_reason }))
      .filter((d) => d.q && d.q > 0);
    const wonValue = withQuote.filter((d) => d.won).reduce((s, d) => s + d.q, 0);
    const lostValue = withQuote.filter((d) => !d.won).reduce((s, d) => s + d.q, 0);
    const lostPricingValue = withQuote.filter((d) => !d.won && d.reason === 'Pricing').reduce((s, d) => s + d.q, 0);

    // Reason totals
    const reasonTotals = reasons
      .map((reason) => ({ reason, count: lost.filter((l) => reasonOf(l) === reason).length }))
      .filter((s) => s.count > 0);

    // Segments
    const segments = {};
    for (const seg of SEGMENTS) {
      const m = new Map();
      for (const l of closed) {
        const b = seg.bucket(l);
        if (!b) continue;
        if (!m.has(b)) m.set(b, { label: b, won: 0, lost: 0 });
        m.get(b)[l.hs_stage_id === WON ? 'won' : 'lost']++;
      }
      let rows = [...m.values()].map((r) => ({ ...r, closed: r.won + r.lost, rate: pct(r.won, r.won + r.lost) }));
      rows = seg.order
        ? seg.order.map((o) => rows.find((r) => r.label === o)).filter(Boolean)
        : rows.sort((a, b) => b.closed - a.closed);
      segments[seg.id] = { rows, covered: rows.reduce((s, r) => s + r.closed, 0) };
    }

    // Median business days from first contact to close, won vs lost
    return { closed, won, lost, routes, rate, withQuote, wonValue, lostValue, lostPricingValue, reasons, reasonTotals, segments };
  }, [leads, range, lostReasonOptions]);

  const { closed, won, lost, routes, rate, withQuote, wonValue, lostValue, lostPricingValue, reasons, reasonTotals, segments } = data;
  const pricingCount = lost.filter((l) => l.lost_reason === 'Pricing').length;
  const pricingShare = pct(pricingCount, lost.length);
  const noReason = lost.filter((l) => !l.lost_reason).length;

  // Plain-English takeaways, only from segments with enough evidence.
  const findings = useMemo(() => {
    const out = [];
    const solid = routes.filter((r) => r.closed >= MIN_N);
    if (solid.length >= 2) {
      const best = [...solid].sort((a, b) => b.rate - a.rate)[0];
      const worst = [...solid].sort((a, b) => a.rate - b.rate)[0];
      if (best.route !== worst.route && best.rate - worst.rate >= 10) {
        out.push({ tone: 'good', text: `${best.route} converts best at ${best.rate}% (${best.won} of ${best.closed}); ${worst.route} is weakest at ${worst.rate}% (${worst.won} of ${worst.closed}).` });
      }
    }
    if (pricingShare !== null && lost.length >= MIN_N && pricingShare >= 50) {
      out.push({ tone: 'bad', text: `Pricing drives ${pricingShare}% of lost deals (${pricingCount} of ${lost.length})${lostPricingValue ? `, about ${money(lostPricingValue)} in quotes` : ''}. It is the single biggest lever.` });
    }
    const q = segments.quote.rows.filter((r) => r.closed >= MIN_N);
    if (q.length >= 2) {
      const best = [...q].sort((a, b) => b.rate - a.rate)[0];
      const worst = [...q].sort((a, b) => a.rate - b.rate)[0];
      if (best.label !== worst.label && best.rate - worst.rate >= 15) {
        out.push({ tone: 'info', text: `By quote size, ${best.label} wins ${best.rate}% against ${worst.rate}% for ${worst.label}.` });
      }
    }
    const dist = segments.distance.rows.filter((r) => r.closed >= MIN_N);
    if (dist.length >= 2) {
      const best = [...dist].sort((a, b) => b.rate - a.rate)[0];
      const worst = [...dist].sort((a, b) => a.rate - b.rate)[0];
      if (best.label !== worst.label && best.rate - worst.rate >= 15) {
        out.push({ tone: 'info', text: `Distance matters: ${best.label} wins ${best.rate}%, ${worst.label} only ${worst.rate}%.` });
      }
    }
    if (noReason > 0) {
      out.push({ tone: 'warn', text: `${noReason} lost deal${noReason === 1 ? ' has' : 's have'} no reason recorded, which weakens every loss analysis here.` });
    }
    if (closed.length < 30) {
      out.push({ tone: 'warn', text: `Only ${closed.length} closed deals in this range. Treat gaps under about 15 points as noise.` });
    }
    return out;
  }, [routes, segments, pricingShare, pricingCount, lost.length, lostPricingValue, noReason, closed.length]);

  const seg = SEGMENTS.find((s) => s.id === segmentId);
  const toneStyle = {
    good: { dot: C.won, bg: '#f0fdf4' },
    bad: { dot: C.lost, bg: '#fef2f2' },
    info: { dot: '#2563eb', bg: '#eff6ff' },
    warn: { dot: '#d97706', bg: '#fffbeb' },
  };
  const heatRows = routes.filter((r) => r.lost > 0).sort((a, b) => b.lost - a.lost);

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: C.brand, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Win / Loss Analysis · Executive View</span>
        <div style={{ flex: 1, minWidth: 20, height: '1px', background: C.brandLine }} />
        <Segmented options={RANGES} value={range} onChange={setRange} />
      </div>

      {closed.length === 0 ? (
        <Card title="No closed deals in this range" sub="Try a longer date range.">{null}</Card>
      ) : (
        <div style={{ display: 'grid', gap: '14px' }}>
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '10px' }}>
            <Kpi WithTip={WithTip} label="Closed deals" value={closed.length} sub={`${won.length} won · ${lost.length} lost`} accent={C.brand}
              tip="Deals that reached a final outcome, Closed Won or Closed Lost, in the selected date range. Open and Declined deals are not counted." />
            <Kpi WithTip={WithTip} label="Win rate" value={`${rate}%`} sub="Won ÷ (won + lost)" color={rate >= 40 ? C.won : C.lost} accent={rate >= 40 ? C.won : C.lost}
              tip="Won deals ÷ total closed (Won + Lost). Only fully closed deals count; leads still in the pipeline aren't included yet. Green at 40% or above." />
            <Kpi WithTip={WithTip} label="Won value" value={money(wonValue)} sub={`${withQuote.filter((d) => d.won).length} of ${won.length} won deals quoted`} color={C.won} accent={C.won}
              tip="Total quote amount of won deals. Only deals with a quote amount recorded are included, so this can understate real revenue." />
            <Kpi WithTip={WithTip} label="Lost value" value={money(lostValue)} sub={`${withQuote.filter((d) => !d.won).length} of ${lost.length} lost deals quoted`} color={C.lost} accent={C.lost}
              tip="Total quote amount of lost deals: the revenue that was quoted but not won. Only lost deals that reached a quote have an amount." />
            <Kpi WithTip={WithTip} label="Lost to pricing" value={pricingShare === null ? '—' : `${pricingShare}%`} sub={`${pricingCount} of ${lost.length} lost deals`} accent="#ea580c"
              tip="Share of lost deals where the recorded loss reason is Pricing. Lost deals with no reason on file count in the denominator but not as Pricing." />
          </div>

          {/* Key findings */}
          {findings.length > 0 && (
            <Card title="Key findings" sub="Generated from the data below; only groups with at least 5 closed deals are called out">
              <div style={{ display: 'grid', gap: '8px' }}>
                {findings.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: toneStyle[f.tone].bg, borderRadius: '8px', padding: '9px 12px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: toneStyle[f.tone].dot, marginTop: 5, flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', color: C.body, lineHeight: 1.45 }}>{f.text}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Route outcomes + reasons donut */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px' }}>
            <Card
              title="Outcome by inbound route"
              sub="Bar length = closed deals. Rate is green when above the overall average."
              right={<Legend items={[{ label: 'Won', color: C.won }, { label: 'Lost', color: C.lost }]} />}
              style={{ gridColumn: 'span 1' }}
            >
              <RouteOutcomeBars rows={routes} avgRate={rate} />
            </Card>
            <Card title="Why deals are lost" sub="All lost deals in range">
              {reasonTotals.length > 0 ? <ReasonDonut slices={reasonTotals} total={lost.length} /> : <p style={{ margin: 0, fontSize: '13px', color: C.faint }}>No lost deals in range.</p>}
            </Card>
          </div>

          {/* Route × reason heatmap */}
          {heatRows.length > 0 && (
            <Card title="Loss reasons by route" sub="Where each route's losses come from. Darker = more deals.">
              <ReasonHeatmap rows={heatRows} reasons={reasons.filter((x) => lost.some((l) => (l.lost_reason || 'No reason') === x))} />
            </Card>
          )}

          {/* Segment drill-down */}
          <Card
            title="What separates wins from losses"
            sub={`${seg.note} · ${segments[seg.id].covered} of ${closed.length} closed deals have this field`}
            right={<Segmented options={SEGMENTS.map((s) => ({ id: s.id, label: s.label }))} value={segmentId} onChange={setSegmentId} />}
          >
            <SegmentBars rows={segments[seg.id].rows} avgRate={rate} />
          </Card>

          {/* Quote strip */}
          <Card
            title="Quote amount by outcome"
            sub={`${withQuote.length} closed deals with a quote · log scale · hover a dot for detail`}
          >
            <QuoteStrip deals={withQuote} />
          </Card>
        </div>
      )}
    </section>
  );
}
