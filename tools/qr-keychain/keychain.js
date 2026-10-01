// Copyright (c) 2025 cmutnik
import jsQR from 'jsqr';
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { rasterizeTopDown } from '../../shared/js/qr-plate.js';
import { buildKeychain } from './geometry.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));

let model = null;
let view = 'print';
let lastInfo = { width: 40, depth: 60, height: 3 };
let first = true;
let timer = null;

function readParams() {
  return {
    data: $('data').value,
    errorCorrection: $('errorCorrection').value,
    module: num('module'), margin: num('margin'),
    mode: $('mode').value, thickness: num('thickness'), depth: num('depth'),
    baseColor: $('baseColor').value, qrColor: $('qrColor').value,
    loopPosition: $('loopPosition').value, loopDiameter: num('loopDiameter'), holeDiameter: num('holeDiameter'),
    neckWidth: num('neckWidth'), neckHeight: num('neckHeight'),
  };
}

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = $('download3mf').disabled = !!msg;
}

function rebuild() { clearTimeout(timer); timer = setTimeout(build, 120); }

function build() {
  const p = readParams();
  if ([p.module, p.margin, p.thickness, p.depth, p.loopDiameter, p.holeDiameter, p.neckWidth, p.neckHeight].some(Number.isNaN)) return;
  let res;
  try {
    res = buildKeychain(p);
  } catch (e) {
    showError(e.message);
    $('scan').hidden = true;
    return;
  }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  if (first) { first = false; viewer.resize(); viewer.setView(view, lastInfo); }

  const i = res.info;
  $('info').textContent = `${i.width.toFixed(1)} x ${i.depth.toFixed(1)} x ${i.height.toFixed(1)} mm  |  ${i.modules} x ${i.modules} modules  |  ${Math.round(i.triangles).toLocaleString()} triangles`
    + `  |  filament change at Z = ${i.filamentChangeZ.toFixed(2)} mm`;
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));

  // scan check: look straight down at the generated geometry and try to decode it
  const img = rasterizeTopDown(res.meshes, p.mode, i.plateSize, 10);
  const pad = 40, w = img.width + 2 * pad;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + pad) * w + pad) * 4);
  const code = jsQR(data, w, w);
  const el = $('scan');
  el.hidden = false;
  el.className = 'scan ' + (code && code.data === p.data ? 'ok' : 'bad');
  el.textContent = code && code.data === p.data
    ? 'Scan check passed: the model decodes back to your text. (Still test-scan the printed part.)'
    : 'Scan check failed: the model could not be decoded. Try a larger module size or lower error correction.';
}

$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));

const slug = () => $('data').value.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'qr';
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `qr-keychain-${slug()}.stl`));
$('download3mf').addEventListener('click', () => downloadBlob(export3MF(model, { title: 'QR keychain', colors: true }), `qr-keychain-${slug()}.3mf`));

build();
