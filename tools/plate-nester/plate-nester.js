// Copyright (c) 2025 cmutnik
import * as THREE from 'three';
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { zipStore } from '../../shared/js/zip.js';
import { readModelFiles, MAX_TRIANGLES } from '../../shared/js/mesh-import.js';
import { nest, applyPlacement } from '../../shared/js/nest.js';
import { analyseParts, transformParts, layFlatAngles, assignSlots, boundsOfParts, DEFAULT_COLOR } from '../mesh-modifier/geometry.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
const BEDS = [['Custom', null], ['Bambu Lab A1 / P1 / X1 (256 x 256)', [256, 256]], ['Bambu Lab A1 mini (180 x 180)', [180, 180]], ['Prusa MK4 (250 x 210)', [250, 210]], ['Creality Ender 3 (220 x 220)', [220, 220]], ['Elegoo Neptune 4 Pro (225 x 225)', [225, 225]]];
BEDS.forEach(([label], i) => $('bedPreset').append(Object.assign(document.createElement('option'), { value: String(i), textContent: label })));
$('bedPreset').value = '4';
const TINTS = ['#c8553d', '#3f88c5', '#6aa84f', '#e0a100', '#8e6bbf', '#2a9d8f', '#d1628b', '#7b8794'];

let items = [];             // { name, raw (parts, as read), copies, tint }
let prepared = [];          // per item: parts on the bed, centred, in mm
let result = null, plateNo = 0, view = 'print', timer = null, first = true, lastInfo = { width: 220, depth: 220, height: 40 };

function showError(msg) { $('error').hidden = !msg; $('error').textContent = msg || ''; }

async function addFiles(fileList) {
  showError('');
  const files = [...fileList], mtls = files.filter(f => /\.mtl$/i.test(f.name)), models = files.filter(f => /\.(stl|3mf|obj)$/i.test(f.name));
  if (!models.length) return showError('Choose .stl, .3mf or .obj files.');
  $('status').textContent = 'Reading...';
  for (const f of models) {
    try {
      const { parts } = await readModelFiles([f, ...mtls]);
      const { parts: oriented } = analyseParts(parts);
      if (oriented.reduce((n, p) => n + p.indices.length / 3, 0) > MAX_TRIANGLES) throw new Error('too many triangles');
      items.push({ name: f.name.replace(/\.[^.]+$/, ''), raw: oriented, copies: 1, tint: TINTS[items.length % TINTS.length] });
    } catch (e) { showError(`${f.name}: ${e.message || e}`); }
  }
  drawItems();
  arrange();
}

function drawItems() {
  $('itemsHint').hidden = $('clear').hidden = !items.length;
  $('items').replaceChildren(...items.map((it, i) => {
    const li = document.createElement('li');
    const dot = Object.assign(document.createElement('span'), { className: 'dot' }); dot.style.background = it.tint;
    const name = Object.assign(document.createElement('span'), { className: 'iname', textContent: it.name, title: it.name });
    const qty = Object.assign(document.createElement('input'), { type: 'number', value: it.copies, min: 0, max: 200, step: 1, title: 'Copies (0 = fill the plate)' });
    qty.addEventListener('change', () => { it.copies = Math.max(0, Math.min(200, parseInt(qty.value, 10) || 0)); arrange(); });
    const rm = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Remove' });
    rm.addEventListener('click', () => { items.splice(i, 1); drawItems(); arrange(); });
    li.append(dot, name, qty, rm);
    return li;
  }));
}

function prepare() {
  const unit = parseFloat($('unit').value);
  prepared = items.map(it => {
    let rotate = [0, 0, 0];
    if ($('layFlat').checked) rotate = layFlatAngles(it.raw, { unit }) || rotate;
    return transformParts(it.raw, { unit, rotate, center: true, onBed: true }).parts;
  });
}

function arrange() {
  clearTimeout(timer);
  if (!items.length) { result = null; render(); return; }
  $('status').textContent = 'Arranging...';
  timer = setTimeout(() => {
    try {
      prepare();
      const step = parseInt($('turning').value, 10), angles = step ? Array.from({ length: 360 / step }, (_, k) => k * step) : [0];
      result = nest(items.map((it, i) => ({ name: it.name, parts: prepared[i], copies: it.copies })), {
        bed: { width: num('bedX'), depth: num('bedY') }, spacing: num('spacing'), edge: num('edge'), cell: parseFloat($('cell').value), angles,
      });
      plateNo = Math.min(plateNo, Math.max(0, result.plates.length - 1));
      showError('');
    } catch (e) { result = null; showError(e.message || String(e)); }
    render();
  }, 60);
}

/** The meshes of one plate, laid out on the bed and centred on the origin (so a slicer opens it in the middle). */
function plateGroup(plate, preview) {
  const group = new THREE.Group(), cx = num('bedX') / 2, cy = num('bedY') / 2;
  const list = [];
  plate.placements.forEach((pl, n) => {
    prepared[pl.item].forEach((part, pi) => {
      const p = applyPlacement(part, pl), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.setIndex(new THREE.BufferAttribute(p.indices, 1));
      const color = preview && !part.color ? items[pl.item].tint : part.color || DEFAULT_COLOR;
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true }));
      mesh.name = `i${n}_${pi}`;
      group.add(mesh);
      list.push({ name: mesh.name, label: `${items[pl.item].name} ${pl.copy + 1}${prepared[pl.item].length > 1 ? ' - ' + (part.name || pi + 1) : ''}`, color: part.color || null });
    });
  });
  group.position.set(-cx, -cy, 0);
  group.updateMatrixWorld(true);
  return { group, list };
}

function partsFor(list) {
  const slots = assignSlots(list.map(l => ({ color: l.color })));
  return list.map((l, i) => ({ name: l.name, label: l.label, extruder: slots[i] }));
}

function render() {
  const has = result && result.plates.length;
  $('download').disabled = $('downloadStl').disabled = $('downloadAll').disabled = !has;
  $('plateButtons').replaceChildren();
  $('summary').replaceChildren();
  $('warnings').replaceChildren();
  if (!has) {
    viewer.setObject(new THREE.Group());
    $('info').textContent = '';
    $('status').textContent = items.length ? 'Nothing could be placed.' : 'Add some models to arrange.';
    if (items.length && result) listUnplaced();
    return;
  }
  const plate = result.plates[plateNo], bx = num('bedX'), by = num('bedY');
  const { group } = plateGroup(plate, true);
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[0, 0], [bx, 0], [bx, by], [0, by]].map(([x, y]) => new THREE.Vector3(x - bx / 2, y - by / 2, 0.05))), new THREE.LineBasicMaterial({ color: 0xd2691e }));
  const display = new THREE.Group(); display.add(group, outline);
  viewer.setObject(display);
  if (first) { first = false; viewer.resize(); }
  const tall = Math.max(...plate.placements.map(pl => boundsOfParts(prepared[pl.item]).size[2]));
  lastInfo = { width: bx, depth: by, height: tall };
  viewer.setView(view, lastInfo);
  result.plates.forEach((p, i) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: `Plate ${i + 1}`, className: i === plateNo ? 'active' : '' });
    b.addEventListener('click', () => { plateNo = i; render(); });
    $('plateButtons').append(b);
  });
  const usedPct = (plate.used / (bx * by)) * 100, total = result.plates.reduce((n, p) => n + p.placements.length, 0);
  $('info').textContent = `${total} model${total === 1 ? '' : 's'} on ${result.plates.length} plate${result.plates.length === 1 ? '' : 's'}  |  plate ${plateNo + 1}: ${plate.placements.length} model${plate.placements.length === 1 ? '' : 's'}, about ${usedPct.toFixed(0)}% of the bed covered (with spacing), tallest ${tall.toFixed(0)} mm`;
  $('status').textContent = '';
  const counts = new Map();
  for (const pl of plate.placements) counts.set(pl.item, (counts.get(pl.item) || 0) + 1);
  $('summary').replaceChildren(...[...counts].map(([i, n]) => Object.assign(document.createElement('li'), { textContent: `${n} x ${items[i].name}` })));
  listUnplaced();
}

function listUnplaced() {
  if (!result || !result.unplaced.length) return;
  const bySize = new Set(result.unplaced.filter(u => u.reason === 'size').map(u => items[u.item].name)), byPlates = result.unplaced.filter(u => u.reason === 'plates').length;
  const msgs = [];
  if (bySize.size) msgs.push(`Too big for the bed in any direction: ${[...bySize].join(', ')}. Scale it down or cut it in two with the STL / 3MF Modifier.`);
  if (byPlates) msgs.push(`${byPlates} model${byPlates > 1 ? 's' : ''} did not fit in 20 plates and were left out. Use a smaller number of copies.`);
  $('warnings').replaceChildren(...msgs.map(t => Object.assign(document.createElement('div'), { textContent: t })));
}

async function plateFile(index, kind) {
  const { group, list } = plateGroup(result.plates[index], false);
  return kind === 'stl' ? exportSTL(group) : export3MF(group, { title: `Plate ${index + 1}`, parts: partsFor(list) });
}
$('download').addEventListener('click', async () => downloadBlob(await plateFile(plateNo, '3mf'), `plate-${plateNo + 1}.3mf`));
$('downloadStl').addEventListener('click', async () => downloadBlob(await plateFile(plateNo, 'stl'), `plate-${plateNo + 1}.stl`));
$('downloadAll').addEventListener('click', async () => {
  const files = [];
  for (let i = 0; i < result.plates.length; i++) files.push([`plate-${i + 1}.3mf`, new Uint8Array(await (await plateFile(i, '3mf')).arrayBuffer())]);
  downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), 'plates.zip');
});

$('file').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
const vp = $('viewport');
vp.addEventListener('dragover', e => { e.preventDefault(); vp.classList.add('drop'); });
vp.addEventListener('dragleave', () => vp.classList.remove('drop'));
vp.addEventListener('drop', e => { e.preventDefault(); vp.classList.remove('drop'); addFiles(e.dataTransfer.files); });
$('clear').addEventListener('click', () => { items = []; drawItems(); arrange(); });
$('bedPreset').addEventListener('change', () => { const v = BEDS[parseInt($('bedPreset').value, 10)][1]; if (v) { $('bedX').value = v[0]; $('bedY').value = v[1]; } arrange(); });
for (const id of ['bedX', 'bedY']) $(id).addEventListener('change', () => { $('bedPreset').value = '0'; arrange(); });
for (const id of ['unit', 'spacing', 'edge', 'turning', 'cell', 'layFlat']) $(id).addEventListener('change', arrange);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  viewer.setView(view, lastInfo);
}));
drawItems();
