// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildMarkers, parseNames, MAX_MARKERS } from '../tools/plant-markers/geometry.js';
import { export3MF, exportSTL } from '../shared/js/export.js';
import { unzip, zipStore } from '../shared/js/zip.js';
import { assertWatertight, testFont } from './helpers.mjs';

const font = await testFont('roboto', 700);
const skip = font ? false : 'font unavailable (offline)';
const base = { font, names: ['Basil', 'Tomato', 'Sweet / Basil'], fontSize: 12, lineSpacing: 1.2, margin: 3, minWidth: 30, sameSize: false, cornerRadius: 3, thickness: 2.4, raise: 0.8, spikeLength: 60, spikeWidth: 12, tipWidth: 2, bedWidth: 220, gap: 4 };

test('parseNames: one per line, blanks dropped, " / " makes two rows', () => {
  assert.deepEqual(parseNames('Basil\n\n  Mint  \nSweet / Basil\n'), ['Basil', 'Mint', 'Sweet\nBasil']);
});

test('every marker is watertight, in two meshes (stake and letters)', { skip }, () => {
  const r = buildMarkers(base);
  assert.equal(r.markers.length, 3);
  for (const m of r.markers) { assert.equal(m.group.children.length, 2); m.group.children.forEach(c => assertWatertight(c, assert)); }
});

test('the spike points down by the stated length, below a head that holds the name', { skip }, () => {
  const r = buildMarkers({ ...base, names: ['Basil'] });
  const local = mesh => new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);   // the marker's own frame
  const m = r.markers[0], bb = local(m.group.children[0]);
  assert.ok(Math.abs(bb.min.y + r.info.headHeight + 60) < 0.01 && Math.abs(bb.max.y) < 0.01, `${bb.min.y} ${bb.max.y}`);
  assert.ok(Math.abs(bb.min.z) < 1e-6 && Math.abs(bb.max.z - 2.4) < 1e-5);
  const t = local(m.group.children[1]);
  assert.ok(Math.abs(t.min.z - 2.4) < 1e-5 && Math.abs(t.max.z - 3.2) < 1e-5);
  assert.ok(t.max.y < bb.max.y && t.min.y > -r.info.headHeight, 'letters sit on the head, not on the spike');
});

test('heads fit their names; sameSize makes them all the width of the longest', { skip }, () => {
  const a = buildMarkers(base), b = buildMarkers({ ...base, sameSize: true });
  assert.ok(a.markers[0].width < a.markers[1].width + 1e-9 || a.markers[0].width === 30);
  assert.equal(new Set(b.markers.map(m => m.width)).size, 1);
  assert.ok(b.markers[0].width >= a.markers[1].width - 1e-9);
});

test('the layout wraps at the bed width and nothing overlaps or leaves the bed', { skip }, () => {
  const names = Array.from({ length: 12 }, (_, i) => `Plant ${i + 1}`);
  const r = buildMarkers({ ...base, names, bedWidth: 200 });
  assert.ok(r.info.rows > 1);
  const boxes = r.markers.map(m => new THREE.Box3().setFromObject(m.group));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!boxes[i].intersectsBox(boxes[j]), `${i} overlaps ${j}`);
  assert.ok(r.info.width <= 200 + 1e-6, `${r.info.width}`);
});

test('bad input is refused with a message', { skip }, () => {
  assert.throws(() => buildMarkers({ ...base, names: [] }), /at least one/);
  assert.throws(() => buildMarkers({ ...base, names: Array(MAX_MARKERS + 1).fill('A') }), /limit/);
  assert.throws(() => buildMarkers({ ...base, spikeLength: 10 }), /20 mm/);
  assert.throws(() => buildMarkers({ ...base, fontSize: 2 }), /4 mm/);
  assert.throws(() => buildMarkers({ ...base, names: ['Extraordinarily Long Plant Name Here'], bedWidth: 100, fontSize: 20 }), /does not fit/);
  assert.throws(() => buildMarkers({ ...base, font: null }), /font/);
  assert.match(buildMarkers({ ...base, fontSize: 6 }).info.warnings.join(' '), /8 mm/);
});

test('exports one STL / 3MF of the set, and a zip of one STL per marker', { skip }, async () => {
  const r = buildMarkers(base);
  assert.ok(exportSTL(r.group).size > 84);
  const blob = export3MF(r.group, { title: 'Plant markers', parts: [{ name: 'base', label: 'Stakes' }, { name: 'text', label: 'Letters' }] });
  assert.ok(blob.size > 100);
  const files = [];
  for (const [i, m] of buildMarkers(base).markers.entries()) files.push([`marker-${i + 1}.stl`, new Uint8Array(await exportSTL(m.group).arrayBuffer())]);
  const zip = unzip(zipStore(files));
  assert.deepEqual(zip.names.sort(), ['marker-1.stl', 'marker-2.stl', 'marker-3.stl']);
});
