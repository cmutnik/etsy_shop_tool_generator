// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';

const { cutPositions, poleOfInaccessibility, jointDims, hookDims, minSegment } = await import('../tools/flexi-maker/joints.js');
const { makeFlexi } = await import('../tools/flexi-maker/flexi.js');
const { loadManifold, toManifold } = await import('../tools/mesh-modifier/boolean3d.js');
const { partStats } = await import('../tools/mesh-modifier/geometry.js');

function box(x0, y0, z0, x1, y1, z1, color = null, name = 'Box') {
  const positions = Float32Array.from([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
  const indices = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { name, color, positions, indices };
}

test('cutPositions: even segments, or the usable custom positions', () => {
  assert.deepEqual(cutPositions(0, 100, 4), [25, 50, 75]);
  assert.deepEqual(cutPositions(0, 100, 1), []);
  assert.deepEqual(cutPositions(0, 100, 4, [70, 30, 0.5, 120, 30]), [30, 70]);
});

test('poleOfInaccessibility: the middle of a square, and the thick end of an L', () => {
  const sq = poleOfInaccessibility([[[0, 0], [20, 0], [20, 20], [0, 20]]]);
  assert.ok(Math.abs(sq.x - 10) < 0.5 && Math.abs(sq.y - 10) < 0.5 && Math.abs(sq.r - 10) < 0.5, JSON.stringify(sq));
  const L = poleOfInaccessibility([[[0, 0], [40, 0], [40, 6], [10, 6], [10, 30], [0, 30]]]);
  assert.ok(Math.abs(L.r - 5) < 0.6, JSON.stringify(L));
  const ring = poleOfInaccessibility([[[0, 0], [30, 0], [30, 30], [0, 30]], [[8, 8], [22, 8], [22, 22], [8, 22]]]);
  assert.ok(ring.r > 3.9 && (ring.x < 7.5 || ring.x > 22.5 || ring.y < 7.5 || ring.y > 22.5), `a hole must be avoided: ${JSON.stringify(ring)}`);
});

test('jointDims: the socket mouth traps the ball but lets the neck tilt', () => {
  for (const tan of [0, 0.1, 0.2, 0.35]) {
    const d = jointDims(4, 0.4, tan);
    assert.ok(d, `a joint fits at slope ${tan}`);
    assert.ok(d.mouth <= 0.92 * d.R && d.mouth - d.neck >= 0.8, JSON.stringify(d));
  }
  assert.equal(jointDims(4, 3, 0), null, 'a clearance this large cannot hold a ball');
});

test('flexi bar keeps both colours, prints in place and bends without the pieces touching', async () => {
  const bar = [box(-10, -10, 0, 0, 10, 100, '#CC0000', 'Red'), box(0, -10, 0, 10, 10, 100, '#0000CC', 'Blue')];
  const r = await makeFlexi(bar, { joint: 'ball', axis: 'z', count: 3, bend: 30 });
  assert.equal(r.cuts.length, 2);
  assert.equal(r.joints.length, 2);
  assert.equal(r.parts.length, 6, 'two colours in each of three segments');
  assert.deepEqual([...new Set(r.parts.map(p => p.color))].sort(), ['#0000CC', '#CC0000']);
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
  assert.ok(r.bend > 15, `reports ${r.bend} degrees`);

  const w = await loadManifold();
  const solids = r.parts.map(p => ({ p, m: toManifold(w, p) }));
  const seg = p => +p.name.match(/Segment (\d)/)[1];
  const overlap = (as, bs) => Math.max(0, ...as.flatMap(a => bs.map(b => a.m.intersect(b.m).volume())));
  const of = n => solids.filter(s => seg(s.p) === n);
  assert.ok(overlap(of(1), of(2)) < 1e-6 && overlap(of(2), of(3)) < 1e-6, 'neighbouring segments do not touch at rest');

  // tilt the upper segments about the first joint by 80 % of the bend the tool reports: still no contact
  const j = r.joints[0], tilt = (list, deg) => list.map(s => ({ m: s.m.translate([-j.x, -j.y, -j.pivot]).rotate([deg, 0, 0]).translate([j.x, j.y, j.pivot]) }));
  const lower = of(1), upper = [...of(2), ...of(3)];
  for (const sign of [1, -1]) {
    const moved = tilt(upper, sign * 0.8 * r.bend);
    assert.ok(overlap(lower, moved) < 1e-6, `segments clear each other tilted ${sign * 0.8 * r.bend} degrees`);
  }
  // pulling the upper segment straight up must not free it (the ball is trapped in the socket)
  const pulled = of(2).map(s => ({ m: s.m.translate([0, 0, 3]) }));
  assert.ok(overlap(lower, pulled) > 0.1, 'the ball is held by the socket');
  solids.forEach(s => s.m.delete());
});

test('thin pieces are reported, and the model still comes out in one orientation', async () => {
  const slab = [box(-30, -30, 0, 30, 30, 6, '#00AA00', 'Plate')];
  await assert.rejects(() => makeFlexi(slab, { joint: 'ball', axis: 'z', count: 2 }), /No joint fits/);
  const r = await makeFlexi([box(0, 0, 0, 100, 16, 16, '#AA00AA', 'Long')], { joint: 'ball', axis: 'x', count: 3, bend: 20 });
  assert.equal(r.parts.length, 3);
  const xs = r.parts.flatMap(p => [...p.positions].filter((_, i) => i % 3 === 0));
  assert.ok(Math.min(...xs) >= -0.001 && Math.max(...xs) <= 100.001, 'joints stay inside the original length');
  assert.ok(minSegment(3, 0.4) > 8);
});

test('nothing is left standing inside the notch, even material wider than the cut section', async () => {
  // a wide flange just below a narrow stem: the cut crosses the stem, but the notch cone dips into the flange
  const model = [box(-20, -20, 0, 20, 20, 10, '#AA5500', 'Flange'), box(-5, -5, 10, 5, 5, 60, '#0055AA', 'Stem')];
  const r = await makeFlexi(model, { joint: 'ball', axis: 'z', positions: [12], bend: 20 });
  const j = r.joints[0], t = Math.tan((r.bend * Math.PI) / 360), h = 0.3;
  for (const p of r.parts) {
    const seg = +p.name.match(/Segment (\d)/)[1];
    for (let i = 0; i < p.positions.length; i += 3) {
      const rho = Math.hypot(p.positions[i] - j.x, p.positions[i + 1] - j.y), z = p.positions[i + 2], edge = (h + rho * t) * 0.98;
      if (rho < j.radius * 1.6) continue;                                                      // the ball, neck and socket live here
      if (seg === 1) assert.ok(z <= j.at - edge, `${p.name}: vertex at radius ${rho.toFixed(1)}, z ${z.toFixed(2)} stands in the notch`);
      else assert.ok(z >= j.at + edge, `${p.name}: vertex at radius ${rho.toFixed(1)}, z ${z.toFixed(2)} stands in the notch`);
    }
  }
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
  assert.equal(r.parts.length, 3, 'flange, lower stem, upper stem: no stray fragments');
  const w = await loadManifold(), solids = r.parts.map(p => toManifold(w, p));
  for (let a = 0; a < solids.length; a++) for (let b = a + 1; b < solids.length; b++) assert.ok(solids[a].intersect(solids[b]).volume() < 1e-6, `${r.parts[a].name} and ${r.parts[b].name} overlap`);
});

test('every cut separates the segments, however many there are', async () => {
  for (const [len, count] of [[100, 4], [120, 6], [90, 3]]) {
    const r = await makeFlexi([box(-12, -12, 0, 12, 12, len, '#AA5500', 'Bar')], { joint: 'ball', axis: 'z', count, bend: 20 });
    assert.equal(r.parts.length, count, `${count} segments make ${count} pieces (got ${r.parts.length})`);
    assert.deepEqual(r.parts.map(p => p.seg), [...Array(count).keys()]);
  }
});

test('hookDims: the links interlock with clearance and need real room', () => {
  const d = hookDims(15, 30, 0.4);
  assert.ok(d && d.d >= 2 && d.W / 2 + 0.5 <= 15 + 1e-9, JSON.stringify(d));
  assert.ok(d.G >= 3 * 0.4 + 2 * d.d + 2 * d.slack - 1e-9, 'the faces are far enough apart for both loops');
  assert.equal(hookDims(3, 30, 0.4), null, 'too thin for a link');
  assert.equal(hookDims(15, 12, 0.4), null, 'segments too short for a link');
  assert.ok(hookDims(15, 30, 0.4, 2.5).d <= 2.5, 'a chosen bar thickness is respected');
});

test('hook and loop: two colours kept, closed pieces, linked like a chain, and they move', async () => {
  const bar = [box(-15, -15, 0, 0, 15, 120, '#CC0000', 'Red'), box(0, -15, 0, 15, 15, 120, '#0000CC', 'Blue')];
  const r = await makeFlexi(bar, { axis: 'z', count: 3, bend: 20 });
  assert.equal(r.joints.length, 2);
  assert.equal(r.parts.length, 6, 'two colours in each of three segments');
  assert.deepEqual([...new Set(r.parts.map(p => p.color))].sort(), ['#0000CC', '#CC0000']);
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
  assert.ok(r.bend > 5, `reports ${r.bend} degrees`);

  const w = await loadManifold();
  const solids = r.parts.map(p => ({ p, m: toManifold(w, p) }));
  const of = n => solids.filter(s => s.p.seg === n);
  const overlap = (as, bs) => Math.max(0, ...as.flatMap(a => bs.map(b => a.m.intersect(b.m).volume())));
  assert.ok(overlap(of(0), of(1)) < 1e-6 && overlap(of(1), of(2)) < 1e-6, 'nothing touches at rest');

  const j = r.joints[0], lower = of(0), upper = [...of(1), ...of(2)];
  const moved = (deg, axis, up = 0) => upper.map(s => ({ m: s.m.translate([-j.x, -j.y, -j.pivot]).rotate(axis === 'x' ? [deg, 0, 0] : [0, deg, 0]).translate([j.x, j.y, j.pivot + up]) }));
  for (const axis of ['x', 'y']) for (const sign of [1, -1]) assert.ok(overlap(lower, moved(sign * 0.8 * r.bend, axis)) < 1e-6, `clear when tilted ${sign * 0.8 * r.bend} degrees about ${axis}`);
  assert.ok(overlap(lower, moved(0, 'x', 3)) > 0.1, 'the links hold: the upper segment cannot be lifted away');
  solids.forEach(s => s.m.delete());
});

test('hook and loop: every cut separates, and the wide part under a narrow cut is cleared', async () => {
  for (const [len, count] of [[100, 3], [150, 5]]) {
    const r = await makeFlexi([box(-15, -15, 0, 15, 15, len, '#AA5500', 'Bar')], { axis: 'z', count });
    assert.equal(r.parts.length, count);
    assert.deepEqual(r.parts.map(p => p.seg), [...Array(count).keys()]);
  }
  const model = [box(-30, -30, 0, 30, 30, 10, '#AA5500', 'Flange'), box(-12, -12, 10, 12, 12, 90, '#0055AA', 'Stem')];
  const r = await makeFlexi(model, { axis: 'z', positions: [40] });
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
});
