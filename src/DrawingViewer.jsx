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

export default function DrawingViewer({ sheet, panel, selCircuit, linked, sheetId, onPickSheet, full, onToggleFull }) {
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

  // Backdrop: render the full page once to a 3000px canvas, cache
