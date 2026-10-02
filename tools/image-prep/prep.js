// Copyright (c) 2025 cmutnik
import { readImageFile, explainImageError } from '../../shared/js/image-trace.js';
import { prepare, maskToRGBA, maskToSvg, dilateMask, cropToContent } from '../../shared/js/image-ops.js';
import { removeBackground, cutOut, subjectPieces, posterize, posterPreview, layersToSvg, rgbToHex } from '../../shared/js/image-color.js';
import { segmentWithMarks } from '../../shared/js/segmentation.js';
import { centerline, pathsToStrokeSvg } from '../../shared/js/skeleton.js';
import { thinFeatures, MIN_FEATURE_MM } from '../../shared/js/raster-tools.js';
import { downloadBlob } from '../../shared/js/download.js';
import { zipStore } from '../../shared/js/zip.js';
import { PRESETS } from './presets.js';

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
let zoom = 'fit';           // 'fit' or a number (1 = one picture pixel per screen pixel)
const shown = { res: null };// size of the picture currently in the result frame { w, h }

// marks for "mark the subject and background" removal
let marks = null;           // Uint8Array(w*h): 0 none, 1 subject, 2 background
let marksVersion = 0;
let brush = 'subject';
let painting = false, lastPoint = null;

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const baseName = () => (file ? file.name.replace(/\.[^.]+$/, '') : 'image').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'image';
const status = msg => { $('status').textContent = msg || ''; };
// errors show at the top of the preview, where they are seen, as well as beside the buttons
function showError(msg) {
  for (const id of ['error', 'previewError']) { $(id).hidden = !msg; $(id).textContent = msg || ''; }
}
const PLACEHOLDER = 'Choose or drop a picture to start.';
const lineStyle = () => $('lineStyle').value;
const needsRemoval = () => outMode === 'cutout' || $('bgRemove').checked;
const marksMode = () => needsRemoval() && $('bgMode').value === 'marks';

// ---------- presets ----------
for (const p of PRESETS) $('preset').append(Object.assign(document.createElement('option'), { value: p.id, textContent: p.label }));

function applyPreset(p) {
  outMode = p.out;
  for (const [id, value] of Object.entries(p.set)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
  }
  paper = 'lightest';
  syncUI();
  schedule(0);
}
$('preset').addEventListener('change', () => { const p = PRESETS.find(x => x.id === $('preset').value); if (p) applyPreset(p); });

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
  const marksOn = marksMode();
  $('marksBox').hidden = !marksOn;
  $('colourKeyBox').hidden = marksOn;
  $('bgColorRow').hidden = $('bgMode').value !== 'pick';
  $('original').classList.toggle('pickable', needsRemoval() && !marksOn);
  $('marks').classList.toggle('painting', marksOn);
  $('marks').hidden = !marksOn;
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
  $('showThinRow').hidden = !(num('printWidth') > 0);
  $('resultPng').parentElement.parentElement.classList.toggle('cutout', cutout);
  document.querySelectorAll('[data-brush]').forEach(b => b.classList.toggle('active', b.dataset.brush === brush));
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

// ---------- previews: size, zoom, scrolling ----------
function layoutPreviews() {
  const items = [['stackOrig', 'frameOrig', image && { w: image.width, h: image.height }], ['stackRes', 'frameRes', shown.res]];
  for (const [sid, fid, d] of items) {
    const stack = $(sid), frame = $(fid);
    if (!d) { stack.style.width = stack.style.height = '0px'; continue; }
    const avail = Math.max(120, (frame.clientWidth || 400) - 4);
    const fit = Math.min(avail / d.w, 516 / d.h);
    const scale = zoom === 'fit' ? fit : zoom;
    stack.style.width = Math.round(d.w * scale) + 'px';
    stack.style.height = Math.round(d.h * scale) + 'px';
  }
}
document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => {
  zoom = b.dataset.zoom === 'fit' ? 'fit' : parseFloat(b.dataset.zoom);
  document.querySelectorAll('[data-zoom]').forEach(x => x.classList.toggle('active', x === b));
  layoutPreviews();
}));
window.addEventListener('resize', layoutPreviews);
// keep the two pictures at the same relative scroll position, so the same spot can be compared
let syncing = false;
for (const [a, b] of [['frameOrig', 'frameRes'], ['frameRes', 'frameOrig']]) {
  $(a).addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    const A = $(a), B = $(b), fx = A.scrollLeft / Math.max(1, A.scrollWidth - A.clientWidth), fy = A.scrollTop / Math.max(1, A.scrollHeight - A.clientHeight);
    B.scrollLeft = fx * (B.scrollWidth - B.clientWidth); B.scrollTop = fy * (B.scrollHeight - B.clientHeight);
    requestAnimationFrame(() => { syncing = false; });
  });
}

// ---------- loading ----------
function drawOriginal() {
  const c = $('original');
  c.width = image.width; c.height = image.height;
  c.getContext('2d').putImageData(image, 0, 0);
  $('placeholder').hidden = true;
}

function resetMarks() {
  marks = new Uint8Array(image.width * image.height);
  marksVersion++;
  const c = $('marks');
  c.width = image.width; c.height = image.height;
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  $('brushSize').value = Math.max(2, Math.min(80, Math.round(Math.min(image.width, image.height) * 0.02)));
}

async function loadFile(f) {
  if (!f) return;
  file = f;
  status('Reading picture...');
  showError('');
  try {
    image = await readImageFile(f, parseInt($('maxSide').value, 10));
  } catch (e) {
    // forget the previous picture too: leaving it on screen next to an unseen error looks like the new one loaded
    image = null; result = null; shown.res = null;
    const c = $('original');
    c.width = c.height = 1;
    c.getContext('2d').clearRect(0, 0, 1, 1);
    $('placeholder').hidden = false;
    $('placeholder').textContent = e.message || explainImageError(f);
    $('resultPng').hidden = true; $('resultSvg').hidden = true; $('thin').hidden = true;
    $('info').textContent = '';
    layoutPreviews();
    showError(e.message || explainImageError(f));
    status('');
    return;
  }
  $('placeholder').textContent = PLACEHOLDER;
  removal = { key: '', image: null, value: null };
  paper = 'lightest';
  if (file !== lastFile) { if ($('bgMode').value === 'pick') $('bgMode').value = 'auto'; lastFile = file; }   // a picked colour does not carry over
  $('adaptiveRadius').value = Math.max(5, Math.round(Math.min(image.width, image.height) * 0.08));
  drawOriginal();
  resetMarks();
  layoutPreviews();
  schedule(0);
}

// ---------- painting marks ----------
const COLORS = { subject: 'rgba(10, 200, 90, 0.6)', background: 'rgba(230, 30, 40, 0.6)' };
function paintDisc(cx, cy, r, value) {
  const w = image.width, h = image.height, ctx = $('marks').getContext('2d');
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) marks[y * w + x] = value;
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (value === 0) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; }
  else ctx.fillStyle = value === 1 ? COLORS.subject : COLORS.background;
  ctx.fill();
  ctx.restore();
}
function strokeTo(x, y) {
  const r = num('brushSize') / 2, value = brush === 'subject' ? 1 : brush === 'background' ? 2 : 0;
  if (!lastPoint) { paintDisc(x, y, r, value); lastPoint = [x, y]; return; }
  const dx = x - lastPoint[0], dy = y - lastPoint[1], dist = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 2)));
  for (let i = 1; i <= steps; i++) paintDisc(lastPoint[0] + (dx * i) / steps, lastPoint[1] + (dy * i) / steps, r, value);
  lastPoint = [x, y];
}
const pointerToImage = e => { const r = $('marks').getBoundingClientRect(); return [((e.clientX - r.left) * image.width) / r.width, ((e.clientY - r.top) * image.height) / r.height]; };
$('marks').addEventListener('pointerdown', e => { if (!image || !marksMode()) return; painting = true; lastPoint = null; $('marks').setPointerCapture(e.pointerId); strokeTo(...pointerToImage(e)); e.preventDefault(); });
$('marks').addEventListener('pointermove', e => { if (painting) strokeTo(...pointerToImage(e)); });
const endStroke = () => { if (!painting) return; painting = false; lastPoint = null; marksVersion++; schedule(0); };
$('marks').addEventListener('pointerup', endStroke);
$('marks').addEventListener('pointercancel', endStroke);
document.querySelectorAll('[data-brush]').forEach(b => b.addEventListener('click', () => { brush = b.dataset.brush; syncUI(); }));
$('clearMarks').addEventListener('click', () => { if (image) { resetMarks(); schedule(0); } });

// ---------- background removal (shared by every output) ----------
function getSource() {
  if (!needsRemoval()) return { img: image, cut: null };
  const common = { feather: num('bgFeather'), shrink: num('bgShrink'), minSubject: num('minInk') };
  if ($('bgMode').value === 'marks') {
    const opts = { ...common, bias: num('marksBias') / 100, version: marksVersion };
    const key = JSON.stringify(opts);
    if (removal.image !== image || removal.key !== key) {
      const seg = segmentWithMarks(image, marks, { bias: opts.bias });
      removal = { image, key, value: seg ? { ...cutOut(image, seg.subject, common), background: null } : null };
    }
    const cut = removal.value;
    if (!cut) {
      $('bgInfo').textContent = 'Paint at least one stroke on the subject (green) and one on the background (red).';
      return { img: image, cut: null, pending: true };
    }
    $('bgInfo').textContent = `Kept ${((1 - cut.removed) * 100).toFixed(0)}% of the picture as the subject. Add strokes where the edge is wrong.`;
    return { img: { data: cut.rgba, width: image.width, height: image.height }, cut };
  }
  const opts = { ...common, color: $('bgMode').value === 'pick' ? hexToRgb($('bgColor').value) : 'auto', tolerance: num('bgTolerance'), contiguous: $('bgContiguous').checked, gradient: $('bgGradient').checked };
  const key = JSON.stringify(opts);
  if (removal.image !== image || removal.key !== key) removal = { image, key, value: removeBackground(image, opts) };
  const cut = removal.value;
  if (!cut.pieces) cut.pieces = subjectPieces(cut.subject, image.width, image.height);
  const shattered = cut.removed > 0.3 && cut.pieces.largestShare < 0.6;
  $('bgInfo').textContent = (cut.background
    ? `Removed ${(cut.removed * 100).toFixed(0)}% of the picture (background ${rgbToHex(cut.background)}).`
    : 'The picture\'s edge is already transparent.')
    + (shattered ? ' The subject came out in many pieces: the background is probably too busy or too close in colour. Try "Mark the subject and background" instead.' : '');
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

/** Red overlay on the result for black details thinner than MIN_FEATURE_MM at the print width the user entered. */
function drawThin(mask, w, h) {
  const canvas = $('thin'), printWidth = num('printWidth');
  canvas.hidden = true;
  if (!(printWidth > 0) || !$('showThin').checked) return '';
  const pxPerMm = w / printWidth, radius = (MIN_FEATURE_MM / 2) * pxPerMm;
  if (radius < 0.6) return `  |  too few pixels to judge details at ${printWidth} mm wide (raise the working size)`;
  const { thin, inkPixels, thinPixels } = thinFeatures(mask, w, h, radius);
  if (thinPixels) {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) if (thin[i]) px.set([225, 29, 72, 235], i * 4);
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
    canvas.hidden = false;
  }
  const pct = inkPixels ? (100 * thinPixels) / inkPixels : 0;
  return `  |  ${pct.toFixed(1)}% of the black is thinner than ${MIN_FEATURE_MM} mm at ${printWidth} mm wide` + (pct > 3 ? ' (shown in red: thicken, simplify or enlarge)' : '');
}

async function run() {
  if (!image) return;
  syncUI();
  const id = ++runId;
  status('Processing...');
  await new Promise(r => setTimeout(r, 0));          // let the status paint before the heavy work
  if (id !== runId) return;
  try {
    $('thin').hidden = true;
    if (outMode === 'colors') renderColors();
    else if (outMode === 'cutout') renderCutout();
    else renderMask();
    showError('');
  } catch (e) {
    console.error(e);
    showError('Something went wrong while processing: ' + e.message);
  }
  layoutPreviews();
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
  let printed = mask;                                            // what will actually be printed, for the thin-detail check
  $('resultPng').hidden = !png;
  $('resultSvg').hidden = png;
  shown.res = { w, h };
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
      printed = fat;
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
  $('info').textContent = infoText + drawThin(printed, w, h);
}

/** colour picture with the background cut away */
function renderCutout() {
  const { cut, pending } = getSource();
  $('resultPng').hidden = false;
  $('resultSvg').hidden = true;
  if (!cut) {                                                       // marks mode, nothing painted yet: show the picture as it is
    shown.res = { w: image.width, h: image.height };
    showCanvas($('resultPng'), new Uint8ClampedArray(image.data), image.width, image.height);
    result = { kind: 'png' };
    $('info').textContent = pending ? 'Paint strokes on the original picture to choose the subject and the background.' : '';
    return;
  }
  let rgba = cut.rgba, w = image.width, h = image.height;
  if ($('crop').checked) {
    const c = cropToContent(cut.subject, w, h, num('cropPad'));
    const out = new Uint8ClampedArray(c.width * c.height * 4);
    for (let y = 0; y < c.height; y++) out.set(rgba.subarray(((y + c.y0) * w + c.x0) * 4, ((y + c.y0) * w + c.x0 + c.width) * 4), y * c.width * 4);
    rgba = out; w = c.width; h = c.height;
  }
  shown.res = { w, h };
  showCanvas($('resultPng'), rgba, w, h);
  result = { kind: 'png' };
  $('info').textContent = `${w} x ${h} px  |  background removed from ${(cut.removed * 100).toFixed(0)}% of the picture`
    + (cut.background ? `  |  background colour ${rgbToHex(cut.background)}` : '');
  if (cut.removed < 0.02) showError('Hardly any background was found. Try a higher tolerance, pick the background colour, or mark the subject and background.');
  else if (cut.removed > 0.97) showError('Almost everything was removed. Lower the tolerance, pick the background colour, or mark the subject and background.');
}

/** posterized colour layers */
function renderColors() {
  const { img } = getSource();
  const p = posterize(img, { colors: num('nColors'), smooth: num('posterSmooth'), paper, minInk: num('minInk'), fillHoles: num('fillHoles'), crop: $('crop').checked, cropPad: num('cropPad') });
  $('resultPng').hidden = false;
  $('resultSvg').hidden = true;
  shown.res = { w: p.width, h: p.height };
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
  const union = new Uint8Array(p.width * p.height);
  for (const l of p.layers) for (let i = 0; i < union.length; i++) if (l.mask[i]) union[i] = 1;
  $('info').textContent = `${p.width} x ${p.height} px  |  ${p.layers.length} layer${p.layers.length === 1 ? '' : 's'}`
    + (p.paper == null ? '  |  no paper colour: every colour is a layer' : '')
    + '  |  All layers share one frame. In the stamp generator keep "Keep the picture\'s frame" ticked and use the same stamp size for each layer.'
    + drawThin(union, p.width, p.height);
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
document.querySelectorAll('[data-out]').forEach(b => b.addEventListener('click', () => { outMode = b.dataset.out; $('preset').value = ''; syncUI(); schedule(0); }));
const onControl = e => {
  if (['file', 'maxSide', 'preset', 'brushSize'].includes(e.target.id)) return;
  if (e.target.id === 'nColors') paper = 'lightest';
  $('preset').value = '';                                  // the user is tuning by hand now
  syncUI(); schedule();
};
$('controls').addEventListener('input', onControl);
$('controls').addEventListener('change', onControl);

// click the original picture to pick the background colour
$('original').addEventListener('click', e => {
  if (!image || !needsRemoval() || marksMode()) return;
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
