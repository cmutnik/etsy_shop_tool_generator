// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { loadFont, parseFont, populateFontSelect, FONTS } from '../../shared/js/fonts.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { buildNameKeychain, BACKINGS, NAME_LOOPS } from './geometry.js';
import { LOOP_STYLES } from '../qr-keychain/loops.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
let font = null, model = null, view = 'print', timer = null, first = true, lastInfo = { width: 50, depth: 20, height: 3.2 };

populateFontSelect($('font'));
$('font').value = '7';                                          // Pacifico: a script font, so letters join even with no plate
for (const b of BACKINGS) $('backing').append(Object.assign(document.createElement('option'), { value: b.id, textContent: b.label }));
for (const s of LOOP_STYLES.filter(s => NAME_LOOPS.includes(s.id))) $('loopStyle').append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));

const NOTES = {
  outline: 'A plate that follows the shape of the letters, like a sticker. Margin is how far it extends past them.',
  rectangle: 'A rounded rectangle round the whole name.',
  none: 'No plate: the letters themselves are the keychain, standing as tall as plate + letters. They must touch each other.',
};

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

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = $('download3mf').disabled = !!msg;
}
function rebuild() { clearTimeout(timer); timer = setTimeout(build, 200); }

function build() {
  const p = {
    font, text: $('text').value, fontSize: num('fontSize'), lineSpacing: num('lineSpacing'), backing: $('backing').value,
    margin: num('margin'), cornerRadius: num('cornerRadius'), thickness: num('thickness'), raise: num('raise'),
    loopStyle: $('loopStyle').value, loopPosition: $('loopPosition').value, loopSize: num('loopSize'), holeDiameter: num('holeDiameter'),
    baseColor: $('baseColor').value, textColor: $('textColor').value,
  };
  $('cornerRow').style.display = p.backing === 'rectangle' ? '' : 'none';
  $('margin').disabled = p.backing === 'none';
  $('plateNote').textContent = NOTES[p.backing];
  $('download3mf').textContent = p.backing === 'none' ? 'Download 3MF' : 'Download 3MF (2 parts)';
  if (!font) return;
  let res;
  try { res = buildNameKeychain(p); } catch (e) { showError(e.message); return; }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  if (first) { first = false; viewer.resize(); }
  viewer.setView(view, lastInfo);
  const i = res.info;
  $('info').textContent = `${i.width.toFixed(1)} x ${i.depth.toFixed(1)} x ${i.height.toFixed(1)} mm`
    + (p.backing === 'none' ? '' : `  |  filament change at Z = ${i.filamentChangeZ.toFixed(2)} mm`);
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
}

$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));
const slug = () => $('text').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'name';
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `name-keychain-${slug()}.stl`));
$('download3mf').addEventListener('click', () => {
  const parts = $('backing').value === 'none' ? null : [{ name: 'base', label: 'Plate' }, { name: 'text', label: 'Letters' }];
  downloadBlob(export3MF(model, { title: 'Name keychain', ...(parts ? { parts } : {}) }), `name-keychain-${slug()}.3mf`);
});

selectFont();
