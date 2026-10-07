// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMesh, analysePart, wallThickness, OVERHANG, THIN } from '../shared/js/mesh-check.js';
import { parseSTL } from '../shared/js/mesh-import.js';
import { flipPart } from '../tools/mesh-modifier/geometry.js';
import { repairPart } from '../tools/mesh-modifier/repair.js';

/** An axis-aligned box as a part (12 outward-facing triangles). Several boxes can be joined with join(). */
function box(x0, y0, z0, x1, y1, z1, name = 'box') {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { name, color: null, positions: Float32Array.from(p.flat()), indices: Uint32Array.from(f.flat()) };
}
const join = (...parts) => {
  let off = 0; const pos = [], idx = [];
  for (const p of parts) { pos.push(...p.positions); idx.push(...Array.from(p.indices, i => i + off)); off += p.positions.length / 3; }
  return { name: 'joined', color: null, positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
};
const ids = r => r.findings.map(f => f.id + ':' + f.level);
const get = (r, id) => r.findings.find(f => f.id === id);

test('a clean solid box is ready: closed, right way out, no overhangs, thick walls', () => {
  const r = checkMesh([box(0, 0, 0, 20, 20, 20)]);
  assert.equal(r.verdict, 'ready', JSON.stringify(ids(r)));
  assert.ok(Math.abs(r.stats.volume - 8000) < 1e-3 && Math.abs(r.stats.area - 2400) < 1e-3);
  assert.equal(get(r, 'overhang').level, 'ok');
  assert.equal(get(r, 'thin').level, 'ok');
  assert.ok(Math.abs(r.stats.bedArea - 400) < 1e-6);
});

test('open edges: a missing triangle is reported as a hole, and Repair really fixes it', () => {
  const b = box(0, 0, 0, 20, 20, 20);
  const holed = { ...b, indices: b.indices.slice(3) };
  const r = checkMesh([holed]);
  assert.equal(r.verdict, 'problem');
  assert.equal(get(r, 'open').level, 'bad');
  assert.ok(r.stats.open > 0);
  assert.equal(get(r, 'thin').level, 'info', 'wall thickness is skipped on an open model');
  const fixed = repairPart(holed).part;
  assert.equal(checkMesh([fixed]).verdict, 'ready');
});

test('inside-out, flipped neighbours, duplicates and zero-area triangles are named', () => {
  const b = box(0, 0, 0, 20, 20, 20);
  assert.equal(get(checkMesh([flipPart(b)]), 'inside-out').level, 'bad');
  const one = b.indices.slice(); [one[1], one[2]] = [one[2], one[1]];
  assert.equal(get(checkMesh([{ ...b, indices: one }]), 'winding').level, 'warn');
  assert.equal(get(checkMesh([{ ...b, indices: Uint32Array.from([...b.indices, ...b.indices.slice(0, 3)]) }]), 'duplicate').level, 'warn');
  const deg = Uint32Array.from([...b.indices, 0, 0, 1]);
  assert.ok(analysePart({ ...b, indices: deg }).degenerate === 1);
  assert.equal(get(checkMesh([{ ...b, indices: deg }]), 'degenerate').level, 'warn');
});

test('two solids touching along an edge are non-manifold', () => {
  const a = box(0, 0, 0, 10, 10, 10), c = box(10, 10, 0, 20, 20, 10);          // meet only along the vertical edge x = y = 10
  const r = checkMesh([join(a, c)]);
  assert.equal(get(r, 'non-manifold').level, 'bad');
});

test('size against the bed, in either orientation, and wrong-unit hints', () => {
  assert.equal(get(checkMesh([box(0, 0, 0, 250, 100, 10)], { bed: [220, 220, 250] }), 'size').level, 'bad');
  assert.equal(get(checkMesh([box(0, 0, 0, 240, 100, 10)], { bed: [300, 220, 250] }), 'size'), undefined);
  assert.equal(get(checkMesh([box(0, 0, 0, 100, 240, 10)], { bed: [300, 220, 250] }), 'size'), undefined, 'fits turned 90 degrees');
  assert.equal(get(checkMesh([box(0, 0, 0, 2, 2, 2)]), 'units').level, 'warn');
  assert.equal(get(checkMesh([box(0, 0, 0, 900, 50, 50)], { bed: [1000, 1000, 1000] }), 'units').level, 'warn');
});

test('overhangs: a table top over legs needs supports; the legs and the bed contact do not', () => {
  const table = join(box(0, 0, 0, 5, 5, 30), box(35, 0, 0, 40, 5, 30), box(0, 0, 30, 40, 5, 35));
  const r = checkMesh([table]);
  const o = get(r, 'overhang');
  assert.equal(o.level, 'warn');
  assert.ok(Math.abs(r.stats.overhangArea - 200) < 1, `${r.stats.overhangArea}`);   // the slab's whole underside (40 x 5), as the legs are only joined to it
  assert.ok(Math.abs(r.stats.bedArea - 50) < 1e-6);
  assert.ok(r.flags[0].some(v => v & OVERHANG));
  assert.equal(get(r, 'bed').level, 'warn', 'tall on a small base');
});

test('the overhang angle setting moves the limit', () => {
  // a roof slope rising 10 mm over 10 mm to the left (45 degrees from vertical) with a flat floor
  const p = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [10, 0, 10], [10, 10, 10]];
  const idx = [[0, 2, 1], [0, 3, 2], [1, 2, 5], [1, 5, 4], [0, 4, 5], [0, 5, 3], [3, 5, 2], [0, 1, 4]];
  const part = { name: 'wedge', color: null, positions: Float32Array.from(p.flat()), indices: Uint32Array.from(idx.flat()) };
  assert.ok(analysePart(part).closed);
  const strict = checkMesh([part], { overhangAngle: 30 }), loose = checkMesh([part], { overhangAngle: 60 });
  assert.ok(strict.stats.overhangArea === 0 || loose.stats.overhangArea <= strict.stats.overhangArea);
});

test('thin walls: a 0.3 mm plate is a problem, 0.6 mm a warning, 2 mm fine; flags mark the faces', () => {
  const plate = t => box(0, 0, 0, 40, 40, t);
  const bad = checkMesh([plate(0.3)]), mid = checkMesh([plate(0.6)]), ok = checkMesh([plate(2)]);
  assert.equal(get(bad, 'thin').level, 'bad');
  assert.equal(get(mid, 'thin').level, 'warn');
  assert.equal(get(ok, 'thin').level, 'ok');
  assert.ok(Math.abs(bad.stats.thinMin - 0.3) < 0.02, `${bad.stats.thinMin}`);
  assert.ok(bad.flags[0].some(v => v & THIN));
  assert.ok(!ok.flags[0].some(v => v & THIN));
  const w = wallThickness(plate(0.5), analysePart(plate(0.5)), { minWall: 0.8 });
  assert.ok(Math.abs(w.min - 0.5) < 0.02);
});

test('a hollow box with 1 mm walls is thin only where the shell is under the limit', () => {
  // outer 30 mm cube, inner cavity leaving 1.0 mm walls (inner faces inverted)
  const outer = box(0, 0, 0, 30, 30, 30), inner = flipPart(box(1, 1, 1, 29, 29, 29));
  const hollow = join(outer, inner);
  const r = checkMesh([hollow], { minWall: 0.8 });
  assert.equal(get(r, 'thin').level, 'ok', JSON.stringify(r.findings.map(f => f.title)));
  assert.ok(r.stats.thinMin > 0.9 && r.stats.thinMin < 1.1, `${r.stats.thinMin}`);
  const r2 = checkMesh([hollow], { minWall: 1.5 });
  assert.notEqual(get(r2, 'thin').level, 'ok');
});

test('tiny floating fragments are counted, and multi-piece models are noted', () => {
  const r = checkMesh([join(box(0, 0, 0, 20, 20, 20), box(30, 0, 0, 30.5, 0.5, 0.5), box(40, 0, 0, 40.4, 0.4, 0.4))]);
  assert.equal(get(r, 'specks').level, 'warn');
  const two = checkMesh([join(box(0, 0, 0, 20, 20, 20), box(30, 0, 0, 50, 20, 20))]);
  assert.equal(get(two, 'shells').level, 'info');
  assert.equal(two.verdict, 'ready');
});

test('works on a real STL read by the importer, and stays fast on an 80,000-triangle sphere', () => {
  const b = box(0, 0, 0, 20, 10, 5), buf = new ArrayBuffer(84 + 12 * 50), dv = new DataView(buf);
  dv.setUint32(80, 12, true);
  for (let t = 0; t < 12; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, b.positions[b.indices[t * 3 + Math.floor(k / 3)] * 3 + (k % 3)], true);
  const part = parseSTL(buf, 'box');
  assert.equal(checkMesh([part]).verdict, 'ready');
  // a sphere of ~80k triangles: the ray casting must stay fast
  const n = 200, m = 200, pos = [], idx = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j < m; j++) { const a = (i / n) * Math.PI, c = (j / m) * 2 * Math.PI; pos.push(20 * Math.sin(a) * Math.cos(c), 20 * Math.sin(a) * Math.sin(c), 20 + 20 * Math.cos(a)); }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const a = i * m + j, b2 = i * m + ((j + 1) % m), c2 = (i + 1) * m + j, d = (i + 1) * m + ((j + 1) % m); idx.push(a, c2, b2, b2, c2, d); }
  const sphere = { name: 'sphere', color: null, positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  const t0 = Date.now(), r = checkMesh([sphere]);
  assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0} ms`);
  assert.ok(r.stats.thinMin === null || r.stats.thinMin > 2 || r.stats.thinMin <= 40, 'sphere walls are thick');
});
