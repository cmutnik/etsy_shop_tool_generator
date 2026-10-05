// Copyright (c) 2025 cmutnik
import * as THREE from 'three';
import { createViewer } from '../../shared/js/viewer.js';
import { exportSTL, export3MF, downloadBlob } from '../../shared/js/export.js';
import { readModelFiles, MAX_TRIANGLES } from '../../shared/js/mesh-import.js';
import { transformParts, buildGroup, partsStats, analyseParts, boundsOfParts, assignSlots, DEFAULT_COLOR } from '../mesh-modifier/geometry.js';
import { loadManifold } from '../mesh-modifier/boolean3d.js';
import { makeFlexi, fromAxisFrame } from './flexi.js';
import { simplifyParts, SOFT_LIMIT, HARD_LIMIT } from './prepare.js';
import { repairParts } from '../mesh-modifier/repair-groups.js';
import { cutPositions } from './joints.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
const AXES = ['x', 'y', 'z'];

let source = null;          // { name, fileName, parts, stats, include, colors, slots }
let shown = null;           // { size, sizeObj } of what the preview shows
let result = null;          // the flexi model, until something changes: { group, meta }
let pose = null;            // the preview's bendable copy: { levels, joints, axis }
let framed = false, view = 'print', timer = null, busy = false, engineReady = false;

const showError = msg => { $('error').hidden = !msg; $('error').textContent = msg || ''; };
const showWarnings = list => $('warnings').replaceChildren(...list.map(t => Object.assign(document.createElement('div'), { textContent: t })));
const round = (v, d = 1) => +v.toFixed(d);

// ---------- loading ----------
let lastFiles = [];
async function load(files) {
  if (!files || !files.length) return;
  lastFiles = [...files];
  $('status').textContent = 'Reading the file...';
  try {
    const { file, parts: read, notes, painted } = await readModelFiles(lastFiles, { colors: parseInt($('paintColors').value, 10) || 6 });
    $('paintRow').hidden = !painted;
    let parts = read;
    const { parts: turned, stats } = analyseParts(parts);                      // inside-out solids are turned the right way round; colour patches are judged together
    parts = turned;
    const tris = stats.reduce((s, x) => s + x.triangles, 0);
    if (tris > MAX_TRIANGLES) throw new Error('That model has too many triangles for the browser.');
    source = { name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, notes, original: null, parts, stats, include: parts.map(() => true), colors: parts.map(p => p.color), slots: parts.map(p => p.slot || null) };
    for (const id of ['rotX', 'rotY', 'rotZ']) $(id).value = 0;
    $('scalePct').value = 100; $('unit').value = '1'; $('custom').value = '';
    buildPartList();
    framed = false;
    $('status').textContent = file.name;
    showError('');
    // cut along the longest direction by default
    const size = boundsOfParts(parts).size;
    $('axis').value = AXES[size.indexOf(Math.max(...size))];
    refresh();
  } catch (e) {
    $('status').textContent = '';
    showError(e.message || String(e));
  }
}
$('file').addEventListener('change', e => load(e.target.files));
$('paintColors').addEventListener('change', () => load(lastFiles));
const drop = $('viewport');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drop'); load(e.dataTransfer.files); });

function buildPartList() {
  $('partHint').hidden = false;
  $('partList').replaceChildren(...source.parts.map((p, i) => {
    const li = document.createElement('li'), on = document.createElement('input'), col = document.createElement('input'), name = document.createElement('span');
    on.type = 'checkbox'; on.checked = true; on.title = 'Include this part';
    col.type = 'color'; col.value = source.colors[i] || DEFAULT_COLOR; col.title = 'Colour';
    name.textContent = p.name;
    on.addEventListener('change', () => { source.include[i] = on.checked; li.classList.toggle('off', !on.checked); framed = false; refresh(); });
    col.addEventListener('input', () => { source.colors[i] = col.value; refresh(); });
    li.append(on, col, name);
    return li;
  }));
}

document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => {
  const el = $(b.dataset.rot), v = ((parseFloat(el.value) || 0) + 90) % 360;
  el.value = v > 180 ? v - 360 : v;
  refresh();
}));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b));
  if (shown) viewer.setView(view, shown.sizeObj);
}));

// ---------- preview: the model with the cut planes ----------
const usedParts = () => source.parts.map((p, i) => ({ ...p, color: source.colors[i], slot: source.slots[i] || undefined })).filter((_, i) => source.include[i]);
function placed(parts, { rotate = [0, 0, 0], unit = num('unit'), scale = (num('scalePct') || 100) / 100 } = {}) {
  return transformParts(parts, { unit, rotate, scale: [scale, scale, scale], center: true, onBed: true });
}
const customList = () => $('custom').value.split(/[,;\s]+/).map(parseFloat).filter(Number.isFinite);

function refresh() { clearTimeout(timer); timer = setTimeout(draw, 120); invalidate(); }
function invalidate() { result = null; pose = null; $('poseRow').hidden = true; $('pose').value = 0; $('poseOut').textContent = '0\u00b0'; $('downloadStl').disabled = $('download3mf').disabled = true; }

function draw() {
  if (!source) return;
  const used = usedParts();
  $('barRow').hidden = $('joint').value === 'ball'; $('ballRow').hidden = $('joint').value !== 'ball';
  $('make').disabled = busy || !used.length;
  if (!used.length) { showError('Keep at least one part ticked.'); return; }
  showError('');
  const xf = placed(used, { rotate: ['rotX', 'rotY', 'rotZ'].map(id => parseFloat($(id).value) || 0) });
  const { group } = buildGroup(xf.parts);
  const k = AXES.indexOf($('axis').value), lo = xf.min[k], hi = xf.max[k];
  const cuts = cutPositions(lo, hi, num('count'), customList().map(v => lo + v));
  for (const c of cuts) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xd9480f, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    const other = [0, 1, 2].filter(a => a !== k), centre = xf.min.map((v, a) => (v + xf.max[a]) / 2);
    centre[k] = c;
    plane.position.set(...centre);
    if (k === 0) plane.rotation.y = Math.PI / 2; else if (k === 1) plane.rotation.x = Math.PI / 2;
    const wide = other.map(a => (xf.max[a] - xf.min[a]) * 1.15 + 4);
    // the plane's local x, y map to world axes: z cut -> (x, y); x cut (turned about y) -> (z, y); y cut (turned about x) -> (x, z)
    plane.scale.set(...(k === 0 ? [wide[1], wide[0], 1] : [wide[0], wide[1], 1]));
    group.add(plane);
  }
  viewer.setObject(group);
  const [w, d, h] = xf.size;
  shown = { size: xf.size, sizeObj: { width: w, depth: d, height: h } };
  if (!framed) { framed = true; viewer.resize(); viewer.setView(view, shown.sizeObj); }
  const tris = used.reduce((s, p) => s + p.indices.length / 3, 0);
  $('info').textContent = `${round(w)} x ${round(d)} x ${round(h)} mm  |  ${tris.toLocaleString()} triangles  |  ${cuts.length + 1} segments  |  ${used.length} part${used.length === 1 ? '' : 's'}`;
  const warnings = [...(source.notes || [])];
  const openParts = source.parts.map((p, i) => ({ name: p.name, edges: source.stats[i].openEdges, on: source.include[i] })).filter(x => x.on && x.edges > 0);
  if (openParts.length) warnings.push(`Not watertight, so it cannot be cut: ${openParts.map(x => `${x.name} (${x.edges.toLocaleString()} open edges)`).join(', ')}. Use "Repair open edges" below, or untick the part.`);
  if (tris > SOFT_LIMIT) warnings.push(`This model has ${tris.toLocaleString()} triangles${tris > HARD_LIMIT ? ', too many to cut in the browser' : ', which is slow to cut'}. Use "Reduce triangles" below.`);
  $('fixBox').hidden = !(openParts.length || tris > SOFT_LIMIT || source.original);
  $('undoFix').hidden = !source.original;
  const longest = Math.max(w, d, h);
  if (longest < 20) warnings.push(`The model is only ${round(longest)} mm across, which is small for joints. Scale it up, or check "The file's units".`);
  showWarnings(warnings);
  $('status').textContent = source.fileName;
}
$('controls').addEventListener('input', e => { if (!e.target.closest('#partList') && e.target.id !== 'file') refresh(); });

// ---------- fix the model: repair, reduce ----------
const snapshot = () => ({ parts: source.parts, stats: source.stats, include: source.include, colors: source.colors, slots: source.slots });
const keepOriginal = () => { source.original ||= snapshot(); };
/** Take a new parts list ({ part, from } entries) and carry each part's tick, colour and slot over from the part it came from. */
function adopt(list) {
  const { include, colors, slots } = source;
  source.parts = list.map(x => x.part);
  source.include = list.map(x => include[x.from]);
  source.colors = list.map(x => colors[x.from]);
  source.slots = list.map(x => slots[x.from]);
  source.stats = partsStats(source.parts);
  buildPartList();
  source.include.forEach((on, i) => { document.querySelectorAll('#partList li')[i]?.classList.toggle('off', !on); const box = document.querySelectorAll('#partList li input[type=checkbox]')[i]; if (box) box.checked = on; });
}
const fixDone = lines => { $('fixReport').replaceChildren(...lines.map(t => Object.assign(document.createElement('div'), { textContent: t }))); framed = false; refresh(); };
$('repair').addEventListener('click', () => {
  if (!source) return;
  const before = snapshot();
  const { list, changed, log } = repairParts(source.parts, source.include);
  if (changed) { source.original ||= before; adopt(list); }
  if (!log.length) log.push('Nothing to repair.');
  fixDone(log);
});
$('reduce').addEventListener('click', async () => {
  if (!source || busy) return;
  busy = true; $('reduce').disabled = $('make').disabled = true;
  try {
    if (!engineReady) { $('status').textContent = 'Loading the cutting engine (about 0.5 MB)...'; await loadManifold(); engineReady = true; }
    $('status').textContent = 'Reducing triangles...';
    await new Promise(r => setTimeout(r, 30));
    const unitScale = num('unit') * ((num('scalePct') || 100) / 100);          // the limit is in mm, the file may not be
    const before = snapshot();
    const r = await simplifyParts(source.parts, { include: source.include, target: num('reduceTo') || 100000, maxDeviation: (num('maxDev') || 0.2) / unitScale });
    if (r.after !== r.before) { source.original ||= before; adopt(r.list); }
    const lines = [r.after === r.before ? `Already ${r.before.toLocaleString()} triangles: nothing to reduce.` : `${r.before.toLocaleString()} -> ${r.after.toLocaleString()} triangles; the surface moved by at most ${round(r.deviation * unitScale, 2)} mm.`];
    if (!r.reached) lines.push(`Could not get down to ${(num('reduceTo') || 100000).toLocaleString()} without moving the surface more than ${num('maxDev') || 0.2} mm. Allow a bigger move, or ask for more triangles.`);
    if (r.open.length) lines.push(`Not reduced because they are not closed: ${r.open.join(', ')}. Repair them first.`);
    fixDone(lines);
  } catch (e) { showError(e.message || String(e)); }
  finally { busy = false; $('reduce').disabled = false; $('status').textContent = source.fileName; draw(); }
});
$('undoFix').addEventListener('click', () => {
  if (!source?.original) return;
  Object.assign(source, source.original, { original: null });
  buildPartList();
  fixDone(['Fixes undone.']);
});

// ---------- make it flexi ----------
$('make').addEventListener('click', async () => {
  if (!source || busy) return;
  clearTimeout(timer); draw();
  const used = usedParts();
  const triangles = used.reduce((n, p) => n + p.indices.length / 3, 0);
  if (triangles > HARD_LIMIT) { showError(`This model has ${triangles.toLocaleString()} triangles, too many to cut in the browser. Use "Reduce triangles" first.`); return; }
  busy = true; $('make').disabled = true;
  try {
    if (!engineReady) { $('status').textContent = 'Loading the cutting engine (about 0.5 MB)...'; await loadManifold(); engineReady = true; }
    $('status').textContent = 'Making joints...';
    await new Promise(r => setTimeout(r, 30));                                // let the status paint before the heavy work
    const xf = placed(used, { rotate: ['rotX', 'rotY', 'rotZ'].map(id => parseFloat($(id).value) || 0) });
    const axis = $('axis').value, k = AXES.indexOf(axis), lo = xf.min[k];
    const flexi = await makeFlexi(xf.parts, {
      axis, count: num('count'), positions: customList().length ? customList().map(v => lo + v) : null,
      joint: $('joint').value, ball: num('ball') || 0, bar: num('bar') || 0, bend: num('bend') || 0, clearance: num('clearance'),
    });
    let parts = flexi.parts;
    const turn = $('onSide').checked && axis === 'z';
    if (turn) parts = transformParts(parts, { rotate: [0, 90, 0], center: true, onBed: true }).parts;   // z -> x: the joints now lie sideways
    const { group, parts: meta } = buildGroup(parts);
    assignSlots(parts).forEach((s, i) => { meta[i].extruder = s; });
    viewer.setObject(buildPose(flexi, axis, turn));
    const b = boundsOfParts(parts);
    result = { group, meta, colored: parts.some(p => p.color) };      // what gets exported: the unbent model
    shown = { size: b.size, sizeObj: { width: b.size[0], depth: b.size[1], height: b.size[2] } };
    viewer.setView(view, shown.sizeObj);
    $('downloadStl').disabled = $('download3mf').disabled = false;
    $('info').textContent = `${round(b.size[0])} x ${round(b.size[1])} x ${round(b.size[2])} mm  |  ${flexi.joints.length} joint${flexi.joints.length === 1 ? '' : 's'}  |  ${parts.length} pieces  |  bends about ${Math.round(flexi.bend)} degrees per joint`;
    showWarnings(flexi.warnings);
    $('status').textContent = `Done: ${source.fileName}. Change any setting to go back to the cut view.`;
    showError('');
  } catch (e) {
    $('status').textContent = source.fileName;
    showError(e.message || String(e));
  } finally { busy = false; $('make').disabled = false; }
});

// ---------- try the bend ----------
/**
 * What the preview shows after "Make it flexi": the same pieces, nested so that turning a joint carries everything above it along.
 * It is only a picture (pieces can pass through each other beyond the bend the page reports); the download is the unbent model.
 */
function buildPose(flexi, axis, turn) {
  const k = AXES.indexOf(axis), spin = (k + 1) % 3, { group } = buildGroup(flexi.parts), segs = Math.max(...flexi.parts.map(p => p.seg)) + 1;
  const levels = Array.from({ length: segs }, () => new THREE.Group());
  levels.forEach((g, s) => { if (s) levels[s - 1].add(g); });
  [...group.children].forEach((mesh, i) => levels[flexi.parts[i].seg].add(mesh));
  const joints = levels.map((_, s) => { const j = flexi.joints.find(x => x.k === s - 1); return j && new THREE.Vector3(...fromAxisFrame([j.x, j.y, j.pivot], axis)); });
  const root = new THREE.Group();
  root.add(levels[0]);
  if (turn) {                                                                      // the same turn and drop to the bed that the download got
    const b = boundsOfParts(flexi.parts.map(p => ({ positions: p.positions.map((v, i) => [p.positions[i - (i % 3) + 2], p.positions[i - (i % 3) + 1], -p.positions[i - (i % 3)]][i % 3]) })));
    root.rotation.y = Math.PI / 2;
    root.position.set(...[-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
  }
  pose = { levels, joints, spin };
  const limit = Math.max(1, Math.round(flexi.bend));
  $('pose').min = -limit; $('pose').max = limit; $('pose').value = 0; $('poseOut').textContent = '0\u00b0';
  $('poseRow').hidden = false;
  return root;
}
function applyPose(deg) {
  if (!pose) return;
  $('poseOut').textContent = `${deg}\u00b0`;
  const axisVec = new THREE.Vector3().setComponent(pose.spin, 1);
  pose.levels.forEach((g, s) => {
    if (!s) return;
    const p = pose.joints[s];
    g.matrix.identity(); g.matrixAutoUpdate = false;
    if (p) g.matrix.makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationAxis(axisVec, (deg * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    g.matrixWorldNeedsUpdate = true;
  });
}
$('pose').addEventListener('input', () => applyPose(parseInt($('pose').value, 10) || 0));

// ---------- download ----------
const outName = ext => `${(source?.name || 'model').replace(/[^\w.-]+/g, '-')}-flexi.${ext}`;
$('downloadStl').addEventListener('click', () => result && downloadBlob(exportSTL(result.group), outName('stl')));
$('download3mf').addEventListener('click', () => result && downloadBlob(export3MF(result.group, { title: `${source.name} flexi`, parts: result.meta }), outName('3mf')));
