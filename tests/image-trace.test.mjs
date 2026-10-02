// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { traceMask, imageToGroups } from '../shared/js/image-trace.js';
import { signedArea, boundsOf } from '../shared/js/geometry2d.js';

function rgba(w, h, ink) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
  return { data, width: w, height: h };
}

test('traceMask: solid block is one ring with the right area', () => {
  const mask = new Uint8Array(100);
  for (let y = 2; y < 8; y++) for (let x = 3; x < 9; x++) mask[y * 10 + x] = 1;
  const rings = traceMask(mask, 10, 10);
  assert.equal(rings.length, 1);
  // contour passes through pixel-edge midpoints: a 6x6 block traces a ~5.5x5.5 octagon-cornered ring
  const a = Math.abs(signedArea(rings[0]));
  assert.ok(a > 28 && a < 36, `area ${a}`);
});

test('imageToGroups: square with a hole -> one group, one hole', () => {
  const img = rgba(40, 40, (x, y) => x >= 5 && x < 35 && y >= 5 && y < 35 && !(x >= 15 && x < 25 && y >= 15 && y < 25));
  const { groups, width, height } = imageToGroups(img);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].holes.length, 1);
  assert.ok(Math.abs(width - 29) < 1.5 && Math.abs(height - 29) < 1.5, `size ${width}x${height}`);
  const b = boundsOf(groups);
  assert.ok(Math.abs(b.minX + b.maxX) < 1e-6, 'centred');
});

test('imageToGroups: invert flips ink', () => {
  const img = rgba(30, 30, (x, y) => x >= 10 && x < 20 && y >= 10 && y < 20);
  const normal = imageToGroups(img);
  const inv = imageToGroups(img, { invert: true });
  assert.ok(normal.width < 15);
  assert.ok(inv.width > 25); // background becomes ink, with the square as a hole
  assert.equal(inv.groups[0].holes.length, 1);
});

test('imageToGroups: transparent pixels count as paper', () => {
  const data = new Uint8ClampedArray(20 * 20 * 4); // all transparent black
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) data.set([0, 0, 0, 255], (y * 20 + x) * 4);
  const { groups } = imageToGroups({ data, width: 20, height: 20 });
  assert.equal(groups.length, 1);
});

test('imageToGroups frame: two layers cut from one picture keep their relative positions', () => {
  const w = 60, h = 40;
  const pic = (x0, y0) => { const data = new Uint8ClampedArray(w * h * 4).fill(255); for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3); return { data, width: w, height: h }; };
  const A = imageToGroups(pic(5, 25), { frame: true }), B = imageToGroups(pic(45, 5), { frame: true });
  const cx = g => { const o = g.groups[0].outer; return [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length]; };
  assert.equal(A.width, 60); assert.equal(A.height, 40); assert.equal(A.framed, true);
  const [ax, ay] = cx(A), [bx, by] = cx(B);
  assert.ok(Math.abs(bx - ax - 40) < 0.01 && Math.abs(by - ay - 20) < 0.01, `offset ${bx - ax}, ${by - ay}`);   // B is 40 to the right and 20 higher (y points up)
  // the first square (pixels 5..12 x 25..32) sits left of and below the picture's centre
  assert.ok(ax < 0 && ay < 0);
  assert.equal(imageToGroups(pic(5, 25)).framed, false);
});
