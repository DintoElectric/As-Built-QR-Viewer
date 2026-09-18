import { useMemo, useState } from 'react';

// Admin-only full-screen editor for the J-box -> circuits mapping. Lists every
// J-box on the loaded sheets (deduped by label), lets an admin fill/edit the
// circuits each box carries, saves to the shared overrides store (so the drawing
// highlights + circuit filter update everywhere), and prints a clean table.
// The circuits shown are the EFFECTIVE values (static drawings.json merged with
// any admin overrides) — so edits persist and read back here.

const FLOOR_LABEL = { 1: 'Level 1', 2: 'Level 2', 3: 'Level 3', 4: 'Level 4', 5: 'Level 5' };

function floorOfSheet(id) {
  const m = /-0?(\d)[A-C]$/.exec(id || '');
  return m ? Number(m[1]) : 0;
}
function jbNum(jb) {
  const m = /(\d+)/.exec(jb || '');
  return m ? Number(m[1]) : 99999;
}

export default function JboxEditor({ sheets, onSave, onClose }) {
  const [q, setQ] = useState('');
  const [floor, setFloor] = useState('All');
  const [edits, setEdits] = useState({});       // label -> in-progress circuits string
  const [savingLabel, setSavingLabel] = useState(null);
  const [onlyBlank, setOnlyBlank] = useState(false);

  // Flatten + dedupe J-boxes by label across all sheets.
  const rows = useMemo(() => {
    const byLabel = {};
    (sheets || []).forEach((s) => {
      const fl = floorOfSheet(s.id);
      (s.jboxes || []).forEach((b) => {
        const e = byLabel[b.label] || {
          label: b.label, jb: b.jb, panel: b.panel,
          tag: (b.ckts || []).join(','), circuits: (b.circuits || []).join(','),
          sheets: new Set(), floor: fl,
        };
        e.sheets.add(s.id);
        if ((b.circuits || []).length && !e.circuits) e.circuits = b.circuits.join(',');
        byLabel[b.label] = e;
      });
    });
    return Object.values(byLabel)
      .map((e) => ({ ...e, sheets: [...e.sheets].sort().join(', ') }))
      .sort((a, b) => (a.floor - b.floor) || a.panel.localeCompare(b.panel) || (jbNum(a.jb) - jbNum(b.jb)) || a.jb.localeCompare(b.jb));
  }, [sheets]);

  const floors = useMemo(() => [...new Set(rows.map((r) => r.floor))].filter(Boolean).sort(), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return rows.filter((r) => {
      if (floor !== 'All' && r.floor !== floor) return false;
      if (onlyBlank && (edits[r.label] != null ? edits[r.label].trim() : r.circuits)) return false;
      if (!needle) return true;
      return (r.jb + ' ' + r.panel + ' ' + r.tag + ' ' + r.circuits).toUpperCase().includes(needle);
    });
  }, [rows, q, floor, onlyBlank, edits]);

  const filledCount = rows.filter((r) => (edits[r.label] != null ? edits[r.label].trim() : r.circuits)).length;

  const setEdit = (label, val) => setEdits((p) => ({ ...p, [label]: val }));
  const valueOf = (r) => (edits[r.label] != null ? edits[r.label] : r.circuits);
  const dirty = (r) => edits[r.label] != null && edits[r.label].trim() !== r.circuits;

  const save = async (r) => {
    const arr = valueOf(r).split(',').map((x) => x.trim()).filter(Boolean);
    setSavingLabel(r.label);
    try {
      await onSave(r.label, arr);
      setEdits((p) => { const n = { ...p }; delete n[r.label]; return n; }); // reflect saved (merged) value
    } catch { /* parent surfaces errors */ }
    setSavingLabel(null);
  };

  // group shown rows by panel for both screen + print
  const groups = useMemo(() => {
    const g = [];
    let cur = null;
    shown.forEach((r) => {
      if (!cur || cur.panel !== r.panel || cur.floor !== r.floor) { cur = { panel: r.panel, floor: r.floor, items: [] }; g.push(cur); }
      cur.items.push(r);
    });
    return g;
  }, [shown]);

  return (
    <>
      <div className="jbox-editor">
        <div className="jbe-bar">
          <span className="jbe-title">J-box circuit editor</span>
          <span className="jbe-count">{filledCount} of {rows.length} filled · {shown.length} shown</span>
          <input className="input jbe-search" placeholder="Search J-box, panel, circuit…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="jbe-chips">
            <button className="fbtn" data-on={floor === 'All' ? '1' : '0'} onClick={() => setFloor('All')}>All</button>
            {floors.map((f) => (
              <button key={f} className="fbtn" data-on={floor === f ? '1' : '0'} onClick={() => setFloor(f)}>L{f}</button>
            ))}
            <button className="fbtn" data-on={onlyBlank ? '1' : '0'} onClick={() => setOnlyBlank((v) => !v)} title="Show only J-boxes with no circuits yet">Blanks</button>
          </div>
          <span className="jbe-actions">
            <button className="btn btn-secondary" onClick={() => window.print()}>Print</button>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </span>
        </div>

        <div className="jbe-body scrolly">
          <div className="jbe-hint">Circuits are comma-separated (e.g. <b>1,3,5</b>). Saving updates the shared record and the drawing highlights. Clearing a field reverts it to the imported value.</div>
          {groups.map((g) => (
            <div key={g.floor + '·' + g.panel} className="jbe-group">
              <div className="jbe-ghead">{FLOOR_LABEL[g.floor] || ('Level ' + g.floor)} · {g.panel} <span>· {g.items.length}</span></div>
              <div className="jbe-head"><span>J-box</span><span>Tag #</span><span>Circuits</span><span>Sheet(s)</span><span /></div>
              {g.items.map((r) => (
                <div key={r.label} className={'jbe-row' + (valueOf(r).trim() ? '' : ' blank')}>
                  <span className="mono jbe-jb">{r.jb}</span>
                  <span className="mono jbe-tag">{r.tag}</span>
                  <input className="einput jbe-ckt" value={valueOf(r)} placeholder="— none —"
                    onChange={(e) => setEdit(r.label, e.target.value)} inputMode="numeric" />
                  <span className="mono jbe-sheets">{r.sheets}</span>
                  {dirty(r)
                    ? <button className="btn btn-primary esave" disabled={savingLabel === r.label} onClick={() => save(r)}>{savingLabel === r.label ? '…' : 'Save'}</button>
                    : <span />}
                </div>
              ))}
            </div>
          ))}
          {!shown.length && <div className="status" style={{ padding: 20 }}>No J-boxes match.</div>}
        </div>
      </div>

      {/* Print-only clean table of the currently shown rows */}
      <div className="jbox-print">
        <div className="jbp-title">Dinto As-Builts — J-box circuits{floor === 'All' ? '' : ' · ' + (FLOOR_LABEL[floor] || 'Level ' + floor)}</div>
        <table className="jbp-table">
          <thead><tr><th>J-box</th><th>Panel</th><th>Tag #</th><th>Circuits</th><th>Sheet(s)</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.label}>
                <td>{r.jb}</td><td>{r.panel}</td><td>{r.tag}</td>
                <td>{valueOf(r)}</td><td>{r.sheets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
