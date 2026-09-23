import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Minus, Plus, CornersOut, CornersIn } from '@phosphor-icons/react';
import { boxPlacements, distinctLabels, sheetFloor, floorOf, naturalSort } from './lib/schedule';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const docCache = new Map();
const imgCache = new Map();
const BACKDROP_W = 3000;
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
function getDoc(id) {
  if (!docCache.has(id)) { docCache.set(id, pdfjsLib.getDocument('/drawings/' + id + '.pdf').promise); }
  return docCache.get(id);
}
export default function DrawingViewer({ sheet, panel, selCircuit, linked, sheetId, onPickSheet, full, onToggleFull, location, circuitLive }) {
  const [zoom, setZoom] = useState(1);
  const [, forceTick] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [printMenu, setPrintMenu] = useState(false);
  const [printImg, setPrintImg] = useState(null);
  const [printing, setPrinting] = useState(false);
  const scrollRef = useRef(null);
  const wrapRef = useRef(null);
  const tileRef = useRef(null);
  const tileTask = useRef(null);
  const tileBusy = useRef(false);
  const tileTimer = useRef(null);
  const zoomRef = useRef(1);
  const pendingAnchor = useRef(null);
  const id = sheet ? sheet.id : null;
  const imgKey = id ? id + '@' + BACKDROP_W : null;
  const img = imgKey ? imgCache.get(imgKey) : null;
  const hasImg = !!img && img !== 'error';
  const clearTile = useCallback(() => {
    const cv = tileRef.current; if (!cv) return;
    cv.width = 0; cv.height = 0;
    Object.assign(cv.style, { left: '0px', top: '0px', width: '0px', height: '0px' });
  }, []);
  const renderTile = useCallback(async () => {
    const sc = scrollRef.current; const cv = tileRef.current; const wrap = wrapRef.current;
    if (!sc || !cv || !wrap || tileBusy.current || !id || !hasImg) return;
    clearTile();
    const wr = wrap.getBoundingClientRect(); const sr = sc.getBoundingClientRect();
    const dispW = wrap.clientWidth; const dispH = wrap.clientHeight;
    if (!dispW || !dispH) return;
    const vx = Math.max(0, sr.left - wr.left); const vy = Math.max(0, sr.top - wr.top);
    const vw = Math.min(dispW - vx, sr.width); const vh = Math.min(dispH - vy, sr.height);
    if (vw < 20 || vh < 20) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cw = Math.round(vw * dpr); let ch = Math.round(vh * dpr);
    const cap = 6e6; const f = Math.sqrt(cap / (cw * ch));
    if (f < 1) { cw = Math.round(cw * f); ch = Math.round(ch * f); }
    tileBusy.current = true;
    try {
      if (tileTask.current) { try { tileTask.current.cancel(); } catch (e) { /* superseded */ } }
      const doc = await getDoc(id); const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const k = cw / vw; const scale = (dispW / base.width) * k;
      const vp = page.getViewport({ scale });
      cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
      tileTask.current = page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -vx * k, -vy * k] });
      await tileTask.current.promise;
      Object.assign(cv.style, { left: vx + 'px', top: vy + 'px', width: vw + 'px', height: vh + 'px', opacity: 1 });
    } catch (e) { /* render superseded or cancelled */ }
    tileBusy.current = false;
  }, [id, hasImg, clearTile]);
  const queueTile = useCallback(() => {
    clearTimeout(tileTimer.current); clearTile();
    tileTimer.current = setTimeout(renderTile, 130);
  }, [renderTile, clearTile]);
  useEffect(() => {
    if (!id || imgCache.has(imgKey)) { if (id) queueTile(); return; }
    let cancelled = false; setRendering(true);
    (async () => {
      try {
        const doc = await getDoc(id); const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: BACKDROP_W / base.width });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (cancelled) return;
        imgCache.set(imgKey, c.toDataURL('image/jpeg', 0.92));
        c.width = 0; c.height = 0;
      } catch (e) { imgCache.set(imgKey, 'error'); }
      if (!cancelled) { setRendering(false); forceTick((n) => n + 1); }
    })();
    return () => { cancelled = true; };
  }, [id, imgKey, queueTile]);
  useEffect(() => { if (hasImg) queueTile(); }, [zoom, id, full, hasImg, queueTile]);
  useEffect(() => () => clearTimeout(tileTimer.current), []);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    if (a && scrollRef.current) {
      scrollRef.current.scrollLeft = a.left; scrollRef.current.scrollTop = a.top;
      pendingAnchor.current = null;
    }
  }, [zoom]);
  useEffect(() => {
    const well = scrollRef.current; if (!well) return undefined;
    const clamp = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    const anchorTo = (cur, next, cx, cy) => {
      const rect = well.getBoundingClientRect();
      const mx = cx - rect.left, my = cy - rect.top;
      if (cur > 1) {
        const r = next / cur;
        pendingAnchor.current = { left: (well.scrollLeft + mx) * r - mx, top: (well.scrollTop + my) * r - my };
      } else {
        const imgEl = wrapRef.current && wrapRef.current.querySelector('img');
        if (imgEl) {
          const ir = imgEl.getBoundingClientRect();
          const fx = Math.min(1, Math.max(0, (cx - ir.left) / ir.width));
          const fy = Math.min(1, Math.max(0, (cy - ir.top) / ir.height));
          const contentW = next * well.clientWidth; const contentH = contentW * (ir.height / ir.width);
          pendingAnchor.current = { left: fx * contentW - mx, top: fy * contentH - my };
        }
      }
      setZoom(next);
    };
    const onWheel = (e) => {
      if (!e.ctrlKey) return; e.preventDefault();
      const cur = zoomRef.current; const next = clamp(cur * Math.exp(-e.deltaY * 0.0018));
      if (next !== cur) anchorTo(cur, next, e.clientX, e.clientY);
    };
    let pinchDist = 0, pinchZoom = 1;
    const twoDist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    const onTouchStart = (e) => { if (e.touches.length === 2) { pinchDist = twoDist(e.touches); pinchZoom = zoomRef.current; } };
    const onTouchMove = (e) => {
      if (e.touches.length !== 2 || !pinchDist) return; e.preventDefault();
      const cur = zoomRef.current; const next = clamp(pinchZoom * (twoDist(e.touches) / pinchDist));
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      if (next !== cur) anchorTo(cur, next, cx, cy);
    };
    const onTouchEnd = (e) => { if (e.touches.length < 2) pinchDist = 0; };
    well.addEventListener('wheel', onWheel, { passive: false });
    well.addEventListener('touchstart', onTouchStart, { passive: true });
    well.addEventListener('touchmove', onTouchMove, { passive: false });
    well.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      well.removeEventListener('wheel', onWheel); well.removeEventListener('touchstart', onTouchStart);
      well.removeEventListener('touchmove', onTouchMove); well.removeEventListener('touchend', onTouchEnd);
    };
  }, [id, hasImg]);
  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5));
  const zoomFit = () => {
    clearTile();
    if (scrollRef.current) { scrollRef.current.scrollLeft = 0; scrollRef.current.scrollTop = 0; }
    setZoom(1);
  };
  const fit = zoom === 1;
  const zoomLabel = Math.round(zoom * 100) + '%';
  const overlay = sheet ? buildOverlay(sheet, panel, selCircuit, zoom, hasImg, circuitLive) : null;
  const placements = boxPlacements(sheet, panel);
  const labelCount = distinctLabels(placements).length;
  const circuitCount = selCircuit ? distinctLabels(placements.filter((b) => (b.circuits || []).includes(selCircuit))).length : 0;
  const offFloor = sheet ? sheetFloor(sheet.id) !== floorOf(panel) : false;
  const panelHere = sheet ? (sheet.panels || []).some((p) => p.panel === panel) : false;
  const hlLabels = sheet ? (selCircuit ? distinctLabels(placements.filter((b) => (b.circuits || []).includes(selCircuit))) : distinctLabels(placements)).sort(naturalSort) : [];
  const note = sheet
    ? (selCircuit
        ? `Circuit ${selCircuit} of ${panel}: ${circuitCount} of ${labelCount} J-box${labelCount === 1 ? '' : 'es'} on this sheet carr${circuitCount === 1 ? 'ies' : 'y'} it, highlighted.`
        : (labelCount === 0 && panelHere
            ? `${panel} is drawn on this sheet — its callout is boxed. No J-boxes on this sheet are tagged to it.`
            : `${labelCount} J-box tag${labelCount === 1 ? '' : 's'} name ${panel}, boxed on the sheet` +
              (offFloor ? ` (${sheetFloor(sheet.id).toLowerCase()} sheet ↗)` : '') +
              '. Parentheses are box tags, not circuits.' +
              (panelHere ? ` Panel ${panel} is drawn on this sheet — its callout is boxed.` : '')))
    : '';
  const PRINT_SIZES = { letter: [11, 8.5], '11x17': [17, 11], '24x36': [36, 24], '36x48': [48, 36] };
  const doPrint = async (key) => {
    setPrintMenu(false);
    if (!id || printing) return;
    const dim = PRINT_SIZES[key] || PRINT_SIZES.letter;
    let styleEl = document.getElementById('dp-page-size');
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'dp-page-size'; document.head.appendChild(styleEl); }
    styleEl.textContent = `@page { size: ${dim[0]}in ${dim[1]}in; margin: 0.5in; }`;
    setPrinting(true);
    let hires = null;
    try {
      const doc = await getDoc(id); const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const targetW = Math.max(4000, Math.min(8000, Math.round(dim[0] * 170)));
      const vp = page.getViewport({ scale: targetW / base.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      hires = c.toDataURL('image/jpeg', 0.9);
      c.width = 0; c.height = 0;
      await new Promise((res) => { const im = new Image(); im.onload = res; im.onerror = res; im.src = hires; });
    } catch (e) { hires = null; }
    setPrintImg(hires);
    document.body.classList.add('mode-print-drawing');
    const done = () => {
      document.body.classList.remove('mode-print-drawing');
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      setPrintImg(null); setPrinting(false);
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
    setTimeout(done, 120000);
  };
  return (
    <div className="viewer">
      <div className="viewer-head">
        <span className="eyebrow">Sheet</span>
        <div className="sheet-chips">
          {linked.map((s) => {
            const off = sheetFloor(s.id) !== floorOf(panel);
            const n = distinctLabels(s.jboxes.filter((b) => b.panel === panel)).length;
            return (
              <button key={s.id} className="fbtn" data-on={sheet && s.id === sheet.id ? '1' : '0'} onClick={() => onPickSheet(s.id)} title={s.title}>
                {s.id}{off ? ' ↗' : ''} <span style={{ color: 'var(--color-muted)' }}>· {n > 0 ? n + ' JB' : 'callout'}</span>
              </button>
            );
          })}
        </div>
        <div className="viewer-tools">
          <button className="btn btn-ghost icon" onClick={zoomOut} aria-label="Zoom out" disabled={!hasImg}><Minus size={14} weight="bold" /></button>
          <span className="mono zoom-read">{zoomLabel}</span>
          <button className="btn btn-ghost icon" onClick={zoomIn} aria-label="Zoom in" disabled={!hasImg}><Plus size={14} weight="bold" /></button>
          <button className="btn btn-ghost fit" onClick={zoomFit} disabled={!hasImg}>Fit</button>
          <span className="print-wrap">
            <button className="btn btn-ghost fit" onClick={() => setPrintMenu((v) => !v)} disabled={!hasImg || printing} title="Print / export this drawing with highlights">{printing ? 'Preparing…' : 'Print ▾'}</button>
            {printMenu && (
              <>
                <div className="print-menu-backdrop" onClick={() => setPrintMenu(false)} />
                <div className="print-menu">
                  <div className="print-menu-h">Print size</div>
                  <button onClick={() => doPrint('letter')}>Letter (8.5 × 11)</button>
                  <button onClick={() => doPrint('11x17')}>11 × 17</button>
                  <button onClick={() => doPrint('24x36')}>24 × 36 · ARCH D</button>
                  <button onClick={() => doPrint('36x48')}>36 × 48 · ARCH E</button>
                </div>
              </>
            )}
          </span>
          <button className="fbtn full-toggle" data-on={full ? '1' : '0'} onClick={onToggleFull}>
            {full ? <CornersIn size={14} /> : <CornersOut size={14} />} {full ? 'Exit full sheet' : 'Full sheet'}
          </button>
        </div>
      </div>
      {sheet ? (
        <div className="viewer-body">
          <div className="canvas-well scrolly" ref={scrollRef} onScroll={queueTile}>
            <div className="zoom-frame" style={fit ? { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10, width: '100%', height: '100%' } : { width: Math.round(zoom * 100) + '%', minWidth: '100%' }}>
              {hasImg ? (
                <div ref={wrapRef} style={fit ? { position: 'relative', background: '#fff', height: '100%', width: 'auto', display: 'inline-block', lineHeight: 0 } : { position: 'relative', background: '#fff' }}>
                  <img src={img} alt={sheet.title} style={fit ? { height: '100%', width: 'auto', display: 'block' } : { width: '100%', display: 'block' }} />
                  <canvas key={'tile@' + zoom} ref={tileRef} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }} />
                  {overlay}
                </div>
              ) : (
                <div className="rendering">{img === 'error' ? 'Could not load this sheet.' : 'Rendering sheet…'}</div>
              )}
            </div>
          </div>
          <div className="viewer-foot scrolly">
            <div style={{ minWidth: 0 }}>
              <div className="foot-note">{note}</div>
              <div className="mono foot-src">{sheet.source}{rendering ? ' · rendering…' : ''}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="gridpaper empty-well">
          <div className="empty-msg">
            {location ? (
              <><span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>Located</span><br />{location}<br /><span style={{ fontSize: 11, color: 'var(--color-faint)' }}>Not drawn on a loaded branch sheet.</span></>
            ) : (
              <>No drawing for this panel.<br />{panel} isn't tagged on a J-box or drawn as a callout on any loaded sheet.</>
            )}
          </div>
        </div>
      )}
      {sheet && hasImg && createPortal(
        <div className="drawing-print">
          <div className="dp-detail">
            <img className="dp-logo" src="/dinto-logo.png" alt="Dinto" />
            <div className="dp-lines">
              <div><b>Sheet</b> {sheet.id} — {sheet.title}</div>
              <div><b>Panel</b> {panel}</div>
              <div><b>Circuit filter</b> {selCircuit ? ('Circuit ' + selCircuit) : "None — all of this panel's J-boxes"}</div>
              <div><b>Highlighted J-boxes ({hlLabels.length})</b> {hlLabels.join(', ') || '—'}</div>
            </div>
          </div>
          <div className="dp-canvas-wrap">
            <div className="dp-canvas" style={{ aspectRatio: sheet.pdfW + '/' + sheet.pdfH }}>
              <img src={printImg || img} alt={sheet.title} />
              {buildOverlay(sheet, panel, selCircuit, 1, true, circuitLive)}
            </div>
          </div>
          <div className="dp-foot">REFERENCE ONLY — NOT A SAFE-TO-WORK DETERMINATION. Verify de-energization per NFPA 70E before working. Paul Dinto Electrical Contractors.</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
function buildOverlay(sheet, panel, selCircuit, zoom, hasImg, circuitLive) {
  const h = 1000 * sheet.pdfH / sheet.pdfW;
  const k = Math.sqrt(zoom || 1);
  const others = []; const dimmed = []; const hits = [];
  sheet.jboxes.forEach((b, i) => {
    const x = 1000 * b.x; const y = h * (b.y - b.h); const w = 1000 * b.w; const bh = h * b.h;
    if (b.panel === panel) {
      if (!selCircuit || (b.circuits || []).includes(selCircuit)) { hits.push({ i, x, y, w, bh }); }
      else {
        const pad = 1.0 / k;
        dimmed.push(<rect key={'d' + i} x={x - pad} y={y - pad} width={w + 2 * pad} height={bh + 2 * pad} rx={1.5} fill="none" stroke="rgba(145,132,217,.28)" strokeWidth={0.8 / k} />);
      }
    } else {
      const pad = 0.9 / k;
      others.push(<rect key={'o' + i} x={x - pad} y={y - pad} width={w + 2 * pad} height={bh + 2 * pad} rx={1.5} fill="none" stroke="rgba(89,93,108,.35)" strokeWidth={0.7 / k} />);
    }
  });
  const hitEls = [];
  hits.forEach(({ i, x, y, w, bh }) => {
    const p = 1.6 / k; const bx = x - p, by = y - p, bw = w + 2 * p, bhh = bh + 2 * p;
    hitEls.push(<rect key={'g' + i} x={bx - p} y={by - p} width={bw + 2 * p} height={bhh + 2 * p} rx={3} fill="rgba(145,132,217,.22)" />);
    hitEls.push(<rect key={'h' + i} x={bx} y={by} width={bw} height={bhh} rx={2} fill="rgba(145,132,217,.16)" stroke="#9184d9" strokeWidth={1.6 / k} />);
  });
  const panelEls = [];
  (sheet.panels || []).forEach((pnl, i) => {
    const x = 1000 * pnl.x; const y = h * (pnl.y - pnl.h); const w = 1000 * pnl.w; const bh = h * pnl.h;
    if (pnl.panel === panel) {
      const p = 2.2 / k; const bx = x - p, by = y - p, bw = w + 2 * p, bhh = bh + 2 * p;
      panelEls.push(<rect key={'pg' + i} x={bx - 1.6 * p} y={by - 1.6 * p} width={bw + 3.2 * p} height={bhh + 3.2 * p} rx={3.5} fill="rgba(145,132,217,.20)" />);
      panelEls.push(<rect key={'ph' + i} x={bx} y={by} width={bw} height={bhh} rx={2.5} fill="rgba(145,132,217,.34)" stroke="#b7aef2" strokeWidth={2.2 / k} />);
    } else {
      const pad = 1.1 / k;
      panelEls.push(<rect key={'po' + i} x={x - pad} y={y - pad} width={w + 2 * pad} height={bh + 2 * pad} rx={2} fill="none" stroke="rgba(145,132,217,.22)" strokeWidth={0.8 / k} />);
    }
  });
  // Circuit numbers under each J-box callout — live = red, dead = green (per the
  // panel's circuit status). White halo keeps them legible over the drawing.
  const LIVE = '#e5484d', DEAD = '#137a2e';
  const cktTexts = [];
  if (circuitLive) {
    sheet.jboxes.forEach((b, i) => {
      if (b.panel !== panel) return;      // only the selected panel's J-boxes
      const cks = b.circuits || [];
      if (!cks.length) return;
      const x = 1000 * b.x;
      const fs = Math.max(h * b.h * 0.82, 1.4);
      const ty = h * b.y + h * b.h * 1.25;
      cktTexts.push(
        <text key={'ct' + i} x={x} y={ty} fontSize={fs} fontFamily="Arial, Helvetica, sans-serif"
          style={{ paintOrder: 'stroke' }} stroke="#ffffff" strokeWidth={fs * 0.18} strokeLinejoin="round">
          {cks.flatMap((c, j) => {
            const num = <tspan key={'n' + j} dx={j ? fs * 0.3 : 0} fill={circuitLive(b.panel, c) ? LIVE : DEAD}>{c}</tspan>;
            return j ? [<tspan key={'c' + j} fill="#333333">,</tspan>, num] : [num];
          })}
        </text>
      );
    });
  }
  return (
    <svg viewBox={'0 0 1000 ' + h} preserveAspectRatio={hasImg ? 'none' : 'xMidYMid meet'} style={hasImg ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : { width: '100%', display: 'block' }}>
      {others}{dimmed}{hitEls}{panelEls}{cktTexts}
    </svg>
  );
}
