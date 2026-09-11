import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import DrawingViewer from './DrawingViewer';
import {
  floorOf, sheetFloor, linkedSheets, boxPlacements, distinctLabels,
  breaker, isSpare, sourceLabel, FLOOR_ORDER, naturalSort,
} from './lib/schedule';

const FN_LOGIN = '/.netlify/functions/admin-login';
const FN_OVR = '/.netlify/functions/overrides';

// Shown at the bottom at all times. Wording can be adjusted here.
const DISCLAIMER =
  'REFERENCE ONLY — NOT A SAFE-TO-WORK DETERMINATION. The live/dead indicator and all information shown may be inaccurate or out of date. Never rely on this application to determine whether a panel is energized. Always verify de-energization by lockout/tagout and appropriate testing before working. Paul Dinto Electrical Contractors assumes no liability for any reliance on this application.';

// A QR slug is `{job}-{panel}` (e.g. 24118-LP2A). Panel designations contain
// hyphens, so resolve against the real panel set: exact match, then strip job.
function panelFromSlug(slug, panels) {
  if (!slug) return null;
  const names = new Set(panels.map((p) => p.panel));
  const decoded = decodeURIComponent(slug);
  if (names.has(decoded)) return decoded;
  const cut = decoded.indexOf('-');
  if (cut > 0) { const rest = decoded.slice(cut + 1); if (names.has(rest)) return rest; }
  return null;
}

// Build two-column schedule rows (odd left, even right), merging multi-pole
// breakers across the rows they occupy — matches the printed panel-schedule.
function buildScheduleRows(circuits) {
  const byN = {}; circuits.forEach((c) => { byN[c.n] = c; });
  const maxN = circuits.length ? Math.max(...circuits.map((c) => c.n)) : 0;
  const nRows = Math.ceil(maxN / 2);
  const side = (first) => {
    const cells = {}; let cn = first;
    while (cn <= maxN) {
      const c = byN[cn];
      if (c) {
        const p = c.poles || 1;
        cells[cn] = { kind: 'cell', span: p, c };
        for (let k = 1; k < p; k++) cells[cn + 2 * k] = { kind: 'covered' };
        cn += 2 * p;
      } else { if (!cells[cn]) cells[cn] = { kind: 'empty' }; cn += 2; }
    }
    return cells;
  };
  const L = side(1), R = side(2);
  const rows = [];
  for (let i = 0; i < nRows; i++) rows.push({ lc: 2 * i + 1, l: L[2 * i + 1], rc: 2 * i + 2, r: R[2 * i + 2] });
  return { rows, maxN };
}

function ScheduleCells({ cell }) {
  if (!cell || cell.kind === 'empty') return (<><td></td><td></td><td className="d"></td></>);
  if (cell.kind === 'covered') return null;
  const c = cell.c;
  return (<><td rowSpan={cell.span}>{c.poles || 1}</td><td rowSpan={cell.span}>{c.amps || ''}</td><td rowSpan={cell.span} className="d">{c.desc}</td></>);
}

export default function App() {
  const { slug } = useParams();
  const [rawPanels, setRawPanels] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Admin-editable overlay (statuses + circuit edits) shared via Netlify Blobs.
  const [overrides, setOverrides] = useState({ status: {}, circuits: {}, edited: {} });
  const [token, setToken] = useState(() => sessionStorage.getItem('adminToken') || '');
  const admin = !!token;
  const [loginOpen, setLoginOpen] = useState(false);
  const [code, setCode] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [selCircuit, setSelCircuit] = useState(null);
  const [floor, setFloor] = useState('All');
  const [sheetId, setSheetId] = useState(null);
  const [full, setFull] = useState(false);

  // Static base data.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/data/panels.json').then((r) => r.json()),
      fetch('/data/drawings.json').then((r) => r.json()),
    ]).then(([pd, dd]) => {
      if (!alive) return;
      setRawPanels(pd.panels); setSheets(dd.sheets); setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Shared overrides — loaded on mount and refreshed when the tab regains focus,
  // so the live/dead light stays current without a full reload.
  const refreshOverrides = () => {
    fetch(FN_OVR).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) setOverrides({ status: d.status || {}, circuits: d.circuits || {}, edited: d.edited || {} });
    }).catch(() => { /* backend not up yet — app still works read-only */ });
  };
  useEffect(() => {
    refreshOverrides();
    const onFocus = () => refreshOverrides();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && full) setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  // Merge circuit edits + edited "date typed" onto the static panels.
  const panels = useMemo(() => rawPanels.map((p) => {
    const ce = overrides.circuits[p.panel];
    const ed = overrides.edited[p.panel];
    if (!ce && !ed) return p;
    const circuits = ce ? p.circuits.map((c) => {
      const o = ce[String(c.n)];
      return o ? { ...c, desc: o.desc, amps: o.amps === '' ? '' : o.amps, poles: o.poles === '' ? '' : o.poles } : c;
    }) : p.circuits;
    const meta = ed ? { ...(p.meta || {}), date: ed } : p.meta;
    return { ...p, circuits, meta };
  }), [rawPanels, overrides]);

  const statusOf = (name) => !!(overrides.status[name] && overrides.status[name].live);
  const statusAt = (name) => (overrides.status[name] && overrides.status[name].at) || null;

  const totalCircuits = useMemo(() => panels.reduce((s, p) => s + p.circuits.length, 0), [panels]);
  const inFloor = (p) => floor === 'All' || floorOf(p.panel) === floor;
  const presentFloors = FLOOR_ORDER.filter((g) => panels.some((p) => floorOf(p.panel) === g));

  const panel = panels.find((p) => p.panel === sel) || null;
  const linked = linkedSheets(sheets, sel);
  const sheet = linked.find((s) => s.id === sheetId) || linked[0] || null;

  // Resolve the QR-scanned panel once data is in; otherwise land on the first.
  useEffect(() => {
    if (!panels.length || sel) return;
    setSel(panelFromSlug(slug, panels) || panels[0].panel);
  }, [panels, slug, sel]);

  const searching = q.trim().length >= 2;
  const results = useMemo(() => {
    if (!searching) return [];
    const needle = q.trim().toUpperCase();
    const out = [];
    panels.filter(inFloor).forEach((p) => p.circuits.forEach((c) => {
      if ((c.desc || '').toUpperCase().includes(needle) || p.panel.toUpperCase().includes(needle)) {
        out.push({ panel: p.panel, n: c.n, desc: c.desc, bk: breaker(c) });
      }
    }));
    return out;
  }, [q, searching, panels, floor]);

  const selectPanel = (name) => { setSel(name); setQ(''); setPick(null); setSelCircuit(null); setSheetId(null); };
  const openResult = (r) => {
    setSel(r.panel); setQ(''); setSheetId(null);
    setPick({ tag: r.panel + ' · ckt ' + r.n, desc: r.desc, bk: r.bk });
    setSelCircuit(r.n != null ? String(r.n) : null);
  };
  const toggleCircuit = (c) => {
    const cn = String(c.n);
    if (selCircuit === cn) { setSelCircuit(null); setPick(null); }
    else { setSelCircuit(cn); setPick({ tag: panel.panel + ' · ckt ' + c.n, desc: c.desc, bk: breaker(c) }); }
  };

  // ---- admin ----
  const doLogin = async () => {
    setBusy(true); setLoginErr('');
    try {
      const r = await fetch(FN_LOGIN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      const d = await r.json();
      if (d.ok && d.token) { sessionStorage.setItem('adminToken', d.token); setToken(d.token); setLoginOpen(false); setCode(''); }
      else setLoginErr(d.error || 'Wrong code');
    } catch { setLoginErr('Login unavailable — is the backend deployed?'); }
    setBusy(false);
  };
  const logout = () => { sessionStorage.removeItem('adminToken'); setToken(''); };
  const setStatus = async (live) => {
    if (!admin || !panel) return;
    setBusy(true);
    try {
      const r = await fetch(FN_OVR, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ action: 'setStatus', panel: panel.panel, live }),
      });
      if (r.status === 401) { logout(); setLoginErr('Session expired — log in again.'); }
      const d = await r.json().catch(() => null);
      if (d && d.data) setOverrides({ status: d.data.status || {}, circuits: d.data.circuits || {}, edited: d.data.edited || {} });
    } catch { /* ignore */ }
    setBusy(false);
  };

  const placements = boxPlacements(sheet, sel);
  const hitLabels = distinctLabels(placements).sort(naturalSort);
  const circuitLabels = (sheet && selCircuit)
    ? distinctLabels(placements.filter((b) => (b.circuits || []).includes(selCircuit))).sort(naturalSort)
    : [];

  const oddRows = panel ? panel.circuits.filter((c) => c.n % 2 === 1) : [];
  const evenRows = panel ? panel.circuits.filter((c) => c.n % 2 === 0) : [];
  const spareCount = panel ? panel.circuits.filter(isSpare).length : 0;
  const schedule = panel ? buildScheduleRows(panel.circuits) : { rows: [], maxN: 0 };

  const ensureQR = () => new Promise((resolve) => {
    if (window.QRCode) return resolve();
    const el = document.createElement('script');
    el.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    el.onload = resolve; el.onerror = resolve; document.head.appendChild(el);
  });
  const printSchedule = async () => {
    if (!panel) return;
    await ensureQR();
    const holder = document.getElementById('print-qr');
    if (holder && window.QRCode) {
      holder.innerHTML = '';
      new window.QRCode(holder, { text: window.location.origin + '/p/' + encodeURIComponent(panel.panel), width: 92, height: 92, correctLevel: window.QRCode.CorrectLevel.M });
    }
    setTimeout(() => window.print(), 250);
  };

  const gridCols = full ? 'minmax(0,1fr)' : '196px 300px minmax(0,1fr)';
  const live = panel ? statusOf(panel.panel) : false;

  return (
    <>
    <div className="app">
      <header className="topbar">
        <span className="wordmark">Dinto <span className="wordmark-2">As-Builts</span></span>
        <span className="tag tag-neutral">Public link · no sign-in</span>
        <input
          className="input search"
          placeholder={panels.length ? `Search ${totalCircuits.toLocaleString()} circuits — try REFRIGERATOR, RTU, 324A` : 'Search circuits'}
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search circuits"
        />
        {!loaded && <span className="status">loading schedules…</span>}
        <div className="admin-box">
          {admin ? (
            <><span className="tag tag-accent">Admin</span><button className="btn btn-ghost" onClick={logout}>Log out</button></>
          ) : loginOpen ? (
            <div className="admin-login">
              <input className="input" style={{ width: 110 }} type="password" inputMode="numeric" placeholder="Admin code"
                value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLogin()} autoFocus />
              <button className="btn btn-primary" onClick={doLogin} disabled={busy}>Enter</button>
              <button className="btn btn-ghost" onClick={() => { setLoginOpen(false); setLoginErr(''); }}>Cancel</button>
              {loginErr && <span className="status" style={{ color: '#e5484d' }}>{loginErr}</span>}
            </div>
          ) : (
            <button className="btn btn-secondary" onClick={() => setLoginOpen(true)}>Admin</button>
          )}
        </div>
      </header>

      <div className="grid" style={{ gridTemplateColumns: gridCols }}>
        {!full && (
          <aside className="col-panels scrolly">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Panels · {panels.filter(inFloor).length}</div>
            <div className="floor-chips">
              {['All', ...presentFloors].map((f) => (
                <button key={f} className="fbtn" data-on={f === floor ? '1' : '0'} onClick={() => setFloor(f)}>
                  {f === 'All' ? 'All' : f.replace('Level ', 'L')}
                </button>
              ))}
            </div>
            {FLOOR_ORDER.filter((g) => floor === 'All' || g === floor).map((g) => {
              const items = panels.filter((p) => floorOf(p.panel) === g);
              if (!items.length) return null;
              return (
                <div key={g} className="floor-group">
                  <div className="floor-head">{g}</div>
                  {items.map((p) => (
                    <button key={p.panel} className="pbtn" data-on={p.panel === sel ? '1' : '0'} onClick={() => selectPanel(p.panel)}>
                      <span className={'lamp ' + (statusOf(p.panel) ? 'on' : 'off')} title={statusOf(p.panel) ? 'Live' : 'Dead'} />
                      <span className="mono" style={{ fontSize: 13 }}>{p.panel}</span>
                      <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-muted)' }}>{p.circuits.length}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>
        )}

        {!full && (
          <section className="col-schedule scrolly">
            {searching ? (
              <div>
                <div className="eyebrow">Results for “{q.trim()}” · {results.length > 60 ? `${results.length} (showing 60)` : results.length}</div>
                <div className="result-list">
                  {results.slice(0, 60).map((r, i) => (
                    <button key={i} className="result" onClick={() => openResult(r)}>
                      <span className="mono" style={{ fontSize: 13, color: 'var(--color-accent)' }}>{r.panel} · {r.n ?? '—'}</span>
                      <span style={{ fontSize: 14 }}>{r.desc}</span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-2)', textAlign: 'right' }}>{r.bk}</span>
                    </button>
                  ))}
                  {!results.length && <div className="status" style={{ marginTop: 8 }}>No circuit or panel matches “{q.trim()}”.</div>}
                </div>
              </div>
            ) : panel ? (
              <div>
                <div className="scanned"><span className="scanned-dot" />Scanned · panel label</div>
                <div className="mono designation">{panel.panel}</div>
                <div className="source-line">{sourceLabel(panel)} · {panel.circuits.length} circuits scheduled · {spareCount} spare</div>

                {/* Live / dead status */}
                <div className={'status-bar ' + (live ? 'live' : 'dead')}>
                  <span className={'lamp big ' + (live ? 'on' : 'off')} />
                  <span className="status-text">{live ? 'LIVE — ENERGIZED' : 'DEAD — DE-ENERGIZED'}</span>
                  {statusAt(panel.panel) && <span className="status-since">set {new Date(statusAt(panel.panel)).toLocaleString()}</span>}
                  {admin && (
                    <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => setStatus(!live)}>
                      {live ? 'Mark DEAD' : 'Mark LIVE'}
                    </button>
                  )}
                </div>

                <div style={{ marginTop: 12 }}><button className="btn btn-secondary" onClick={printSchedule}>Export / print schedule (PDF)</button></div>

                {hitLabels.length > 0 && (
                  <div className="jbox-block">
                    <div className="eyebrow" style={{ marginBottom: 7 }}>J-boxes fed from this panel · {hitLabels.length}</div>
                    <div className="mono jbox-list scrolly">{hitLabels.map((label) => <span key={label}>{label}</span>)}</div>
                  </div>
                )}

                {pick && (
                  <div className="card elev-sm trace-card">
                    <div className="card-kicker">{pick.tag}{selCircuit ? ' · filtering boxes' : ' · traced'}</div>
                    <div style={{ fontSize: 14 }}>{pick.desc}</div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--color-text-2)' }}>{pick.bk}</div>
                    {selCircuit && (
                      <div style={{ fontSize: 12.5, color: 'var(--color-text-2)' }}>
                        {circuitLabels.length
                          ? `${circuitLabels.length} J-box${circuitLabels.length === 1 ? '' : 'es'} on circuit ${selCircuit}${sheet ? ' (this sheet)' : ''} highlighted.`
                          : `No J-box on this sheet carries circuit ${selCircuit}${placements.some((b) => b.circuits) ? '.' : ' — circuit data not entered for this panel yet.'}`}
                      </div>
                    )}
                    <div><button className="btn btn-ghost" onClick={() => { setPick(null); setSelCircuit(null); }}>{selCircuit ? 'Clear circuit filter' : 'Clear trace'}</button></div>
                  </div>
                )}

                <div className="ckt-cols">
                  {[oddRows, evenRows].map((rows, ci) => (
                    <div key={ci}>
                      <div className="chd"><span>Ckt</span><span>Description</span><span style={{ textAlign: 'right' }}>Breaker</span></div>
                      {rows.map((c) => {
                        const spare = isSpare(c);
                        const on = selCircuit === String(c.n);
                        return (
                          <button key={c.n} className="crow" onClick={() => toggleCircuit(c)}
                            style={on ? { background: 'var(--color-surface)', boxShadow: 'inset 0 0 0 1px var(--color-accent)' } : undefined}>
                            <span className="mono" style={{ fontSize: 13, color: spare ? 'var(--color-faint)' : 'var(--color-accent)' }}>{c.n}</span>
                            <span style={{ fontSize: 13.5, color: spare ? 'var(--color-muted)' : 'var(--color-text)' }}>{c.desc}</span>
                            <span className="mono" style={{ fontSize: 12, textAlign: 'right', color: 'var(--color-text-2)' }}>{breaker(c)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="status" style={{ marginTop: 20 }}>{loaded ? 'Select a panel.' : 'Loading…'}</div>
            )}
          </section>
        )}

        <DrawingViewer
          sheet={sheet} panel={sel} selCircuit={selCircuit} linked={linked}
          sheetId={sheet ? sheet.id : null} onPickSheet={setSheetId}
          full={full} onToggleFull={() => setFull((v) => !v)}
        />
      </div>
    </div>

    {/* Always-on safety disclaimer */}
    <div className="disclaimer">{DISCLAIMER}</div>

    {/* Print-only panel schedule (browser Print / Save-as-PDF). QR top-right. */}
    {panel && (
      <div className="print-schedule">
        <div className="ps-head">
          <img className="ps-logo" src="/dinto-logo.png" alt="Dinto Electrical Contractors" />
          <div className="ps-title">PANEL: {panel.panel}</div>
          <div className="ps-meta">
            <div>PANEL LOCATION: {panel.meta ? panel.meta.location : ''}</div>
            <div>DATE TYPED: {panel.meta ? panel.meta.date : ''}</div>
            <div className="sp">VOLTAGE:&nbsp; {panel.meta ? panel.meta.voltage : ''}</div>
            <div>PH/WIRE:&nbsp; {panel.meta ? panel.meta.phwire : ''}</div>
            <div>FED FROM: {panel.meta ? panel.meta.fedfrom : ''}</div>
          </div>
          <div id="print-qr" className="ps-qr" />
        </div>
        <table className="ps-table">
          <thead>
            <tr>
              <th>CKT#</th><th>Poles</th><th>Amps</th><th>Description</th>
              <th>CKT#</th><th>Poles</th><th>Amps</th><th>Description</th>
            </tr>
          </thead>
          <tbody>
            {schedule.rows.map((row, i) => (
              <tr key={i}>
                <td className="ckt">{row.lc <= schedule.maxN ? row.lc : ''}</td>
                <ScheduleCells cell={row.l} />
                <td className="ckt">{row.rc <= schedule.maxN ? row.rc : ''}</td>
                <ScheduleCells cell={row.r} />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ps-foot">
          <div>121 Turnpike Drive | Middlebury, CT 06762 | Tel: 203-575-9473</div>
          <div>DINTOELECTRIC.COM | CT State Electrical License #100760 | AA/EOE</div>
        </div>
      </div>
    )}
    </>
  );
}
