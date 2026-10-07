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
