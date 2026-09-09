#!/usr/bin/env python3
"""
Extract J-box tag positions from branch-conduit sheets and merge them into
public/data/drawings.json as the `jboxes` array per sheet. Companion to
extract_panel_callouts.py (which fills the `panels` array).

A J-box tag is any text item shaped `JB-<box>-<panel>(<ckts>)` whose <panel>
part matches a known panel designation from panels.json. The <box> may be a
number (JB-290), a number+letter (JB-226A), or a placeholder (JB-***, JB-?)
on as-builts where boxes aren't numbered yet — all are kept. Matching <panel>
against the real panel set is what separates a J-box tag from other JB- text.

By default this only fills sheets that don't yet have jboxes (safe/additive).
Pass --all to regenerate every sheet from its PDF.

    python3 scripts/extract_jboxes.py            # only sheets missing jboxes
    python3 scripts/extract_jboxes.py --all      # regenerate all sheets

Sheet id is taken from the PDF filename stem (E35-05A.pdf -> E35-05A). A sheet
entry is created if missing (title "Branch conduit — sheet 05A").
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

strip_par = re.compile(r'\s*\(([^)]*)\)\s*$')

def main():
    regen_all = '--all' in sys.argv
    names = sorted({p['panel'] for p in json.load(open(PANELS))['panels']}, key=len, reverse=True)

    def extract(path):
        pg = fitz.open(path)[0]
        W, H = pg.rect.width, pg.rect.height
        out = []
        for b in pg.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    t = s['text'].strip()
                    if not t.startswith('JB-') or '(' not in t:
                        continue
                    m = strip_par.search(t)
                    if not m:
                        continue
                    base = strip_par.sub('', t).strip()
                    panel = next((pn for pn in names if base.endswith('-' + pn)), None)
                    if not panel:
                        continue
                    x0, y0, x1, y1 = s['bbox']
                    out.append({
                        'label': t, 'jb': base[:-(len(panel) + 1)], 'panel': panel,
                        'ckts': [c.strip() for c in m.group(1).split(',') if c.strip()],
                        'x': round(x0 / W, 5), 'y': round(y1 / H, 5),
                        'w': round((x1 - x0) / W, 5), 'h': round((y1 - y0) / H, 5),
                    })
        return int(W), int(H), out

    data = json.load(open(DRAWINGS))
    by_id = {s['id']: s for s in data['sheets']}
    for path in sorted(glob.glob(os.path.join(PDF_DIR, '*.pdf'))):
        sid = os.path.splitext(os.path.basename(path))[0]
        sheet = by_id.get(sid)
        if sheet and sheet.get('jboxes') and not regen_all:
            continue
        W, H, jb = extract(path)
        if not sheet:
            tag = sid.split('-')[-1]
            sheet = {'id': sid, 'title': f'Branch conduit — sheet {tag}',
                     'source': f'Yale_OML-BRANCH-E35_{tag}.pdf', 'pdfW': W, 'pdfH': H,
                     'jboxes': [], 'panels': []}
            data['sheets'].append(sheet)
        sheet['jboxes'] = jb
        sheet['pdfW'], sheet['pdfH'] = W, H
        print(f'{sid}: {len(jb)} jboxes')

    data['sheets'].sort(key=lambda s: s['id'])
    json.dump(data, open(DRAWINGS, 'w'))
    print(f'{len(data["sheets"])} sheets in {os.path.relpath(DRAWINGS, ROOT)}')

if __name__ == '__main__':
    main()
