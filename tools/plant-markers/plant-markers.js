// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { loadFont, parseFont, populateFontSelect, FONTS } from '../../shared/js/fonts.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { zipStore } from '../../shared/js/zip.js';
import { buildMarkers, parseNames, MAX_MARKERS } from './geometry.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
let font = null, model = null, params = null, view = 'print', timer = null, first = true, lastInfo = { width: 200, depth: 100, height: 3.2 };

populateFontSelect($('font'));

async function selectFont() {
  $('status').textContent = 'Loading font...';
  try { font = await loadFont(FONTS[parseInt($('font').value, 10)].url); $('status').textContent = ''; }
  catch { font = null; $('status').textContent = 'Could not load the font (offline?). Try uploading a font file.'; }
  rebuild();
}
$('font').addEventListener('change', selectFont);
$('fontFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { font = parseFont(await file.arrayBuffer()); $('status').textContent = `Using ${file.name}`; rebuild(); }
  catch { $('status').textContent = 'Could not read that font file (WOFF2 is not supported).'; }
});

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = $('download3mf').disabled = $('downloadZip').disabled = !!msg;
}
function rebuild() { clearTimeout(timer); timer = setTimeout(build, 250); }

function build() {
  const names = parseNames($('names').value);
  $('count').textContent = `${names.length} marker${names.length === 1 ? '' : 's'} (up to ${MAX_MARKERS})`;
  params = {
    font, names, fontSize: num('fontSize'), lineSpacing: 1.2, margin: num('margin'), minWidth: 30, sameSize: $('sameSize').checked,
    cornerRadius: num('cornerRadius'), thickness: num('thickness'), raise: num('raise'), spikeLength: num('spikeLength'),
    spikeWidth: num('spikeWidth'), tipWidth: num('tipWidth'), bedWidth: num('bedWidth'), gap: num('gap'),
    baseColor: $('baseColor').value, textColor: $('textColor').value,
  };
  if (!font || Object.values(params).some(v => typeof v === 'number' && Number.isNaN(v))) return;
  let res;
  try { res = buildMarkers(params); } catch (e) { showError(e.message); return; }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  if (first) { first = false; viewer.resize(); }
  viewer.setView(view, lastInfo);
  const i = res.info;
  $('info').textContent = `${i.count} marker${i.count === 1 ? '' : 's'} in ${i.rows} row${i.rows === 1 ? '' : 's'}  |  ${i.width.toFixed(0)} x ${i.depth.toFixed(0)} x ${i.height.toFixed(1)} mm  |  filament change at Z = ${i.filamentChangeZ.toFixed(2)} mm`;
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
}

$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));

$('download').addEventListener('click', () => downloadBlob(exportSTL(model), 'plant-markers.stl'));
$('download3mf').addEventListener('click', () => downloadBlob(export3MF(model, { title: 'Plant markers', parts: [{ name: 'base', label: 'Stakes' }, { name: 'text', label: 'Letters' }] }), 'plant-markers.3mf'));
$('downloadZip').addEventListener('click', async () => {
  const used = new Set(), files = [];
  for (const m of buildMarkers(params).markers) {
    let slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'marker';
    for (let n = 2; used.has(slug); n++) slug = `${slug.replace(/-\d+$/, '')}-${n}`;
    used.add(slug);
    m.group.position.set(0, 0, 0);                              // each file on its own, at the origin
    m.group.updateMatrixWorld(true);
    files.push([`marker-${slug}.stl`, new Uint8Array(await exportSTL(m.group).arrayBuffer())]);
  }
  downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), 'plant-markers.zip');
});

selectFont();
