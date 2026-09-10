import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import DrawingViewer from './DrawingViewer';
import {
  floorOf, sheetFloor, linkedSheets, boxPlacements, distinctLabels,
  breaker, isSpare, sourceLabel, FLOOR_ORDER, naturalSort,
} from './lib/schedule';

// A QR slug is `{job}-{panel}` (e.g. 24118-LP2A, or 224166-EHLP1-1). Panel
// designations themselves contain hyphens, so resolve against the real panel
// set: exact match first, then strip the leading job token.
function panelFromSlug(slug, panels) {
  if (!slug) return null;
  const names = new Set(panels.map((p) => p.panel));
  const decoded = decodeURIComponent(slug);
  if (names.has(decoded)) return decoded;
  const cut = decoded.indexOf('-');
  if (cut > 0) {
    const rest = decoded.slice(cut + 1);
    if (names.has(rest)) return rest;
  }
  return null;
}

export default function App() {
  const { slug } = useParams();
  const [panels, setPanels] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [selCircuit, setSelCircuit] = useState(null); // circuit filter: highlight only boxes carrying it
  const [floor, setFloor] = useState('All');
  const [sheetId, setSheetId] = useState(null);
  const [full, setFull] = useState(false);

  // Load both JSON files once; everything else is derived. No write path.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('data/panels.json').then((r) => r.json()),
      fetch('data/drawings.json').then((r) => r.json()),
    ]).then(([pd, dd]) => {
      if (!alive) return;
      setPanels(pd.panels);
      setSheets(dd.sheets);
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Resolve the QR-scanned panel once data is in; otherwise land on the first.
  useEffect(() => {
    if (!panels.length || sel) return;
    setSel(panelFromSlug(slug, panels) || panels[0].panel);
  }, [panels, slug, sel]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && full) setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const totalCircuits = useMemo(() => panels.reduce((s, p) => s + p.circuits.length, 0), [panels]);

  const inFloor = (p) => floor === 'All' || floorOf(p.panel) === floor;
  const presentFloors = FLOOR_ORDER.filter((g) => panels.some((p) => floorOf(p.panel) === g));

  const panel = panels.find((p) => p.panel === sel) || null;
  const linked = linkedSheets(sheets, sel);
  const sheet = linked.find((s) => s.id === sheetId) || linked[0] || null;

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

  // Selecting a panel clears the query and trace, and resets the sheet choice.
  const selectPanel = (name) => { setSel(name); setQ(''); setPick(null); setSelCircuit(null); setSheetId(null); };
  // A search hit selects the panel, opens its circuit detail, AND filters to that circuit.
  const openResult = (r) => {
    setSel(r.panel); setQ(''); setSheetId(null);
    setPick({ tag: r.panel + ' · ckt ' + r.n, desc: r.desc, bk: r.bk });
    setSelCircuit(r.n != null ? String(r.n) : null);
  };
  // Toggle the circuit filter from a schedule row.
  const toggleCircuit = (c) => {
    const cn = String(c.n);
    if (selCircuit === cn) { setSelCircuit(null); setPick(null); }
    else { setSelCircuit(cn); setPick({ tag: panel.panel + ' · ckt ' + c.n, desc: c.desc, bk: breaker(c) }); }
  };

  const placements = boxPlacements(sheet, sel);
  const hitLabels = distinctLabels(placements).sort(naturalSort);
  // Boxes on the current sheet that carry the selected circuit for this panel.
  const circuitLabels = (sheet && selCircuit)
    ? distinctLabels(placements.filter((b) => (b.circuits || []).includes(selCircuit))).sort(naturalSort)
    : [];

  const oddRows = panel ? panel.circuits.filter((c) => c.n % 2 === 1) : [];
  const evenRows = panel ? panel.circuits.filter((c) => c.n % 2 === 0) : [];
  const spareCount = panel ? panel.circuits.filter(isSpare).length : 0;

  const gridCols = full ? 'minmax(0,1fr)' : '196px 300px minmax(0,1fr)';

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">Dinto <span className="wordmark-2">As-Builts</span></span>
        <span className="tag tag-neutral">Public link · no sign-in</span>
        <input
          className="input search"
          placeholder={panels.length ? `Search ${totalCircuits.toLocaleString()} circuits — try REFRIGERATOR, RTU, 324A` : 'Search circuits'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search circuits"
        />
        {!loaded && <span className="status">loading schedules…</span>}
      </header>

      <div className="grid" style={{ gridTemplateColumns: gridCols }}>
        {/* Column 1 — panel list */}
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
                      <span className="mono" style={{ fontSize: 13 }}>{p.panel}</span>
                      <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-muted)' }}>{p.circuits.length}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>
        )}

        {/* Column 2 — schedule / search results */}
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

                {hitLabels.length > 0 && (
                  <div className="jbox-block">
                    <div className="eyebrow" style={{ marginBottom: 7 }}>J-boxes fed from this panel · {hitLabels.length}</div>
                    <div className="mono jbox-list scrolly">
                      {hitLabels.map((label) => <span key={label}>{label}</span>)}
                    </div>
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

        {/* Column 3 — drawing viewer */}
        <DrawingViewer
          sheet={sheet}
          panel={sel}
          selCircuit={selCircuit}
          linked={linked}
          sheetId={sheet ? sheet.id : null}
          onPickSheet={setSheetId}
          full={full}
          onToggleFull={() => setFull((v) => !v)}
        />
      </div>
    </div>
  );
}
