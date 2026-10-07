// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBin, footInset, lipInset, lipProfile, lipHeight, ringAt, FOOT, GRID, FOOTPRINT, BASE_H, MAGNET, LIP_PENETRATION } from '../tools/gridfinity/geometry.js';
import { exportSTL } from '../shared/js/export.js';
import { assertWatertight } from './helpers.mjs';

const base = { units: [2, 1], height: 4, compartments: [1, 1], wall: 1.2, floor: 1.2, divider: 1.2, lip: true, scoop: 0, magnets: false };
const box = o => new THREE.Box3().setFromObject(o);
const vol = g => g.children.reduce((s, m) => { const p = m.geometry.attributes.position, ix = m.geometry.index, at = i => (ix ? ix.getX(i) : i); let v = 0; for (let t = 0; t < (ix ? ix.count : p.count); t += 3) { const a = at(t), b = at(t + 1), c = at(t + 2); v += (p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) - p.getY(a) * (p.getX(b) * p.getZ(c) - p.getZ(b) * p.getX(c)) + p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c))) / 6; } return s + v; }, 0);

test('the foot profile is the Gridfinity one: 0.8 mm 45 degree chamfer, 1.8 mm straight, 2.15 mm 45 degree chamfer, 4.75 mm tall', () => {
  assert.equal(FOOT[FOOT.length - 1][0], 4.75);
  assert.ok(Math.abs(footInset(0) - 2.95) < 1e-9 && Math.abs(footInset(0.8) - 2.15) < 1e-9 && Math.abs(footInset(2.6) - 2.15) < 1e-9 && footInset(4.75) === 0);
  assert.ok(Math.abs(footInset(0.4) - 2.55) < 1e-9, 'first chamfer is 45 degrees');
  assert.ok(Math.abs(footInset(3.675) - 1.075) < 1e-9, 'second chamfer is 45 degrees');
  assert.ok(Math.abs((FOOTPRINT - 2 * footInset(0)) - 35.6) < 1e-9, 'the bottom of the foot is 35.6 mm square');
});

test('every combination of lip, scoop, magnets and compartments is watertight, and the bin is the stated size', () => {
  for (const lip of [true, false]) for (const scoop of [0, 6]) for (const magnets of [false, true]) for (const compartments of [[1, 1], [2, 2]]) {
    const r = buildBin({ ...base, units: [2, 2], lip, scoop, magnets, compartments });
    r.group.children.forEach(m => assertWatertight(m, assert));
    const b = box(r.group);
    assert.ok(Math.abs(b.max.x - b.min.x - (2 * GRID - 0.5)) < 1e-3 && Math.abs(b.max.y - b.min.y - (2 * GRID - 0.5)) < 1e-3, `${lip} ${scoop} ${magnets}`);
    assert.ok(Math.abs(b.min.z) < 1e-6 && Math.abs(b.max.z - 28) < 1e-3, 'on the bed, 7 mm per height unit, lip included');
  }
});

test('outer size is units x 42 minus 0.5, centred; height is 7 mm a unit', () => {
  for (const [u, v, h] of [[1, 1, 2], [3, 2, 3], [4, 4, 6]]) {
    const r = buildBin({ ...base, units: [u, v], height: h }), b = box(r.group);
    assert.ok(Math.abs(r.info.width - (u * 42 - 0.5)) < 1e-9 && Math.abs(r.info.depth - (v * 42 - 0.5)) < 1e-9 && r.info.height === h * 7);
    assert.ok(Math.abs(b.min.x + b.max.x) < 1e-3 && Math.abs(b.min.y + b.max.y) < 1e-3);
    assert.equal(r.info.feet, u * v);
    assert.equal(r.group.children.filter(m => Math.abs(new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position).max.z - 4.75) < 1e-4).length >= u * v, true);
  }
});

test('feet sit on the 42 mm grid and are 41.5 mm wide at the top, 35.6 at the bottom', () => {
  const r = buildBin({ ...base, units: [3, 2] }), feet = r.group.children.filter(m => { const b = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position); return b.max.z <= 4.75 + 1e-4 && b.min.z < 1e-6; });
  assert.equal(feet.length, 6);
  const centres = feet.map(m => { const b = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position); return [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.x - b.min.x]; });
  for (const [x, y, w] of centres) { assert.ok(Math.abs(w - 41.5) < 1e-3); assert.ok(Math.abs(x / 42 - Math.round(x / 42)) < 1e-6, `x ${x}`); assert.ok(Math.abs(Math.abs(y) - 21) < 1e-3); }
  const bottom = feet[0].geometry.attributes.position; let lo = 1e9, hi = -1e9;
  for (let i = 0; i < bottom.count; i++) if (bottom.getZ(i) < 1e-6) { lo = Math.min(lo, bottom.getX(i)); hi = Math.max(hi, bottom.getX(i)); }
  assert.ok(Math.abs(hi - lo - 35.6) < 1e-3, `${hi - lo}`);
});

test('rings keep the Gridfinity corner radii: 3.75 outside, 1.6 on the straight part of the foot, 0.8 at its bottom', () => {
  for (const [inset, r] of [[0, 3.75], [2.15, 1.6], [2.95, 0.8]]) {
    const ring = ringAt(20.75, 20.75, inset), straight = ring.filter(p => Math.abs(p[1] - (20.75 - inset)) < 1e-9).map(p => p[0]);
    assert.ok(Math.abs(Math.max(...straight) - (20.75 - inset - r)) < 1e-6, `inset ${inset}: top edge ends ${Math.max(...straight)}`);
  }
});

test('the stacking lip fits the foot: its inner face clears a bin sitting in it by 0.25 mm and its underside is a printable 45 degrees', () => {
  for (const wall of [1.2, 1.6, 2]) {
    const prof = lipProfile(wall);
    for (let d = 0; d <= LIP_PENETRATION + 1e-9; d += 0.05) {
      const s = lipInset(d, wall), foot = footInset(LIP_PENETRATION - d);
      assert.ok(foot - s >= 0.25 - 1e-9, `wall ${wall} d ${d.toFixed(2)}: lip ${s.toFixed(3)} foot ${foot.toFixed(3)}`);
    }
    const [d3, s3] = prof[3], [d4, s4] = prof[4];
    assert.ok(Math.abs((d4 - d3) - (s3 - s4)) < 1e-9, 'the underside runs at 45 degrees');
    assert.ok(Math.abs(s4 - wall) < 1e-9, 'and ends on the wall face');
    assert.ok(lipHeight(wall) === d4 && lipHeight(wall) < 6);
  }
});

test('compartments divide the cavity evenly with the divider thickness between them', () => {
  const r = buildBin({ ...base, units: [3, 2], compartments: [3, 2], divider: 1.5 });
  assert.equal(r.info.compartments, 6);
  const [cw, cd] = r.info.compartmentSize;
  assert.ok(Math.abs(3 * cw + 2 * 1.5 - (r.info.width - 2.4)) < 1e-9 && Math.abs(2 * cd + 1.5 - (r.info.depth - 2.4)) < 1e-9);
  assert.ok(vol(r.group) > vol(buildBin({ ...base, units: [3, 2], compartments: [1, 1] }).group), 'dividers add plastic');
});

test('more height, thicker walls and a scoop all add plastic; no lip removes it; magnets remove it', () => {
  const v = o => vol(buildBin({ ...base, ...o }).group);
  assert.ok(v({ height: 6 }) > v({ height: 4 }));
  assert.ok(v({ wall: 1.6 }) > v({ wall: 1.2 }));
  assert.ok(v({ scoop: 8 }) > v({ scoop: 0 }));
  assert.ok(v({ lip: false }) > v({ lip: true }) - 5000 && v({ lip: false, height: 4 }) !== v({ lip: true }));
  const hole = Math.PI * (MAGNET.diameter / 2) ** 2 * MAGNET.depth;
  const removed = v({ magnets: false }) - v({ magnets: true });
  assert.ok(Math.abs(removed - 8 * hole) / (8 * hole) < 0.03, `${removed} vs ${8 * hole}`);
  const grams = buildBin(base).info.grams;
  assert.ok(grams > 10 && grams < 80, `${grams}`);
});

test('the cavity is open on top and its floor is the stated thickness above the foot', () => {
  const r = buildBin({ ...base, floor: 2 });
  assert.ok(Math.abs(r.info.zFloor - 6.75) < 1e-9);
  assert.ok(Math.abs(r.info.cavityDepth - (r.info.zWallTop - 6.75)) < 1e-9 && r.info.cavityDepth > 10);
});

test('bad settings are refused with a message', () => {
  assert.throws(() => buildBin({ ...base, units: [0, 1] }), /1 to 8/);
  assert.throws(() => buildBin({ ...base, units: [9, 1] }), /1 to 8/);
  assert.throws(() => buildBin({ ...base, height: 1 }), /2 to 12/);
  assert.throws(() => buildBin({ ...base, compartments: [0, 1] }), /Compartments/);
  assert.throws(() => buildBin({ ...base, units: [1, 1], compartments: [8, 1] }), /only/);
  assert.throws(() => buildBin({ ...base, wall: 0.4 }), /wall/);
  assert.throws(() => buildBin({ ...base, divider: 0.4 }), /Dividers/);
  assert.throws(() => buildBin({ ...base, floor: 0.2 }), /floor/);
  assert.throws(() => buildBin({ ...base, scoop: 30 }), /scoop/);
  assert.throws(() => buildBin({ ...base, height: 2, floor: 5, lip: true }), /too short/);
  assert.ok(buildBin({ ...base, height: 2, lip: false }).info.height === 14, 'a low bin works without a lip');
  assert.match(buildBin({ ...base, lip: false }).info.warnings.join(' '), /nest|stack/);
  assert.match(buildBin({ ...base, magnets: true }).info.warnings.join(' '), /6\.5 mm/);
});

test('exports an STL, and a large bin stays quick', () => {
  assert.ok(exportSTL(buildBin(base).group).size > 84);
  const t0 = Date.now(), r = buildBin({ ...base, units: [6, 6], height: 6, compartments: [3, 3], magnets: true, scoop: 6 });
  assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0} ms`);
  r.group.children.slice(0, 3).forEach(m => assertWatertight(m, assert));
});
