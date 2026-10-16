// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, downloadBlob } from '../../shared/js/export.js';
import { imageToGroups, readImageFile } from '../../shared/js/image-trace.js';
import { svgToGroups } from '../../shared/js/svg-import.js';
import { buildCookieCutter, SHAPES, shape } from './geometry.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
let picture = null;                 // { kind: 'svg', text } | { kind: 'raster', image: ImageData }
let model = null, view = 'print', timer = null, first = true, fileName = 'cutter', lastInfo = { width: 80, depth: 80, height: 12 };

for (const s of SHAPES) $('source').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));
$('source').append(Object.assign(document.createElement('option'), { value: 'picture', textContent: 'My own picture' }));
$('source').value = 'heart';

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = !!msg;
}
function rebuild() { clearTimeout(timer); $('status').textContent = 'Working...'; timer = setTimeout(build, 200); }

function currentGroups() {
  if ($('source').value !== 'picture') return shape($('source').value).groups();
  if (!picture) return [];
  if (picture.kind === 'svg') return svgToGroups(picture.text, { ignoreWhite: true }).groups;
  return imageToGroups(picture.image, { source: 'auto', threshold: 'auto', smooth: num('smooth'), tolerance: num('tolerance'), minArea: 40, invert: $('invert').checked }).groups;
}

function build() {
  $('pictureBox').hidden = $('source').value !== 'picture';
  const p = {
    size: num('size'), height: num('height'), wall: num('wall'), edge: num('edge'), edgeHeight: num('edgeHeight'),
    flange: num('flange'), flangeThickness: num('flangeThickness'), fillHoles: $('fillHoles').checked, color: $('color').value,
  };
  if (Object.values(p).some(v => typeof v === 'number' && Number.isNaN(v))) return;
  let res;
  try {
    const groups = currentGroups();
    if (!groups.length && $('source').value === 'picture' && !picture) { showError('Choose a picture, or pick one of the built-in shapes.'); $('status').textContent = ''; return; }
    res = buildCookieCutter({ ...p, groups });
  } catch (e) { showError(e.message); $('status').textContent = ''; return; }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  if (first) { first = false; viewer.resize(); }
  viewer.setView(view, lastInfo);
  const i = res.info;
  $('info').textContent = `Cookie ${i.cookieWidth.toFixed(1)} x ${i.cookieHeight.toFixed(1)} mm  |  cutter ${i.width.toFixed(1)} x ${i.depth.toFixed(1)} x ${i.height.toFixed(1)} mm`;
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  $('status').textContent = '';
}

$('file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    picture = /svg/i.test(file.type) || /\.svg$/i.test(file.name) ? { kind: 'svg', text: await file.text() } : { kind: 'raster', image: await readImageFile(file, 700) };
    fileName = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cutter';
    $('pictureNote').textContent = `Using ${file.name}.`;
    build();
  } catch (err) { showError(err.message); }
});
$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `cookie-cutter-${$('source').value === 'picture' ? fileName : $('source').value}.stl`));

build();
