# Dinto As-Builts — QR drawing access

A public, no-login web app for reaching as-built branch-conduit drawings by QR
code. A scan resolves to one panel; from there a field tech reads the circuit
schedule, searches circuits across the job, and opens the linked drawings with
that panel's J-boxes highlighted on the sheet.

Built from the Claude Design handoff (`design_handoff_asbuilt_qr`) against real
Yale OML data: **134 panel schedules (3,480 circuits)** and **9 branch conduit
sheets (606 tag placements, 543 per-sheet distinct box labels)**.

Stack: **Vite + React**, `pdfjs-dist` for vector rendering, Phosphor icons.
No backend — both JSON files are fetched once on load and everything else is
derived. The app is read-only by design; a field discrepancy is reported, never
corrected in place.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
npm run preview    # serve the production build
```

## Deploy: GitHub → Netlify

I can't push to your accounts, so these are the steps to take it live.

**1. Create the GitHub repo and push:**
```bash
git init
git add .
git commit -m "As-Built QR drawing access — initial build from design handoff"
git branch -M main
git remote add origin https://github.com/<you>/dinto-asbuilts.git
git push -u origin main
```

**2. Connect Netlify:** In Netlify → *Add new site → Import an existing project*
→ pick the repo. Build settings are already in `netlify.toml`:
- Build command: `npm run build`
- Publish directory: `dist`

Netlify auto-detects these, so you can accept the defaults. The included
`netlify.toml` also sets the SPA fallback so the `/p/{job}-{panel}` QR route
resolves, and adds `X-Robots-Tag: noindex`.

**3. Custom domain (optional):** point `asbuilt.dintoelectric.com` at the
Netlify site to match the printed-label URL shape below.

## QR / printed-label URLs

The printed panel label encodes:

```
asbuilt.dintoelectric.com/p/{job}-{panel}      e.g. /p/24118-LP2A
```

The route resolves the panel by matching the real schedule set (panel
designations contain hyphens, so it matches the full name first, then strips the
leading job token). Unknown or missing slugs land on the first panel.

## Before launch — one real decision

These are as-built electrical drawings for a medical building, and a public URL
is **permanently public**. The app ships truly open (no login, read-only) to
match the handoff. `noindex` keeps it out of search engines but does not gate
access. Confirm this is the intended access model before printing labels.

## What's faithful to the handoff (and why)

Three pieces are reusable logic, not just visual reference — a naive rebuild
reproduces a bug that took real iteration to find. All three are preserved:

- **Viewport-tile PDF rendering** (`src/DrawingViewer.jsx`). Three layers: a
  full-page 3000px backdrop cached as JPEG; a viewport tile re-rendered from the
  vector PDF over just the visible rectangle on every zoom/scroll (debounced,
  in-flight render cancelled, tile geometry cleared before each pass); and the
  SVG overlay. This is what keeps the sheet's own J-box labels legible at zoom.
- **Overlay alignment.** The overlay uses `preserveAspectRatio="none"` and an
  **unrounded** `viewBox` height (`1000 * pdfH / pdfW`). Either default —
  `xMidYMid meet` or a rounded height — letterboxes the overlay and drifts every
  highlight at Fit.
- **J-box highlighting.** The tags are stacked callout text, so the highlight is
  a box drawn over the printed label itself (glow + fill for the current panel,
  a faint outline for every other tag), sized in sheet units and scaled by
  `1/sqrt(zoom)`. No dot markers.

Counts everywhere dedupe **by label** (`new Set(...map(b => b.label)).size`),
never by raw array length — 606 placements exist for the per-sheet distinct box
totals because some tags print twice on a sheet. Sheet linking is by tag, never
by floor: 21 legitimate cross-floor links exist and off-floor sheets are marked
`↗`.

**Deliberately omitted:** conduit run-line tracing. The handoff has it built
then disabled — the parenthetical on a tag is a box tag, not a circuit number,
so a connecting line would imply a run the drawing does not state. Per-circuit
highlighting and run tracing return with the revised drawings (see the handoff's
*Deferred* section).

## Data

`public/data/panels.json` and `public/data/drawings.json` are the extracted
outputs from the handoff; `public/drawings/*.pdf` are the 9 source sheets (all
slated to be replaced). The extraction pipeline that produced the JSON is
documented in the handoff README under *Data model* — rebuild it server-side
when admin upload/tagging is added (currently offline). A useful ingest
invariant to keep: every J-box panel resolves to a schedule (0 orphans in the
current data).

## Layout notes

Desktop/tablet three-column workspace, full viewport, columns scroll
independently; full-sheet mode collapses to the drawing alone (`Esc` exits). The
mobile screens in the handoff are direction-setting mockups — this build degrades
gracefully to a stacked layout on narrow screens rather than implementing that
phone design, which the handoff defers.
