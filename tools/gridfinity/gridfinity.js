// Copyright (c) 2025 cmutnik
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { buildBin } from './geometry.js';

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

function build() {
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
const name = () => `gridfinity-${int('ux')}x${int('uy')}x${int('uh')}${$('cx').value * $('cy').value > 1 ? `-${$('cx').value}x${$('cy').value}` : ''}`;
$('download').addEventListener('click', () => downloadBlob(exportSTL(model), `${name()}.stl`));
$('download3mf').addEventListener('click', () => downloadBlob(export3MF(model, { title: 'Gridfinity bin' }), `${name()}.3mf`));

build();
