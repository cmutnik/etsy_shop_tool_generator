// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { parseMesh, MAX_TRIANGLES } from '../../shared/js/mesh-import.js';
import { loadFont, parseFont, populateFontSelect, FONTS } from '../../shared/js/fonts.js';
import { transformParts, buildGroup, partStats, DEFAULT_COLOR } from './geometry.js';
import { buildTab, buildLabel, TAB_STYLES, TAB_SIDES } from './attach.js';

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
let timer = null, framed = false, view = 'print';

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
    const parts = await parseMesh(file.name, await file.arrayBuffer());
    const stats = parts.map(partStats);
    if (stats.reduce((s, x) => s + x.triangles, 0) > MAX_TRIANGLES) throw new Error('That model has too many triangles for the browser.');
    source = { name: file.name.replace(/\.[^.]+$/, ''), parts, stats, is3mf: /\.3mf$/i.test(file.name) };
    resetTransform();
    framed = false;
    $('status').textContent = file.name;
    $('error').hidden = true;
    build();
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
$('resetXform').addEventListener('click', () => { if (source) { resetTransform(); rebuild(); } });
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  if (result) viewer.setView(view, result.sizeObj);
}));

// ---------- building ----------
function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('downloadStl').disabled = $('download3mf').disabled = !!msg || !result;
}

function rebuild() { clearTimeout(timer); timer = setTimeout(build, 150); }

function syncUI() {
  $('tabOptions').hidden = !$('tabOn').checked;
  $('labelOptions').hidden = !$('labelOn').checked;
  $('tabSlotRow').hidden = $('tabStyle').value !== 'slot';
  if ($('labelOn').checked && !font && !fontRequested) { fontRequested = true; selectFont(); }
}

function build() {
  syncUI();
  if (!source) return;
  const rot = ['rotX', 'rotY', 'rotZ'].map(id => parseFloat($(id).value) || 0);
  const xf = transformParts(source.parts, {
    unit: num('unit'), rotate: rot, mirror: ['mirrorX', 'mirrorY', 'mirrorZ'].map(id => $(id).checked), scale,
    center: $('center').checked, onBed: $('onBed').checked,
  });
  const warnings = [], extras = [];
  let error = '';
  try {
    if ($('tabOn').checked) {
      const t = buildTab(xf.parts, xf.size, {
        style: $('tabStyle').value, side: $('tabSide').value, hole: num('tabHole'), wall: num('tabWall'), slotLength: num('tabSlot'),
        thickness: num('tabThickness'), overlap: num('tabOverlap'), shift: num('tabShift') || 0,
      });
      extras.push({ name: 'tab', label: 'Hanging tab', color: $('tabColor').value, geometry: t.geometry });
      warnings.push(...t.warnings);
    }
    if ($('labelOn').checked && font) {
      const l = buildLabel(xf.parts, {
        font, text: $('labelText').value, height: num('labelHeight'), raise: num('labelRaise'),
        x: num('labelX') || 0, y: num('labelY') || 0, rotate: num('labelRot') || 0,
      });
      extras.push({ name: 'label', label: 'Raised text', color: $('labelColor').value, geometry: l.geometry });
      warnings.push(...l.warnings);
    }
  } catch (e) { error = e.message || String(e); }

  const { group, parts: meta } = buildGroup(xf.parts, extras);
  viewer.setObject(group);
  const [w, d, h] = xf.size;
  result = { group, meta, size: xf.size, unscaledSize: xf.unscaledSize, sizeObj: { width: w, depth: d, height: h }, colored: xf.parts.some(p => p.color) };
  if (!framed) { framed = true; viewer.resize(); viewer.setView(view, result.sizeObj); }
  showError(error);

  // reflect the real numbers in the size fields
  SIZE_IDS.forEach((id, k) => { if (document.activeElement !== $(id)) $(id).value = round(xf.size[k]); });
  const uniform = scale.every(s => Math.abs(s - scale[0]) < 1e-9);
  if (document.activeElement !== $('scalePct')) $('scalePct').value = uniform ? round(scale[0] * 100) : '';
  $('scalePct').placeholder = uniform ? '' : 'mixed';

  const tris = source.stats.reduce((s, x) => s + x.triangles, 0), vol = source.stats.reduce((s, x) => s + x.volume, 0);
  const open = source.stats.reduce((s, x) => s + x.openEdges, 0);
  const u = num('unit') * Math.cbrt(scale[0] * scale[1] * scale[2]);
  $('info').textContent = `${round(w, 1)} x ${round(d, 1)} x ${round(h, 1)} mm  |  ${tris.toLocaleString()} triangles  |  about ${round((vol * Math.pow(u, 3)) / 1000, 1)} cm³ of material (solid)  |  ${source.parts.length} part${source.parts.length === 1 ? '' : 's'}`;

  if (open) warnings.unshift(`This model is not watertight (${open.toLocaleString()} open or shared edges). It may slice badly; repair it in a mesh tool if the slicer complains.`);
  const maxDim = Math.max(w, d, h);
  if (maxDim < 5) warnings.push(`The model is only ${round(maxDim, 2)} mm across. If it was made in centimetres or inches, change "The file's units".`);
  if (maxDim > 400) warnings.push(`The model is ${round(maxDim, 0)} mm across, bigger than most printers. Scale it down, or check "The file's units".`);
  $('warnings').replaceChildren(...warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));

  $('partList').replaceChildren(...meta.map((m, i) => {
    const li = document.createElement('li'), sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = (i < xf.parts.length ? xf.parts[i].color : extras[i - xf.parts.length].color) || DEFAULT_COLOR;
    li.append(sw, document.createTextNode(m.label));
    return li;
  }));
}

$('controls').addEventListener('input', e => { if (!SIZE_IDS.includes(e.target.id) && e.target.id !== 'scalePct' && e.target.id !== 'file' && e.target.id !== 'fontFile') rebuild(); });

// ---------- download ----------
const outName = ext => `${(source?.name || 'model').replace(/[^\w.-]+/g, '-')}-modified.${ext}`;
$('downloadStl').addEventListener('click', () => downloadBlob(exportSTL(result.group), outName('stl')));
$('download3mf').addEventListener('click', () => {
  const keep = result.meta.length > 1 || result.colored;                          // one plain part: a plain 3MF
  downloadBlob(export3MF(result.group, { title: source.name, parts: keep ? result.meta : null }), outName('3mf'));
});
