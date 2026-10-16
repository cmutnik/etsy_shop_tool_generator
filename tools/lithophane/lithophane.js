// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, downloadBlob } from '../../shared/js/export.js';
import { readImageFile } from '../../shared/js/image-trace.js';
import { buildLithophane, backlitPreview } from '../../shared/js/lithophane.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
let image = samplePicture(), fileName = 'lithophane';
let model = null, view = 'lit', timer = null, lastInfo = { width: 100, depth: 5, height: 70 };

/** A made-up picture so the page shows something before a photo is chosen: a sun over hills. */
function samplePicture() {
  const c = document.createElement('canvas');
  c.width = 400; c.height = 300;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, '#3a5a8c'); sky.addColorStop(1, '#f6d8a8');
  g.fillStyle = sky; g.fillRect(0, 0, 400, 300);
  g.fillStyle = '#fff6d0'; g.beginPath(); g.arc(280, 110, 48, 0, Math.PI * 2); g.fill();
  for (const [col, base, amp, ph] of [['#6d7f6a', 200, 26, 0], ['#3f5a47', 235, 22, 2], ['#1f3326', 270, 16, 4]]) {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, 300);
    for (let x = 0; x <= 400; x += 8) g.lineTo(x, base + Math.sin(x / 55 + ph) * amp);
    g.lineTo(400, 300); g.fill();
  }
  return g.getImageData(0, 0, 400, 300);
}

function readParams() {
  return {
    widthMm: num('widthMm'), frameMm: num('frameMm'), minThickness: num('minThickness'), maxThickness: num('maxThickness'),
    pixelMm: num('pixelMm'), gamma: num('gamma'), smooth: num('smooth'), invert: $('invert').checked, curve: num('curve'), color: $('color').value,
  };
}

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = !!msg;
}

function rebuild() { clearTimeout(timer); $('status').textContent = 'Working...'; timer = setTimeout(build, 150); }

function build() {
  const p = readParams();
  $('curveLabel').textContent = p.curve ? `${p.curve} degrees` : 'flat';
  if (Object.values(p).some(v => typeof v === 'number' && Number.isNaN(v))) return;
  let res;
  try { res = buildLithophane(image, p); } catch (e) { showError(e.message); $('status').textContent = ''; return; }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  const i = res.info;
  $('info').textContent = `${i.width.toFixed(1)} x ${i.depth.toFixed(1)} x ${i.height.toFixed(1)} mm  |  ${i.cols} x ${i.rows} cells  |  ${Math.round(i.triangles).toLocaleString()} triangles`;
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  const lit = backlitPreview(res.grid, p), canvas = $('lit');
  canvas.width = lit.width; canvas.height = lit.height;
  canvas.getContext('2d').putImageData(new ImageData(lit.data, lit.width, lit.height), 0, 0);
  $('status').textContent = '';
  showView();
}

function showView() {
  $('litWrap').hidden = view !== 'lit';
  $('viewport').hidden = view !== '3d';
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === '3d') { viewer.resize(); viewer.setView('print', lastInfo); }
}

$('file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    image = await readImageFile(file, 1200);
    fileName = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lithophane';
    $('source').textContent = `Using ${file.name} (${image.width} x ${image.height} px).`;
    build();
  } catch (err) { showError(err.message); }
});
$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; showView(); }));
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `lithophane-${fileName}.stl`));

build();
