// Copyright (c) 2025 cmutnik
// Carrying a slicer project's print settings from the 3MF that was opened into the 3MF that is saved (Bambu Studio / OrcaSlicer
// projects, whose settings live in Metadata/*.config). Pure helpers; the page decides when to use them.
// EXPERIMENTAL: the files are copied byte for byte (except the filament colours, see below). Whether a given slicer accepts the result
// has to be checked in that slicer.

/**
 * Update the filament colours in a project_settings.config (JSON) so slot n shows the colour the parts in slot n have in the page.
 * Everything else in the file is left exactly as it was. `slotColors` is Map(slot -> '#RRGGBB').
 * Returns { text, changed: [slots], beyond: [slots that the project has no filament for] }.
 */
export function patchProjectSettings(text, slotColors) {
  const out = { text, changed: [], beyond: [] };
  let json;
  try { json = JSON.parse(text); } catch { return out; }
  if (!Array.isArray(json.filament_colour)) { out.beyond = [...slotColors.keys()]; return out; }
  for (const [slot, color] of slotColors) {
    if (slot < 1 || slot > json.filament_colour.length) { out.beyond.push(slot); continue; }
    if (String(json.filament_colour[slot - 1]).toUpperCase() !== color.toUpperCase()) { json.filament_colour[slot - 1] = color.toUpperCase(); out.changed.push(slot); }
  }
  if (out.changed.length) out.text = JSON.stringify(json, null, 4);               // Bambu Studio writes four-space JSON
  return out;
}

/** What the project is set up for, for the page: { printer, print, filaments } (any may be ''). */
export function describeProject(text) {
  try {
    const j = JSON.parse(text), one = v => (Array.isArray(v) ? v[0] : v) || '';
    return { printer: one(j.printer_settings_id), print: one(j.print_settings_id), filaments: Array.isArray(j.filament_colour) ? j.filament_colour.length : 0 };
  } catch { return { printer: '', print: '', filaments: 0 }; }
}
