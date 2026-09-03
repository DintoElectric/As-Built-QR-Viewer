// Pure logic shared by the workspace and the drawing viewer.
// Kept side-effect free so it can be unit-tested and reused.

// Floor is derived from the panel designation — the digit before the first
// hyphen (`EHLP4-2` -> Level 4). Anything unparseable is "Other".
export function floorOf(name) {
  const m = String(name).match(/(\d)-/);
  return m ? 'Level ' + m[1] : 'Other';
}

// Sheet floor is the digit in the sheet id (`E35-03B` -> Level 3). Used ONLY
// for the "off-floor" (↗) label, never to filter which sheets a panel links to.
export function sheetFloor(id) {
  const m = String(id).match(/-0?(\d)[A-Z]$/);
  return m ? 'Level ' + m[1] : 'Other';
}

// A panel links to EVERY sheet carrying a J-box tag that names it, regardless
// of floor. 21 legitimate cross-floor links exist in the OML data — do not
// filter by floor here.
export function linkedSheets(sheets, panel) {
  if (!panel) return [];
  return sheets.filter((s) => s.jboxes.some((b) => b.panel === panel));
}

// J-boxes on a sheet fed from a panel, as raw placements (may repeat a label
// at different positions — every printed instance gets highlighted).
export function boxPlacements(sheet, panel) {
  if (!sheet || !panel) return [];
  return sheet.jboxes.filter((b) => b.panel === panel);
}

// Counts must agree everywhere: dedupe BY LABEL, never by raw array length.
// 606 placements exist for 543 distinct boxes because some tags print twice.
export function distinctLabels(placements) {
  return [...new Set(placements.map((b) => b.label))];
}

export function breaker(c) {
  return c.amps ? c.amps + 'A/' + (c.poles || 1) + 'P' : '';
}

export function isSpare(c) {
  return /^SPARE$/i.test(c.desc || '');
}

// `tab` provenance: an .xlsx filename means the Panelboards/ folder; anything
// else is a worksheet tab in the OML workbook.
export function sourceLabel(panel) {
  if (!panel) return '';
  return /\.xlsx$/i.test(panel.tab || '')
    ? 'Panelboards/' + panel.tab
    : 'Panel Schedules (OML) · tab ' + panel.tab;
}

export const FLOOR_ORDER = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Other'];

// Natural sort so JB-2 sorts before JB-10.
export function naturalSort(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
