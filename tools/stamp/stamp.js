// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { loadFont, parseFont, populateFontSelect, FONTS } from '../../shared/js/fonts.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { svgToGroups } from '../../shared/js/svg-import.js';
import { imageToGroups, readImageFile } from '../../shared/js/image-trace.js';
import { buildStamp } from './geometry.js';
import { renderImprint, MIN_FEATURE_MM } from './imprint.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const statusEl = $('status');
const viewer = createViewer($('viewport'));
const STAMP_PARTS = [{ name: 'relief', label: 'Stamp face (artwork)' }, { name: 'base', label: 'Base and handle', names: ['base', 'handle'] }];

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
      ? svgToGroups(logoSource.text, { ignoreWhite: $('ignoreWhite').checked, frame: $('logoFrame').checked })
      : imageToGroups(logoSource.image, {
        frame: $('logoFrame').checked,
        source: $('source').value,
        threshold: $('autoThreshold').checked ? 'auto' : num('threshold'),
        smooth: num('smooth'),
        minArea: num('specks'),
        invert: $('invert').checked,
      });
    if (logoSource.kind === 'raster') {
      $('thrValue').textContent = `(${logo.source}, cut-off ${Math.round(logo.threshold)})`;
      if ($('autoThreshold').checked) $('threshold').value = Math.round(logo.threshold);
    }
    if (!logo.groups.length) statusEl.textContent = 'No shapes found in that logo - try another source, threshold or Invert.';
    else statusEl.textContent = '';
  } catch (err) {
    logo = null;
    statusEl.textContent = 'Could not read that logo file.';
    console.error(err);
  }
}

async function setLogoFile(file) {
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
}
$('logoFile').addEventListener('change', e => { $('logoFrom').hidden = true; setLogoFile(e.target.files[0]); });

// A picture sent over from the Image Prep tool (see tools/image-prep): use it as the logo.
async function takeHandoff() {
  let raw = null;
  try { raw = sessionStorage.getItem('etsytools.handoff'); sessionStorage.removeItem('etsytools.handoff'); } catch { /* storage blocked */ }
  if (!raw) return;
  try {
    const { name, type, dataUrl, frame } = JSON.parse(raw);
    $('logoFrame').checked = !!frame;
    const blob = await (await fetch(dataUrl)).blob();
    $('artMode').value = 'logo';
    await setLogoFile(new File([blob], name, { type }));
    $('logoFrom').textContent = `Using ${name} from Image Prep. Choose a file above to replace it.`;
    $('logoFrom').hidden = false;
  } catch {
    statusEl.textContent = 'Could not use the picture from Image Prep.';
  }
}

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
    logoScale: num('logoScale') / 100,
    logoFullBleed: $('logoFullBleed').checked,
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
  if ([p.fontSize, p.lineSpacing, p.textPadding, p.width, p.height, p.borderWidth, p.margin, p.relief, p.baseThickness, p.handleSize, p.handleHeight, p.logoShare, p.logoScale].some(Number.isNaN)) return;

  const usesLogo = p.artMode !== 'text', usesText = p.artMode !== 'logo';
  $('logoControls').style.display = usesLogo ? '' : 'none';
  $('textFieldset').style.display = usesText ? '' : 'none';
  $('logoShare').parentElement.style.display = p.artMode === 'logo' || p.artMode === 'text' ? 'none' : '';
  $('logoScaleValue').textContent = `${$('logoScale').value}%`;
  $('bleedRow').style.display = p.artMode === 'logo' ? '' : 'none';
  const isSvg = logoSource && logoSource.kind === 'svg';
  $('whiteRow').style.display = !logoSource || isSvg ? '' : 'none';
  $('rasterControls').style.display = logoSource && !isSvg ? '' : 'none';
  $('threshold').disabled = $('autoThreshold').checked;
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
  const thin = renderImprint($('imprint'), i, p);
  const warnings = [...i.warnings];
  $('thinStat').textContent = thin.thinMm2 > 0 ? `(${(thin.thinFraction * 100).toFixed(1)}% of the artwork)` : '';
  if (thin.thinFraction > 0.03) warnings.push(`${(thin.thinFraction * 100).toFixed(0)}% of the artwork is thinner than ${MIN_FEATURE_MM} mm (red in the imprint preview) and may print poorly or break off. Enlarge the stamp, use a bolder font, or simplify the logo (more smoothing, higher speck removal).`);
  $('warnings').replaceChildren(...warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  const empty = !stamp.children.some(c => c.name === 'relief');
  $('download').disabled = $('download3mf').disabled = $('download3mfParts').disabled = empty;
}

const LOGO_OPTS = ['threshold', 'autoThreshold', 'invert', 'source', 'smooth', 'specks', 'ignoreWhite', 'logoFrame'];
$('controls').addEventListener('input', e => rebuild(LOGO_OPTS.includes(e.target.id)));
$('controls').addEventListener('change', e => rebuild(LOGO_OPTS.includes(e.target.id)));

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
// Two parts for a multi-material printer: face = slot 1, base + handle = slot 2. Rebuilt so the parts meet
// exactly at the face/base plane (the single-mesh model overlaps them so slicers can union it).
$('download3mfParts').addEventListener('click', () => {
  const { group } = buildStamp({ ...readParams(), separateParts: true });
  downloadBlob(export3MF(group, { title: 'Stamp', parts: STAMP_PARTS }), filename('2-parts.3mf'));
});

selectFont();
takeHandoff();
