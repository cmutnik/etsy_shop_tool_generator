// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';
import { repairCapJunctions, extrudeShapes, groupsToShapes, outlineShape, cleanShape } from '../shared/js/geometry2d.js';
import { multiPolygonToGroups, difference } from '../shared/js/boolean2d.js';
import { layoutText } from '../shared/js/text-layout.js';
import { testFont } from './helpers.mjs';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { mergeArtwork } = await import('../tools/qr-stand/geometry.js');
const font = await testFont();
const skip = font ? false : 'font not available offline';

/** Edge incidence histogram of a mesh, with vertices welded at 1e-4. */
function edges(geo) {
  const pos = geo.attributes.position, idx = geo.index, m = new Map();
  const key = i => [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => v.toFixed(4)).join();
  const n = idx ? idx.count : pos.count, at = i => (idx ? idx.getX(i) : i);
  for (let t = 0; t < n; t += 3) for (let e = 0; e < 3; e++) {
    const a = key(at(t + e)), b = key(at(t + (e + 1) % 3));
    if (a === b) continue;
    const k = a < b ? a + '|' + b : b + '|' + a;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return { bad: [...m.values()].filter(c => c !== 2).length, total: m.size };
}
const raw = (groups, depth = 1) => new THREE.ExtrudeGeometry(groupsToShapes(groups), { depth, bevelEnabled: false, curveSegments: 48 });

/** A banner top layer: a plate with text-shaped holes whose bottoms all sit on one baseline (the case that cracks the cap). */
function textTopLayer(text) {
  const lay = layoutText(font, text, 100, 1.25), k = 7 / lay.height;
  const art = mergeArtwork(lay.groups.map(g => ({ outer: g.outer.map(([x, y]) => [x * k + 30, y * k + 10]), holes: g.holes.map(h => h.map(([x, y]) => [x * k + 30, y * k + 10])) })));
  return multiPolygonToGroups(difference([[0, 0], [60, 0], [60, 20], [0, 20]], art.map(g => [g.outer, ...g.holes])));
}

test('repairCapJunctions: cracks that ExtrudeGeometry leaves under a baseline of letters are closed', { skip }, () => {
  let crackedBefore = 0;
  for (const text of ['LLLLLL IIIII', 'HEHEHE', 'iiiiii lllll', 'Handmade with love']) {
    const groups = textTopLayer(text);
    const before = edges(raw(groups)), after = edges(repairCapJunctions(raw(groups)));
    crackedBefore += before.bad;
    assert.equal(after.bad, 0, `${text}: ${after.bad} bad edges left of ${after.total}`);
  }
  assert.ok(crackedBefore > 0, 'the plain triangulation really does leave cracks for at least one of these, so this test is not vacuous');
});

test('repairCapJunctions: leaves simple shapes exactly as they were, and is idempotent', () => {
  for (const shape of [outlineShape('rect', 40, 18, 4), outlineShape('ellipse', 18, 18), outlineShape('rect', 10, 10, 0)]) {
    const g = new THREE.ExtrudeGeometry([cleanShape(shape)], { depth: 2, bevelEnabled: false, curveSegments: 48 });
    const once = repairCapJunctions(g), twice = repairCapJunctions(once);
    assert.equal(once.attributes.position.count, g.attributes.position.count, 'no triangles added or removed');
    assert.equal(twice.attributes.position.count, once.attributes.position.count);
    assert.equal(edges(once).bad, 0);
    assert.equal(edges(g).bad, 0, 'a cleaned shape extrudes watertight even without the repair');
  }
});

test('repairCapJunctions: stays manifold for text (with holes) and keeps the volume', { skip }, () => {
  const lay = layoutText(font, 'Handmade\nwith love', 8, 1.25);
  const g = raw(lay.groups, 1.5), fixed = repairCapJunctions(g);
  assert.equal(edges(fixed).bad, 0);
  const vol = geo => { const p = geo.attributes.position; let v = 0; for (let t = 0; t < p.count; t += 3) { const a = [0, 1, 2].map(j => [p.getX(t + j), p.getY(t + j), p.getZ(t + j)]); v += (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])) / 6; } return v; };
  assert.ok(Math.abs(vol(fixed) - vol(g)) / vol(g) < 1e-6, `volume ${vol(fixed)} vs ${vol(g)}`);
});

test('repairCapJunctions is fast enough to run on every keystroke', { skip }, () => {
  const lay = layoutText(font, 'Handmade with love and a much longer line\nsecond line of text here', 8, 1.25);
  const g = raw(lay.groups, 1.5);
  const t = performance.now(); repairCapJunctions(g);
  const ms = performance.now() - t;
  assert.ok(ms < 800, `${Math.round(ms)} ms for ${g.attributes.position.count / 3} triangles`);
});

test('extrudeShapes returns the repaired geometry (non-indexed, with normals)', () => {
  const g = extrudeShapes([outlineShape('rect', 10, 10, 2)], 3, 1);
  assert.equal(g.index, null);
  assert.ok(g.attributes.normal && g.attributes.normal.count === g.attributes.position.count);
  const b = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  assert.ok(Math.abs(b.min.z - 1) < 1e-6 && Math.abs(b.max.z - 4) < 1e-6);
});

test('cleanShape removes coincident consecutive points that three.js arcs leave behind', () => {
  const s = outlineShape('rect', 40, 18, 4), before = s.extractPoints(48).shape;
  const clean = cleanShape(s).extractPoints(48).shape;
  const dups = pts => pts.filter((p, i) => i && Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) <= 1e-6).length;
  assert.ok(dups(clean) === 0 && dups(before) >= 0);
  assert.ok(clean.length <= before.length);
  const sq = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1), new THREE.Vector2(0, 1), new THREE.Vector2(0, 0)]);
  assert.equal(cleanShape(sq).extractPoints(48).shape.length, 4, 'repeated point and the closing duplicate are both removed');
});
