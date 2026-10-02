// Copyright (c) 2025 cmutnik
import { readImageFile } from '../../shared/js/image-trace.js';
import { prepare, maskToRGBA, maskToSvg, dilateMask, cropToContent } from '../../shared/js/image-ops.js';
import { removeBackground, subjectPieces, posterize, posterPreview, layersToSvg, rgbToHex } from '../../shared/js/image-color.js';
import { centerline, pathsToStrokeSvg } from '../../shared/js/skeleton.js';
import { downloadBlob } from '../../shared/js/download.js';
import { zipStore } from '../../shared/js/zip.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);

let file = null;            // the File the user chose
let lastFile = null;
let image = null;           // ImageData at the working size
let outMode = 'png';        // 'png' | 'svg' | 'colors' | 'cutout'
let paper = 'lightest';     // posterize: which palette entry is the paper ('lightest' | 'none' | index)
let result = null;          // what the current result can be downloaded / sent as
let removal = { key: '', image: null, value: null };   // cache of the last background removal
let timer = null, runId = 0, svgUrl = null;

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const baseName = () => (file ? file.name.replace(/\.[^.]+$/, '') : 'image').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'image';
const status = msg => { $('status').textContent = msg || ''; };
function showError(msg) { $('error').hidden = !msg; $('error').textContent = msg || ''; }
const lineStyle = () => $('lineStyle').value;
const needsRemoval = () => outMode === 'cutout' || $('bgRemove').checked;

// ---------- controls ----------
function syncUI() {
  const svg = outMode === 'svg', colors = outMode === 'colors', cutout = outMode === 'cutout';
  const edges = svg && lineStyle() === 'edges', center = svg && lineStyle() === 'centerline';
  document.querySelectorAll('[data-out]').forEach(b => b.classList.toggle('active', b.dataset.out === outMode));
  $('svgStyle').hidden = !svg;
  $('svgBox').hidden = !svg;
  $('toneBox').hidden = !(outMode === 'png' || (svg && !edges));
  $('edgeBox').hidden = !edges;
  $('centerBox').hidden = !center;
  $('colorsBox').hidden = !colors;
  $('bgRemoveRow').hidden = cutout;                       // a cut-out is the background removal
  $('bgOptions').hidden = !needsRemoval();
  $('bgColorRow').hidden = $('bgMode').value !== 'pick';
  $('original').classList.toggle('pickable', needsRemoval());
  $('paperRow').hidden = !(outMode === 'png' || colors);
  $('layersBox').hidden = !colors;
  $('downloadPng').hidden = !(outMode === 'png' || cutout);
  $('downloadSvg').hidden = !svg;
  $('downloadZip').hidden = !colors;
  $('colorExtras').hidden = !colors;
  $('toStamp').hidden = colors;                            // colour layers are sent one by one from the list
  $('downloadPng').textContent = cutout ? 'Download cut-out PNG' : 'Download PNG';
  $('ditherOpt').disabled = svg;                           // halftone dots make a huge, useless SVG
  if (svg && $('method').value === 'dither') $('method').value = 'threshold';
  const method = $('method').value;
  $('thresholdBox').hidden = method !== 'threshold';
  $('adaptiveBox').hidden = method !== 'adaptive';
  $('threshold').disabled = $('autoThreshold').checked;
  $('cropRow').hidden = !$('crop').checked;
  $('nColorsValue').textContent = $('nColors').value;
  $('resultPng').parentElement.classList.toggle('cutout', cutout);
}

function readOptions() {
  const common = { minInk: num('minInk'), fillHoles: num('fillHoles'), crop: $('crop').checked, cropPad: num('cropPad') };
  if (outMode === 'svg' && lineStyle() === 'edges') {
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
  removal = { key: '', image: null, value: null };
  paper = 'lightest';
  if (file !== lastFile) { $('bgMode').value = 'auto'; lastFile = file; }   // a colour picked on the previous picture does not carry over
  $('adaptiveRadius').value = Math.max(5, Math.round(Math.min(image.width, image.height) * 0.08));
  drawOriginal();
  schedule(0);
}

// ---------- background removal (shared by every output) ----------
function getSource() {
  if (!needsRemoval()) return { img: image, cut: null };
  const opts = {
    color: $('bgMode').value === 'pick' ? hexToRgb($('bgColor').value) : 'auto', tolerance: num('bgTolerance'), contiguous: $('bgContiguous').checked, gradient: $('bgGradient').checked,
    feather: num('bgFeather'), shrink: num('bgShrink'), minSubject: num('minInk'),
  };
  const key = JSON.stringify(opts);
  if (removal.image !== image || removal.key !== key) removal = { image, key, value: removeBackground(image, opts) };
  const cut = removal.value;
  if (!cut.pieces) cut.pieces = subjectPieces(cut.subject, image.width, image.height);
  const shattered = cut.removed > 0.3 && cut.pieces.largestShare < 0.6;
  $('bgInfo').textContent = (cut.background
    ? `Removed ${(cut.removed * 100).toFixed(0)}% of the picture (background ${rgbToHex(cut.background)}).`
    : 'The picture\'s edge is already transparent.')
    + (shattered ? ' The subject came out in many pieces: the background is probably too busy or too close in colour. Lower the tolerance, turn off "Follow gradients", or pick the background colour.' : '');
  return { img: { data: cut.rgba, width: image.width, height: image.height }, cut };
}

// ---------- processing ----------
function schedule(delay = 160) { clearTimeout(timer); timer = setTimeout(run, delay); }

function showCanvas(canvas, rgba, w, h) {
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
}
function showSvg(svg) {
  if (svgUrl) URL.revokeObjectURL(svgUrl);
  svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  $('resultSvg').src = svgUrl;
}

async function run() {
  if (!image) return;
  syncUI();
  const id = ++runId;
  status('Processing...');
  await new Promise(r => setTimeout(r, 0));          // let the status paint before the heavy work
  if (id !== runId) return;
  try {
    if (outMode === 'colors') renderColors();
    else if (outMode === 'cutout') renderCutout();
    else renderMask();
    showError('');
  } catch (e) {
    console.error(e);
    showError('Something went wrong while processing: ' + e.message);
  }
  status('');
}

/** black & white PNG, and the three line-art styles */
function renderMask() {
  const { img, cut } = getSource();
  const o = readOptions();
  if (cut && o.source === 'auto') o.source = 'brightness';      // the removed background is paper, not "transparent ink"
  const res = prepare(img, o);
  const { mask, width: w, height: h } = res;
  const ink = mask.reduce((s, v) => s + v, 0), color = $('color').value, png = outMode === 'png';
  let infoText = `${w} x ${h} px  |  ${(100 * ink / (w * h)).toFixed(1)}% black`;
  $('resultPng').hidden = !png;
  $('resultSvg').hidden = png;
  if (png) {
    const paperPx = $('transparent').checked ? [255, 255, 255, 0] : [255, 255, 255, 255];
    showCanvas($('resultPng'), maskToRGBA(mask, w, h, { ink: hexToRgb(color), paper: paperPx }), w, h);
    result = { kind: 'png' };
  } else {
    const svgOpts = { tolerance: num('tolerance'), minArea: 6, smooth: $('smoothCurves').checked, color };
    let out, filled = null;
    if (lineStyle() === 'centerline') {
      const lw = num('clWidth');
      const cl = centerline(mask, w, h, { prune: num('clPrune') });
      const fat = dilateMask(cl.skeleton, w, h, Math.max(0, (lw - 1) / 2));
      filled = maskToSvg(fat, w, h, { ...svgOpts, minArea: 4 });
      out = $('clOutput').value === 'strokes' ? { ...pathsToStrokeSvg(cl.paths, w, h, { width: lw, color, tolerance: num('tolerance'), smooth: svgOpts.smooth }), nodes: 0 } : filled;
      out.shapes = out.shapes ?? out.paths;
      infoText += `  |  ${cl.paths.length} lines, ${lw}px thick`;
      if ($('clOutput').value === 'strokes') infoText += '  (the stamp generator needs the filled version; the button sends that)';
    } else {
      out = maskToSvg(mask, w, h, svgOpts);
    }
    showSvg(out.svg);
    result = { kind: 'svg', svg: out.svg, filledSvg: filled ? filled.svg : out.svg };
    infoText += `  |  ${out.shapes} ${lineStyle() === 'centerline' && $('clOutput').value === 'strokes' ? 'paths' : 'shapes'}${out.nodes ? `, ${out.nodes.toLocaleString()} points` : ''}, ${(out.svg.length / 1024).toFixed(0)} KB`;
    if (!out.shapes) showError('No shapes found - try a different threshold, more detail, or Invert.');
  }
  if (res.threshold != null && $('autoThreshold').checked) {
    $('thrValue').textContent = `(${res.source}, cut-off ${Math.round(res.threshold)})`;
    $('threshold').value = Math.round(res.threshold);
  }
  const frac = ink / (w * h), plain = png || lineStyle() !== 'edges';
  if (plain && $('method').value === 'threshold' && (frac > 0.7 || frac < 0.02) && !(outMode === 'svg' && lineStyle() === 'edges')) {
    infoText += frac > 0.7 ? '  |  Mostly black. For a photo try Adaptive or Dither; for light-on-dark art try Invert.' : '  |  Almost empty. Try Invert, a higher threshold, or Adaptive.';
  }
  $('info').textContent = infoText;
}

/** colour picture with the background cut away */
function renderCutout() {
  const { cut } = getSource();
  let rgba = cut.rgba, w = image.width, h = image.height;
  if ($('crop').checked) {
    const c = cropToContent(cut.subject, w, h, num('cropPad'));
    const out = new Uint8ClampedArray(c.width * c.height * 4);
    for (let y = 0; y < c.height; y++) out.set(rgba.subarray(((y + c.y0) * w + c.x0) * 4, ((y + c.y0) * w + c.x0 + c.width) * 4), y * c.width * 4);
    rgba = out; w = c.width; h = c.height;
  }
  $('resultPng').hidden = false;
  $('resultSvg').hidden = true;
  showCanvas($('resultPng'), rgba, w, h);
  result = { kind: 'png' };
  $('info').textContent = `${w} x ${h} px  |  background removed from ${(cut.removed * 100).toFixed(0)}% of the picture`
    + (cut.background ? `  |  background colour ${rgbToHex(cut.background)}` : '');
  if (cut.removed < 0.02) showError('Hardly any background was found. Try a higher tolerance, or pick the background colour.');
  else if (cut.removed > 0.97) showError('Almost everything was removed. Lower the tolerance or pick the background colour.');
}

/** posterized colour layers */
function renderColors() {
  const { img } = getSource();
  const p = posterize(img, { colors: num('nColors'), smooth: num('posterSmooth'), paper, minInk: num('minInk'), fillHoles: num('fillHoles'), crop: $('crop').checked, cropPad: num('cropPad') });
  $('resultPng').hidden = false;
  $('resultSvg').hidden = true;
  showCanvas($('resultPng'), posterPreview(p, { paperColor: [255, 255, 255, $('transparent').checked ? 0 : 255] }), p.width, p.height);
  result = { kind: 'colors', poster: p, svgs: null };
  // palette: click a swatch to make it the paper
  const pal = $('palette');
  pal.replaceChildren(...p.palette.map((c, i) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'swatch' + (i === p.paper ? ' paper' : ''), title: `${rgbToHex(c)} - click to make this the paper colour` });
    b.style.background = rgbToHex(c);
    b.addEventListener('click', () => { paper = p.paper === i ? 'none' : i; schedule(0); });   // the paper swatch again = no paper at all
    return b;
  }));
  // layer list
  $('layers').replaceChildren(...p.layers.map((l, n) => {
    const row = document.createElement('div');
    row.className = 'layer';
    row.innerHTML = '<span class="chip"></span><span class="name"></span>';
    row.querySelector('.chip').style.background = rgbToHex(l.color);
    row.querySelector('.name').innerHTML = `Layer ${n + 1} <small>${rgbToHex(l.color)} &middot; ${(l.coverage * 100).toFixed(1)}% of the picture</small>`;
    const svgBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'SVG' });
    const stampBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Use in stamp' });
    svgBtn.addEventListener('click', () => downloadBlob(new Blob([layerSvgs().layers[n].svg], { type: 'image/svg+xml' }), `${baseName()}-layer${n + 1}-${rgbToHex(l.color).slice(1)}.svg`));
    stampBtn.addEventListener('click', () => sendToStamp({ name: `${baseName()}-layer${n + 1}.svg`, type: 'image/svg+xml', svg: layerSvgs({ fill: '#000000' }).layers[n].svg, frame: true }));
    row.append(svgBtn, stampBtn);
    return row;
  }));
  $('info').textContent = `${p.width} x ${p.height} px  |  ${p.layers.length} layer${p.layers.length === 1 ? '' : 's'}`
    + (p.paper == null ? '  |  no paper colour: every colour is a layer' : '')
    + '  |  All layers share one frame. In the stamp generator keep "Keep the picture\'s frame" ticked and use the same stamp size for each layer.';
  if (!p.layers.length) showError('No layers: every colour is the paper colour. Click a swatch to choose a different paper colour.');
}

const svgOptions = () => ({ tolerance: num('tolerance'), minArea: 6, smooth: $('smoothCurves').checked });
function layerSvgs(over = {}) {
  const key = JSON.stringify([over, svgOptions()]);
  if (!result.svgs || result.svgs.key !== key) result.svgs = { key, value: layersToSvg(result.poster, { ...svgOptions(), ...over }) };
  return result.svgs.value;
}

// ---------- downloads ----------
const pngBlob = () => new Promise(resolve => $('resultPng').toBlob(resolve, 'image/png'));

$('downloadPng').addEventListener('click', async () => { if (result) downloadBlob(await pngBlob(), `${baseName()}-${outMode === 'cutout' ? 'cutout' : 'bw'}.png`); });
$('downloadSvg').addEventListener('click', () => { if (result && result.svg) downloadBlob(new Blob([result.svg], { type: 'image/svg+xml' }), `${baseName()}-lineart.svg`); });
$('downloadCombined').addEventListener('click', () => { if (result && result.poster) downloadBlob(new Blob([layerSvgs().combined], { type: 'image/svg+xml' }), `${baseName()}-colours.svg`); });
$('downloadPreview').addEventListener('click', async () => { if (result && result.poster) downloadBlob(await pngBlob(), `${baseName()}-colours.png`); });
$('downloadZip').addEventListener('click', async () => {
  if (!result || !result.poster) return;
  const out = layerSvgs(), files = out.layers.map((l, n) => [`${baseName()}-layer${n + 1}-${rgbToHex(l.color).slice(1)}.svg`, l.svg]);
  files.push([`${baseName()}-colours.svg`, out.combined]);
  files.push([`${baseName()}-colours.png`, new Uint8Array(await (await pngBlob()).arrayBuffer())]);
  downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), `${baseName()}-layers.zip`);
});

const toDataUrl = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });

/** Hand a picture to the stamp generator (read once on its load, see tools/stamp/stamp.js). */
async function sendToStamp({ name, type, svg = null, blob = null, frame = false }) {
  const dataUrl = svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : await toDataUrl(blob);
  try {
    sessionStorage.setItem('etsytools.handoff', JSON.stringify({ name, type, dataUrl, frame }));
  } catch {
    showError('That result is too large to send directly. Download it and upload it in the stamp generator instead.');
    return;
  }
  location.href = '../stamp/';
}
$('toStamp').addEventListener('click', async () => {
  if (!result) { showError('Choose a picture first.'); return; }
  if (result.kind === 'svg') await sendToStamp({ name: `${baseName()}-lineart.svg`, type: 'image/svg+xml', svg: result.filledSvg });
  else await sendToStamp({ name: `${baseName()}-${outMode === 'cutout' ? 'cutout' : 'bw'}.png`, type: 'image/png', blob: await pngBlob() });
});

// ---------- wiring ----------
$('file').addEventListener('change', e => loadFile(e.target.files[0]));
$('maxSide').addEventListener('change', () => file && loadFile(file));
document.querySelectorAll('[data-out]').forEach(b => b.addEventListener('click', () => { outMode = b.dataset.out; syncUI(); schedule(0); }));
const onControl = e => { if (e.target.id === 'file' || e.target.id === 'maxSide') return; if (e.target.id === 'nColors') paper = 'lightest'; syncUI(); schedule(); };
$('controls').addEventListener('input', onControl);
$('controls').addEventListener('change', onControl);

// click the original picture to pick the background colour
$('original').addEventListener('click', e => {
  if (!image || !needsRemoval()) return;
  const c = $('original'), r = c.getBoundingClientRect();
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(((e.clientX - r.left) * image.width) / r.width)));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor(((e.clientY - r.top) * image.height) / r.height)));
  const i = (y * image.width + x) * 4;
  $('bgColor').value = rgbToHex([image.data[i], image.data[i + 1], image.data[i + 2]]);
  $('bgMode').value = 'pick';
  syncUI(); schedule(0);
});

const drop = $('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

syncUI();
