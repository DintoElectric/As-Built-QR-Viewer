#!/usr/bin/env python3
"""
Extract panel callout positions from the branch-conduit sheets and merge them
into public/data/drawings.json as a `panels` array per sheet (same coordinate
schema as `jboxes`: normalized x/y/w/h, y = text baseline/bottom).

A panel callout is a text item that, after stripping a trailing parenthetical
suffix like " (OS)" / " (LS)" / " (OS-LAB)", exactly equals a known panel
designation from panels.json. That rule keeps real callouts (EPP2-5 (OS)) and
excludes J-box tags (JB-290-MP2-2(1) -> JB-290-MP2-2, not a panel).

Re-run this whenever the drawings are replaced:
    python3 scripts/extract_panel_callouts.py

Requires: pymupdf  (pip install pymupdf)
"""
import json, re, glob, os, sys
try:
    import pymupdf as fitz
except ImportError:
    import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANELS = os.path.join(ROOT, 'public/data/panels.json')
DRAWINGS = os.path.join(ROOT, 'public/data/drawings.json')
PDF_DIR = os.path.join(ROOT, 'public/drawings')

strip_paren = re.compile(r'\s*\([^)]*\)\s*$')

def main():
    names = {p['panel'] for p in json.load(open(PANELS))['panels']}

    def panel_of(text):
        t = text.strip()
        if t in names:
            return t
        base = strip_paren.sub('', t).strip()
        return base if base in names else None

    by_sheet = {}
    for path in sorted(glob.glob(os.path.join(PDF_DIR, '*.pdf'))):
        sid = os.path.splitext(os.path.basename(path))[0]
        pg = fitz.open(path)[0]
        W, H = pg.rect.width, pg.rect.height
        out = []
        for b in pg.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    pn = panel_of(s['text'])
                    if not pn:
                        continue
                    x0, y0, x1, y1 = s['bbox']
                    out.append({
                        'panel': pn,
                        'raw': s['text'].strip(),
                        'x': round(x0 / W, 5), 'y': round(y1 / H, 5),
                        'w': round((x1 - x0) / W, 5), 'h': round((y1 - y0) / H, 5),
                    })
        by_sheet[sid] = out
        print(f'{sid}: {len(out)} panel callouts')

    data = json.load(open(DRAWINGS))
    for sheet in data['sheets']:
        sheet['panels'] = by_sheet.get(sheet['id'], [])
    json.dump(data, open(DRAWINGS, 'w'))
    total = sum(len(v) for v in by_sheet.values())
    print(f'merged {total} callouts into {os.path.relpath(DRAWINGS, ROOT)}')

if __name__ == '__main__':
    main()
