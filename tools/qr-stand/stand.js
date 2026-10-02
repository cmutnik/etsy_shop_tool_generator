// Copyright (c) 2025 cmutnik
import jsQR from 'jsqr';
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { rasterizeTopDown } from '../../shared/js/qr-plate.js';
import { loadFont, parseFont, populateFontSelect, FONTS } from '../../shared/js/fonts.js';
import { ICON_NAMES } from '../../shared/js/icons.js';
import { buildStand, centered } from './geometry.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));

for (const n of ICON_NAMES) $('icon').append(Object.assign(document.createElement('option'), { value: n, textContent: n }));
populateFontSelect($('font'));

let font = null;
let model = null;          // { stand, views: { plate, base, assembled } }
let show = 'plate';
let first = true;
let timer = null;

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

function readParams() {
  return {
    data: $('data').value, errorCorrection: $('errorCorrection').value, module: num('module'), margin: num('margin'),
    mode: $('mode').value, thickness: num('thickness'), depth: num('depth'), baseColor: $('baseColor').value, qrColor: $('qrColor').value,
    iconName: $('icon').value || null, iconSize: num('iconSize'), title: $('title').value, titleHeight: num('titleHeight'), font,
    bannerPosition: $('bannerPosition').value,
    baseDepth: num('baseDepth'), baseHeight: num('baseHeight'), tilt: num('tilt'), slotDepth: num('slotDepth'), slotClearance: num('slotClearance'),
  };
}

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('downloadPlate').disabled = $('downloadPlate3mf').disabled = $('downloadBase').disabled = !!msg;
}

function syncUI() {
  const hasIcon = !!$('icon').value, hasTitle = !!$('title').value.trim();
  $('brandOptions').hidden = !(hasIcon || hasTitle);
  $('iconSizeRow').hidden = !hasIcon;
  $('titleRows').hidden = !hasTitle;
}

function rebuild() { clearTimeout(timer); timer = setTimeout(build, 150); }

function build() {
  syncUI();
  const p = readParams();
  if ([p.module, p.margin, p.thickness, p.depth, p.iconSize, p.titleHeight, p.baseDepth, p.baseHeight, p.tilt, p.slotDepth, p.slotClearance].some(Number.isNaN)) return;
  let stand;
  try { stand = buildStand(p); }
  catch (e) { showError(e.message); $('scan').hidden = true; return; }
  showError('');
  model = { stand, views: { plate: centered(stand.plate), base: centered(stand.base), assembled: centered(stand.assembled) } };
  showView();
  const i = stand.info;
  $('info').textContent = `Plate ${i.plateWidth.toFixed(0)} x ${i.plateHeight.toFixed(0)} x ${i.plateThickness.toFixed(1)} mm  |  Base ${i.baseSize.map(v => v.toFixed(0)).join(' x ')} mm  |  ${i.modules} x ${i.modules} modules`
    + `  |  blank tab ${i.shortfall.toFixed(1)} mm  |  filament change at Z = ${i.filamentChangeZ.toFixed(2)} mm`;
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));

  // scan check: the code on the plate, looked at from above
  const img = rasterizeTopDown(stand.qrMeshes, p.mode, i.plateWidth, 8), pad = 40, w = img.width + 2 * pad;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + pad) * w + pad) * 4);
  const ok = jsQR(data, w, w)?.data === p.data;
  $('scan').hidden = false;
  $('scan').className = 'scan ' + (ok ? 'ok' : 'bad');
  $('scan').textContent = ok ? 'Scan check passed: the model decodes back to your text. (Still test-scan the printed plate.)'
    : 'Scan check failed: the model could not be decoded. Try a larger module size or lower error correction.';
}

function showView() {
  if (!model) return;
  const v = model.views[show];
  viewer.setObject(v);
  const size = viewSize(v);
  if (first) { first = false; viewer.resize(); }
  viewer.setView('print', size);
}
function viewSize(obj) {
  // width / depth / height of the displayed object, for the camera distance
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  obj.updateMatrixWorld(true);
  obj.traverse(c => {
    if (!c.isMesh) return;
    c.geometry.computeBoundingBox();
    const bb = c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld);
    for (const [k, a] of [[0, 'x'], [1, 'y'], [2, 'z']]) { min[k] = Math.min(min[k], bb.min[a]); max[k] = Math.max(max[k], bb.max[a]); }
  });
  return { width: max[0] - min[0], depth: max[1] - min[1], height: max[2] - min[2] };
}

document.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => {
  show = b.dataset.show;
  document.querySelectorAll('[data-show]').forEach(x => x.classList.toggle('active', x === b));
  showView();
}));
$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);

const slug = () => $('data').value.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'qr';
$('downloadPlate').addEventListener('click', () => downloadBlob(exportSTL(model.stand.plate), `qr-stand-plate-${slug()}.stl`));
$('downloadPlate3mf').addEventListener('click', () => downloadBlob(export3MF(model.stand.plate, { title: 'QR stand plate', parts: [{ name: 'base', label: 'Plate' }, { name: 'qr', label: 'QR code and branding' }] }), `qr-stand-plate-${slug()}.3mf`));
$('downloadBase').addEventListener('click', () => downloadBlob(exportSTL(model.stand.base), `qr-stand-base-${slug()}.stl`));

selectFont();
