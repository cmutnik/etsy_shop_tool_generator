// Copyright (c) 2025 cmutnik
import * as THREE from 'three';
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, downloadBlob } from '../../shared/js/export.js';
import { readModelFiles, MAX_TRIANGLES } from '../../shared/js/mesh-import.js';
import { checkMesh, OVERHANG, THIN } from '../../shared/js/mesh-check.js';
import { analyseParts, transformParts, layFlatAngles, buildGroup, mergeGroups } from '../mesh-modifier/geometry.js';
import { repairParts } from '../mesh-modifier/repair-groups.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
const BEDS = [['Custom', null], ['Bambu Lab A1 / P1 / X1 (256 x 256 x 256)', [256, 256, 256]], ['Prusa MK4 (250 x 210 x 220)', [250, 210, 220]], ['Creality Ender 3 (220 x 220 x 250)', [220, 220, 250]], ['Bambu Lab A1 mini (180 x 180 x 180)', [180, 180, 180]], ['Elegoo Neptune 4 Pro (225 x 225 x 265)', [225, 225, 265]]];
BEDS.forEach(([label, v], i) => $('bedPreset').append(Object.assign(document.createElement('option'), { value: String(i), textContent: label })));
$('bedPreset').value = '3';

let source = null;           // { name, raw (as read), parts (repaired or flipped, in file units) }
let placed = [], report = null, mode = 'normal', first = true, timer = null, fileName = 'model';

function showError(msg) { $('error').hidden = !msg; $('error').textContent = msg || ''; }

async function load(files) {
  showError('');
  $('status').textContent = 'Reading...';
  try {
    const { file, parts } = await readModelFiles(files);
    const { parts: oriented } = analyseParts(parts);
    if (oriented.reduce((n, p) => n + p.indices.length / 3, 0) > MAX_TRIANGLES) throw new Error('That model has too many triangles for the browser.');
    source = { name: file.name, raw: parts, parts: mergeGroups(parts), repaired: false };
    fileName = file.name.replace(/\.[^.]+$/, '');
    $('repairReport').textContent = '';
    check();
  } catch (e) { showError(e.message || String(e)); $('status').textContent = ''; }
}

function place() {
  const unit = num('unit');
  let rotate = [0, 0, 0];
  if ($('layFlat').checked) rotate = layFlatAngles(source.parts, { unit }) || rotate;
  return transformParts(source.parts, { unit, rotate, center: true, onBed: true }).parts;
}

function check() {
  if (!source) return;
  clearTimeout(timer);
  $('status').textContent = 'Checking...';
  timer = setTimeout(() => {
    placed = place();
    const bed = [num('bedX'), num('bedY'), num('bedZ')];
    report = checkMesh(placed, { bed, overhangAngle: num('overhang'), minWall: num('minWall'), nozzle: num('nozzle') });
    render();
    $('status').textContent = source.name;
  }, 30);
}

function coloured() {
  const group = new THREE.Group();
  placed.forEach((p, k) => {
    const nt = p.indices.length / 3, pos = new Float32Array(nt * 9), col = new Float32Array(nt * 9), fl = report.flags[k];
    const base = new THREE.Color(p.color || '#b8b8b8'), red = new THREE.Color('#e03b3b'), orange = new THREE.Color('#ff8a00');
    for (let t = 0; t < nt; t++) {
      const c = mode === 'overhang' && fl[t] & OVERHANG ? red : mode === 'thin' && fl[t] & THIN ? orange : base;
      for (let j = 0; j < 3; j++) for (let a = 0; a < 3; a++) { pos[t * 9 + j * 3 + a] = p.positions[p.indices[t * 3 + j] * 3 + a]; col[t * 9 + j * 3 + a] = [c.r, c.g, c.b][a]; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true })));
  });
  return group;
}

const ICON = { ok: 'OK', info: 'i', warn: '!', bad: 'X' };
function render() {
  viewer.setObject(coloured());
  const s = report.stats, size = s.size;
  if (first) { first = false; viewer.resize(); }
  viewer.setView('print', { width: size[0], depth: size[1], height: size[2] });
  const v = $('verdict');
  v.hidden = false;
  v.className = 'verdict ' + report.verdict;
  v.textContent = { ready: 'Looks ready to print.', caution: 'Printable, with things to look at.', problem: 'Problems that will likely spoil the print.' }[report.verdict];
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  $('findings').replaceChildren(...[...report.findings].sort((a, b) => order[a.level] - order[b.level]).map(f => {
    const li = document.createElement('li');
    li.className = 'f ' + f.level;
    const head = Object.assign(document.createElement('div'), { className: 'ft' });
    head.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: ICON[f.level] }), f.title);
    li.append(head);
    if (f.detail) li.append(Object.assign(document.createElement('div'), { className: 'fd', textContent: f.detail }));
    if (f.fix) li.append(Object.assign(document.createElement('div'), { className: 'ff', textContent: 'Fix: ' + f.fix }));
    return li;
  }));
  $('info').textContent = `${size.map(x => x.toFixed(1)).join(' x ')} mm  |  ${s.triangles.toLocaleString()} triangles  |  volume ${(s.volume / 1000).toFixed(1)} cm³  |  surface ${(s.area / 100).toFixed(0)} cm²  |  ${s.shells} piece${s.shells === 1 ? '' : 's'}`;
  const broken = report.findings.some(f => ['open', 'non-manifold', 'inside-out', 'winding', 'degenerate', 'duplicate'].includes(f.id));
  $('repair').hidden = !broken;
  $('download').disabled = false;
}

$('repair').addEventListener('click', async () => {
  $('repair').disabled = true;
  $('status').textContent = 'Repairing... large models can take several seconds.';
  await new Promise(r => setTimeout(r, 30));
  try {
    const { list, log } = repairParts(source.parts, source.parts.map(() => true));
    source.parts = list.map(x => x.part);
    source.repaired = true;
    $('repairReport').replaceChildren(...log.map(t => Object.assign(document.createElement('div'), { textContent: t })));
    check();
  } catch (e) { showError(`Repair failed: ${e.message || e}`); }
  $('repair').disabled = false;
});

$('download').addEventListener('click', () => {
  const { group } = buildGroup(placed);
  downloadBlob(exportSTL(group), `${fileName}${source.repaired ? '-repaired' : ''}.stl`);
});

$('bedPreset').addEventListener('change', () => {
  const v = BEDS[parseInt($('bedPreset').value, 10)][1];
  if (v) { $('bedX').value = v[0]; $('bedY').value = v[1]; $('bedZ').value = v[2]; }
  check();
});
$('file').addEventListener('change', e => load(e.target.files));
const drop = $('viewport');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drop'); load(e.dataTransfer.files); });
for (const id of ['unit', 'layFlat', 'bedX', 'bedY', 'bedZ', 'nozzle', 'minWall', 'overhang']) { $(id).addEventListener('change', () => { if (id.startsWith('bed')) $('bedPreset').value = '0'; check(); }); }
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b));
  if (report) viewer.setObject(coloured());
}));
