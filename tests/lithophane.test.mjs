// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { thicknessGrid, buildLithophane, backlitPreview, resample } from '../shared/js/lithophane.js';
import { exportSTL, export3MF } from '../shared/js/export.js';
import { assertWatertight } from './helpers.mjs';

/** A w*h picture: left half black, right half white, with a mid-grey pixel in one corner. */
function picture(w = 40, h = 30, fn = x => (x < w / 2 ? 0 : 255)) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fn(x, y); data.set([v, v, v, 255], (y * w + x) * 4); }
  return { data, width: w, height: h };
}
const base = { widthMm: 20, pixelMm: 0.5, minThickness: 0.8, maxThickness: 3.2 };

test('dark is thick and bright is thin, with the thickness range respected', () => {
  const g = thicknessGrid(picture(), base);
  const row = g.t.subarray(5 * g.nx, 6 * g.nx);
  assert.ok(Math.abs(row[1] - 3.2) < 1e-4, `black ${row[1]}`);
  assert.ok(Math.abs(row[g.nx - 2] - 0.8) < 1e-4, `white ${row[g.nx - 2]}`);
  const inv = thicknessGrid(picture(), { ...base, invert: true });
  assert.ok(inv.t[5 * g.nx + 1] < 1);
  assert.ok(Math.min(...g.t) >= 0.8 - 1e-4 && Math.max(...g.t) <= 3.2 + 1e-4);
});

test('the frame adds full-thickness cells all round and grows the plate', () => {
  const plain = thicknessGrid(picture(), base), framed = thicknessGrid(picture(), { ...base, frameMm: 2 });
  assert.equal(framed.nx, plain.nx + 8);
  assert.ok(Math.abs(framed.t[0] - 3.2) < 1e-5);
  assert.ok(Math.abs(framed.t[framed.nx * framed.nz - 1] - 3.2) < 1e-5);
  assert.equal(framed.t[4 * framed.nx + 4 + 30], plain.t[30], 'the picture is unchanged inside the frame');   // picture row 0, col 30, shifted by the 4-cell frame
});

test('the plate keeps the picture\'s proportions and the stated width', () => {
  const r = buildLithophane(picture(40, 30), { ...base, widthMm: 40 });
  assert.ok(Math.abs(r.info.plateWidth - 40) < 0.5, r.info.plateWidth);
  assert.ok(Math.abs(r.info.height / r.info.plateWidth - 0.75) < 0.03);
  const mesh = r.group.children[0];
  const bb = mesh.geometry.boundingBox;
  assert.ok(Math.abs(bb.min.z) < 1e-6, 'bottom edge on the bed');
  assert.ok(Math.abs(bb.min.y) < 1e-6 && Math.abs(bb.max.y - 3.2) < 1e-3, 'smooth face at y = 0, relief up to the thickest point');
  assert.ok(Math.abs(bb.min.x + bb.max.x) < 1e-3, 'centred on x = 0');
});

test('flat, framed, smoothed and curved plates are all watertight with outward faces', () => {
  const pics = [picture(), picture(31, 17, (x, y) => (x * 7 + y * 13) % 256), picture(20, 20, () => 255)];
  for (const img of pics)
    for (const extra of [{}, { frameMm: 1.5 }, { smooth: 1, gamma: 1.4 }, { curve: 90 }, { curve: 200, frameMm: 1 }, { invert: true }]) {
      const r = buildLithophane(img, { ...base, ...extra });
      assertWatertight(r.group.children[0], assert);
    }
});

test('a curved plate bends round a centre on the relief side', () => {
  const r = buildLithophane(picture(), { ...base, widthMm: 30, curve: 180 });
  const R = 30 / Math.PI;
  assert.ok(Math.abs(r.info.radius - R) < 1e-6);
  assert.ok(Math.abs(r.info.depth - (R + 0.0)) < 1.5, `a half cylinder is about R deep: ${r.info.depth} vs ${R}`);
  const pos = r.group.children[0].geometry.attributes.position;
  // every smooth-face point is on the circle of radius R round (0, R)
  for (let i = 0; i < pos.count / 2; i += 17) assert.ok(Math.abs(Math.hypot(pos.getX(i), pos.getY(i) - R) - R) < 1e-4);
});

test('bad settings are refused with a message', () => {
  assert.throws(() => buildLithophane(picture(), { ...base, minThickness: 0.2 }), /at least 0.4/);
  assert.throws(() => buildLithophane(picture(), { ...base, maxThickness: 0.8 }), /thicker/);
  assert.throws(() => buildLithophane(picture(), { ...base, curve: 300 }), /270/);
  assert.throws(() => buildLithophane(picture(), { ...base, widthMm: 8, curve: 270, maxThickness: 3.2 }), /too tight/);
  assert.throws(() => buildLithophane(picture(), { ...base, widthMm: 400, pixelMm: 0.1 }), /too many/);
});

test('exports to STL and 3MF', async () => {
  const r = buildLithophane(picture(), base);
  assert.ok(exportSTL(r.group).size > 84);
  assert.ok(export3MF(r.group, { title: 'Lithophane' }).size > 100);
});

test('the backlit preview is bright where thin and dark where thick', () => {
  const r = buildLithophane(picture(), base);
  const p = backlitPreview(r.grid, base);
  assert.equal(p.width, r.grid.nx);
  const rowAt = x => p.data[(5 * p.width + x) * 4];
  assert.ok(rowAt(1) < 30 && rowAt(p.width - 2) > 240);
});

test('resample averages and keeps the mean', () => {
  const src = Float32Array.from({ length: 36 }, (_, i) => i % 2);
  const out = resample(src, 6, 6, 3, 3);
  assert.equal(out.length, 9);
  assert.ok(Math.abs(out.reduce((a, b) => a + b) / 9 - 0.5) < 1e-6);
});
