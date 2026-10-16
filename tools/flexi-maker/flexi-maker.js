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
import { makeTestStrip } from './test-strip.js';
import { segmentLengths, dragValue, cutsToText, MIN_SEGMENT, cutsFromOffsets, offsetsOf, addCutAt, moveCutTo, removeCutAt, tiltCutTo, setCutAxis, dragCut, MAX_TILT } from './cut-edit.js';
import { makeFlexiCuts } from './multi.js';
import { normalOf, needsGeneral, positionOf, axisIndex } from './cut-plane.js';

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);
const viewer = createViewer($('viewport'));
const AXES = ['x', 'y', 'z'];

let source = null;          // { name, fileName, parts, stats, include, colors, slots }
let shown = null;           // { size, sizeObj } of what the preview shows
let result = null;          // the flexi model, until something changes: { group, meta }
let pose = null;            // the preview's bendable copy: { levels, joints, axis }
let cutView = null;         // the cut planes in the preview, while they are showing: { group, planes, models, cuts, bounds }
let manual = null;          // null: the cuts come from "Segments", "Cut positions" and "Cut across". Otherwise the cuts placed by hand: [{ axis, tilt, point, anchor }] in the placed model's coordinates
let boundsKey = '';         // what the manual cuts were measured against: they are dropped if the model changes size or position
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

/** The cuts the page will make: the ones placed by hand, or even / typed positions all across the chosen axis. */
function currentCuts(bounds) {
  if (manual) return manual;
  const axis = $('axis').value, k = AXES.indexOf(axis), lo = bounds.min[k], hi = bounds.max[k];
  return cutsFromOffsets(cutPositions(lo, hi, num('count'), customList().map(v => lo + v)).map(c => c - lo), axis, bounds);
}

function refresh() { clearTimeout(timer); timer = setTimeout(draw, 120); invalidate(); }
function invalidate() { result = null; pose = null; cutView = null; $('poseRow').hidden = true; $('pose').value = 0; $('poseOut').textContent = '0°'; $('downloadStl').disabled = $('download3mf').disabled = true; }

function draw() {
  if (!source) return;
  const used = usedParts();
  $('barRow').hidden = $('joint').value === 'ball'; $('ballRow').hidden = $('joint').value !== 'ball';
  $('make').disabled = busy || !used.length;
  if (!used.length) { showError('Keep at least one part ticked.'); return; }
  showError('');
  const xf = placed(used, { rotate: ['rotX', 'rotY', 'rotZ'].map(id => parseFloat($(id).value) || 0) });
  const { group } = buildGroup(xf.parts);
  const bounds = { min: xf.min, max: xf.max }, key = [...xf.min, ...xf.max].map(v => v.toFixed(2)).join();
  if (key !== boundsKey) { manual = null; boundsKey = key; }                        // turned, scaled or trimmed: hand-placed cuts no longer mean the same thing
  const cuts = currentCuts(bounds), diag = Math.hypot(...xf.size), planes = [];
  for (const [i, c] of cuts.entries()) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xd9480f, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    plane.position.set(...c.point);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...normalOf(c.axis, c.tilt)));
    const wide = diag * 0.75 + 4;                                                      // big enough to show a tilted plane across the whole model
    plane.scale.set(wide, wide, 1);
    plane.userData = { plane: true, index: i };
    planes.push(plane);
    group.add(plane);
  }
  cutView = { group, planes, models: group.children.filter(c => !c.userData.plane), cuts, bounds };
  drawCutList();
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
  if (needsGeneral(cuts)) warnings.push('These cuts are in more than one direction or tilted, so each one is made on the piece you clicked, in the order you placed them, and the model is printed the way it is turned here ("Lay it on its side" is not used). A cut slices every part of the piece it works on.');
  showWarnings(warnings);
  $('status').textContent = source.fileName;
}
$('count').addEventListener('input', () => { $('custom').value = ''; manual = null; });   // asking for a number of segments means even ones again
$('custom').addEventListener('input', () => { manual = null; });
$('controls').addEventListener('input', e => { if (!e.target.closest('#partList') && !e.target.closest('#cutList') && e.target.id !== 'file') refresh(); });

// ---------- placing the cuts by hand ----------
/** Make `list` the cuts. The segment count and the positions box follow where they can (parallel cuts), and the preview is redrawn. */
function setCuts(list) {
  if (!cutView) return;
  manual = list;
  $('count').value = list.length + 1;
  $('custom').value = needsGeneral(list) || !list.length ? '' : cutsToText(offsetsOf(list, cutView.bounds));
  refresh();
}
const AXIS_LABEL = { x: 'X', y: 'Y', z: 'Z' };
function drawCutList(live = null) {
  const box = $('cutBox');
  if (!cutView) { box.hidden = true; return; }
  const cuts = live || cutView.cuts, b = cutView.bounds, len = k => b.max[k] - b.min[k];
  box.hidden = false;
  $('cutList').replaceChildren(...cuts.map((c, i) => {
    const k = axisIndex(c.axis), li = document.createElement('li'), label = document.createElement('span'), axis = document.createElement('select'), pos = document.createElement('input'), ta = document.createElement('input'), tb = document.createElement('input'), rm = document.createElement('button');
    label.textContent = `Cut ${i + 1}`;
    for (const a of AXES) axis.append(Object.assign(document.createElement('option'), { value: a, textContent: AXIS_LABEL[a], selected: a === c.axis }));
    axis.title = 'The direction this cut goes across';
    axis.addEventListener('change', () => setCuts(setCutAxis(cutView.cuts, i, axis.value)));
    pos.type = 'number'; pos.value = round(positionOf(c, b.min[k]), 1); pos.step = 0.5; pos.min = MIN_SEGMENT; pos.max = round(len(k) - MIN_SEGMENT, 1); pos.title = 'mm from the low end of the model, along the cut axis';
    pos.addEventListener('change', () => setCuts(moveCutTo(cutView.cuts, i, b.min[k] + parseFloat(pos.value), b)));
    const others = [AXES[(k + 1) % 3], AXES[(k + 2) % 3]];
    [ta, tb].forEach((t, n) => { t.type = 'number'; t.value = round(c.tilt[n], 1); t.step = 5; t.min = -MAX_TILT; t.max = MAX_TILT; t.title = `Tilt the cut about the ${others[n].toUpperCase()} axis (degrees)`; t.addEventListener('change', () => setCuts(tiltCutTo(cutView.cuts, i, parseFloat(ta.value), parseFloat(tb.value)))); });
    rm.type = 'button'; rm.textContent = '×'; rm.title = 'Remove this cut';
    rm.addEventListener('click', () => setCuts(removeCutAt(cutView.cuts, i)));
    li.append(label, axis, pos, ta, tb, rm);
    return li;
  }));
  $('cutSegs').textContent = needsGeneral(cuts) ? `${cuts.length + 1} pieces, cut in the order shown` : `Segments: ${segmentLengths(offsetsOf(cuts, b), len(cuts.length ? axisIndex(cuts[0].axis) : AXES.indexOf($('axis').value))).join(' + ')} mm`;
}
$('addCut').addEventListener('click', () => {
  if (!cutView) return;
  const axis = $('axis').value, k = AXES.indexOf(axis), b = cutView.bounds, length = b.max[k] - b.min[k];
  const same = cutView.cuts.filter(c => c.axis === axis && !c.tilt[0] && !c.tilt[1]), edges = [0, ...offsetsOf(same, b), length];
  let best = 0;
  for (let i = 1; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > edges[best + 1] - edges[best]) best = i;
  const r = addCutAt(cutView.cuts, cutsFromOffsets([(edges[best] + edges[best + 1]) / 2], axis, b)[0], b);
  if (r.added) setCuts(r.cuts); else showError(r.reason);
});
$('evenCuts').addEventListener('click', () => { manual = null; $('custom').value = ''; $('count').value = (cutView ? cutView.cuts.length : 1) + 1; refresh(); });

// Click the model to add a cut there (across the axis chosen in "Cut across"); drag a cut plane along its normal to move it; double-click a plane to remove it.
// Orbiting works as before. Each cut remembers where you clicked, so it works on the piece that was there.
{
  const dom = viewer.dom, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let drag = null, press = null, hover = null;
  const pick = (e, objects) => {
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    viewer.camera.updateMatrixWorld();                                         // the render loop may not have run since the camera last moved
    objects.forEach(o => o.updateMatrixWorld());
    ray.setFromCamera(ndc, viewer.camera);
    return ray.intersectObjects(objects, false);
  };
  const live = () => cutView && $('editCuts').checked && !result && !busy;
  /** What is nearest under the pointer: a cut plane (grab it) or the model (add a cut there). A plane the model is in front of does not count. */
  const nearest = e => { const h = pick(e, [...cutView.planes, ...cutView.models])[0]; return h ? { hit: h, plane: !!h.object.userData.plane } : null; };
  const setHover = plane => {
    if (hover === plane) return;
    if (hover) hover.material.opacity = 0.35;
    hover = plane;
    if (hover) hover.material.opacity = 0.7;
    dom.style.cursor = plane ? 'grab' : '';
  };
  /** One mm along the plane's normal, as a vector in screen pixels, at the plane's centre. */
  const axisPixels = i => {
    const r = dom.getBoundingClientRect(), c = cutView.cuts[i], a = new THREE.Vector3(...c.point), b = a.clone().add(new THREE.Vector3(...normalOf(c.axis, c.tilt)));
    const px = v => { const p = v.clone().project(viewer.camera); return { x: (p.x * r.width) / 2, y: (-p.y * r.height) / 2 }; };
    const pa = px(a), pb = px(b);
    return { x: pb.x - pa.x, y: pb.y - pa.y };
  };
  dom.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !live()) return;
    const n = nearest(e);
    if (n && n.plane) {
      const i = n.hit.object.userData.index;
      drag = { i, x: e.clientX, y: e.clientY, axis: axisPixels(i), cuts: cutView.cuts.slice(), list: cutView.cuts.slice() };
      viewer.controls.enabled = false;
      try { dom.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: carry on without capture */ }
      dom.style.cursor = 'grabbing';
    } else press = { x: e.clientX, y: e.clientY };
  });
  dom.addEventListener('pointermove', e => {
    if (!live()) return;
    if (drag) {
      const mm = dragValue(0, { x: e.clientX - drag.x, y: e.clientY - drag.y }, drag.axis);
      drag.list = dragCut(drag.cuts, drag.i, mm, cutView.bounds);
      cutView.planes[drag.i].position.set(...drag.list[drag.i].point);
      drawCutList(drag.list);
      $('status').textContent = `Cut ${drag.i + 1} at ${round(positionOf(drag.list[drag.i], cutView.bounds.min[axisIndex(drag.list[drag.i].axis)]), 1)} mm`;
    } else if (!(e.buttons & 1)) { const n = nearest(e); setHover(n && n.plane ? n.hit.object : null); }
  });
  const finish = e => {
    if (drag) {
      const list = drag.list; drag = null;
      viewer.controls.enabled = true;
      dom.style.cursor = hover ? 'grab' : '';
      try { dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      setCuts(list);
    }
  };
  dom.addEventListener('pointerup', e => {
    if (drag) return finish(e);
    if (!press) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y); press = null;
    if (moved > 4 || !live()) return;                                          // that was an orbit, not a click
    const n = nearest(e);
    if (!n || n.plane) return;
    showError('');
    const hit = n.hit, normal = hit.face ? hit.face.normal : new THREE.Vector3(), point = hit.point.toArray();
    const anchor = [0, 1, 2].map(k => point[k] - normal.getComponent(k));       // a point just inside the material, to tell which piece was clicked
    const r = addCutAt(cutView.cuts, { axis: $('axis').value, tilt: [0, 0], point, anchor }, cutView.bounds);
    if (r.added) setCuts(r.cuts); else showError(r.reason);
  });
  dom.addEventListener('pointercancel', finish);
  dom.addEventListener('dblclick', e => {
    if (!live()) return;
    const n = nearest(e);
    if (n && n.plane) setCuts(removeCutAt(cutView.cuts, n.hit.object.userData.index));
  });
}

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
    const r = await simplifyParts(source.parts, { include: source.include, target: num('reduceTo') || 100000, maxDeviation: (num('maxDev') || Math.max(0.005, 0.0015 * Math.max(...(shown?.size || [1])))) / unitScale });
    if (r.after !== r.before) { source.original ||= before; adopt(r.list); }
    const lines = [r.after === r.before ? `Already ${r.before.toLocaleString()} triangles: nothing to reduce.` : `${r.before.toLocaleString()} -> ${r.after.toLocaleString()} triangles; the surface moved by at most ${round(r.deviation * unitScale, 2)} mm.`];
    if (!r.reached) lines.push(`Could not get down to ${(num('reduceTo') || 100000).toLocaleString()} without moving the surface more than ${round(r.deviation * unitScale, 3)} mm. Allow a bigger move, or ask for more triangles.`);
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
    const cuts = currentCuts({ min: xf.min, max: xf.max });
    if (!cuts.length) throw new Error('Place at least one cut: click the model, or ask for two or more segments.');
    const joint = { joint: $('joint').value, ball: num('ball') || 0, bar: num('bar') || 0, bend: num('bend') || 0, clearance: num('clearance') };
    let flexi, tree, axis, turn = false;
    if (needsGeneral(cuts)) {
      flexi = await makeFlexiCuts(xf.parts, cuts, joint);                    // cuts in several directions, or tilted: each works on one piece
      tree = flexi.joints.map(j => ({ parent: j.parent, child: j.child, pivot: j.pivot, axis: j.axis }));
    } else {
      axis = cuts[0].axis;                                                    // parallel straight cuts: the whole model, in a chain
      const k = AXES.indexOf(axis), spin = [0, 1, 2].map(i => (i === (k + 1) % 3 ? 1 : 0));
      flexi = await makeFlexi(xf.parts, { axis, count: cuts.length + 1, positions: cuts.map(c => c.point[k]), ...joint });
      tree = flexi.joints.map(j => ({ parent: j.k, child: j.k + 1, pivot: fromAxisFrame([j.x, j.y, j.pivot], axis), axis: spin }));
      turn = $('onSide').checked && axis === 'z';
    }
    let parts = flexi.parts;
    if (turn) parts = transformParts(parts, { rotate: [0, 90, 0], center: true, onBed: true }).parts;   // z -> x: the joints now lie sideways
    const { group, parts: meta } = buildGroup(parts);
    assignSlots(parts).forEach((s, i) => { meta[i].extruder = s; });
    viewer.setObject(buildPose(flexi, tree, turn));
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

// ---------- joint test strip ----------
$('strip').addEventListener('click', async () => {
  if (busy) return;
  clearTimeout(timer);
  busy = true; $('strip').disabled = $('make').disabled = true;
  try {
    if (!engineReady) { $('status').textContent = 'Loading the cutting engine (about 0.5 MB)...'; await loadManifold(); engineReady = true; }
    $('status').textContent = 'Making the test strip...';
    await new Promise(r => setTimeout(r, 30));
    const r = await makeTestStrip({ joint: $('joint').value, ball: num('ball') || 0, bar: num('bar') || 0, bend: num('bend') || 0, clearance: num('clearance'), onSide: $('onSide').checked });
    const { group, parts: meta } = buildGroup(r.parts);
    assignSlots(r.parts).forEach((s, i) => { meta[i].extruder = s; });
    invalidate();
    viewer.setObject(group);
    result = { group, meta, base: `joint-test-strip-${$('joint').value}-${r.clearances.map(c => c.toFixed(2)).join('-')}`, title: 'Joint test strip' };
    shown = { size: r.size, sizeObj: { width: r.size[0], depth: r.size[1], height: r.size[2] } };
    framed = true; viewer.resize(); viewer.setView(view, shown.sizeObj);
    $('downloadStl').disabled = $('download3mf').disabled = false;
    $('info').textContent = `Joint test strip: ${r.clearances.map(c => c.toFixed(2)).join(', ')} mm clearance, from the nearest bar to the farthest (1, 2 and 3 bumps)  |  ${round(r.size[0])} x ${round(r.size[1])} x ${round(r.size[2])} mm`;
    showWarnings(['Print the strip as it is, with the settings you will use for the model (layer height, speed, filament). Bend each joint a few times to free it. Pick the lowest clearance that moves smoothly with no wobble, type it into "Joint clearance", then make your model. If every bar is stuck, raise the clearance by 0.2 mm and print the strip again; if all are loose, lower it.']);
    $('status').textContent = 'Joint test strip ready. Change any setting to go back to your model.';
    showError('');
  } catch (e) {
    $('status').textContent = source ? source.fileName : 'Open a file to start.';
    showError(e.message || String(e));
  } finally { busy = false; $('strip').disabled = false; $('make').disabled = !source; }
});

// ---------- try the bend ----------
/**
 * What the preview shows after "Make it flexi": the same pieces, nested along the joint tree so that turning a joint carries everything beyond it along.
 * Each tree entry is { parent, child, pivot, axis } in the model's coordinates. It is only a picture (pieces can pass through each other beyond the bend the page
 * reports); the download is the unbent model.
 */
function buildPose(flexi, tree, turn) {
  const { group } = buildGroup(flexi.parts), segs = Math.max(...flexi.parts.map(p => p.seg)) + 1;
  const levels = Array.from({ length: segs }, () => new THREE.Group());
  for (const e of tree) if (!levels[e.child].parent) levels[e.parent].add(levels[e.child]);
  [...group.children].forEach((mesh, i) => levels[flexi.parts[i].seg].add(mesh));
  const joints = levels.map((_, s) => { const e = tree.find(x => x.child === s); return e && { pivot: new THREE.Vector3(...e.pivot), axis: new THREE.Vector3(...e.axis).normalize() }; });
  const root = new THREE.Group();
  root.add(levels[0]);
  if (turn) {                                                                      // the same turn and drop to the bed that the download got
    const b = boundsOfParts(flexi.parts.map(p => ({ positions: p.positions.map((v, i) => [p.positions[i - (i % 3) + 2], p.positions[i - (i % 3) + 1], -p.positions[i - (i % 3)]][i % 3]) })));
    root.rotation.y = Math.PI / 2;
    root.position.set(...[-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
  }
  pose = { levels, joints };
  const limit = Math.max(1, Math.round(flexi.bend));
  $('pose').min = -limit; $('pose').max = limit; $('pose').value = 0; $('poseOut').textContent = '0°';
  $('poseRow').hidden = false;
  return root;
}
function applyPose(deg) {
  if (!pose) return;
  $('poseOut').textContent = `${deg}°`;
  pose.levels.forEach((g, s) => {
    if (!s) return;
    const j = pose.joints[s], p = j && j.pivot;
    g.matrix.identity(); g.matrixAutoUpdate = false;
    if (j) g.matrix.makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationAxis(j.axis, (deg * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    g.matrixWorldNeedsUpdate = true;
  });
}
$('pose').addEventListener('input', () => applyPose(parseInt($('pose').value, 10) || 0));

// ---------- download ----------
const outName = ext => (result?.base ? `${result.base}.${ext}` : `${(source?.name || 'model').replace(/[^\w.-]+/g, '-')}-flexi.${ext}`);
$('downloadStl').addEventListener('click', () => result && downloadBlob(exportSTL(result.group), outName('stl')));
$('download3mf').addEventListener('click', () => result && downloadBlob(export3MF(result.group, { title: result.title || `${source.name} flexi`, parts: result.meta }), outName('3mf')));
