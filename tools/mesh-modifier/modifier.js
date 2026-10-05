// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { parseMesh, MAX_TRIANGLES } from '../../shared/js/mesh-import.js';
import { loadFont, parseFont, populateFontSelect, FONTS } from '../../shared/js/fonts.js';
import { transformParts, buildGroup, partStats, boundsOfParts, flipPart, layFlatAngles, assignSlots, DEFAULT_COLOR } from './geometry.js';
import { buildTab, buildLabel, placeLabel, buildInfill, TAB_STYLES, TAB_SIDES } from './attach.js';
import { loadManifold, cutHole, cutText, splitModel } from './boolean3d.js';
import { repairPart, describeRepair } from './repair.js';
import { createHistory } from './history.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));

for (const s of TAB_STYLES) $('tabStyle').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));
for (const s of TAB_SIDES) $('tabSide').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));
populateFontSelect($('font'));

let source = null;         // { name, parts, stats }
let scale = [1, 1, 1];
let result = null;         // { group, meta, size }
let font = null, fontRequested = false;
let timer = null, framed = false, view = 'print', buildId = 0, engineReady = false;
const hist = createHistory(100);
/** Hole directions: the axis the hole runs along, which end it is drilled from, and the labels for its two position boxes. */
const HOLE_DIRECTIONS = {
  down: { axis: 'z', from: 1, a: 'Left / right (mm)', b: 'Front / back (mm)' },
  up: { axis: 'z', from: -1, a: 'Left / right (mm)', b: 'Front / back (mm)' },
  'x+': { axis: 'x', from: 1, a: 'Front / back (mm)', b: 'Height above the bed (mm)' },
  'x-': { axis: 'x', from: -1, a: 'Front / back (mm)', b: 'Height above the bed (mm)' },
  'y+': { axis: 'y', from: 1, a: 'Left / right (mm)', b: 'Height above the bed (mm)' },
  'y-': { axis: 'y', from: -1, a: 'Left / right (mm)', b: 'Height above the bed (mm)' },
};
let partsVersion = 0, restoring = false, commitTimer = null;

const round = (v, d = 2) => +v.toFixed(d);

async function selectFont() {
  $('status').textContent = 'Loading font...';
  try { font = await loadFont(FONTS[parseInt($('font').value, 10)].url); $('status').textContent = ''; }
  catch { font = null; $('status').textContent = 'Could not load the font (offline?). Try uploading a font file.'; }
  rebuild();
}
$('font').addEventListener('change', selectFont);
$('fontFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { font = parseFont(await f.arrayBuffer()); $('status').textContent = `Using ${f.name}`; rebuild(); }
  catch { $('status').textContent = 'Could not read that font file (WOFF2 is not supported).'; }
});

// ---------- loading ----------
async function load(file) {
  if (!file) return;
  $('status').textContent = `Reading ${file.name}...`;
  try {
    let parts = await parseMesh(file.name, await file.arrayBuffer());
    let stats = parts.map(partStats);
    const inside = stats.filter(x => x.volume < 0).length;                     // inside-out parts: faces point inwards
    if (inside) { parts = parts.map((p, i) => (stats[i].volume < 0 ? flipPart(p) : p)); stats = parts.map(partStats); }
    if (stats.reduce((s, x) => s + x.triangles, 0) > MAX_TRIANGLES) throw new Error('That model has too many triangles for the browser.');
    source = { name: file.name.replace(/\.[^.]+$/, ''), parts, stats, is3mf: /\.3mf$/i.test(file.name), flipped: inside, original: null, repairLog: [], include: parts.map(() => true), colors: parts.map(p => p.color), slots: parts.map(p => p.slot || null) };
    buildPartList();
    resetTransform();
    framed = false;
    source.fileName = file.name;
    $('status').textContent = file.name;
    $('error').hidden = true;
    await build();
    resetHistory();
  } catch (e) {
    $('status').textContent = '';
    showError(e.message || String(e));
  }
}
$('file').addEventListener('change', e => load(e.target.files[0]));
const drop = $('viewport');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drop'); load(e.dataTransfer.files[0]); });

function resetTransform() {
  scale = [1, 1, 1];
  for (const id of ['rotX', 'rotY', 'rotZ']) $(id).value = 0;
  for (const id of ['mirrorX', 'mirrorY', 'mirrorZ']) $(id).checked = false;
  $('unit').value = '1';
  for (const id of ['tabShift', 'labelX', 'labelY', 'labelRot']) $(id).value = 0;   // positions belong to the old model
}

function buildPartList() {
  $('partHint').hidden = false;
  $('partList').replaceChildren(...source.parts.map((p, i) => {
    const li = document.createElement('li'), on = document.createElement('input'), col = document.createElement('input'), name = document.createElement('span');
    on.type = 'checkbox'; on.checked = true; on.title = 'Include this part';
    col.type = 'color'; col.value = source.colors[i] || DEFAULT_COLOR; col.title = 'Colour';
    name.textContent = p.name;
    on.addEventListener('change', () => { source.include[i] = on.checked; li.classList.toggle('off', !on.checked); framed = false; rebuild(); });
    col.addEventListener('input', () => { source.colors[i] = col.value; rebuild(); });
    const slot = document.createElement('input');
    slot.type = 'number'; slot.min = 1; slot.max = 16; slot.step = 1; slot.className = 'slot'; slot.value = source.slots[i] || ''; slot.placeholder = 'auto';
    slot.title = 'Filament slot (1-16). Leave empty to share a slot with parts of the same colour.';
    slot.addEventListener('input', () => { const n = parseInt(slot.value, 10); source.slots[i] = n >= 1 && n <= 16 ? n : null; rebuild(); });
    li.append(on, col, name, slot);
    return li;
  }));
}

// a sideways hole needs a height: start at half the model's height instead of on the bed
$('holeDir').addEventListener('change', () => {
  if (!result) return;
  const sideways = HOLE_DIRECTIONS[$('holeDir').value]?.axis !== 'z';
  $('holeA').value = 0;
  $('holeB').value = sideways ? round(result.sizeObj.height / 2, 1) : 0;
});

// ---------- repair ----------
$('repair').addEventListener('click', () => {
  if (!source) return;
  const before = source.parts.slice(), log = [];
  let changed = false;
  source.parts = source.parts.map((p, i) => {
    if (!source.include[i] || source.stats[i].openEdges === 0) return p;
    const { part, report } = repairPart(p);
    log.push(describeRepair(p.name, report));
    if (report.openAfter < report.openBefore) { changed = true; return part; }   // keep any improvement; leave a part alone if nothing got better
    return p;
  });
  if (changed) { source.original = source.original || before; source.stats = source.parts.map(partStats); partsVersion++; }
  source.repairLog = log;
  build();
  commit();
});
$('undoRepair').addEventListener('click', () => {
  if (!source?.original) return;
  source.parts = source.original; source.original = null; source.repairLog = [];
  source.stats = source.parts.map(partStats);
  partsVersion++;
  build();
  commit();
});

// ---------- size controls ----------
const SIZE_IDS = ['sizeX', 'sizeY', 'sizeZ'];
SIZE_IDS.forEach((id, axis) => $(id).addEventListener('change', () => {
  if (!result) return;
  const target = num(id), base = result.unscaledSize[axis];
  if (!(target > 0)) return;
  const s = target / base;
  scale = $('lock').checked ? [s, s, s] : scale.map((v, k) => (k === axis ? s : v));
  rebuild();
}));
$('scalePct').addEventListener('change', () => {
  const p = num('scalePct');
  if (p > 0) { scale = [p / 100, p / 100, p / 100]; rebuild(); }
});
$('lock').addEventListener('change', () => {
  if ($('lock').checked && result) { const s = scale[0]; scale = [s, s, s]; rebuild(); }
});
document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => {
  const el = $(b.dataset.rot), v = ((parseFloat(el.value) || 0) + 90) % 360;
  el.value = v > 180 ? v - 360 : v;
  rebuild();
}));
$('layFlat').addEventListener('click', () => {
  if (!source) return;
  const used = source.parts.filter((_, i) => source.include[i]);
  const angles = layFlatAngles(used, { unit: num('unit'), rotate: ['rotX', 'rotY', 'rotZ'].map(id => parseFloat($(id).value) || 0), mirror: ['mirrorX', 'mirrorY', 'mirrorZ'].map(id => $(id).checked) });
  if (!angles) return;
  ['rotX', 'rotY', 'rotZ'].forEach((id, k) => { $(id).value = angles[k]; });
  rebuild();
});
$('resetXform').addEventListener('click', () => { if (source) { resetTransform(); rebuild(); } });
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  if (result) viewer.setView(view, result.sizeObj);
}));

// ---------- undo / redo ----------
const DERIVED = ['sizeX', 'sizeY', 'sizeZ', 'scalePct'];                         // shown from the real model, kept in `scale`, so not a separate edit
const fieldEls = () => [...document.querySelectorAll('#controls input[id], #controls select[id], #controls textarea[id]')].filter(el => el.type !== 'file' && !DERIVED.includes(el.id));

function snapshot() {
  const fields = {};
  for (const el of fieldEls()) fields[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  const data = { fields, scale: scale.slice(), include: source.include.slice(), colors: source.colors.slice(), slots: source.slots.slice(), version: partsVersion };
  return { key: JSON.stringify(data), state: { ...data, parts: source.parts, original: source.original, stats: source.stats, repairLog: source.repairLog.slice() } };
}
function updateHistoryButtons() { $('undo').disabled = !hist.canUndo; $('redo').disabled = !hist.canRedo; }
function record() {
  clearTimeout(commitTimer); commitTimer = null;
  if (!source || restoring) return;
  const s = snapshot();
  if (hist.push(s.state, s.key)) updateHistoryButtons();
}
function commit() { clearTimeout(commitTimer); commitTimer = setTimeout(record, 500); }   // a burst of typing becomes one step
function resetHistory() {
  clearTimeout(commitTimer); commitTimer = null;
  partsVersion++;
  const s = snapshot();
  hist.reset(s.state, s.key);
  updateHistoryButtons();
}

async function restore(s) {
  restoring = true;
  try {
    const fontBefore = $('font').value;
    for (const [id, v] of Object.entries(s.fields)) { const el = $(id); if (!el) continue; if (el.type === 'checkbox') el.checked = v; else el.value = v; }
    scale = s.scale.slice();
    Object.assign(source, { include: s.include.slice(), colors: s.colors.slice(), slots: s.slots.slice(), parts: s.parts, original: s.original, stats: s.stats, repairLog: s.repairLog.slice() });
    partsVersion = s.version;
    buildPartList();
    if ($('font').value !== fontBefore) await selectFont();
    await build();
  } finally { restoring = false; updateHistoryButtons(); }
}
async function step(dir) {
  if (!source) return;
  if (commitTimer) record();                                                    // keep the edit that is still waiting to be recorded
  const s = dir < 0 ? hist.undo() : hist.redo();
  if (s) await restore(s); else updateHistoryButtons();
}
$('undo').addEventListener('click', () => step(-1));
$('redo').addEventListener('click', () => step(1));
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const t = e.target, editing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'button', 'range'].includes(t.type)));
  if (editing) return;                                                          // inside a field, Ctrl+Z undoes typing as usual
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); step(-1); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); step(1); }
});

// ---------- building ----------
function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('downloadStl').disabled = $('download3mf').disabled = !!msg || !result;
}

function rebuild() { clearTimeout(timer); timer = setTimeout(build, 150); if (!restoring) commit(); }

function syncUI() {
  $('tabOptions').hidden = !$('tabOn').checked;
  $('labelOptions').hidden = !$('labelOn').checked;
  $('tabSlotRow').hidden = $('tabStyle').value !== 'slot';
  $('holeOptions').hidden = !$('holeOn').checked;
  const hd = HOLE_DIRECTIONS[$('holeDir').value] || HOLE_DIRECTIONS.down;
  $('holeALabel').textContent = hd.a;
  $('holeBLabel').textContent = hd.b;
  $('splitOptions').hidden = !$('splitOn').checked;
  $('splitPegOptions').hidden = $('splitKeep').value !== 'both';
  const engraved = $('labelMode').value === 'engraved';
  $('labelRaiseText').textContent = engraved ? 'Cut depth (mm)' : 'Raised by (mm)';
  $('labelFillRow').hidden = !engraved;
  $('labelColorRow').hidden = engraved && !$('labelFill').checked;
  if ($('labelOn').checked && !font && !fontRequested) { fontRequested = true; selectFont(); }
}

async function build() {
  syncUI();
  if (!source) return;
  const id = ++buildId;
  const rot = ['rotX', 'rotY', 'rotZ'].map(id => parseFloat($(id).value) || 0);
  const used = source.parts.map((p, i) => ({ ...p, color: source.colors[i], slot: source.slots[i] || undefined })).filter((_, i) => source.include[i]);
  if (!used.length) { showError('Keep at least one part ticked.'); return; }
  const xf = transformParts(used, {
    unit: num('unit'), rotate: rot, mirror: ['mirrorX', 'mirrorY', 'mirrorZ'].map(id => $(id).checked), scale,
    center: $('center').checked, onBed: $('onBed').checked,
  });
  const warnings = [], extras = [];
  let error = '', parts = xf.parts, cutDone = false, infill = null;
  const engraved = $('labelOn').checked && $('labelMode').value === 'engraved';
  try {
    // 3D cuts first (they change the model), then the parts that are only added on
    if ($('holeOn').checked || engraved || $('splitOn').checked) {
      if (!engineReady) $('status').textContent = 'Loading the cutting engine (about 0.5 MB)...';
      await loadManifold();
      engineReady = true;
      if (id !== buildId) return;
      $('status').textContent = source.fileName || '';
      if ($('holeOn').checked) {
        const dir = HOLE_DIRECTIONS[$('holeDir').value] || HOLE_DIRECTIONS.down;
        const h = await cutHole(parts, { axis: dir.axis, from: dir.from, a: num('holeA') || 0, b: num('holeB') || 0, diameter: num('holeD'), depth: num('holeDepth') || null });
        parts = h.parts; cutDone = true;
        if (!h.touched) warnings.push('The hole does not touch the model. Move it onto the model.');
      }
      if (engraved && font) {
        const l = placeLabel(parts, { font, text: $('labelText').value, height: num('labelHeight'), raise: num('labelRaise'), x: num('labelX') || 0, y: num('labelY') || 0, rotate: num('labelRot') || 0 });
        const depth = num('labelRaise');
        if (l.top - depth < 0.8) throw new Error(`The engraving is too deep: the surface is ${l.top.toFixed(1)} mm high and at least 0.8 mm of floor must remain. Use a depth under ${(l.top - 0.8).toFixed(1)} mm.`);
        parts = await cutText(parts, l.groups, l.top - depth, l.top + 1); cutDone = true;
        if ($('labelFill').checked) infill = buildInfill(l.groups, l.top - depth, depth);
        warnings.push(...l.warnings);
      }
      if ($('splitOn').checked) {
        const sp = await splitModel(parts, {
          z: num('splitZ'), keep: $('splitKeep').value, pegs: $('splitPegs').checked, pegDiameter: num('pegD'), pegHeight: num('pegH'),
          clearance: num('pegClear'), gap: num('splitGap'),
        });
        parts = sp.parts; cutDone = true;
        warnings.push(...sp.warnings);
      }
      if (id !== buildId) return;
    }
    const size = boundsOfParts(parts).size;
    if ($('tabOn').checked) {
      const t = buildTab(parts, size, {
        style: $('tabStyle').value, side: $('tabSide').value, hole: num('tabHole'), wall: num('tabWall'), slotLength: num('tabSlot'),
        thickness: num('tabThickness'), overlap: num('tabOverlap'), shift: num('tabShift') || 0,
      });
      extras.push({ name: 'tab', label: 'Hanging tab', color: $('tabColor').value, geometry: t.geometry });
      warnings.push(...t.warnings);
    }
    if (infill) extras.push({ name: 'infill', label: 'Engraving infill', color: $('labelColor').value, geometry: infill });
    if ($('labelOn').checked && !engraved && font) {
      const l = buildLabel(parts, {
        font, text: $('labelText').value, height: num('labelHeight'), raise: num('labelRaise'),
        x: num('labelX') || 0, y: num('labelY') || 0, rotate: num('labelRot') || 0,
      });
      extras.push({ name: 'label', label: 'Raised text', color: $('labelColor').value, geometry: l.geometry });
      warnings.push(...l.warnings);
    }
  } catch (e) {
    if (id !== buildId) return;
    error = e.message || String(e);
    $('status').textContent = source.fileName || '';
    parts = xf.parts; extras.length = 0; cutDone = false; infill = null;                    // show the model without the change that failed
  }

  const { group, parts: meta } = buildGroup(parts, extras);
  assignSlots([...parts, ...extras]).forEach((s, i) => { meta[i].extruder = s; });
  // show the slot each model part will get when the box is empty
  const autoSlots = assignSlots(used);
  let shown = 0;
  document.querySelectorAll('#partList input.slot').forEach((el, i) => { if (source.include[i]) el.placeholder = String(autoSlots[shown++]); else el.placeholder = '-'; });
  viewer.setObject(group);
  const [w, d, h] = boundsOfParts(parts).size;
  result = { group, meta, size: xf.size, unscaledSize: xf.unscaledSize, sizeObj: { width: w, depth: d, height: h }, colored: parts.some(p => p.color) };
  if (!framed) { framed = true; viewer.resize(); viewer.setView(view, result.sizeObj); }
  showError(error);

  // reflect the real numbers in the size fields
  SIZE_IDS.forEach((id, k) => { if (document.activeElement !== $(id)) $(id).value = round(xf.size[k]); });
  const uniform = scale.every(s => Math.abs(s - scale[0]) < 1e-9);
  if (document.activeElement !== $('scalePct')) $('scalePct').value = uniform ? round(scale[0] * 100) : '';
  $('scalePct').placeholder = uniform ? '' : 'mixed';

  const kept = cutDone ? parts.map(partStats) : source.stats.filter((_, i) => source.include[i]);
  const tris = kept.reduce((s, x) => s + x.triangles, 0), vol = kept.reduce((s, x) => s + x.volume, 0);
  const open = kept.reduce((s, x) => s + x.openEdges, 0);
  const u = num('unit') * Math.cbrt(scale[0] * scale[1] * scale[2]);
  $('info').textContent = `${round(w, 1)} x ${round(d, 1)} x ${round(h, 1)} mm  |  ${tris.toLocaleString()} triangles  |  about ${round((vol * Math.pow(u, 3)) / 1000, 1)} cm³ of material (solid)  |  ${parts.length} part${parts.length === 1 ? '' : 's'}`;

  if (source.flipped) warnings.unshift(`${source.flipped} part${source.flipped === 1 ? ' was' : 's were'} inside-out (faces pointing inwards) and ${source.flipped === 1 ? 'has' : 'have'} been turned the right way round.`);
  const srcOpen = source.stats.some((x, i) => source.include[i] && x.openEdges > 0);
  $('repairBox').hidden = !(srcOpen || source.original);
  $('repair').hidden = !srcOpen;
  $('undoRepair').hidden = !source.original;
  $('repairReport').replaceChildren(...source.repairLog.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  if (open) warnings.unshift(`This model is not watertight (${open.toLocaleString()} open or shared edges). It may slice badly and cannot be cut. Try "Repair open edges" below.`);
  const maxDim = Math.max(w, d, h);
  if (maxDim < 5) warnings.push(`The model is only ${round(maxDim, 2)} mm across. If it was made in centimetres or inches, change "The file's units".`);
  if (maxDim > 400) warnings.push(`The model is ${round(maxDim, 0)} mm across, bigger than most printers. Scale it down, or check "The file's units".`);
  $('warnings').replaceChildren(...warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));

  $('extraList').replaceChildren(...extras.map(x => {
    const el = document.createElement('div'), sw = document.createElement('span');
    sw.className = 'swatch'; sw.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;background:${x.color}`;
    el.append(sw, document.createTextNode(`Added: ${x.label}`));
    return el;
  }));
}

$('controls').addEventListener('input', e => {
  if (e.target.closest('#partList')) return;                                   // handled by the part list itself
  if (SIZE_IDS.includes(e.target.id) || ['scalePct', 'file', 'fontFile'].includes(e.target.id)) return;
  rebuild();
});

// ---------- download ----------
const outName = ext => `${(source?.name || 'model').replace(/[^\w.-]+/g, '-')}-modified.${ext}`;
$('downloadStl').addEventListener('click', () => downloadBlob(exportSTL(result.group), outName('stl')));
$('download3mf').addEventListener('click', () => {
  const keep = result.meta.length > 1 || result.colored;                          // one plain part: a plain 3MF
  downloadBlob(export3MF(result.group, { title: source.name, parts: keep ? result.meta : null }), outName('3mf'));
});
