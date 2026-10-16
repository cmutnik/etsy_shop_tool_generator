// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assignLabels, stackOrder, usedOrder, buildLayeredArt, NONE, rgbToHex, hexToRgb } from '../shared/js/layered-art.js';
import { quantize } from '../shared/js/image-color.js';
import { export3MF, exportSTL, collectMesh } from '../shared/js/export.js';
import { unzip } from '../shared/js/zip.js';
import { assertWatertight } from './helpers.mjs';

const BLACK = [0, 0, 0], RED = [200, 30, 30], WHITE = [250, 250, 250];

/** w*h picture: black frame, red middle band, white centre square; optionally a transparent top-left corner. */
function picture(w = 40, h = 30, { hole = false } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    const c = edge < 3 ? BLACK : edge < 8 ? RED : WHITE;
    data.set([...c, hole && x < 6 && y < 6 ? 0 : 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}
const palette = [WHITE, BLACK, RED];                        // deliberately not sorted
const area = mesh => {                                      // volume / depth = footprint area
  const g = mesh.geometry, p = g.attributes.position, ix = g.index;
  let vol = 0;
  const at = i => (ix ? ix.getX(i) : i);
  for (let t = 0; t < (ix ? ix.count : p.count); t += 3) {
    const [a, b, c] = [0, 1, 2].map(j => [p.getX(at(t + j)), p.getY(at(t + j)), p.getZ(at(t + j))]);
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return vol;
};

test('labels go to the nearest palette colour and transparency is left empty', () => {
  const l = assignLabels(picture(40, 30, { hole: true }), palette);
  assert.equal(l[0], NONE);
  assert.equal(l[10 * 40 + 20], 0);                         // white centre
  assert.equal(l[1 * 40 + 20], 1);                          // black edge
  assert.equal(l[5 * 40 + 20], 2);                          // red band
});

test('stack order puts dark or light at the bottom, and unused colours drop out', () => {
  assert.deepEqual(stackOrder(palette, 'dark-bottom'), [1, 2, 0]);
  assert.deepEqual(stackOrder(palette, 'light-bottom'), [0, 2, 1]);
  assert.deepEqual(stackOrder(palette, 'as-listed'), [0, 1, 2]);
  const l = new Uint8Array([0, 0, 2, NONE]);
  assert.deepEqual(usedOrder(l, [1, 2, 0]), [2, 0]);
});

test('one part per colour, stacked: each step is the right thickness and sits on the one below', () => {
  const img = picture();
  const labels = assignLabels(img, palette), order = stackOrder(palette);
  const r = buildLayeredArt({ labels, width: 40, height: 30, palette, order, widthMm: 40, baseThickness: 0.8, stepHeight: 0.2 });
  assert.equal(r.group.children.length, 3);
  assert.ok(Math.abs(r.info.height - 1.2) < 1e-9);
  assert.deepEqual(r.info.filamentChangeZs.map(z => +z.toFixed(3)), [0.8, 1.0]);
  r.group.children.forEach((m, k) => {
    assertWatertight(m, assert);
    const bb = new THREE.Box3().setFromObject(m);
    assert.ok(Math.abs(bb.min.z - [0, 0.8, 1.0][k]) < 1e-5 && Math.abs(bb.max.z - [0.8, 1.0, 1.2][k]) < 1e-5, `layer ${k} z range ${bb.min.z}-${bb.max.z}`);
  });
  // layer footprints shrink: black+red+white (everything), red+white, white only
  const areas = r.group.children.map((m, k) => area(m) / [0.8, 0.2, 0.2][k]);
  assert.ok(Math.abs(areas[0] - 40 * 30 * 1) < 40, `base covers the picture: ${areas[0]}`);          // 1 mm^2 per px
  assert.ok(Math.abs(areas[1] - (40 * 30 - 2 * 3 * (40 + 30) + 4 * 9)) < 40, `${areas[1]}`);
  assert.ok(areas[0] > areas[1] && areas[1] > areas[2]);
  assert.equal(r.group.children[0].material.color.getHexString(), '000000');
});

test('layers register: every layer is centred on the same point of the same frame', () => {
  const labels = assignLabels(picture(), palette);
  const r = buildLayeredArt({ labels, width: 40, height: 30, palette, order: stackOrder(palette), widthMm: 40 });
  const boxes = r.group.children.map(m => new THREE.Box3().setFromObject(m));
  for (const b of boxes) assert.ok(Math.abs((b.min.x + b.max.x) / 2) < 0.6 && Math.abs((b.min.y + b.max.y) / 2) < 0.6);
  assert.ok(boxes[0].max.x - boxes[0].min.x > boxes[2].max.x - boxes[2].min.x);
});

test('transparent pixels stay empty in every layer (a cut-out print)', () => {
  const img = picture(40, 30, { hole: true });
  const r = buildLayeredArt({ labels: assignLabels(img, palette), width: 40, height: 30, palette, order: stackOrder(palette), widthMm: 40 });
  const base = r.group.children[0];
  assertWatertight(base, assert);
  const a = area(base) / 0.8;
  assert.ok(a < 40 * 30 - 25 && a > 40 * 30 - 45, `corner cut out: ${a}`);
});

test('a photo posterized with k-means builds, and the 3MF carries one filament slot per colour', async () => {
  const w = 60, h = 40, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 4, y * 6, 128 + ((x * y) % 50), 255], (y * w + x) * 4);
  const img = { data, width: w, height: h }, q = quantize(img, 4);
  const labels = assignLabels(img, q.palette);
  const order = usedOrder(labels, stackOrder(q.palette));
  const r = buildLayeredArt({ labels, width: w, height: h, palette: q.palette, order, widthMm: 60 });
  assert.equal(r.group.children.length, order.length);
  const parts = r.group.children.map((m, i) => ({ name: m.name, label: `Layer ${i + 1}`, extruder: i + 1 }));
  const blob = export3MF(r.group, { title: 'Layered art', parts });
  const zip = unzip(new Uint8Array(await blob.arrayBuffer()));
  const cfg = new TextDecoder().decode(await zip.read('Metadata/model_settings.config'));
  assert.equal((cfg.match(/key="extruder"/g) || []).length, order.length);
  for (let i = 1; i <= order.length; i++) assert.match(cfg, new RegExp(`key="extruder" value="${i}"`));
  assert.ok(exportSTL(r.group).size > 84);
});

test('bad settings are refused', () => {
  const labels = assignLabels(picture(), palette), args = { labels, width: 40, height: 30, palette, order: stackOrder(palette) };
  assert.throws(() => buildLayeredArt({ ...args, baseThickness: 0.1 }), /base/);
  assert.throws(() => buildLayeredArt({ ...args, stepHeight: 0.01 }), /step/);
  assert.throws(() => buildLayeredArt({ ...args, order: [] }), /no opaque/);
});

test('hex helpers round-trip', () => {
  assert.equal(rgbToHex([255, 0, 128]), '#ff0080');
  assert.deepEqual(hexToRgb('#ff0080'), [255, 0, 128]);
});
