// Copyright (c) 2025 cmutnik
import { readImageFile } from '../../shared/js/image-trace.js';
import { prepare, maskToRGBA, maskToSvg } from '../../shared/js/image-ops.js';
import { downloadBlob } from '../../shared/js/download.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);

let file = null;          // the File the user chose
let image = null;         // ImageData at the working size
let outMode = 'png';      // 'png' | 'svg'
let result = null;        // { svg?: string, width, height }
let timer = null, runId = 0, svgUrl = null;

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const baseName = () => (file ? file.name.replace(/\.[^.]+$/, '') : 'image').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'image';
const status = msg => { $('status').textContent = msg || ''; };
function showError(msg) { $('error').hidden = !msg; $('error').textContent = msg || ''; }

// ---------- controls ----------
function syncUI() {
  const svg = outMode === 'svg', edges = svg && $('lineStyle').value === 'edges';
  document.querySelectorAll('[data-out]').forEach(b => b.classList.toggle('active', b.dataset.out === outMode));
  $('svgStyle').hidden = !svg;
  $('svgBox').hidden = !svg;
  $('toneBox').hidden = edges;
  $('edgeBox').hidden = !edges;
  $('paperRow').hidden = svg;
  $('downloadPng').hidden = svg;
  $('downloadSvg').hidden = !svg;
  $('ditherOpt').disabled = svg;                       // halftone dots make a huge, useless SVG
  if (svg && $('method').value === 'dither') $('method').value = 'threshold';
  const method = $('method').value;
  $('thresholdBox').hidden = method !== 'threshold';
  $('adaptiveBox').hidden = method !== 'adaptive';
  $('threshold').disabled = $('autoThreshold').checked;
  $('cropRow').hidden = !$('crop').checked;
}

function readOptions() {
  const common = { minInk: num('minInk'), fillHoles: num('fillHoles'), crop: $('crop').checked, cropPad: num('cropPad') };
  if (outMode === 'svg' && $('lineStyle').value === 'edges') {
    return { ...common, method: 'edges', source: $('edgeSource').value, edgeSigma: num('edgeSigma'), edgeSens: num('edgeSens') / 100, lineWidth: num('lineWidth'), invert: $('edgeInvert').checked, stretch: true };
  }
  return {
    ...common, method: $('method').value, source: $('source').value, threshold: $('autoThreshold').checked ? 'auto' : num('threshold'),
    blur: num('blur'), stretch: $('stretch').checked, invert: $('invert').checked, adaptiveRadius: num('adaptiveRadius'), adaptiveOffset: num('adaptiveOffset'),
  };
}

// ---------- loading ----------
function drawOriginal() {
  const c = $('original');
  c.width = image.width; c.height = image.height;
  c.getContext('2d').putImageData(image, 0, 0);
  $('placeholder').hidden = true;
}

async function loadFile(f) {
  if (!f) return;
  file = f;
  status('Reading picture...');
  showError('');
  try {
    image = await readImageFile(f, parseInt($('maxSide').value, 10));
  } catch {
    image = null;
    showError('Could not open that file. Try a PNG or JPG.');
    status('');
    return;
  }
  $('adaptiveRadius').value = Math.max(5, Math.round(Math.min(image.width, image.height) * 0.08));
  drawOriginal();
  schedule(0);
}

// ---------- processing ----------
function schedule(delay = 160) { clearTimeout(timer); timer = setTimeout(run, delay); }

async function run() {
  if (!image) return;
  syncUI();
  const id = ++runId;
  status('Processing...');
  await new Promise(r => setTimeout(r, 0));          // let the status paint before the heavy work
  if (id !== runId) return;
  let res;
  try {
    res = prepare(image, readOptions());
  } catch (e) {
    showError('Something went wrong while processing: ' + e.message);
    status('');
    return;
  }
  showError('');
  const { mask, width: w, height: h } = res;
  const ink = mask.reduce((s, v) => s + v, 0);
  const color = $('color').value;
  const png = outMode === 'png';
  let infoText = `${w} x ${h} px  |  ${(100 * ink / (w * h)).toFixed(1)}% black`;

  $('resultPng').hidden = !png;
  $('resultSvg').hidden = png;
  if (png) {
    const c = $('resultPng');
    c.width = w; c.height = h;
    const paper = $('transparent').checked ? [255, 255, 255, 0] : [255, 255, 255, 255];
    c.getContext('2d').putImageData(new ImageData(maskToRGBA(mask, w, h, { ink: hexToRgb(color), paper }), w, h), 0, 0);
    result = { width: w, height: h };
  } else {
    const out = maskToSvg(mask, w, h, { tolerance: num('tolerance'), minArea: 6, smooth: $('smoothCurves').checked, color });
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    svgUrl = URL.createObjectURL(new Blob([out.svg], { type: 'image/svg+xml' }));
    $('resultSvg').src = svgUrl;
    result = { svg: out.svg, width: w, height: h };
    infoText += `  |  ${out.shapes} shapes, ${out.nodes.toLocaleString()} points, ${(out.svg.length / 1024).toFixed(0)} KB`;
    if (out.shapes === 0) showError('No shapes found - try a different threshold, more detail, or Invert.');
  }
  if (res.threshold != null && $('autoThreshold').checked) {
    $('thrValue').textContent = `(${res.source}, cut-off ${Math.round(res.threshold)})`;
    $('threshold').value = Math.round(res.threshold);
  }
  $('info').textContent = infoText;
  const frac = ink / (w * h), plain = outMode === 'png' || $('lineStyle').value === 'trace';
  if (plain && $('method').value === 'threshold' && (frac > 0.7 || frac < 0.02)) {
    $('info').textContent += frac > 0.7
      ? '  |  Mostly black. For a photo try Adaptive or Dither; for light-on-dark art try Invert.'
      : '  |  Almost empty. Try Invert, a higher threshold, or Adaptive.';
  }
  status('');
}

// ---------- downloads ----------
function pngBlob() { return new Promise(resolve => $('resultPng').toBlob(resolve, 'image/png')); }

$('downloadPng').addEventListener('click', async () => { if (result) downloadBlob(await pngBlob(), `${baseName()}-bw.png`); });
$('downloadSvg').addEventListener('click', () => { if (result && result.svg) downloadBlob(new Blob([result.svg], { type: 'image/svg+xml' }), `${baseName()}-lineart.svg`); });

const toDataUrl = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
$('toStamp').addEventListener('click', async () => {
  if (!result) { showError('Choose a picture first.'); return; }
  let handoff;
  if (outMode === 'svg') handoff = { name: `${baseName()}-lineart.svg`, type: 'image/svg+xml', dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.svg) };
  else handoff = { name: `${baseName()}-bw.png`, type: 'image/png', dataUrl: await toDataUrl(await pngBlob()) };
  try {
    sessionStorage.setItem('etsytools.handoff', JSON.stringify(handoff));
  } catch {
    showError('That result is too large to send directly. Download it and upload it in the stamp generator instead.');
    return;
  }
  location.href = '../stamp/';
});

// ---------- wiring ----------
$('file').addEventListener('change', e => loadFile(e.target.files[0]));
$('maxSide').addEventListener('change', () => file && loadFile(file));
document.querySelectorAll('[data-out]').forEach(b => b.addEventListener('click', () => { outMode = b.dataset.out; syncUI(); schedule(0); }));
$('controls').addEventListener('input', e => { if (e.target.id !== 'file' && e.target.id !== 'maxSide') { syncUI(); schedule(); } });
$('controls').addEventListener('change', e => { if (e.target.id !== 'file' && e.target.id !== 'maxSide') { syncUI(); schedule(); } });

const drop = $('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

syncUI();
