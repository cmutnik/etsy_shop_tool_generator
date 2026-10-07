// Copyright (c) 2025 cmutnik
import jsQR from 'jsqr';
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { rasterizeTopDown, rasterizeBottomUp } from '../../shared/js/qr-plate.js';
import { qrMatrix } from '../../shared/js/qr-plate.js';
import { qrSvgBlob, qrPngBlob } from '../../shared/js/qr-image.js';
import { buildKeychain } from './geometry.js';
import { LOOP_STYLES, HEADER_SHAPES, loopStyle } from './loops.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
for (const s of LOOP_STYLES) $('loopStyle').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));
for (const s of HEADER_SHAPES) $('headerShape').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));

const STYLE_NOTES = {
  round: 'A classic ring. A neck wider than the ring becomes a base under it.',
  'rounded-square': 'A square tab with soft corners.',
  hexagon: 'Flat top and bottom; the size is the width across the corners.',
  teardrop: 'A round loop that tapers to a point away from the code.',
  'lanyard-slot': 'A wide stadium with a slot for a strap or lanyard, so the hole is a slot (set its length).',
  header: 'A band as wide as the plate with the hole in it - the sturdiest option. Choose its outline and move the hole anywhere inside it; the neck settings are not used.',
};
function syncLoopControls() {
  const style = $('loopStyle').value, def = loopStyle(style);
  $('loopSizeLabel').textContent = `Loop size - ${def.size} (mm)`;
  $('slotRow').style.display = style === 'lanyard-slot' ? '' : 'none';
  $('neckRow').style.display = style === 'header' ? 'none' : '';
  const header = style === 'header', shape = $('headerShape').value;
  $('headerOptions').style.display = header ? '' : 'none';
  $('leanRow').style.display = shape.startsWith('triangle') ? '' : 'none';
  $('roundingRow').style.display = shape === 'semicircle' ? 'none' : '';
  // a semicircle's height is fixed by the plate width, so the size field does not apply
  $('loopDiameter').disabled = header && shape === 'semicircle';
  if (header && shape === 'semicircle') $('loopSizeLabel').textContent = 'Loop size - height is half the plate width';
  $('loopNote').textContent = STYLE_NOTES[style];
}

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
    loopStyle: $('loopStyle').value, loopPosition: $('loopPosition').value, loopDiameter: num('loopDiameter'), holeDiameter: num('holeDiameter'), slotLength: num('slotLength'),
    headerShape: $('headerShape').value, lean: num('lean') / 100, rounding: num('rounding'), holeOffsetX: num('holeOffsetX'), holeOffsetY: num('holeOffsetY'),
    neckWidth: num('neckWidth'), neckHeight: num('neckHeight'),
    backDepth: $('backEngrave').checked ? num('backDepth') : 0,
    roundBottomCorners: $('roundCorners').checked,
  };
}

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = $('download3mf').disabled = $('downloadPng').disabled = $('downloadSvg').disabled = !!msg;
}

function rebuild() { clearTimeout(timer); timer = setTimeout(build, 120); }

function build() {
  const p = readParams();
  if ([p.module, p.margin, p.thickness, p.depth, p.loopDiameter, p.holeDiameter, p.neckWidth, p.neckHeight, p.backDepth, p.slotLength, p.lean, p.rounding, p.holeOffsetX, p.holeOffsetY].some(Number.isNaN)) return;
  syncLoopControls();
  let res;
  try {
    res = buildKeychain(p);
  } catch (e) {
    showError(e.message);
    $('scan').hidden = true;
    $('scanBack').hidden = true;
    return;
  }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  if (first) { first = false; viewer.resize(); viewer.setView(view, lastInfo); }

  const i = res.info;
  $('info').textContent = `${i.width.toFixed(1)} x ${i.depth.toFixed(1)} x ${i.height.toFixed(1)} mm  |  ${i.modules} x ${i.modules} modules  |  ${Math.round(i.triangles).toLocaleString()} triangles`
    + `  |  filament change${i.filamentChangeZs.length > 1 ? 's' : ''} at Z = ${i.filamentChangeZs.map(z => z.toFixed(2)).join(' and ')} mm`;
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));

  $('backRow').style.display = $('backEngrave').checked ? '' : 'none';
  $('backNote').style.display = $('backEngrave').checked ? '' : 'none';

  // scan check: look at the generated geometry the way a camera would and try to decode it
  const decode = img => {
    const pad = 40, w = img.width + 2 * pad;
    const data = new Uint8ClampedArray(w * w * 4).fill(255);
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + pad) * w + pad) * 4);
    const code = jsQR(data, w, w);
    return code && code.data === p.data;
  };
  const report = (el, ok, label) => {
    el.hidden = false;
    el.className = 'scan ' + (ok ? 'ok' : 'bad');
    el.textContent = ok
      ? `${label} scan check passed: the model decodes back to your text. (Still test-scan the printed part.)`
      : `${label} scan check failed: the model could not be decoded. Try a larger module size or lower error correction.`;
  };
  report($('scan'), decode(rasterizeTopDown(res.meshes, p.mode, i.plateSize, 10)), p.backDepth ? 'Front' : 'Model');
  if (p.backDepth) report($('scanBack'), decode(rasterizeBottomUp(res.meshes, i.plateSize, 10)), 'Back');
  else $('scanBack').hidden = true;
}

$('resetHole').addEventListener('click', () => { $('holeOffsetX').value = 0; $('holeOffsetY').value = 0; rebuild(); });
$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));

const slug = () => $('data').value.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'qr';
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `qr-keychain-${slug()}.stl`));
$('download3mf').addEventListener('click', () => downloadBlob(export3MF(model, { title: 'QR keychain', parts: [{ name: 'base', label: 'Plate' }, { name: 'qr', label: 'QR code' }] }), `qr-keychain-${slug()}.3mf`));

build();

const qrImageOpts = () => ({ dark: $('qrColor').value, light: $('baseColor').value });
const qrImageMatrix = () => qrMatrix($('data').value, $('errorCorrection').value);
$('downloadPng').addEventListener('click', async () => downloadBlob(await qrPngBlob(qrImageMatrix(), qrImageOpts()), `qr-${slug()}.png`));
$('downloadSvg').addEventListener('click', () => downloadBlob(qrSvgBlob(qrImageMatrix(), qrImageOpts()), `qr-${slug()}.svg`));
