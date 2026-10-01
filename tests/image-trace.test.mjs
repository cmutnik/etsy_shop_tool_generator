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
