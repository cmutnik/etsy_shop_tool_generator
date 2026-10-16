// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalOf, frameOf, toFrame, fromFrame, dirFromFrame, mapParts, rotateAbout, planeDistance, sameDirection, needsGeneral, positionOf, setPosition, describeCut } from '../tools/flexi-maker/cut-plane.js';

const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < e);
const len = v => Math.hypot(...v);

test('normalOf: the axis itself, or turned by the two tilts about the other two axes', () => {
  assert.ok(near(normalOf('x'), [1, 0, 0]) && near(normalOf('y'), [0, 1, 0]) && near(normalOf('z'), [0, 0, 1]));
  const t = normalOf('z', [30, 0]);                                              // about x: z turns toward -y
  assert.ok(near(t, [0, -0.5, Math.cos(Math.PI / 6)], 1e-9), t.join());
  const u = normalOf('z', [0, 30]);                                              // about y: z turns toward +x
  assert.ok(near(u, [0.5, 0, Math.cos(Math.PI / 6)], 1e-9), u.join());
  assert.ok(near(normalOf('x', [90, 0]), [0, 0, -1], 1e-9), 'x turned 90 degrees about y (right-hand rule) points along -z');
  for (const a of ['x', 'y', 'z']) for (const tilt of [[0, 0], [20, -35], [-60, 60]]) assert.ok(Math.abs(len(normalOf(a, tilt)) - 1) < 1e-12);
  assert.throws(() => normalOf('w'), /Unknown cut axis/);
});

test('frameOf: carries the normal to +z, is a proper rotation, and round-trips points and directions', () => {
  for (const n of [[0, 0, 1], [1, 0, 0], [0, 1, 0], normalOf('z', [30, 20]), normalOf('x', [-40, 10]), [0.3, -0.5, 0.8], [0, 0, -1]]) {
    const f = frameOf(n), un = n.map(v => v / len(n));
    assert.ok(near(f.R.map(r => r[0] * un[0] + r[1] * un[1] + r[2] * un[2]), [0, 0, 1], 1e-9), `normal -> z for ${n}`);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(f.R[i].reduce((s, v, k) => s + v * f.R[j][k], 0) - (i === j ? 1 : 0)) < 1e-9, 'orthonormal');
    const [x, y, z] = f.R, c = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    assert.ok(near(c, z, 1e-9), 'right-handed, so triangle winding is kept');
    const origin = [3, -4, 5], p = [10, 20, -7];
    assert.ok(near(fromFrame(toFrame(p, f, origin), f, origin), p, 1e-9));
    assert.ok(Math.abs(toFrame(origin, f, origin).reduce((s, v) => s + Math.abs(v), 0)) < 1e-12, 'the point on the plane is the frame origin');
    assert.ok(near(dirFromFrame([1, 0, 0], f), x, 1e-12), 'the page bends about the frame x axis');
  }
  const f = frameOf([0, 0, 1]);
  assert.ok(near(f.R[0], [1, 0, 0]) && near(f.R[1], [0, 1, 0]), 'a z cut is the identity, so the old engine and the new one agree');
});

test('mapParts moves every point and keeps indices and names', () => {
  const part = { name: 'p', color: '#fff', positions: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]), indices: Uint32Array.from([0, 1, 2]) };
  const out = mapParts([part], p => [p[0] + 1, p[1] * 2, -p[2]]);
  assert.deepEqual([...out[0].positions], [2, 0, -0, 1, 2, -0, 1, 0, -1]);
  assert.equal(out[0].indices, part.indices);
  assert.equal(out[0].color, '#fff');
  assert.deepEqual([...part.positions], [1, 0, 0, 0, 1, 0, 0, 0, 1], 'the input is never changed');
});

test('planeDistance, positionOf and setPosition move a plane along its normal, not sideways', () => {
  const cut = { axis: 'z', tilt: [30, 0], point: [5, 5, 40] };
  const n = normalOf('z', [30, 0]);
  assert.ok(Math.abs(planeDistance([5, 5, 40], cut.point, n)) < 1e-12);
  assert.ok(Math.abs(planeDistance([5, 5, 41], cut.point, n) - n[2]) < 1e-12);
  assert.equal(positionOf(cut, 10), 30);
  const moved = setPosition(cut, 50);
  assert.ok(Math.abs(moved.point[2] - 50) < 1e-9);
  assert.ok(Math.abs(planeDistance(moved.point, cut.point, n) - (50 - 40) / n[2]) < 1e-9, 'moved along the normal');
  assert.ok(Math.abs(moved.point[1] - 5) > 1e-6 && moved.tilt === cut.tilt);
  assert.deepEqual(setPosition({ axis: 'z', tilt: [80, 0], point: [0, 0, 0] }, 10).point, [0, 0, 0], 'a plane nearly parallel to its axis cannot be set that way');
});

test('sameDirection and needsGeneral: parallel cuts along one axis use the old engine, anything else the general one', () => {
  const z = (p, tilt = [0, 0]) => ({ axis: 'z', tilt, point: [0, 0, p] });
  assert.equal(needsGeneral([]), false);
  assert.equal(needsGeneral([z(10), z(30), z(50)]), false);
  assert.equal(needsGeneral([z(10), { axis: 'x', tilt: [0, 0], point: [5, 0, 0] }]), true);
  assert.equal(needsGeneral([z(10), z(30, [10, 0])]), true);
  assert.equal(needsGeneral([z(10, [10, 0]), z(30, [10, 0])]), true, 'a tilt alone needs the general engine');
  assert.equal(needsGeneral([z(10, [0.001, 0])]), false);
  assert.equal(sameDirection(z(1, [5, 5]), z(2, [5, 5])), true);
  assert.equal(sameDirection(z(1, [5, 5]), z(2, [5, 6])), false);
});

test('describeCut reads well', () => {
  assert.equal(describeCut({ axis: 'z', tilt: [0, 0], point: [0, 0, 45] }, 0), 'Z 45 mm');
  assert.equal(describeCut({ axis: 'x', tilt: [10, -5], point: [12.34, 0, 0] }, 2), 'X 10.3 mm, tilted 10 / -5 deg');
});

test('rotateAbout turns a vector about an axis', () => {
  assert.ok(near(rotateAbout([1, 0, 0], [0, 0, 1], 90), [0, 1, 0], 1e-12));
  assert.ok(near(rotateAbout([0, 0, 1], [0, 0, 1], 33), [0, 0, 1], 1e-12));
});
