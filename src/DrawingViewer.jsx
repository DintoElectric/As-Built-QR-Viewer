import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Minus, Plus, CornersOut, CornersIn } from '@phosphor-icons/react';
import { boxPlacements, distinctLabels, sheetFloor, floorOf } from './lib/schedule';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Non-state caches — deliberately module-scoped so they survive re-renders and
// panel switches without re-rasterising: pdf.js documents keyed by sheet id,
// and the fit-level backdrop JPEG keyed `{id}@{width}`.
const docCache = new Map();
const imgCache = new Map();

const BACKDROP_W = 3000; // fit-level backdrop; the viewport tile carries zoom detail
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

function getDoc(id) {
  if (!docCache.has(id)) {
    docCache.set(id, pdfjsLib.getDocument('drawings/' + id + '.pdf').promise);
  }
  return docCache.get(id);
}

export default function DrawingViewer({ sheet, panel, linked, sheetId, onPickSheet, full, onToggleFull }) {
  const [zoom, setZoom] = useState(1);
  const [, forceTick] = useState(0);
  const [rendering, setRendering] = useState(false);

  const scrollRef = useRef(null);
  const wrapRef = useRef(null);
  const tileRef = useRef(null);
  const tileTask = useRef(null);
  const tileBusy = useRef(false);
  const tileTimer = useRef(null);

  const id = sheet ? sheet.id : null;
  const imgKey = id ? id + '@' + BACKDROP_W : null;
  const img = imgKey ? imgCache.get(imgKey) : null;
  const hasImg = !!img && img !== 'error';

  // The tile's geometry is set imperatively, so collapse it back to nothing
  // before every pass — a stale tile otherwise inflates the scroll area and
  // produces phantom scrollbars.
  const clearTile = useCallback(() => {
    const cv = tileRef.current;
    if (!cv) return;
    cv.width = 0;
    cv.height = 0;
    Object.assign(cv.style, { left: '0px', top: '0px', width: '0px', height: '0px' });
  }, []);

  // Bluebeam-style crispness: re-render only the VISIBLE region straight from
  // the vector PDF at the current zoom, so glyphs are never limited by a page
  // raster. Cancel any in-flight render before starting a new one.
  const renderTile = useCallback(async () => {
    const sc = scrollRef.current;
    const cv = tileRef.current;
    const wrap = wrapRef.current;
    if (!sc || !cv || !wrap || tileBusy.current || !id || !hasImg) return;
    clearTile();

    const wr = wrap.getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    const dispW = wrap.clientWidth;
    const dispH = wrap.clientHeight;
    if (!dispW || !dispH) return;

    const vx = Math.max(0, sr.left - wr.left);
    const vy = Math.max(0, sr.top - wr.top);
    const vw = Math.min(dispW - vx, sr.width);
    const vh = Math.min(dispH - vy, sr.height);
    if (vw < 20 || vh < 20) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cw = Math.round(vw * dpr);
    let ch = Math.round(vh * dpr);
    const cap = 6e6;
    const f = Math.sqrt(cap / (cw * ch));
    if (f < 1) { cw = Math.round(cw * f); ch = Math.round(ch * f); }

    tileBusy.current = true;
    try {
      if (tileTask.current) { try { tileTask.current.cancel(); } catch (e) { /* superseded */ } }
      const doc = await getDoc(id);
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const k = cw / vw;                       // canvas px per display px
      const scale = (dispW / base.width) * k;
      const vp = page.getViewport({ scale });
      cv.width = cw;
      cv.height = ch;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, ch);
      // pdf.js render offset places the visible rectangle at the canvas origin.
      tileTask.current = page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -vx * k, -vy * k] });
      await tileTask.current.promise;
      Object.assign(cv.style, { left: vx + 'px', top: vy + 'px', width: vw + 'px', height: vh + 'px', opacity: 1 });
    } catch (e) {
      /* render superseded or cancelled */
    }
    tileBusy.current = false;
  }, [id, hasImg, clearTile]);

  const queueTile = useCallback(() => {
    clearTimeout(tileTimer.current);
    clearTile();
    tileTimer.current = setTimeout(renderTile, 130);
  }, [renderTile, clearTile]);

  // Backdrop: render the full page once to a 3000px canvas, cache as JPEG.
  useEffect(() => {
    if (!id || imgCache.has(imgKey)) { if (id) queueTile(); return; }
    let cancelled = false;
    setRendering(true);
    (async () => {
      try {
        const doc = await getDoc(id);
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: BACKDROP_W / base.width });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (cancelled) return;
        imgCache.set(imgKey, c.toDataURL('image/jpeg', 0.92));
        c.width = 0;
        c.height = 0;
      } catch (e) {
        imgCache.set(imgKey, 'error');
      }
      if (!cancelled) { setRendering(false); forceTick((n) => n + 1); }
    })();
    return () => { cancelled = true; };
  }, [id, imgKey, queueTile]);

  // Re-tile on zoom / sheet / full-mode change.
  useEffect(() => { if (hasImg) queueTile(); }, [zoom, id, full, hasImg, queueTile]);

  useEffect(() => () => clearTimeout(tileTimer.current), []);

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5));
  const zoomFit = () => {
    clearTile();
    if (scrollRef.current) { scrollRef.current.scrollLeft = 0; scrollRef.current.scrollTop = 0; }
    setZoom(1);
  };

  const fit = zoom === 1;
  const zoomLabel = Math.round(zoom * 100) + '%';

  // ---- overlay geometry ----
  const overlay = sheet ? buildOverlay(sheet, panel, zoom, hasImg) : null;

  const placements = boxPlacements(sheet, panel);
  const labelCount = distinctLabels(placements).length;
  const offFloor = sheet ? sheetFloor(sheet.id) !== floorOf(panel) : false;
  const note = sheet
    ? `${labelCount} J-box tag${labelCount === 1 ? '' : 's'} name ${panel}, boxed on the sheet` +
      (offFloor ? ` (${sheetFloor(sheet.id).toLowerCase()} sheet ↗)` : '') +
      '. Parentheses are box tags, not circuits.'
    : '';

  return (
    <div className="viewer">
      <div className="viewer-head">
        <span className="eyebrow">Sheet</span>
        <div className="sheet-chips">
          {linked.map((s) => {
            const off = sheetFloor(s.id) !== floorOf(panel);
            const n = distinctLabels(s.jboxes.filter((b) => b.panel === panel)).length;
            return (
              <button
                key={s.id}
                className="fbtn"
                data-on={sheet && s.id === sheet.id ? '1' : '0'}
                onClick={() => onPickSheet(s.id)}
                title={s.title}
              >
                {s.id}{off ? ' ↗' : ''} <span style={{ color: 'var(--color-muted)' }}>· {n} JB</span>
              </button>
            );
          })}
        </div>
        <div className="viewer-tools">
          <button className="btn btn-ghost icon" onClick={zoomOut} aria-label="Zoom out" disabled={!hasImg}><Minus size={14} weight="bold" /></button>
          <span className="mono zoom-read">{zoomLabel}</span>
          <button className="btn btn-ghost icon" onClick={zoomIn} aria-label="Zoom in" disabled={!hasImg}><Plus size={14} weight="bold" /></button>
          <button className="btn btn-ghost fit" onClick={zoomFit} disabled={!hasImg}>Fit</button>
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
                <div
                  ref={wrapRef}
                  style={fit
                    ? { position: 'relative', background: '#fff', height: '100%', width: 'auto', display: 'inline-block', lineHeight: 0 }
                    : { position: 'relative', background: '#fff' }}
                >
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
            No drawing linked to this panel.<br />
            No J-box on the loaded sheets (E35-02/03/04 A–C) is tagged to it.
          </div>
        </div>
      )}
    </div>
  );
}

// The tags are stacked callout text, not symbol positions — so the highlight is
// a box drawn over the printed label itself, which lands on the text the user
// reads. Matching panel's boxes glow + fill; every other tag is a faint outline.
// No dot markers, no run lines (the parenthetical is a box tag, not a circuit).
function buildOverlay(sheet, panel, zoom, hasImg) {
  const h = 1000 * sheet.pdfH / sheet.pdfW; // do NOT round — rounding reintroduces the aspect drift
  const k = Math.sqrt(zoom || 1);           // keep boxes proportionate as the sheet magnifies
  const others = [];
  const hits = [];

  sheet.jboxes.forEach((b, i) => {
    // stored y is the text BASELINE, so subtract the height for the top edge
    const x = 1000 * b.x;
    const y = h * (b.y - b.h);
    const w = 1000 * b.w;
    const bh = h * b.h;
    if (b.panel === panel) {
      hits.push({ i, x, y, w, bh });
    } else {
      const pad = 0.9 / k;
      others.push(
        <rect key={'o' + i} x={x - pad} y={y - pad} width={w + 2 * pad} height={bh + 2 * pad} rx={1.5}
          fill="none" stroke="rgba(89,93,108,.35)" strokeWidth={0.7 / k} />
      );
    }
  });

  const hitEls = [];
  hits.forEach(({ i, x, y, w, bh }) => {
    const p = 1.6 / k;
    const bx = x - p, by = y - p, bw = w + 2 * p, bhh = bh + 2 * p;
    hitEls.push(
      <rect key={'g' + i} x={bx - p} y={by - p} width={bw + 2 * p} height={bhh + 2 * p} rx={3} fill="rgba(145,132,217,.22)" />
    );
    hitEls.push(
      <rect key={'h' + i} x={bx} y={by} width={bw} height={bhh} rx={2} fill="rgba(145,132,217,.16)" stroke="#9184d9" strokeWidth={1.6 / k} />
    );
  });

  return (
    <svg
      viewBox={'0 0 1000 ' + h}
      // The overlay box IS the image box, so stretch the viewBox to it exactly.
      // The default (meet) letterboxes on a sub-pixel aspect diff and shifts
      // every highlight — the alignment bug the handoff warns about.
      preserveAspectRatio={hasImg ? 'none' : 'xMidYMid meet'}
      style={hasImg ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : { width: '100%', display: 'block' }}
    >
      {others}
      {hitEls}
    </svg>
  );
}
