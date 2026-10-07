// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MFCompressed, downloadBlob } from '../../shared/js/export.js';
import { readImageFile } from '../../shared/js/image-trace.js';
import { quantize, smoothLabels } from '../../shared/js/image-color.js';
import { assignLabels, stackOrder, usedOrder, buildLayeredArt, rgbToHex, hexToRgb } from '../../shared/js/layered-art.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
let image = samplePicture(), fileName = 'layered-art';
let palette = [], model = null, parts = [], view = 'print', timer = null, lastInfo = { width: 80, depth: 60, height: 1.4 };

/** A made-up picture so the page shows something before one is chosen: a sunset over water. */
function samplePicture() {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 240;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 150);
  sky.addColorStop(0, '#2b2d6e'); sky.addColorStop(0.6, '#d1495b'); sky.addColorStop(1, '#f6c177');
  g.fillStyle = sky; g.fillRect(0, 0, 320, 150);
  g.fillStyle = '#fff2c4'; g.beginPath(); g.arc(160, 125, 55, Math.PI, 0); g.fill();
  const sea = g.createLinearGradient(0, 150, 0, 240);
  sea.addColorStop(0, '#34547a'); sea.addColorStop(1, '#14233a');
  g.fillStyle = sea; g.fillRect(0, 150, 320, 90);
  g.fillStyle = '#fff2c4';
  for (let i = 0; i < 6; i++) g.fillRect(160 - 45 + i * 5, 156 + i * 13, 90 - i * 10, 4);
  return g.getImageData(0, 0, 320, 240);
}

function resetPalette() {
  const k = Math.max(2, Math.min(8, num('colors') | 0));
  palette = quantize(image, k).palette;
  drawSwatches();
}

function drawSwatches() {
  $('swatches').replaceChildren(...palette.map((c, i) => {
    const input = Object.assign(document.createElement('input'), { type: 'color', value: rgbToHex(c), title: `Colour ${i + 1}` });
    input.addEventListener('input', () => { palette[i] = hexToRgb(input.value); rebuild(); });
    return input;
  }));
}

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = $('download3mf').disabled = !!msg;
}

function rebuild() { clearTimeout(timer); $('status').textContent = 'Working...'; timer = setTimeout(build, 150); }

function build() {
  const widthMm = num('widthMm'), baseThickness = num('baseThickness'), stepHeight = num('stepHeight');
  $('smoothLabel').textContent = $('smooth').value;
  if ([widthMm, baseThickness, stepHeight].some(Number.isNaN) || !palette.length) return;
  let res;
  try {
    const { width: w, height: h } = image;
    let labels = assignLabels(image, palette);
    const passes = num('smooth');
    if (passes > 0) labels = smoothLabels(labels, w, h, passes);
    const order = usedOrder(labels, stackOrder(palette, $('order').value));
    res = buildLayeredArt({ labels, width: w, height: h, palette, order, widthMm, baseThickness, stepHeight });
    parts = res.info.bands.map((b, i) => ({ name: b.name, label: `Layer ${i + 1} ${b.color}`, extruder: i + 1 }));
  } catch (e) { showError(e.message); $('status').textContent = ''; return; }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  viewer.setView(view, lastInfo);
  const i = res.info;
  $('info').textContent = `${i.width.toFixed(1)} x ${i.depth.toFixed(1)} x ${i.height.toFixed(2)} mm  |  ${i.bands.length} colours  |  ${Math.round(i.triangles).toLocaleString()} triangles`;
  $('steps').replaceChildren(...i.bands.map((b, k) => {
    const row = document.createElement('div');
    const sw = Object.assign(document.createElement('span'), { className: 'dot' });
    sw.style.background = b.color;
    row.append(sw, `${k === 0 ? 'Start with' : 'Change to'} ${b.color} ${k === 0 ? 'at' : 'at Z ='} ${b.z0.toFixed(2)} mm${k === 0 ? ' (bed)' : ''}, up to ${b.z1.toFixed(2)} mm  |  ${(b.coverage * 100).toFixed(0)}% of the picture`);
    return row;
  }));
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  $('status').textContent = '';
}

$('file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    image = await readImageFile(file, 400);
    fileName = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'layered-art';
    $('source').textContent = `Using ${file.name} (${image.width} x ${image.height} px).`;
    resetPalette();
    build();
  } catch (err) { showError(err.message); }
});
$('colors').addEventListener('change', () => { resetPalette(); build(); });
$('resetColors').addEventListener('click', () => { resetPalette(); build(); });
for (const id of ['smooth', 'order', 'widthMm', 'baseThickness', 'stepHeight']) {
  $(id).addEventListener('input', rebuild);
  $(id).addEventListener('change', rebuild);
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `layered-art-${fileName}.stl`));
$('download3mf').addEventListener('click', async () => downloadBlob(await export3MFCompressed(model, { title: 'Layered art', parts }), `layered-art-${fileName}.3mf`));

resetPalette();
build();
viewer.resize();
viewer.setView(view, lastInfo);
