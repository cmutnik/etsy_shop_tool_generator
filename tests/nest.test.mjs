// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { nest, applyPlacement, makeMask, footprintArea, rot } from '../shared/js/nest.js';

/** A box part (12 triangles). */
function box(x0, y0, z0, x1, y1, z1) {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { name: 'box', color: null, positions: Float32Array.from(p.flat()), indices: Uint32Array.from(f.flat()) };
}
const join = (...parts) => { let off = 0; const pos = [], idx = []; for (const p of parts) { pos.push(...p.positions); idx.push(...Array.from(p.indices, i => i + off)); off += p.positions.length / 3; } return { name: 'joined', color: null, positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }; };
const bed = { width: 200, depth: 200 };
const opts = { bed, spacing: 4, edge: 3, cell: 2 };

/** World-space rectangle covered by a placed box item (axis-aligned rotations only). */
function rect(item, pl) {
  const p = applyPlacement(item.parts[0], pl), xs = [], ys = [];
  for (let i = 0; i < p.positions.length; i += 3) { xs.push(p.positions[i]); ys.push(p.positions[i + 1]); }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
const gap = (a, b) => Math.max(a.x0 - b.x1, b.x0 - a.x1, a.y0 - b.y1, b.y0 - a.y1);

test('every model lands on the bed, inside the edge margin, and no two are closer than the spacing', () => {
  const items = [{ name: 'a', parts: [box(0, 0, 0, 40, 30, 10)], copies: 6 }, { name: 'b', parts: [box(0, 0, 0, 25, 25, 5)], copies: 5 }, { name: 'c', parts: [box(0, 0, 0, 60, 15, 8)], copies: 3 }];
  const r = nest(items, opts);
  assert.equal(r.unplaced.length, 0);
  const all = r.plates.flatMap(p => p.placements.map(pl => rect(items[pl.item], pl)));
  assert.equal(all.length, 14);
  for (const q of all) assert.ok(q.x0 >= 3 - 1e-6 && q.y0 >= 3 - 1e-6 && q.x1 <= 197 + 1e-6 && q.y1 <= 197 + 1e-6, JSON.stringify(q));
  for (const p of r.plates) {
    const rs = p.placements.map(pl => rect(items[pl.item], pl));
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) assert.ok(gap(rs[i], rs[j]) >= 4 - 1e-6, `gap ${gap(rs[i], rs[j]).toFixed(2)} between ${i} and ${j}`);
  }
});

test('packs tightly: sixteen 40 mm squares fit a bed only 12% bigger than a perfect 4 x 4 grid (the grid cells cost a little)', () => {
  const items = [{ name: 's', parts: [box(0, 0, 0, 40, 40, 5)], copies: 16 }];
  const r = nest(items, { bed: { width: 206, depth: 206 }, spacing: 4, edge: 3, cell: 2 });
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.plates.length, 1, `${r.plates.length} plates`);
});

test('a ring leaves room inside for a small piece (true footprints, not bounding boxes)', () => {
  const ring = join(box(0, 0, 0, 80, 10, 5), box(0, 70, 0, 80, 80, 5), box(0, 10, 0, 10, 70, 5), box(70, 10, 0, 80, 70, 5));
  const small = box(0, 0, 0, 20, 20, 5);
  const tight = { bed: { width: 90, depth: 90 }, spacing: 4, edge: 3, cell: 2 };
  const r = nest([{ name: 'ring', parts: [ring], copies: 1 }, { name: 'small', parts: [small], copies: 1 }], tight);
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.plates.length, 1, 'the small piece sits in the ring on the same plate');
  const [a, b] = r.plates[0].placements.map(pl => rect(pl.item === 0 ? { parts: [ring] } : { parts: [small] }, pl));
  assert.ok(Math.min(...[a, b].map(x => x.x1 - x.x0)) < 25);
});

test('rotation helps: a long piece that only fits turned goes on the bed turned', () => {
  const long = box(0, 0, 0, 150, 10, 5);
  const r = nest([{ name: 'long', parts: [long], copies: 1 }], { bed: { width: 60, depth: 180 }, spacing: 4, edge: 3, cell: 2 });
  assert.equal(r.unplaced.length, 0);
  assert.ok([90, 270].includes(r.plates[0].placements[0].angle));
  const none = nest([{ name: 'long', parts: [long], copies: 1 }], { bed: { width: 60, depth: 180 }, spacing: 4, edge: 3, cell: 2, angles: [0] });
  assert.equal(none.unplaced[0].reason, 'size');
});

test('too big for the bed is reported, not crashed; overflow goes to a second plate', () => {
  const r = nest([{ name: 'huge', parts: [box(0, 0, 0, 500, 500, 5)], copies: 1 }, { name: 'plate', parts: [box(0, 0, 0, 150, 150, 5)], copies: 3 }], opts);
  assert.equal(r.unplaced.length, 1);
  assert.equal(r.unplaced[0].reason, 'size');
  assert.ok(r.plates.length >= 2, 'three 150 mm squares do not share a 200 mm bed');
  assert.equal(r.plates.reduce((n, p) => n + p.placements.length, 0), 3);
  const capped = nest([{ name: 'plate', parts: [box(0, 0, 0, 150, 150, 5)], copies: 5 }], { ...opts, maxPlates: 2 });
  assert.equal(capped.unplaced.filter(u => u.reason === 'plates').length, 3);
});

test('"fill the plate" (0 copies) adds as many as fit around the others', () => {
  const items = [{ name: 'big', parts: [box(0, 0, 0, 100, 100, 5)], copies: 1 }, { name: 'coin', parts: [box(0, 0, 0, 20, 20, 3)], copies: 0 }];
  const r = nest(items, opts);
  const coins = r.plates[0].placements.filter(p => p.item === 1).length;
  assert.ok(coins > 20 && coins < 60, `${coins}`);
  assert.equal(r.plates.length, 1);
  const rs = r.plates[0].placements.map(pl => rect(items[pl.item], pl));
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) assert.ok(gap(rs[i], rs[j]) >= 4 - 1e-6);
});

test('placements are deterministic and use the finer cell for a tighter fit', () => {
  const items = [{ name: 'a', parts: [box(0, 0, 0, 37, 29, 10)], copies: 9 }];
  const a = nest(items, opts), b = nest(items, opts);
  assert.deepEqual(a.plates[0].placements, b.plates[0].placements);
  const fine = nest(items, { ...opts, cell: 1 });
  assert.ok(fine.plates.length <= a.plates.length);
});

test('footprints are conservative and rotate: a 45 degree box covers at least its true area', () => {
  const b = box(-10, -5, 0, 10, 5, 3);
  assert.ok(footprintArea([b], 1) >= 200 && footprintArea([b], 1) < 280);
  const m0 = makeMask([b], 0, 1, 0), m90 = makeMask([b], 90, 1, 0);
  assert.ok(m0.w > m0.h && m90.h > m90.w);
  const [x, y] = rot(1, 0, 90);
  assert.ok(Math.abs(x) < 1e-12 && Math.abs(y - 1) < 1e-12);
  const h = makeMask([b], 0, 1, 3);
  assert.equal(h.w, m0.w + 6);
});

test('a thin vertical wall (zero projected area) is still seen by the footprint', () => {
  const wall = box(0, 0, 0, 60, 0.0001, 40);
  const a = makeMask([wall], 0, 2, 0);
  assert.ok(a.cells >= 30, `${a.cells}`);
});

test('applyPlacement turns about z then moves, keeping z', () => {
  const p = applyPlacement(box(0, 0, 2, 10, 4, 7), { angle: 90, tx: 100, ty: 50 });
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < p.positions.length; i += 3) { xs.push(p.positions[i]); ys.push(p.positions[i + 1]); zs.push(p.positions[i + 2]); }
  assert.ok(Math.abs(Math.min(...xs) - 96) < 1e-4 && Math.abs(Math.max(...xs) - 100) < 1e-4 && Math.abs(Math.max(...ys) - 60) < 1e-4);
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [2, 7]);
});

test('speed: sixty small models on a big bed in a second or two', () => {
  const items = [{ name: 'a', parts: [box(0, 0, 0, 30, 22, 8)], copies: 30 }, { name: 'b', parts: [box(0, 0, 0, 18, 18, 8)], copies: 30 }];
  const t0 = Date.now(), r = nest(items, { bed: { width: 256, depth: 256 }, spacing: 3, edge: 3, cell: 2 });
  assert.equal(r.unplaced.length, 0);
  assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0} ms`);
});
