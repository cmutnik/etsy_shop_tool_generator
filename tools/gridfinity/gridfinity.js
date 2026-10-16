// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { buildBin, buildBaseplate, GRID } from './geometry.js';

const $ = id => document.getElementById(id);
const int = id => parseInt($(id).value, 10);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
let model = null, view = 'print', timer = null, first = true, lastInfo = { width: 83.5, depth: 41.5, height: 21 };

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
  $('download').disabled = $('download3mf').disabled = !!msg;
}
function rebuild() { clearTimeout(timer); $('status').textContent = 'Working...'; timer = setTimeout(build, 150); }

function syncMode() {
  const plate = $('mode').value === 'plate';
  document.querySelectorAll('[data-only]').forEach(el => { el.hidden = el.dataset.only !== (plate ? 'plate' : 'bin'); });
  for (const id of ['ux', 'uy']) $(id).max = plate ? 12 : 8;
  document.querySelectorAll('[data-view="underside"]').forEach(b => { b.textContent = plate ? 'Underside' : 'Base'; });
  $('download3mf').textContent = 'Download 3MF';
}

function build() {
  syncMode();
  if ($('mode').value === 'plate') return buildPlate();
  const p = {
    units: [int('ux'), int('uy')], height: int('uh'), compartments: [int('cx'), int('cy')], scoop: num('scoop'),
    lip: $('lip').checked, magnets: $('magnets').checked, wall: num('wall'), floor: num('floor'), divider: num('divider'), color: $('color').value,
  };
  if ([...p.units, p.height, ...p.compartments, p.scoop, p.wall, p.floor, p.divider].some(Number.isNaN)) return;
  let res;
  try { res = buildBin(p); } catch (e) { showError(e.message); $('status').textContent = ''; return; }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  if (first) { first = false; viewer.resize(); }
  viewer.setView(view, lastInfo);
  const i = res.info;
  $('info').textContent = `${i.units[0]} x ${i.units[1]} x ${i.heightUnits} units  |  ${i.width.toFixed(1)} x ${i.depth.toFixed(1)} x ${i.height.toFixed(0)} mm  |  ${i.feet} ${i.feet === 1 ? 'foot' : 'feet'}`;
  $('stats').textContent = `${i.compartments} compartment${i.compartments > 1 ? 's' : ''} of ${i.compartmentSize[0].toFixed(1)} x ${i.compartmentSize[1].toFixed(1)} mm, ${i.cavityDepth.toFixed(1)} mm deep  |  about ${i.grams.toFixed(0)} g of PLA`;
  $('warnings').replaceChildren(...i.warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  $('status').textContent = '';
}

function buildPlate() {
  const p = { units: [int('ux'), int('uy')], floor: num('floor'), magnets: $('magnets').checked, color: '#8a8f98' };
  if ([...p.units, p.floor].some(Number.isNaN)) return;
  let res;
  try { res = buildBaseplate(p); } catch (e) { showError(e.message); $('status').textContent = ''; return; }
  showError('');
  model = res.group;
  viewer.setObject(model);
  lastInfo = res.info;
  if (first) { first = false; viewer.resize(); }
  viewer.setView(view, lastInfo);
  const i = res.info, bed = num('bed'), warnings = [...i.warnings];
  $('info').textContent = `${i.units[0]} x ${i.units[1]} cells  |  ${i.width.toFixed(0)} x ${i.depth.toFixed(0)} x ${i.height.toFixed(1)} mm`;
  $('stats').textContent = `${i.cells} cell${i.cells > 1 ? 's' : ''}  |  about ${i.grams.toFixed(0)} g of PLA`;
  if (Math.max(i.width, i.depth) > bed && Math.min(i.width, i.depth) > bed) warnings.push(`This is ${i.width.toFixed(0)} x ${i.depth.toFixed(0)} mm and will not fit a ${bed} mm bed. Print it as several smaller plates: up to ${Math.floor(bed / GRID)} cells each way fits.`);
  else if (Math.max(i.width, i.depth) > bed) warnings.push(`The long side is ${Math.max(i.width, i.depth).toFixed(0)} mm, longer than your ${bed} mm bed. It fits only if you print it diagonally; better to split it into plates of up to ${Math.floor(bed / GRID)} cells.`);
  $('warnings').replaceChildren(...warnings.map(t => Object.assign(document.createElement('div'), { textContent: t })));
  $('status').textContent = '';
}

$('preset').addEventListener('change', () => {
  if (!$('preset').value) return;
  const [x, y, h] = $('preset').value.split(',');
  $('ux').value = x; $('uy').value = y; $('uh').value = h;
  build();
});
$('controls').addEventListener('input', rebuild);
$('controls').addEventListener('change', rebuild);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));
const name = () => $('mode').value === 'plate' ? `gridfinity-baseplate-${int('ux')}x${int('uy')}` : `gridfinity-${int('ux')}x${int('uy')}x${int('uh')}${$('cx').value * $('cy').value > 1 ? `-${$('cx').value}x${$('cy').value}` : ''}`;
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `${name()}.stl`));
$('download3mf').addEventListener('click', () => downloadBlob(export3MF(model, { title: $('mode').value === 'plate' ? 'Gridfinity baseplate' : 'Gridfinity bin' }), `${name()}.3mf`));

build();
