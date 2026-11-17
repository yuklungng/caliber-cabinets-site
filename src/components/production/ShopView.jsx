import { useMemo, useState } from 'react';
import { STATIONS, activeJobs, jobStations, nextVisit, stationCounts } from './shopStages.js';
import { todayIso, weekDays } from './weekSchedule.js';

// Shop view of the Production module: the simple, large-print screen for the people in the shop.
// It shows where every job is on the production line, what goes out this week, and one job's colors, dates and
// hardware. The one thing it changes is a job's step boxes: tapping a step ticks or unticks it (saved to
// dev_job_step_ticks; the sheet is never written). It leaves out the office tools (deal links, filters, part search
// totals, data warnings), which stay in the Office view.

const authHeaders = () => ({ Authorization: `Bearer ${sessionStorage.getItem('admin_token') ?? ''}` });

const BROWN = '#78350f';
const AMBER = '#b45309';
const GREEN = '#15803d';
const GREY = '#9ca3af';

const fmtDate = (iso, text, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => {
  if (iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', opts);
  }
  return text ?? '';
};

const css = `
.shop-line { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; padding: 14px 10px 18px; background: linear-gradient(#fffbeb, #fef3c7); border: 1px solid #fde68a; border-radius: 14px; }
.shop-belt { position: absolute; left: 18px; right: 18px; top: 54px; height: 10px; border-radius: 5px; background: repeating-linear-gradient(90deg, #a16207 0 14px, #ca8a04 14px 28px); opacity: .55; }
.shop-station { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: 0; padding: 0 2px; cursor: pointer; font: inherit; color: #374151; min-height: 44px; }
.shop-station .shop-disc { width: 64px; height: 64px; border-radius: 50%; background: #fff; border: 3px solid #e7d3a8; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(120,53,15,.15); transition: transform .15s; }
.shop-station:hover .shop-disc { transform: translateY(-2px); }
.shop-station[aria-pressed="true"] .shop-disc { border-color: ${BROWN}; background: ${BROWN}; }
.shop-count { position: absolute; top: -6px; right: calc(50% - 40px); min-width: 26px; height: 26px; padding: 0 6px; border-radius: 13px; background: ${AMBER}; color: #fff; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
.shop-count.zero { background: #d6d3d1; }
.shop-step-num { font-size: 11px; color: #a16207; font-weight: 700; letter-spacing: .04em; }
.shop-station-label { font-size: 13px; font-weight: 700; text-align: center; line-height: 1.2; }
@media (max-width: 560px) {
  .shop-line { grid-template-columns: repeat(3, 1fr); row-gap: 14px; }
  .shop-belt { display: none; }
}
@keyframes shopPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(180,83,9,.45); } 50% { box-shadow: 0 0 0 8px rgba(180,83,9,0); } }
.shop-now { animation: shopPulse 2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .shop-now { animation: none; } }
`;

// Hand-drawn station icons (48 × 48, stroke only, so they recolor with `color`).
function StationIcon({ station, size = 34, color = BROWN }) {
  const p = { fill: 'none', stroke: color, strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  let body;
  switch (station) {
    case 'paperwork':
      body = (<>
        <rect x="11" y="9" width="26" height="33" rx="3" {...p} />
        <rect x="18" y="5" width="12" height="7" rx="2" {...p} />
        <path d="M17 21h14M17 28h14M17 35h8" {...p} />
      </>);
      break;
    case 'cut': {
      // Saw blade: a toothed ring around an arbor hole.
      const teeth = Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const b = a + Math.PI / 12;
        return `${24 + 18 * Math.cos(a)},${24 + 18 * Math.sin(a)} ${24 + 13 * Math.cos(b)},${24 + 13 * Math.sin(b)}`;
      }).join(' ');
      body = (<>
        <polygon points={teeth} {...p} />
        <circle cx="24" cy="24" r="4" {...p} />
      </>);
      break;
    }
    case 'build':
      body = (<>
        <rect x="8" y="10" width="32" height="30" rx="2" {...p} />
        <path d="M24 10v30M8 40l-2 4M40 40l2 4" {...p} />
        <path d="M20 22v6M28 22v6" {...p} />
      </>);
      break;
    case 'finish':
      // Paint brush.
      body = (<>
        <path d="M30 6l8 8-12 12-8-8z" {...p} />
        <path d="M18 18l-4 4c-3 3-3 6-1 8l3 3c2 2 5 2 8-1l4-4" {...p} />
        <path d="M14 30c-4 2-6 6-6 12 6 0 10-2 12-6" {...p} />
      </>);
      break;
    case 'assemble':
      // Hinge: two leaves and a knuckle, with screw holes.
      body = (<>
        <rect x="6" y="12" width="16" height="24" rx="2" {...p} />
        <rect x="26" y="12" width="16" height="24" rx="2" {...p} />
        <rect x="21" y="10" width="6" height="28" rx="3" {...p} />
        <circle cx="14" cy="18" r="1.8" {...p} /><circle cx="14" cy="30" r="1.8" {...p} />
        <circle cx="34" cy="18" r="1.8" {...p} /><circle cx="34" cy="30" r="1.8" {...p} />
      </>);
      break;
    default:
      // Truck.
      body = (<>
        <rect x="4" y="13" width="25" height="20" rx="2" {...p} />
        <path d="M29 19h8l7 7v7H29z" {...p} />
        <circle cx="13" cy="36" r="4" {...p} fill="#fff" /><circle cx="36" cy="36" r="4" {...p} fill="#fff" />
      </>);
  }
  return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">{body}</svg>;
}

// The shop floor as a line of stations, each with how many jobs are there now. Tapping one lists those jobs.
function ProductionLine({ counts, selected, onSelect }) {
  return (
    <div className="shop-line" role="group" aria-label="Production line">
      <div className="shop-belt" />
      {STATIONS.map((s, i) => {
        const on = selected === s.key;
        return (
          <button key={s.key} type="button" className="shop-station" aria-pressed={on} onClick={() => onSelect(on ? null : s.key)} title={`${s.label}: ${counts[s.key]} job${counts[s.key] === 1 ? '' : 's'}`}>
            <span className="shop-disc"><StationIcon station={s.key} color={on ? '#fff' : BROWN} /></span>
            <span className={`shop-count${counts[s.key] ? '' : ' zero'}`}>{counts[s.key]}</span>
            <span className="shop-step-num">STEP {i + 1}</span>
            <span className="shop-station-label">{s.short}</span>
          </button>
        );
      })}
    </div>
  );
}

// Six dots for a job card: green done, amber where it is now, grey still to come.
function MiniFlow({ job }) {
  const { stations } = jobStations(job);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0' }} aria-label="Progress through the shop">
      {stations.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && <div style={{ width: '14px', height: '3px', background: s.state === 'todo' ? '#e5e7eb' : '#86efac' }} />}
          <div
            title={`${s.label}: ${s.state === 'done' ? 'done' : s.state === 'now' ? 'here now' : 'to come'}`}
            style={{
              width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: s.state === 'done' ? '#dcfce7' : s.state === 'now' ? '#fef3c7' : '#f3f4f6',
              border: `2px solid ${s.state === 'done' ? '#86efac' : s.state === 'now' ? AMBER : '#e5e7eb'}`,
            }}
          >
            <StationIcon station={s.key} size={14} color={s.state === 'done' ? GREEN : s.state === 'now' ? AMBER : GREY} />
          </div>
        </div>
      ))}
    </div>
  );
}

const cardBtn = { display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '14px 16px', cursor: 'pointer', font: 'inherit', boxShadow: '0 1px 2px rgba(0,0,0,.04)' };

function JobRow({ job, onOpen }) {
  const { current } = jobStations(job);
  const station = STATIONS.find((s) => s.key === current);
  const visit = nextVisit(job);
  return (
    <button type="button" onClick={() => onOpen(job.id)} style={cardBtn}>
      <div style={{ fontSize: '19px', fontWeight: '700', color: '#111827', marginBottom: '8px', wordBreak: 'break-word' }}>{job.name || job.jobRef}</div>
      <MiniFlow job={job} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: '8px', fontSize: '15px', color: '#44403c' }}>
        <span>{station ? <>Now: <strong>{station.label}</strong></> : <strong style={{ color: GREEN }}>All done</strong>}</span>
        {visit && <span>{visit.kind}: <strong>{fmtDate(visit.on, visit.text)}</strong></span>}
        {job.paintColor && <span>Color: <strong>{job.paintColor}</strong></span>}
      </div>
    </button>
  );
}

// One job as a vertical process flow: every station with its step boxes, then the facts the bench needs.
function JobDetail({ job, onBack, onStep }) {
  const { stations, other } = jobStations(job);
  const [busy, setBusy] = useState(null); // the step being saved
  const [err, setErr] = useState('');
  const canTick = Boolean(job.rowId);

  async function toggle(step, done) {
    if (!canTick || busy) return;
    setBusy(step); setErr('');
    try { await onStep(job, step, done); } catch (e) { setErr(`Could not save "${step}". Try again. (${e.message})`); } finally { setBusy(null); }
  }

  const stepButton = (st) => {
    const saving = busy === st.name;
    const tick = job.stepTicks?.[st.name];
    return (
      <button
        key={st.name}
        type="button"
        onClick={() => toggle(st.name, !st.done)}
        disabled={!canTick || Boolean(busy)}
        aria-pressed={st.done}
        title={tick?.by ? `Ticked here by ${tick.by}` : st.done ? 'Ticked on the shop sheet' : 'Tap when this step is finished'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px', minHeight: '44px', padding: '8px 14px', borderRadius: '999px',
          fontSize: '16px', fontWeight: 600, cursor: canTick ? 'pointer' : 'default', fontFamily: 'inherit',
          background: st.done ? '#dcfce7' : '#fff', color: st.done ? '#166534' : '#44403c',
          border: `2px solid ${st.done ? '#86efac' : '#d6d3d1'}`, opacity: saving ? 0.6 : 1,
        }}
      >
        <span aria-hidden="true" style={{ width: '22px', height: '22px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: st.done ? GREEN : '#fff', border: `2px solid ${st.done ? GREEN : '#a8a29e'}`, color: '#fff', fontSize: '15px', lineHeight: 1 }}>{st.done ? '✓' : ''}</span>
        {saving ? 'Saving…' : st.name}
      </button>
    );
  };

  // Who last ticked a step of this station here, if anyone: "Body Cut ticked by Morris Ng, Nov 17".
  const lastTick = (steps) => {
    const t = steps.map((st) => ({ name: st.name, ...(job.stepTicks?.[st.name] ?? {}) })).filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!t) return null;
    const when = new Date(t.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${t.name} ${t.done ? 'ticked' : 'unticked'} by ${t.by ?? 'someone'}, ${when}`;
  };
  const facts = [
    ['Paint / stain', job.paintColor],
    ['PVC tape', job.pvcTapeColor],
    ['Paint arrives', fmtDate(job.paintArrives?.on, job.paintArrives?.text)],
    ['Doors arrive', fmtDate(job.doorsArrive?.on, job.doorsArrive?.text)],
  ].filter(([, v]) => v);
  const visits = (job.installs ?? []).flatMap((e) => [
    (e.deliveryOn || e.deliveryText) && { kind: 'Delivery', when: fmtDate(e.deliveryOn, e.deliveryText), note: e.details, completed: e.completed },
    (e.installOn || e.installText) && { kind: 'Install', when: fmtDate(e.installOn, e.installText), note: e.details, completed: e.completed },
  ]).filter(Boolean);
  const hardware = job.hardware ?? [];

  const box = { background: '#fff', border: '1px solid #e7e5e4', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px' };
  const h3 = { margin: '0 0 10px', fontSize: '17px', color: BROWN };

  return (
    <div>
      <button type="button" onClick={onBack} style={{ background: 'none', border: 0, color: BROWN, fontSize: '17px', fontWeight: '700', padding: '8px 0', cursor: 'pointer', minHeight: '44px' }}>‹ Back</button>
      <h2 style={{ margin: '0 0 2px', fontSize: '26px', color: '#111827', wordBreak: 'break-word' }}>{job.name || job.jobRef}</h2>
      {!job.isTemp && <div style={{ fontSize: '15px', color: '#78716c', marginBottom: '14px' }}>Job {job.jobRef}</div>}

      {(facts.length > 0 || visits.length > 0) && (
        <div style={box}>
          <h3 style={h3}>Key details</h3>
          <div style={{ display: 'grid', gap: '8px' }}>
            {visits.map((v, i) => (
              <div key={`v${i}`} style={{ display: 'flex', gap: '12px', fontSize: '17px', opacity: v.completed ? 0.55 : 1 }}>
                <span style={{ color: '#78716c', minWidth: '120px' }}>{v.kind}</span>
                <strong style={{ color: '#111827' }}>{v.when}{v.completed ? ' ✓ done' : ''}{v.note ? <span style={{ fontWeight: 400, color: '#78716c' }}> · {v.note}</span> : null}</strong>
              </div>
            ))}
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: '12px', fontSize: '17px' }}>
                <span style={{ color: '#78716c', minWidth: '120px' }}>{k}</span>
                <strong style={{ color: '#111827', wordBreak: 'break-word' }}>{v}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={box}>
        <h3 style={{ ...h3, marginBottom: '4px' }}>Where it is in the shop</h3>
        {canTick && <p style={{ margin: '0 0 12px', fontSize: '15px', color: '#57534e' }}>Tap a step when it is finished. Tap it again to undo.</p>}
        {err && <p role="alert" style={{ margin: '0 0 12px', fontSize: '15px', color: '#b91c1c', fontWeight: 600 }}>{err}</p>}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {stations.map((s, i) => {
            const last = i === stations.length - 1;
            const ring = s.state === 'done' ? '#86efac' : s.state === 'now' ? AMBER : '#e5e7eb';
            const fill = s.state === 'done' ? '#dcfce7' : s.state === 'now' ? '#fef3c7' : '#fafaf9';
            const ink = s.state === 'done' ? GREEN : s.state === 'now' ? AMBER : GREY;
            return (
              <li key={s.key} style={{ display: 'flex', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div className={s.state === 'now' ? 'shop-now' : undefined} style={{ width: '52px', height: '52px', borderRadius: '50%', background: fill, border: `3px solid ${ring}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <StationIcon station={s.key} size={28} color={ink} />
                  </div>
                  {!last && <div style={{ width: '4px', flex: 1, minHeight: '16px', background: s.state === 'done' ? '#86efac' : '#e5e7eb' }} />}
                </div>
                <div style={{ paddingBottom: last ? 0 : '14px', paddingTop: '4px', flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '17px', fontWeight: '700', color: s.state === 'todo' ? '#78716c' : '#111827' }}>
                    {s.label}
                    {s.state === 'done' && <span style={{ color: GREEN, fontWeight: 600 }}> ✓</span>}
                    {s.state === 'now' && <span style={{ marginLeft: '8px', fontSize: '13px', padding: '2px 8px', borderRadius: '999px', background: AMBER, color: '#fff' }}>HERE NOW</span>}
                  </div>
                  {s.steps.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                      {s.steps.map(stepButton)}
                    </div>
                  )}
                  {lastTick(s.steps) && <div style={{ fontSize: '13px', color: '#78716c', marginTop: '6px' }}>{lastTick(s.steps)}</div>}
                  {s.key === 'out' && visits.length === 0 && <div style={{ fontSize: '14px', color: '#78716c', marginTop: '4px' }}>No date set yet</div>}
                </div>
              </li>
            );
          })}
        </ol>
        {other.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
            {other.map(stepButton)}
          </div>
        )}
      </div>

      {hardware.length > 0 && (
        <div style={box}>
          <h3 style={h3}>Hardware</h3>
          {hardware.map((o, i) => {
            const received = o.receivedOn || o.receivedText || /^\s*received/i.test(o.status ?? '');
            return (
              <div key={o.id ?? i} style={{ borderTop: i ? '1px solid #f5f5f4' : 0, paddingTop: i ? '10px' : 0, marginTop: i ? '10px' : 0 }}>
                <div style={{ fontSize: '14px', color: '#78716c', marginBottom: '6px' }}>
                  Ordered {fmtDate(o.orderedOn, o.orderedText, { month: 'short', day: 'numeric', year: 'numeric' }) || '(no date)'}
                  {received && <span style={{ color: GREEN, fontWeight: 600 }}> · Received ✓</span>}
                  {o.photoUrl && <> · <a href={o.photoUrl} target="_blank" rel="noopener noreferrer" style={{ color: AMBER }}>Photo</a></>}
                </div>
                {o.parts.map((p, k) => (
                  <div key={p.id ?? k} style={{ display: 'flex', gap: '10px', fontSize: '17px', padding: '3px 0' }}>
                    <strong style={{ minWidth: '36px', textAlign: 'right', color: '#111827' }}>{p.qty ?? '–'}</strong>
                    <span style={{ color: '#292524' }}>{p.name}</span>
                  </div>
                ))}
                {o.notes && <div style={{ fontSize: '15px', color: '#57534e', marginTop: '4px' }}>Note: {o.notes}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ShopView({ jobs, onJobChange }) {
  const today = todayIso();
  const [query, setQuery] = useState('');
  const [station, setStation] = useState(null);
  const [openId, setOpenId] = useState(null);

  const active = useMemo(() => [...activeJobs(jobs, today)].reverse(), [jobs, today]);
  const counts = useMemo(() => stationCounts(active), [active]);
  const week = useMemo(() => weekDays(jobs, today).filter((d) => d.items.length), [jobs, today]);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...jobs].reverse().filter((j) => `${j.name} ${j.jobRef}`.toLowerCase().includes(q)).slice(0, 8);
  }, [jobs, query]);

  // Saves a tick and updates the loaded job, so the screen changes without reloading every job.
  async function setStep(job, step, done) {
    const r = await fetch('/api/admin-settings?resource=production&action=step-set', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ rowId: job.rowId, step, done }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Status ${r.status}`);
    onJobChange(job.id, (old) => {
      const steps = { ...old.steps, [step]: j.tick.done };
      // cleared: the box is back to what the sheet says, so nothing ticked here remains for this step.
      const stepTicks = { ...(old.stepTicks ?? {}) };
      if (j.tick.cleared) delete stepTicks[step]; else stepTicks[step] = { by: j.tick.by, at: j.tick.at, done: j.tick.done };
      return {
        ...old, steps, stepTicks,
        stepsDone: Object.values(steps).filter((v) => v === true).length,
      };
    });
  }

  const open = (id) => { setOpenId(id); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openJob = openId && jobs.find((j) => j.id === openId);
  const h2 = { margin: '22px 0 10px', fontSize: '20px', color: BROWN };

  if (openJob) return (<><style>{css}</style><JobDetail job={openJob} onBack={() => setOpenId(null)} onStep={setStep} /></>);

  const listed = station ? active.filter((j) => jobStations(j).current === station) : active;
  const stationLabel = STATIONS.find((s) => s.key === station)?.label;

  return (
    <div>
      <style>{css}</style>
      <input
        type="search"
        placeholder="Find a job — type a name"
        aria-label="Find a job"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: '18px', border: '2px solid #d6d3d1', borderRadius: '12px', outline: 'none', marginBottom: '14px' }}
      />
      {query.trim() && (
        <div style={{ display: 'grid', gap: '10px', marginBottom: '8px' }}>
          {found.length === 0 && <p style={{ fontSize: '17px', color: '#57534e' }}>No job called “{query.trim()}”.</p>}
          {found.map((j) => <JobRow key={j.id} job={j} onOpen={open} />)}
        </div>
      )}

      {!query.trim() && (
        <>
          <h2 style={{ ...h2, marginTop: '4px' }}>The shop right now</h2>
          <ProductionLine counts={counts} selected={station} onSelect={setStation} />
          <p style={{ fontSize: '15px', color: '#57534e', margin: '8px 2px 0' }}>Tap a step to see the jobs at it. The number is how many jobs are there, going by the boxes ticked on the shop sheet.</p>

          <h2 style={h2}>Going out this week</h2>
          {week.length === 0 && <p style={{ fontSize: '17px', color: '#57534e' }}>Nothing scheduled in the next 7 days.</p>}
          <div style={{ display: 'grid', gap: '10px' }}>
            {week.map((d) => {
              const isToday = d.date === today;
              return (
                <div key={d.date} style={{ background: '#fff', border: `2px solid ${isToday ? BROWN : '#e7e5e4'}`, borderRadius: '12px', padding: '12px 16px' }}>
                  <div style={{ fontSize: '17px', fontWeight: '700', color: isToday ? BROWN : '#292524', marginBottom: '6px' }}>{isToday ? 'Today' : fmtDate(d.date, null, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                  {d.items.map((it, i) => (
                    <button key={i} type="button" onClick={() => open(it.jobId)} style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left', background: 'none', border: 0, borderTop: i ? '1px solid #f5f5f4' : 0, padding: '10px 0', cursor: 'pointer', font: 'inherit', minHeight: '48px', opacity: it.completed ? 0.55 : 1 }}>
                      <StationIcon station={it.kind === 'Install' ? 'build' : 'out'} size={30} />
                      <span style={{ fontSize: '17px', color: '#111827' }}><strong>{it.kind}</strong> · {it.jobName}{it.completed ? ' ✓' : ''}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <h2 style={h2}>{station ? `At “${stationLabel}” (${listed.length})` : `Jobs in the shop (${listed.length})`}</h2>
          {station && <button type="button" onClick={() => setStation(null)} style={{ background: 'none', border: 0, color: BROWN, fontSize: '16px', fontWeight: '700', padding: '0 0 10px', cursor: 'pointer' }}>Show all jobs</button>}
          {listed.length === 0 && <p style={{ fontSize: '17px', color: '#57534e' }}>No jobs here right now.</p>}
          <div style={{ display: 'grid', gap: '10px' }}>
            {listed.map((j) => <JobRow key={j.id} job={j} onOpen={open} />)}
          </div>
        </>
      )}
    </div>
  );
}
