// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { loadFont, parseFont, populateFontSelect, FONTS } from '../../shared/js/fonts.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { svgToGroups } from '../../shared/js/svg-import.js';
import { imageToGroups, readImageFile } from '../../shared/js/image-trace.js';
import { buildStamp } from './geometry.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const statusEl = $('status');
const viewer = createViewer($('viewport'));

// ---------- fonts ----------
let font = null;
populateFontSelect($('font'));

async function selectFont() {
  statusEl.textContent = 'Loading font...';
  try {
    font = await loadFont(FONTS[parseInt($('font').value, 10)].url);
    statusEl.textContent = '';
  } catch {
    font = null;
    statusEl.textContent = 'Could not load font (offline?). Try uploading a font file.';
  }
  rebuild();
}
$('font').addEventListener('change', selectFont);
$('fontFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    font = parseFont(await file.arrayBuffer());
    statusEl.textContent = `Using ${file.name}`;
    rebuild();
  } catch {
    statusEl.textContent = 'Could not read that font file (WOFF2 is not supported).';
  }
});

// ---------- logo ----------
let logoSource = null; // { kind: 'svg', text } | { kind: 'raster', image: ImageData }
let logo = null;       // { groups, width, height } derived from logoSource + current options

function updateLogo() {
  if (!logoSource) { logo = null; return; }
  try {
    logo = logoSource.kind === 'svg'
      ? svgToGroups(logoSource.text, { ignoreWhite: $('ignoreWhite').checked })
      : imageToGroups(logoSource.image, { threshold: num('threshold'), invert: $('invert').checked });
    if (!logo.groups.length) statusEl.textContent = 'No shapes found in that logo - try another threshold or Invert.';
    else statusEl.textContent = '';
  } catch (err) {
    logo = null;
    statusEl.textContent = 'Could not read that logo file.';
    console.error(err);
  }
}

$('logoFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) { logoSource = null; rebuild(true); return; }
  statusEl.textContent = 'Reading logo...';
  try {
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) logoSource = { kind: 'svg', text: await file.text() };
    else logoSource = { kind: 'raster', image: await readImageFile(file) };
  } catch {
    logoSource = null;
    statusEl.textContent = 'Could not open that image.';
  }
  rebuild(true);
});

// ---------- build ----------
let stamp = null;
let lastInfo = { width: 50, depth: 30, height: 10 };
let view = 'print';
let firstBuild = true;
let timer = null;
let logoDirty = false;

function readParams() {
  return {
    artMode: $('artMode').value,
    logo,
    logoShare: num('logoShare') / 100,
    font,
    text: $('text').value,
    fontSize: num('fontSize'),
    lineSpacing: num('lineSpacing'),
    autoFit: $('autoFit').checked,
    textPadding: num('textPadding'),
    shape: $('shape').value,
    width: num('width'),
    height: num('height'),
    cornerRadius: $('shape').value === 'rect' ? num('cornerRadius') : 0,
    border: $('border').checked,
    borderWidth: num('borderWidth'),
    margin: num('margin'),
    relief: num('relief'),
    baseThickness: num('baseThickness'),
    handle: $('handle').value,
    handleSize: num('handleSize'),
    handleHeight: num('handleHeight'),
    marker: $('marker').checked,
  };
}

function rebuild(reloadLogo = false) {
  logoDirty = logoDirty || reloadLogo === true;
  clearTimeout(timer);
  timer = setTimeout(doBuild, 120);
}

function doBuild() {
  if (logoDirty) { updateLogo(); logoDirty = false; }
  const p = readParams();
  if ([p.fontSize, p.lineSpacing, p.textPadding, p.width, p.height, p.borderWidth, p.margin, p.relief, p.baseThickness, p.handleSize, p.handleHeight, p.logoShare].some(Number.isNaN)) return;

  const usesLogo = p.artMode !== 'text', usesText = p.artMode !== 'logo';
  $('logoControls').style.display = usesLogo ? '' : 'none';
  $('textFieldset').style.display = usesText ? '' : 'none';
  $('logoShare').parentElement.style.display = p.artMode === 'logo' || p.artMode === 'text' ? 'none' : '';
  const isSvg = logoSource && logoSource.kind === 'svg';
  $('whiteRow').style.display = !logoSource || isSvg ? '' : 'none';
  $('rasterRow').style.display = !logoSource || !isSvg ? '' : 'none';
  $('fontSizeRow').style.display = p.autoFit ? 'none' : '';
  $('cornerRadius').disabled = p.shape !== 'rect';
  $('borderWidth').disabled = !p.border;
  $('handleSize').disabled = $('handleHeight').disabled = p.handle === 'none';

  const res = buildStamp(p);
  stamp = res.group;
  viewer.setObject(stamp);
  lastInfo = res.info;
  if (firstBuild) { firstBuild = false; viewer.resize(); viewer.setView(view, lastInfo); }

  const i = res.info;
  $('info').textContent = `${i.width} x ${i.depth} x ${i.height.toFixed(1)} mm  |  ${Math.round(i.triangles).toLocaleString()} triangles` +
    (i.textInfo ? `  |  text height ~${i.textInfo.fontSizeMm.toFixed(1)} mm` : '');
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  const empty = !stamp.children.some(c => c.name === 'relief');
  $('download').disabled = $('download3mf').disabled = empty;
}

$('controls').addEventListener('input', e => rebuild(e.target.id === 'threshold' || e.target.id === 'invert' || e.target.id === 'ignoreWhite'));
$('controls').addEventListener('change', e => rebuild(e.target.id === 'threshold' || e.target.id === 'invert' || e.target.id === 'ignoreWhite'));

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view === 'face' ? 'underside' : 'print', lastInfo);
}));

// ---------- export ----------
function filename(ext) {
  const slug = ($('text').value.trim().split('\n')[0] || 'stamp').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'stamp';
  return `stamp-${slug}.${ext}`;
}
$('download').addEventListener('click', () => downloadBlob(exportSTL(stamp), filename('stl')));
$('download3mf').addEventListener('click', () => downloadBlob(export3MF(stamp, { title: 'Stamp' }), filename('3mf')));

selectFont();
