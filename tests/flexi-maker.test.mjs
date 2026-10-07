// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';

const { cutPositions, poleOfInaccessibility, ballDims, hookDims } = await import('../tools/flexi-maker/joints.js');
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

test('ballDims: the cup mouth traps the ball but lets the neck tilt, and the faces leave room for both', () => {
  for (const R of [3, 4, 6, 9]) {
    const d = ballDims(R, 0.4);
    assert.ok(d, `a joint fits at R = ${R}`);
    assert.ok(d.mouth <= 0.92 * R + 1e-9 && d.mouth - d.neck >= 0.8 - 1e-9, JSON.stringify(d));
    assert.ok(d.a > R + 0.2, 'the ball clears the lower face on its neck');
    assert.ok(d.b < d.Rc, 'the cavity bites into the upper segment so the cup is attached');
    assert.ok(d.tilt > 15, `it can bend about ${d.tilt.toFixed(0)} degrees`);
  }
  assert.equal(ballDims(1.5, 0.4), null, 'too small a ball cannot hold a mouth narrower than itself and wider than its neck');
});

test('flexi bar keeps both colours, prints in place and bends without the pieces touching', async () => {
  const bar = [box(-10, -10, 0, 0, 10, 100, '#CC0000', 'Red'), box(0, -10, 0, 10, 10, 100, '#0000CC', 'Blue')];
  const r = await makeFlexi(bar, { joint: 'ball', axis: 'z', count: 3, bend: 30 });
  assert.equal(r.cuts.length, 2);
  assert.equal(r.joints.length, 2);
  assert.equal(r.parts.length, 6, 'two colours in each of three segments');
  assert.deepEqual([...new Set(r.parts.map(p => p.color))].sort(), ['#0000CC', '#CC0000']);
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
  assert.ok(r.bend > 12, `reports ${r.bend} degrees`);

  const w = await loadManifold();
  const solids = r.parts.map(p => ({ p, m: toManifold(w, p) }));
  const seg = p => +p.name.match(/Segment (\d)/)[1];
  const overlap = (as, bs) => Math.max(0, ...as.flatMap(a => bs.map(b => a.m.intersect(b.m).volume())));
  const of = n => solids.filter(s => seg(s.p) === n);
  assert.ok(overlap(of(1), of(2)) < 1e-6 && overlap(of(2), of(3)) < 1e-6, 'neighbouring segments do not touch at rest');

  // tilt the upper segments about the first joint by 80 % of the bend the tool reports: still no contact
  const j = r.joints[0], tilt = (list, deg) => list.map(s => ({ m: s.m.translate([-j.x, -j.y, -j.pivot]).rotate([deg, 0, 0]).translate([j.x, j.y, j.pivot]) }));
  assert.ok(r.joints.every(q => q.pivot > q.at - 6 && q.pivot < q.at + 6), 'the ball sits in the gap between the segments');
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
});

test('nothing is left standing inside the notch, even material wider than the cut section', async () => {
  // a wide flange just below a narrow stem: the cut crosses the stem, but the notch cone dips into the flange
  const model = [box(-40, -40, 0, 40, 40, 10, '#AA5500', 'Flange'), box(-8, -8, 10, 8, 8, 80, '#0055AA', 'Stem')];
  const r = await makeFlexi(model, { joint: 'ball', axis: 'z', positions: [20], bend: 20 });
  const j = r.joints[0], t = Math.tan((r.bend * Math.PI) / 360), h = j.half;
  for (const p of r.parts) {
    const seg = +p.name.match(/Segment (\d)/)[1];
    for (let i = 0; i < p.positions.length; i += 3) {
      const rho = Math.hypot(p.positions[i] - j.x, p.positions[i + 1] - j.y), z = p.positions[i + 2], edge = (h + rho * t) * 0.98;
      if (rho < j.radius * 2.2) continue;                                                      // the ball, neck and socket live here
      if (seg === 1) assert.ok(z <= j.at - edge, `${p.name}: vertex at radius ${rho.toFixed(1)}, z ${z.toFixed(2)} stands in the notch`);
      else assert.ok(z >= j.at + edge, `${p.name}: vertex at radius ${rho.toFixed(1)}, z ${z.toFixed(2)} stands in the notch`);
    }
  }
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
  assert.equal(r.parts.length, 3, 'flange, lower stem, upper stem: no stray fragments');
  assert.ok(Math.min(...r.parts.find(p => p.name.includes('Flange')).positions.filter((_, i) => i % 3 === 2)) >= 0 - 1e-6);
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

test('simplifyParts: a heavy closed model comes down, stays closed, keeps its colour, and open parts are left alone', async () => {
  const { simplifyParts } = await import('../tools/flexi-maker/prepare.js');
  const { fromManifold } = await import('../tools/mesh-modifier/boolean3d.js');
  const w = await loadManifold();
  const sphere = w.Manifold.sphere(20, 500);                                    // 125,000 triangles
  const dense = { ...fromManifold(sphere, { name: 'Ball' }), name: 'Ball', color: '#CC0000' };
  sphere.delete();
  const open = box(0, 0, 0, 10, 10, 10, '#00AA00', 'Open');
  open.indices = open.indices.slice(0, open.indices.length - 3);                // drop a triangle: not closed any more
  const r = await simplifyParts([dense, open], { target: 20000, maxDeviation: 0.3 });
  assert.ok(r.before > 120000);
  assert.ok(r.after <= 20000 && r.reached, `reduced to ${r.after}`);
  assert.ok(r.deviation <= 0.3 + 1e-9);
  const [ball, kept] = r.list;
  assert.equal(ball.part.color, '#CC0000');
  assert.equal(partStats(ball.part).openEdges, 0, 'still a closed solid');
  assert.equal(kept.part, open, 'the open part is untouched');
  assert.deepEqual(r.open, ['Open']);
  const v0 = partStats(dense).volume, v1 = partStats(ball.part).volume;
  assert.ok(Math.abs(v1 - v0) / v0 < 0.01, `volume changed ${(100 * Math.abs(v1 - v0) / v0).toFixed(2)} %`);
  const small = await simplifyParts([open], { target: 100 });
  assert.equal(small.reached, true, 'already small enough: returned as is');
});

test('simplifyParts and repairParts keep the colours of a painted model (patches of one closed surface)', async () => {
  const { simplifyParts } = await import('../tools/flexi-maker/prepare.js');
  const { repairParts } = await import('../tools/mesh-modifier/repair-groups.js');
  const { partsStats, analyseParts } = await import('../tools/mesh-modifier/geometry.js');
  const { fromManifold } = await import('../tools/mesh-modifier/boolean3d.js');
  const w = await loadManifold();
  const sphere = w.Manifold.sphere(20, 300), whole = fromManifold(sphere, { name: 'S' });
  sphere.delete();
  const patch = red => {
    const idx = [];
    for (let t = 0; t < whole.indices.length; t += 3) {
      const cx = [0, 1, 2].reduce((n, k) => n + whole.positions[whole.indices[t + k] * 3], 0) / 3;
      if ((cx > 0) === red) idx.push(whole.indices[t], whole.indices[t + 1], whole.indices[t + 2]);
    }
    return { name: red ? 'Red' : 'Blue', color: red ? '#CC0000' : '#0000CC', positions: whole.positions, indices: Uint32Array.from(idx), group: 'g' };
  };
  const patches = [patch(true), patch(false)];
  const stats = partsStats(patches);
  assert.equal(stats[0].openEdges, 0, 'together the patches are closed, and that is reported once, on the first');
  assert.equal(stats[1].openEdges, 0);
  assert.ok(stats[0].volume > 30000 && stats[1].volume === 0, 'the whole sphere\'s volume, on the first patch');
  assert.equal(analyseParts(patches).flipped, 0);

  const r = await simplifyParts(patches, { target: 8000, maxDeviation: 0.3 });
  assert.ok(r.reached && r.after <= 8000, `reduced to ${r.after}`);
  assert.deepEqual(r.list.map(x => x.part.color).sort(), ['#0000CC', '#CC0000']);
  const mean = c => { const p = r.list.find(x => x.part.color === c).part; const xs = [...p.positions].filter((_, i) => i % 3 === 0); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  assert.ok(mean('#CC0000') > 5 && mean('#0000CC') < -5, 'each colour stays on its own side');
  assert.equal(partsStats(r.list.map(x => x.part))[0].openEdges, 0, 'still one closed surface');

  // a hole punched in the surface: repairing the group fills it and keeps the colours
  const holed = patches.map(p => ({ ...p }));
  holed[0].indices = holed[0].indices.slice(3);
  assert.ok(partsStats(holed)[0].openEdges > 0);
  const fixed = repairParts(holed);
  assert.ok(fixed.changed, fixed.log.join(' | '));
  assert.deepEqual(fixed.list.map(x => x.part.color).sort(), ['#0000CC', '#CC0000']);
  assert.equal(partsStats(fixed.list.map(x => x.part))[0].openEdges, 0, 'closed again');
});

test('a cut that falls between two separate parts says so instead of calling it a sliver', async () => {
  const two = [box(0, -15, -15, 40, 15, 15, '#AA0000', 'Left'), box(100, -15, -15, 140, 15, 15, '#0000AA', 'Right')];
  const r = await makeFlexi(two, { joint: 'ball', axis: 'x', positions: [20, 70] });
  assert.equal(r.joints.length, 1, 'only the cut through a part gets a joint');
  assert.ok(r.warnings.some(w => /space between separate parts/.test(w)), r.warnings.join(' | '));
  assert.ok(!r.warnings.some(w => /sliver/.test(w)));
});

test('a painted model (colour patches of one closed surface) is cut whole and comes out coloured again', async () => {
  const w = await loadManifold();
  const { fromManifold } = await import('../tools/mesh-modifier/boolean3d.js');
  const cyl = w.Manifold.cylinder(100, 12, 12, 48, false);                    // closed, ~200 triangles
  const whole = fromManifold(cyl, { name: 'Tube' });
  cyl.delete();
  // two patches: the triangles on the +x side red, the rest blue: neither is closed on its own
  const side = (red) => {
    const idx = [];
    for (let t = 0; t < whole.indices.length; t += 3) {
      const cx = [0, 1, 2].reduce((s, k) => s + whole.positions[whole.indices[t + k] * 3], 0) / 3;
      if ((cx > 0) === red) idx.push(whole.indices[t], whole.indices[t + 1], whole.indices[t + 2]);
    }
    return { name: red ? 'Red' : 'Blue', color: red ? '#CC0000' : '#0000CC', positions: whole.positions, indices: Uint32Array.from(idx), group: 'g1' };
  };
  const patches = [side(true), side(false)];
  assert.ok(patches.every(p => partStats(p).openEdges > 0), 'the patches are open on their own');
  for (const joint of ['hook', 'ball']) {
    const r = await makeFlexi(patches, { axis: 'z', count: 3, joint });
    assert.deepEqual([...new Set(r.parts.map(p => p.color))].sort(), ['#0000CC', '#CC0000'], `${joint}: both colours survive`);
    for (const seg of [0, 1, 2]) {
      const mean = c => { const ps = r.parts.filter(p => p.seg === seg && p.color === c), xs = ps.flatMap(p => [...p.positions].filter((_, i) => i % 3 === 0)); return xs.reduce((a, b) => a + b, 0) / xs.length; };
      assert.ok(mean('#CC0000') > 1, `${joint} segment ${seg}: the red patch stays on the +x side (${mean('#CC0000').toFixed(1)})`);
      assert.ok(mean('#0000CC') < -1, `${joint} segment ${seg}: the blue patch stays on the -x side (${mean('#0000CC').toFixed(1)})`);
    }
    assert.equal(new Set(r.parts.map(p => p.seg)).size, 3);
  }
});

test('repairParts: a few pinched, non-manifold spots are cut out and filled when the normal repair cannot', async () => {
  const { repairParts, stripBadEdges } = await import('../tools/mesh-modifier/repair-groups.js');
  const { partsStats } = await import('../tools/mesh-modifier/geometry.js');
  const { fromManifold } = await import('../tools/mesh-modifier/boolean3d.js');
  const w = await loadManifold();
  const sphere = w.Manifold.sphere(20, 64), base = fromManifold(sphere, { name: 'S', color: '#AA0000' });
  sphere.delete();
  // a fin: one extra triangle stuck on an existing edge, so that edge is shared by three triangles (non-manifold)
  const a = base.indices[0], b = base.indices[1], extra = base.positions.length / 3;
  const positions = new Float32Array(base.positions.length + 3);
  positions.set(base.positions);
  positions.set([base.positions[a * 3] + 50, base.positions[a * 3 + 1] + 50, base.positions[a * 3 + 2] + 50], base.positions.length);
  const pinched = { ...base, positions, indices: Uint32Array.from([...base.indices, a, b, extra]) };
  assert.ok(partsStats([pinched])[0].openEdges > 0, 'the fin makes it not closed');
  const stripped = stripBadEdges(pinched);
  assert.ok(stripped.dropped >= 3 && stripped.dropped < 20, `dropped ${stripped.dropped}`);
  const r = repairParts([pinched]);
  assert.ok(r.changed, r.log.join(' | '));
  assert.equal(partsStats(r.list.map(x => x.part))[0].openEdges, 0, r.log.join(' | '));
  assert.equal(r.list[0].part.color, '#AA0000');
});

// ---------------- joint test strip ----------------
const { makeTestStrip, stripClearances, boxPart } = await import('../tools/flexi-maker/test-strip.js');
const { boundsOfParts } = await import('../tools/mesh-modifier/geometry.js');

test('stripClearances: three distinct values around the chosen one, never under 0.1 mm', () => {
  assert.deepEqual(stripClearances(0.4), [0.3, 0.4, 0.5]);
  assert.deepEqual(stripClearances(0.25, 0.05), [0.2, 0.25, 0.3]);
  assert.deepEqual(stripClearances(0.15), [0.15, 0.25, 0.35]);
  assert.deepEqual(stripClearances(0.1), [0.1, 0.2, 0.3]);
  for (const c of [0.1, 0.12, 0.3, 0.9]) assert.equal(new Set(stripClearances(c)).size, 3);
});

for (const joint of ['hook', 'ball']) {
  test(`${joint} test strip: three closed, separate bars at three clearances, laid out in a row without touching`, async () => {
    const r = await makeTestStrip({ joint, clearance: 0.4, bend: 20 });
    assert.deepEqual(r.clearances, [0.3, 0.4, 0.5]);
    assert.equal(r.strips.length, 3);
    for (const [i, s] of r.strips.entries()) {
      const mine = s.parts.filter(p => !p.marker), marks = s.parts.filter(p => p.marker);
      assert.equal(mine.length, 2, 'two segments per bar');
      assert.equal(marks.length, i + 1, `${i + 1} bump marker${i ? 's' : ''} so the bars can be told apart`);
      assert.ok(mine.every(p => p.name.startsWith(`${s.clearance.toFixed(2)} mm - Segment`)));
      for (const p of s.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
    }
    // bars are side by side with a gap, all lying on the bed
    const boxes = r.strips.map(s => boundsOfParts(s.parts));
    for (let i = 0; i < 2; i++) assert.ok(boxes[i + 1].min[1] - boxes[i].max[1] >= 5.5, `gap ${boxes[i + 1].min[1] - boxes[i].max[1]}`);
    for (const b of boxes) assert.ok(Math.abs(b.min[2]) < 1e-4);
    assert.ok(Math.abs(boundsOfParts(r.parts).min[1] + boundsOfParts(r.parts).max[1]) < 1e-3, 'centred on the bed');
    // lying on its side: the bar's 64 mm now runs along x
    assert.ok(boxes[0].size[0] > 60 && boxes[0].size[1] < 30);
  }, { timeout: 120000 });
}

test('a larger clearance leaves a wider gap: the joint pieces of the loosest bar are further apart than the tightest', async () => {
  const w = await loadManifold();
  const r = await makeTestStrip({ joint: 'ball', clearance: 0.4, step: 0.2 });
  // volume of material falls as the clearance grows (the socket is cut bigger around the same ball)
  const volume = s => s.parts.filter(p => !p.marker).reduce((v, p) => { const m = toManifold(w, p); const x = m.volume(); m.delete(); return v + x; }, 0);
  const [a, b, c] = r.strips.map(volume);
  assert.ok(a > b && b > c, `volumes ${a.toFixed(0)} > ${b.toFixed(0)} > ${c.toFixed(0)}`);
}, { timeout: 120000 });

test('test strip can be stood upright, and a bar too small for the joint says so', async () => {
  const up = await makeTestStrip({ joint: 'hook', onSide: false });
  const b = boundsOfParts(up.strips[0].parts);
  assert.ok(b.size[2] > 60 && Math.abs(b.min[2]) < 1e-4);
  await assert.rejects(() => makeTestStrip({ joint: 'ball', section: 5 }), /No joint fits/);
}, { timeout: 120000 });

// ---------------- editing cuts by hand ----------------
const ce = await import('../tools/flexi-maker/cut-edit.js');

test('cut-edit: addCut snaps, keeps the list sorted and refuses spots without room', () => {
  const a = ce.addCut([], 30.2, 100);
  assert.deepEqual(a, { list: [30], added: true, reason: '' });
  assert.deepEqual(ce.addCut([30], 70.3, 100).list, [30, 70.5]);
  assert.deepEqual(ce.addCut([30, 70], 10, 100).list, [10, 30, 70], 'kept sorted');
  const near = ce.addCut([30], 33, 100);
  assert.equal(near.added, false); assert.deepEqual(near.list, [30]); assert.match(near.reason, /another cut/);
  assert.match(ce.addCut([], 2, 100).reason, /each side/);
  assert.match(ce.addCut([], 99, 100).reason, /each side/);
  assert.equal(ce.addCut([], 50, 100).added, true);
});

test('cut-edit: moveCut is held between its neighbours and the ends by the minimum segment length', () => {
  const l = [20, 50, 80];
  assert.deepEqual(ce.moveCut(l, 1, 60, 100), [20, 60, 80]);
  assert.deepEqual(ce.moveCut(l, 1, 200, 100), [20, 74, 80], 'cannot pass the next cut');
  assert.deepEqual(ce.moveCut(l, 1, -50, 100), [20, 26, 80], 'cannot pass the previous cut');
  assert.deepEqual(ce.moveCut(l, 0, -10, 100), [6, 50, 80], 'cannot reach the end');
  assert.deepEqual(ce.moveCut(l, 2, 500, 100), [20, 50, 94]);
  assert.deepEqual(l, [20, 50, 80], 'the input is never changed');
  assert.deepEqual(ce.moveCut([10, 14], 0, 12, 24), [8, 14], 'held 6 mm short of the next cut');
});

test('cut-edit: removeCut, evenCuts, segmentLengths and normalise', () => {
  assert.deepEqual(ce.removeCut([10, 20, 30], 1), [10, 30]);
  assert.deepEqual(ce.evenCuts(100, 4), [25, 50, 75]);
  assert.deepEqual(ce.evenCuts(100, 1), []);
  assert.deepEqual(ce.evenCuts(10, 3), [3.3, 6.7]);
  assert.deepEqual(ce.segmentLengths([25, 50, 75], 100), [25, 25, 25, 25]);
  assert.deepEqual(ce.segmentLengths([], 80), [80]);
  assert.deepEqual(ce.normalise([70, 30, 30.04, 2, 99, 33, NaN], 100), [30, 70]);
  assert.deepEqual(ce.normalise([10, 12, 40], 100), [10, 40], 'a cut too close to the one before is dropped');
});

test('cut-edit: dragValue follows the cut direction on screen, and ignores a drag across it', () => {
  const axis = { x: 0, y: -4 };                                                // up the screen: 4 px per mm
  assert.equal(ce.dragValue(50, { x: 0, y: -40 }, axis), 60);
  assert.equal(ce.dragValue(50, { x: 0, y: 20 }, axis), 45);
  assert.equal(ce.dragValue(50, { x: 80, y: 0 }, axis), 50);
  const diag = { x: 3, y: -3 };
  assert.ok(Math.abs(ce.dragValue(10, { x: 6, y: -6 }, diag) - 12) < 1e-9);
  assert.equal(ce.dragValue(10, { x: 5, y: 5 }, { x: 0, y: 0 }), 10, 'an axis pointing at the camera cannot be dragged');
});

test('cut-edit: the text form round-trips', () => {
  assert.equal(ce.cutsToText([30, 55.04, 80]), '30, 55, 80');
  assert.deepEqual(ce.textToCuts('30, 55;80  x'), [30, 55, 80]);
  assert.deepEqual(ce.textToCuts(''), []);
  assert.deepEqual(ce.textToCuts(ce.cutsToText([12.3, 45.6])), [12.3, 45.6]);
});

// ---------------- cuts in any direction ----------------
const { makeFlexiCuts, joinReach, roomAround: roomAroundImport } = await import('../tools/flexi-maker/multi.js');
const { fromManifold } = await import('../tools/mesh-modifier/boolean3d.js');
const cp = await import('../tools/flexi-maker/cut-plane.js');

/** One closed part that is several boxes joined (an L, a T...). */
async function joined(boxes, name = 'Body', color = null) {
  const w = await loadManifold(), ms = boxes.map(b => toManifold(w, box(...b))), u = w.Manifold.union(ms), part = fromManifold(u, { name, color });
  [...ms, u].forEach(m => m.delete());
  return part;
}
async function overlapVolume(a, b) {
  const w = await loadManifold(), ma = a.map(p => toManifold(w, p)), mb = b.map(p => toManifold(w, p));
  let v = 0;
  for (const x of ma) for (const y of mb) { const i = x.intersect(y); v = Math.max(v, i.volume()); i.delete(); }
  [...ma, ...mb].forEach(m => m.delete());
  return v;
}
const piece = (r, id) => r.parts.filter(p => p.seg === id);
const cut = (axis, point, tilt = [0, 0], anchor = null) => ({ axis, tilt, point, ...(anchor ? { anchor } : {}) });

test('an L-shaped body cut across z and then across x: three closed pieces in a tree, none touching', async () => {
  const L = await joined([[-10, -10, 0, 10, 10, 80], [10, -10, 60, 90, 10, 80]]);       // an upright with an arm going out of its top
  const r = await makeFlexiCuts([L], [cut('z', [0, 0, 30], [0, 0], [0, 0, 10]), cut('x', [55, 0, 70], [0, 0], [40, 0, 70])], { joint: 'ball', bend: 20 });
  assert.equal(r.joints.length, 2);
  assert.deepEqual(r.joints.map(j => [j.parent, j.child]), [[0, 1], [1, 2]], 'the second cut works on the piece the first made (it holds the arm)');
  assert.deepEqual(r.applied, [{ cut: 0, piece: 0 }, { cut: 1, piece: 1 }]);
  assert.deepEqual([...new Set(r.parts.map(p => p.seg))], [0, 1, 2]);
  assert.deepEqual(r.parts.map(p => p.name), ['Segment 1', 'Segment 2', 'Segment 3']);
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
  assert.ok(await overlapVolume(piece(r, 0), piece(r, 1)) < 1e-6 && await overlapVolume(piece(r, 1), piece(r, 2)) < 1e-6, 'neighbouring pieces do not touch');
  // the second joint's pivot is on its own plane (x = 55) and its axis is the frame's x, which for an x cut is some direction across the arm
  assert.ok(Math.abs(r.joints[1].pivot[0] - 55) < 8, `pivot ${r.joints[1].pivot}`);
  assert.ok(Math.abs(Math.hypot(...r.joints[1].axis) - 1) < 1e-9);
  assert.ok(r.bend > 5);
}, { timeout: 120000 });

test('a tilted cut: the two pieces are closed, separate, and the plane really is tilted', async () => {
  const post = await joined([[-12, -12, 0, 12, 12, 100]]);
  const tilt = 25, r = await makeFlexiCuts([post], [cut('z', [0, 0, 50], [tilt, 0])], { joint: 'ball', bend: 20 });
  const [lo, hi] = [piece(r, 0), piece(r, 1)];
  for (const p of [...lo, ...hi]) assert.equal(partStats(p).openEdges, 0);
  assert.ok(await overlapVolume(lo, hi) < 1e-6);
  // a plane tilted 25 degrees about x: the lower piece reaches higher on one side (y) than the other
  const topAt = (parts, side) => Math.max(...parts.flatMap(p => { const v = []; for (let i = 0; i < p.positions.length; i += 3) if (Math.sign(p.positions[i + 1]) === side && Math.abs(p.positions[i + 1]) > 8) v.push(p.positions[i + 2]); return v; }));
  const dz = topAt(lo, -1) - topAt(lo, 1);
  assert.ok(Math.abs(Math.abs(dz) - 2 * 10 * Math.tan((tilt * Math.PI) / 180)) < 4, `the cut rises ${dz.toFixed(1)} mm across 20 mm`);
  // the joint sits on the tilted plane, and bends about an axis lying in it
  const j = r.joints[0], n = cp.normalOf('z', [tilt, 0]);
  assert.ok(Math.abs(cp.planeDistance(j.pivot, [0, 0, 50], n)) < 8, `pivot ${j.pivot}`);
  assert.ok(Math.abs(j.axis.reduce((s, v, i) => s + v * n[i], 0)) < 1e-9, 'the bend axis is perpendicular to the cut normal');
  // tilt the upper piece about the joint by 80 % of the reported bend, either way: still no contact
  const w = await loadManifold(), up = hi.map(p => toManifold(w, p)), dn = lo.map(p => toManifold(w, p));
  const turn = (m, axis, deg, at) => {                     // rotate m about the line through `at` along `axis` (Rodrigues, as a column-major 4x4)
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s2 = Math.sin(t), [x, y, z] = axis, C = 1 - c;
    const R = [[c + x * x * C, x * y * C - z * s2, x * z * C + y * s2], [y * x * C + z * s2, c + y * y * C, y * z * C - x * s2], [z * x * C - y * s2, z * y * C + x * s2, c + z * z * C]];
    const tr = [0, 1, 2].map(i => at[i] - R[i][0] * at[0] - R[i][1] * at[1] - R[i][2] * at[2]);
    return m.transform([R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, tr[0], tr[1], tr[2], 1]);
  };
  for (const sign of [1, -1]) {
    let worst = 0;
    for (const u of up) for (const d of dn) { const mv = turn(u, j.axis, sign * 0.8 * r.bend, j.pivot), i = mv.intersect(d); worst = Math.max(worst, i.volume()); mv.delete(); i.delete(); }
    assert.ok(worst < 1e-6, `tilted ${sign * 0.8 * r.bend} degrees about the joint, the pieces overlap by ${worst}`);
  }
  [...up, ...dn].forEach(m => m.delete());
}, { timeout: 120000 });

test('cuts too close together are refused (no room for a joint), and ones further apart work', async () => {
  const post = await joined([[-15, -15, 0, 15, 15, 120]]);
  const near = [cut('z', [0, 0, 50], [0, 0], [0, 0, 10]), cut('z', [0, 0, 56], [0, 0], [0, 0, 100])];
  await assert.rejects(() => makeFlexiCuts([post], near, { joint: 'ball' }), /Cut 1: No joint fits/, 'two cuts 6 mm apart leave no room for either joint');
  const ok = await makeFlexiCuts([post], [cut('z', [0, 0, 40]), cut('z', [0, 0, 85], [0, 0], [0, 0, 100])], { joint: 'ball' });
  assert.equal(ok.joints.length, 2);
  assert.deepEqual(ok.joints.map(j => [j.parent, j.child]), [[0, 1], [1, 2]]);
  assert.ok(joinReach({ half: 8, extent: 10, radius: 6 }) > joinReach({ half: 3, extent: 4, radius: 2 }));
}, { timeout: 120000 });

test('each cut works on the piece its anchor is in: cuts on the two sides of an earlier cut make a tree, not a chain', async () => {
  const post = await joined([[-15, -15, 0, 15, 15, 140]]);
  const r = await makeFlexiCuts([post], [
    cut('z', [0, 0, 70]),
    cut('z', [0, 0, 25], [0, 0], [0, 0, 20]),                  // across the lower piece
    cut('z', [0, 0, 115], [0, 0], [0, 0, 120]),                // across the upper piece
  ], { joint: 'ball' });
  assert.deepEqual(r.joints.map(j => [j.parent, j.child]), [[0, 1], [0, 2], [1, 3]], 'the second and third cut each split a different piece');
  assert.equal(new Set(r.parts.map(p => p.seg)).size, 4);
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0);
  // numbering follows the order the cuts were made; pieces 0 and 2 are the two halves of the lower part
  const zTop = id => Math.max(...piece(r, id).flatMap(p => Array.from({ length: p.positions.length / 3 }, (_, i) => p.positions[i * 3 + 2])));
  assert.ok(zTop(2) > zTop(0) - 1, 'piece 3 is the upper part of the lower half');
}, { timeout: 120000 });

test('a cut across the middle of an earlier joint is refused even when it is another axis', async () => {
  const post = await joined([[-15, -15, 0, 15, 15, 140]]);
  await assert.rejects(() => makeFlexiCuts([post], [cut('z', [0, 0, 70]), cut('x', [0, 0, 20], [0, 0], [0, 0, 20])], { joint: 'ball' }), /Cut 2 passes 0\.0 mm from the joint of cut 1/);
}, { timeout: 120000 });

test('a cut with no anchor works on the piece the plane crosses the most', async () => {
  const body = await joined([[-10, -10, 0, 10, 10, 100]]);
  const r = await makeFlexiCuts([body], [cut('z', [0, 0, 50]), cut('z', [0, 0, 20])], { joint: 'ball' });
  assert.deepEqual(r.applied, [{ cut: 0, piece: 0 }, { cut: 1, piece: 0 }]);
}, { timeout: 120000 });

test('cuts along one axis with no tilt give the same pieces from the general engine as from the original', async () => {
  const bar = [box(-10, -10, 0, 0, 10, 100, '#CC0000', 'Red'), box(0, -10, 0, 10, 10, 100, '#0000CC', 'Blue')];
  const a = await makeFlexi(bar, { joint: 'ball', axis: 'z', count: 2, bend: 20 });
  const b = await makeFlexiCuts(bar, [cut('z', [0, 0, 50])], { joint: 'ball', bend: 20 });
  assert.deepEqual(b.parts.map(p => p.name).sort(), a.parts.map(p => p.name).sort());
  assert.deepEqual([...new Set(b.parts.map(p => p.color))].sort(), ['#0000CC', '#CC0000']);
  assert.equal(b.parts.length, a.parts.length);
  assert.ok(Math.abs(b.bend - a.bend) < 1e-6);
}, { timeout: 120000 });

test('bad cuts say what is wrong', async () => {
  const post = await joined([[-10, -10, 0, 10, 10, 60]]);
  await assert.rejects(() => makeFlexiCuts([post], [], {}), /at least one/);
  await assert.rejects(() => makeFlexiCuts([post], [cut('z', [0, 0, 300])], { joint: 'ball' }), /does not cross|Cut 1/);
}, { timeout: 120000 });

// ---------------- editing cuts with their own axis and tilt ----------------
const bnd = { min: [-20, -10, 0], max: [60, 10, 100] };
const zc = (pos, extra = {}) => ({ axis: 'z', tilt: [0, 0], point: [0, 0, pos], anchor: null, ...extra });

test('cut-edit: cutsFromOffsets and offsetsOf round-trip, and the cuts pass through the middle of the model', () => {
  const cuts = ce.cutsFromOffsets([25, 50, 75], 'z', bnd);
  assert.deepEqual(cuts.map(c => c.point), [[20, 0, 25], [20, 0, 50], [20, 0, 75]]);
  assert.deepEqual(ce.offsetsOf(cuts, bnd), [25, 50, 75]);
  assert.deepEqual(ce.cutsFromOffsets([10], 'x', bnd)[0].point, [-10, 0, 50]);
  assert.deepEqual(ce.offsetsOf(ce.cutsFromOffsets([10], 'x', bnd), bnd), [10]);
});

test('cut-edit: addCutAt keeps order of placing, snaps, and only refuses a parallel cut that is too near', () => {
  let r = ce.addCutAt([], zc(40.3), bnd);
  assert.equal(r.added, true);
  assert.equal(r.cuts[0].point[2], 40.5);
  const x = { axis: 'x', tilt: [0, 0], point: [0, 0, 40.5], anchor: [1, 2, 3] };
  r = ce.addCutAt(r.cuts, x, bnd);
  assert.equal(r.added, true, 'a cut along another axis may cross the first');
  assert.deepEqual(r.cuts.map(c => c.axis), ['z', 'x'], 'kept in the order placed');
  const near = ce.addCutAt(r.cuts, zc(43), bnd);
  assert.equal(near.added, false); assert.match(near.reason, /same direction/);
  const tilted = ce.addCutAt(r.cuts, zc(43, { tilt: [20, 0] }), bnd);
  assert.equal(tilted.added, true, 'a tilted plane is not parallel to the first, so it may be near');
  assert.match(ce.addCutAt([], zc(3), bnd).reason, /each side/);
  assert.match(ce.addCutAt([], { axis: 'x', tilt: [0, 0], point: [59, 0, 0] }, bnd).reason, /each side/, 'the x range is -20..60');
});

test('cut-edit: moveCutTo clamps to the ends and to parallel neighbours only', () => {
  const cuts = [zc(30), zc(60), { axis: 'x', tilt: [0, 0], point: [0, 0, 45] }];
  assert.equal(ce.moveCutTo(cuts, 0, 200, bnd)[0].point[2], 54, 'cannot pass the parallel cut at 60');
  assert.equal(ce.moveCutTo(cuts, 1, 0, bnd)[1].point[2], 36, 'nor the one at 30');
  assert.equal(ce.moveCutTo(cuts, 0, -50, bnd)[0].point[2], 6, 'nor the end');
  assert.equal(ce.moveCutTo(cuts, 2, -10, bnd)[2].point[0], -10, 'the x cut is free of the z cuts and moves along x');
  assert.deepEqual(cuts[0].point, [0, 0, 30], 'the input is never changed');
});

test('cut-edit: tilts are clamped, axis changes stand the plane up straight, drag moves along the normal, remove drops one', () => {
  const cuts = [zc(40), zc(70)];
  assert.deepEqual(ce.tiltCutTo(cuts, 0, 20, -90)[0].tilt, [20, -60]);
  assert.deepEqual(ce.tiltCutTo(cuts, 0, NaN, 5)[0].tilt, [0, 5]);
  assert.deepEqual(ce.tiltCutTo(cuts, 1, 10, 10)[0].tilt, [0, 0], 'only the chosen cut changes');
  const tilted = ce.tiltCutTo(cuts, 0, 30, 0), flat = ce.setCutAxis(tilted, 0, 'x');
  assert.equal(flat[0].axis, 'x'); assert.deepEqual(flat[0].tilt, [0, 0]); assert.deepEqual(flat[0].point, [0, 0, 40]);
  const dragged = ce.dragCut(tilted, 0, 10, bnd);                              // 10 mm along a normal that is 30 degrees off z
  assert.ok(Math.abs(dragged[0].point[2] - (40 + 10 * Math.cos(Math.PI / 6))) < 0.3, `${dragged[0].point[2]}`);
  assert.ok(Math.abs(dragged[0].point[1] - 0) > 1, 'it moved sideways too, along the normal');
  assert.deepEqual(ce.removeCutAt(cuts, 0).map(c => c.point[2]), [70]);
});

test('closely spaced cuts in the general engine get joints sized to fit, like the single-axis engine', async () => {
  const post = await joined([[-15, -15, 0, 15, 15, 200]]);
  const cuts = [50, 75, 100, 125].map((z, i) => cut('z', [0, 0, z], [0, 0], [0, 0, z + 5]));
  const r = await makeFlexiCuts([post], cuts, { joint: 'ball', bend: 20 });
  assert.equal(r.joints.length, 4);
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
  const ids = [...new Set(r.parts.map(p => p.seg))].sort();
  for (let i = 0; i + 1 < ids.length; i++) assert.ok(await overlapVolume(piece(r, ids[i]), piece(r, ids[i + 1])) < 1e-6, `pieces ${ids[i]} and ${ids[i + 1]} do not touch`);
  const single = await makeFlexi([post], { joint: 'ball', axis: 'z', count: 9, positions: [50, 75, 100, 125], bend: 20 });
  const rad = r.joints.map(j => j.radius), ref = single.joints.map(j => j.radius);
  assert.ok(Math.max(...rad) <= Math.max(...ref) + 1e-6, `ball radii ${rad.map(v => v.toFixed(1))} vs ${ref.map(v => v.toFixed(1))}`);
}, { timeout: 180000 });

test('roomAround: the distance along a cut\'s normal to the nearest other plane, either side', () => {
  const zc2 = p => ({ axis: 'z', tilt: [0, 0], point: [0, 0, p] });
  const r = roomAroundImport([zc2(40), zc2(70), zc2(95)], 1);
  assert.deepEqual([r.below, r.above], [30, 25]);
  assert.deepEqual(roomAroundImport([zc2(40)], 0), { below: Infinity, above: Infinity });
  const side = roomAroundImport([zc2(40), { axis: 'x', tilt: [0, 0], point: [10, 0, 0] }], 0);
  assert.deepEqual([side.below, side.above], [Infinity, Infinity], 'a plane running along the line never meets it');
  const tilted = roomAroundImport([zc2(40), { axis: 'z', tilt: [45, 0], point: [0, 0, 60] }], 0);
  assert.ok(Math.abs(tilted.above - 20) < 1e-9, `${tilted.above}`);
});

test('a curved tube (a quarter of a torus) cut square to its length at two angles: closed pieces in a chain that bend without touching', async () => {
  const w = await loadManifold();
  const cs = new w.CrossSection.circle(10, 48).translate([60, 0]);                       // a 20 mm tube whose centre line is a circle of radius 60 round z
  const tube = w.Manifold.revolve(cs, 96, 90), part = fromManifold(tube, { name: 'Tube', color: null });
  cs.delete(); tube.delete();
  assert.equal(partStats(part).openEdges, 0);
  // at angle t round the z axis the tube runs along (-sin t, cos t, 0): that is the y axis turned by t about z, which is tilt A of a y cut
  const at = t => cut('y', [60 * Math.cos((t * Math.PI) / 180), 60 * Math.sin((t * Math.PI) / 180), 0], [t, 0], [60 * Math.cos((t * Math.PI) / 180), 60 * Math.sin((t * Math.PI) / 180), 0]);
  const r = await makeFlexiCuts([part], [at(30), at(60)], { joint: 'ball', bend: 20 });
  assert.equal(r.joints.length, 2);
  assert.equal(new Set(r.parts.map(p => p.seg)).size, 3);
  for (const p of r.parts) assert.equal(partStats(p).openEdges, 0, `${p.name} is closed`);
  const ids = [0, 1, 2], pcs = ids.map(i => piece(r, i));
  assert.ok(await overlapVolume(pcs[0], pcs[1]) < 1e-6 && await overlapVolume(pcs[1], pcs[2]) < 1e-6, 'neighbouring pieces do not touch');
  // every joint's centre is on the tube's centre line (radius 60 about z, z = 0), and its bend axis points along the tube's radius, so the tube bends in its own plane
  for (const [i, j] of r.joints.entries()) {
    assert.ok(Math.abs(Math.hypot(j.pivot[0], j.pivot[1]) - 60) < 4 && Math.abs(j.pivot[2]) < 4, `joint ${i + 1} pivot ${j.pivot.map(v => v.toFixed(1))}`);
    const t = ((i === 0 ? 30 : 60) * Math.PI) / 180, tangent = [-Math.sin(t), Math.cos(t), 0];
    assert.ok(Math.abs(j.axis.reduce((s, v, k) => s + v * tangent[k], 0)) < 1e-6, 'the bend axis lies in the cut plane');
  }
  assert.ok(r.bend > 5, `reports ${r.bend} degrees`);
}, { timeout: 180000 });
