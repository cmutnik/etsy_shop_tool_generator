// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { loadFont, parseFont, populateFontSelect, FONTS } from '../../shared/js/fonts.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { imageToGroups, readImageFile } from '../../shared/js/image-trace.js';
import { svgToGroups } from '../../shared/js/svg-import.js';
import { SHAPES, shape } from '../cookie-cutter/geometry.js';
import { LOOP_STYLES } from '../qr-keychain/loops.js';
import { ATTACH_LOOPS } from '../qr-keychain/attach.js';
import { buildMagnet } from './geometry.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
let font = null, outlinePic = null, artPic = null, model = null, hasArt = false, view = 'print', timer = null, first = true, lastInfo = { width: 70, depth: 70, height: 6 };

populateFontSelect($('font'));
$('font').value = '7';
for (const s of SHAPES) $('source').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));
$('source').append(Object.assign(document.createElement('option'), { value: 'picture', textContent: 'My own picture' }));
$('source').value = 'heart';
for (const s of LOOP_STYLES.filter(s => ATTACH_LOOPS.includes(s.id))) $('loopStyle').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));

async function selectFont() {
  $('status').textContent = 'Loading font...';
  try { font = await loadFont(FONTS[parseInt($('font').value, 10)].url); $('status').textContent = ''; }
  catch { font = null; $('status').textContent = 'Could not load the font (offline?). Try uploading a font file.'; }
  rebuild();
}
$('font').addEventListener('change', selectFont);
$('fontFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { font = parseFont(await file.arrayBuffer()); $('status').textContent = `Using ${file.name}`; rebuild(); }
  catch { $('status').textContent = 'Could not read that font file (WOFF2 is not supported).'; }
});

const isSvg = f => /svg/i.test(f.type) || /\.svg$/i.test(f.name);
const readPicture = async f => (isSvg(f) ? { kind: 'svg', text: await f.text() } : { kind: 'raster', image: await readImageFile(f, 700) });
$('outlineFile').addEventListener('change', async e => { if (e.target.files[0]) { try { outlinePic = await readPicture(e.target.files[0]); $('outlineNote').textContent = `Using ${e.target.files[0].name}.`; build(); } catch (err) { showError(err.message); } } });
$('artFile').addEventListener('change', async e => { if (e.target.files[0]) { try { artPic = await readPicture(e.target.files[0]); $('artNote').textContent = `Using ${e.target.files[0].name}. Dark areas are raised.`; build(); } catch (err) { showError(err.message); } } });

const trace = (pic, o) => (!pic ? [] : pic.kind === 'svg' ? svgToGroups(pic.text, { ignoreWhite: true }).groups : imageToGroups(pic.image, { source: 'auto', threshold: 'auto', ...o }).groups);

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = $('download3mf').disabled = !!msg;
}
function rebuild() { clearTimeout(timer); $('status').textContent = 'Working...'; timer = setTimeout(build, 250); }

function build() {
  const art = $('art').value, own = $('source').value === 'picture';
  $('outlineBox').hidden = !own;
  $('textBox').hidden = art !== 'text';
  $('pictureBox').hidden = art !== 'picture';
  $('magnetBox').hidden = $('magnetCount').value === '0';
  $('loopBox').hidden = !$('loopOn').checked;
  const p = {
    groups: own ? trace(outlinePic, { smooth: 2, tolerance: 1.5, minArea: 40 }) : shape($('source').value).groups(),
    size: num('size'), thickness: num('thickness'), raise: num('raise'), rim: num('rim'),
    art, text: $('text').value, font, artSize: num('artSize'),
    pictureGroups: art === 'picture' ? trace(artPic, { smooth: 1, tolerance: 0.8, minArea: 6 }) : [],
    magnet: { count: parseInt($('magnetCount').value, 10), diameter: num('magnetDiameter'), thickness: num('magnetThickness'), clearance: num('clearance') },
    loop: { position: $('loopOn').checked ? 'top' : 'none', style: $('loopStyle').value, size: num('loopSize'), holeDiameter: num('holeDiameter') },
    baseColor: $('baseColor').value, artColor: $('artColor').value,
  };
  const nums = [p.size, p.thickness, p.raise, p.rim, p.artSize, p.magnet.diameter, p.magnet.thickness, p.magnet.clearance, p.loop.size, p.loop.holeDiameter];
  if (nums.some(Number.isNaN)) return;
  if (art === 'text' && !font) return;
  let res;
  try {
    if (own && !p.groups.length) { showError(outlinePic ? 'Could not find a shape in that picture.' : 'Choose a picture for the outline, or pick a built-in shape.'); $('status').textContent = ''; return; }
    res = buildMagnet(p);
  } catch (e) { showError(e.message); $('status').textContent = ''; return; }
  showError('');
  model = res.group;
  hasArt = model.children.some(m => m.name === 'art');
  viewer.setObject(model);
  lastInfo = res.info;
  if (first) { first = false; viewer.resize(); }
  viewer.setView(view, lastInfo);
  const i = res.info;
  $('info').textContent = `${i.width.toFixed(1)} x ${i.depth.toFixed(1)} x ${i.height.toFixed(1)} mm`
    + (hasArt ? `  |  filament change at Z = ${i.plateHeight.toFixed(2)} mm` : '')
    + (i.pockets.length ? `  |  ${i.pockets.length} magnet pocket${i.pockets.length > 1 ? 's' : ''}, ${i.magnetDepth.toFixed(1)} mm deep` : '');
  $('download3mf').textContent = hasArt ? 'Download 3MF (2 parts)' : 'Download 3MF';
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  $('status').textContent = '';
}

$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));
const slug = () => ($('art').value === 'text' ? $('text').value : $('source').value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'piece';
const kind = () => ($('magnetCount').value !== '0' ? 'magnet' : $('loopOn').checked ? 'ornament' : 'plate');
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `${kind()}-${slug()}.stl`));
$('download3mf').addEventListener('click', () => downloadBlob(export3MF(model, { title: 'Magnet', ...(hasArt ? { parts: [{ name: 'base', label: 'Plate' }, { name: 'art', label: 'Raised parts' }] } : {}) }), `${kind()}-${slug()}.3mf`));

selectFont();
