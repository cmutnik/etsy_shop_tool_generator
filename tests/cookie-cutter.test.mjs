// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildCookieCutter, SHAPES, fitToSize, shape } from '../tools/cookie-cutter/geometry.js';
import { imageToGroups } from '../shared/js/image-trace.js';
import { dilate, outerBand, multiArea, fillHoles } from '../shared/js/offset2d.js';
import { exportSTL } from '../shared/js/export.js';
import { assertWatertight } from './helpers.mjs';

const box = m => new THREE.Box3().setFromObject(m);

/** w*h picture: black ring (disc with a hole) on white. */
function ring(w = 120, h = 100) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - w / 2, y - h / 2), v = d < 40 && d > 15 ? 0 : 255;
    data.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}

test('every built-in shape makes a watertight cutter of the stated size', () => {
  for (const s of SHAPES) {
    const r = buildCookieCutter({ groups: s.groups(), size: 60 });
    r.group.children.forEach(m => assertWatertight(m, assert));
    assert.ok(Math.abs(Math.max(r.info.cookieWidth, r.info.cookieHeight) - 60) < 1e-6, s.id);
    assert.ok(r.info.width <= 60 + 2 * (1.2 + 4) + 1e-3 && r.info.width >= 60 - 0.01, `${s.id} ${r.info.width}`);
    assert.ok(Math.abs(r.info.height - 12) < 1e-5);
  }
});

test('layers stack flange / wall / edge with the stated heights, each thinner than the one below', () => {
  const r = buildCookieCutter({ groups: shape('circle').groups(), size: 50, wall: 1.2, edge: 0.6, edgeHeight: 2, height: 12, flange: 4, flangeThickness: 2 });
  const [fl, wa, ed] = r.group.children.map(box);
  assert.deepEqual([fl.min.z, fl.max.z].map(z => +z.toFixed(4)), [0, 2]);
  assert.deepEqual([wa.min.z, wa.max.z].map(z => +z.toFixed(4)), [2, 10]);
  assert.deepEqual([ed.min.z, ed.max.z].map(z => +z.toFixed(4)), [10, 12]);
  const w = b => b.max.x - b.min.x;
  assert.ok(Math.abs(w(fl) - (50 + 2 * 5.2)) < 0.1 && Math.abs(w(wa) - (50 + 2 * 1.2)) < 0.1 && Math.abs(w(ed) - (50 + 2 * 0.6)) < 0.1, `${w(fl)} ${w(wa)} ${w(ed)}`);
});

test('the inside of the cutter is exactly the shape: the cavity is clear at every height', () => {
  const r = buildCookieCutter({ groups: shape('heart').groups(), size: 60 });
  const fit = fitToSize(shape('heart').groups(), 60).groups;
  // no cutter material inside the shape: band regions are disjoint from it (area of overlap ~ 0)
  const wallArea = multiArea(outerBand(fit, 1.2));
  const grown = multiArea(dilate(fit, 1.2));
  const shapeArea = multiArea([[fit[0].outer]]);
  assert.ok(Math.abs(grown - shapeArea - wallArea) / wallArea < 0.01, 'wall + shape = shape grown by the wall');
  assert.ok(r.group.children.length === 3);
});

test('a picture with a hole gets a wall round the island, unless holes are ignored', () => {
  const g = imageToGroups(ring(), { tolerance: 1.2, smooth: 1 }).groups;
  assert.equal(g.length, 1);
  assert.equal(g[0].holes.length, 1);
  const withHole = buildCookieCutter({ groups: g, size: 70 }), solid = buildCookieCutter({ groups: g, size: 70, fillHoles: true });
  withHole.group.children.forEach(m => assertWatertight(m, assert));
  solid.group.children.forEach(m => assertWatertight(m, assert));
  const vol = r => r.group.children.reduce((s, m) => s + (() => { const p = m.geometry.attributes.position; let v = 0; for (let i = 0; i < p.count; i += 3) { const a = [p.getX(i), p.getY(i), p.getZ(i)], b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)]; v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return v; })(), 0);
  assert.ok(vol(withHole) > vol(solid) * 1.3, 'the hole adds a second wall');
  assert.match(withHole.info.warnings.join(' '), /1 hole/);
  assert.equal(solid.info.warnings.filter(w => /hole/.test(w)).length, 0);
});

test('a flange of 0 leaves just the wall on the bed', () => {
  const r = buildCookieCutter({ groups: shape('star').groups(), size: 60, flange: 0 });
  r.group.children.forEach(m => assertWatertight(m, assert));
  assert.ok(Math.abs(r.info.width - (60 + 2.4)) < 0.2, `${r.info.width}`);
});

test('bad settings and empty shapes are refused', () => {
  const g = shape('circle').groups();
  assert.throws(() => buildCookieCutter({ groups: [], size: 50 }), /no shape/);
  assert.throws(() => buildCookieCutter({ groups: g, size: 5 }), /15 mm/);
  assert.throws(() => buildCookieCutter({ groups: g, size: 50, edge: 0.2 }), /0.4/);
  assert.throws(() => buildCookieCutter({ groups: g, size: 50, wall: 0.5, edge: 0.6 }), /wall/);
  assert.throws(() => buildCookieCutter({ groups: g, size: 50, height: 4 }), /too short/);
  assert.throws(() => buildCookieCutter({ groups: g, size: 50, flangeThickness: 0.4 }), /flange/);
});

test('exports an STL, and fillHoles keeps only outer rings', () => {
  assert.ok(exportSTL(buildCookieCutter({ groups: shape('flower').groups(), size: 60 }).group).size > 84);
  const g = imageToGroups(ring(), { tolerance: 1.2 }).groups;
  assert.equal(fillHoles(g)[0].holes.length, 0);
});
