// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildMagnet } from '../tools/magnets/geometry.js';
import { SHAPES, shape, fitToSize } from '../tools/cookie-cutter/geometry.js';
import { multiPolygonToGroups } from '../shared/js/boolean2d.js';
import { pointInPoly } from '../shared/js/geometry-pure.js';
import { imageToGroups } from '../shared/js/image-trace.js';
import { export3MF, exportSTL } from '../shared/js/export.js';
import { inset, fillHoles } from '../shared/js/offset2d.js';
import { assertWatertight, testFont } from './helpers.mjs';

const font = await testFont('pacifico', 400);
const skipFont = font ? false : 'font unavailable (offline)';
const heart = () => shape('heart').groups();
const base = { groups: heart(), size: 70, thickness: 5, raise: 0.8, rim: 1.2, art: 'none', magnet: { count: 1, diameter: 10, thickness: 3 }, loop: { position: 'none' } };
const meshes = (r, name) => r.group.children.filter(m => m.name === name);
const local = m => new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position);

/** w*h picture: a black disc on white. */
function disc(w = 100, h = 100) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.hypot(x - w / 2, y - h / 2) < 30 ? 0 : 255; data.set([v, v, v, 255], (y * w + x) * 4); }
  return { data, width: w, height: h };
}

test('every shape with every combination of magnets, loop and rim is watertight', () => {
  for (const s of SHAPES) for (const count of [0, 1, 2]) for (const position of ['none', 'top']) for (const rim of [0, 1.2]) {
    const r = buildMagnet({ ...base, groups: s.groups(), rim, magnet: { count, diameter: 10, thickness: 3 }, loop: { position, style: 'round', size: 12, holeDiameter: 4.5 } });
    r.group.children.forEach(m => assertWatertight(m, assert));
  }
});

test('layers: pocket layer under a solid layer, art on top, in two parts', () => {
  const r = buildMagnet({ ...base, rim: 1.2 });
  const b = meshes(r, 'base'), a = meshes(r, 'art');
  assert.equal(b.length, 2);
  assert.equal(a.length, 1);
  const [pocket, solid] = b.map(local);
  assert.ok(Math.abs(pocket.min.z) < 1e-6 && Math.abs(pocket.max.z - 3.2) < 1e-5, 'pocket is magnet thickness + 0.2 deep');
  assert.ok(Math.abs(solid.min.z - 3.2) < 1e-5 && Math.abs(solid.max.z - 5) < 1e-5);
  assert.ok(Math.abs(local(a[0]).min.z - 5) < 1e-5 && Math.abs(local(a[0]).max.z - 5.8) < 1e-5, 'raised parts stand on the plate');
  assert.ok(Math.abs(r.info.height - 5.8) < 1e-5);
});

test('the pocket is a real hole of the right size: the pocket layer has less volume than a solid one', () => {
  const vol = m => { const p = m.geometry.attributes.position; let v = 0; for (let i = 0; i < p.count; i += 3) { const a = [0, 1, 2].map(k => p.getX(i + 0) * 0 + [p.getX(i), p.getY(i), p.getZ(i)][k]), b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)]; v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return v; };
  const none = buildMagnet({ ...base, magnet: { count: 0 } }), one = buildMagnet(base), two = buildMagnet({ ...base, magnet: { count: 2, diameter: 8, thickness: 3 } });
  const total = r => meshes(r, 'base').reduce((s, m) => s + vol(m), 0);
  const hole = Math.PI * (5.15 ** 2) * 3.2;
  assert.ok(Math.abs(total(none) - total(one) - hole) / hole < 0.03, `${total(none) - total(one)} vs ${hole}`);
  assert.ok(total(two) < total(none));
  assert.equal(one.info.pockets.length, 1);
  assert.equal(two.info.pockets.length, 2);
});

test('pockets keep a wall of plastic: every pocket centre is further than wall + radius from the outline', () => {
  for (const s of SHAPES) {
    const r = buildMagnet({ ...base, groups: s.groups(), magnet: { count: 2, diameter: 8, thickness: 3 } });
    const room = multiPolygonToGroups(inset(fitToSize(fillHoles(s.groups()), 70).groups, 1.2 + 4.15 - 0.01));
    assert.equal(r.info.pockets.length, 2);
    for (const c of r.info.pockets) assert.ok(room.some(g => pointInPoly(c, g.outer)), `${s.id}: pocket at ${c.map(v => v.toFixed(1))} is too near the edge`);
    assert.ok(Math.hypot(r.info.pockets[0][0] - r.info.pockets[1][0], r.info.pockets[0][1] - r.info.pockets[1][1]) > 8.3 + 1, 'the two pockets do not overlap');
  }
});

test('a magnet that does not fit, or a plate that is too thin, is refused with a message', () => {
  assert.throws(() => buildMagnet({ ...base, magnet: { count: 1, diameter: 40, thickness: 3 }, size: 30 }), /does not fit/);
  assert.throws(() => buildMagnet({ ...base, thickness: 3 }), /too thin/);
  assert.throws(() => buildMagnet({ ...base, magnet: { count: 1, diameter: 2, thickness: 3 } }), /between 4 and 40/);
  assert.throws(() => buildMagnet({ ...base, groups: [] }), /no shape/);
  assert.throws(() => buildMagnet({ ...base, size: 10 }), /25 mm/);
  assert.throws(() => buildMagnet({ ...base, raise: 0.2 }), /0.4/);
  assert.throws(() => buildMagnet({ ...base, rim: 0.4 }), /rim/);
  assert.throws(() => buildMagnet({ ...base, art: 'picture', pictureGroups: [] }), /picture/);
  assert.throws(() => buildMagnet({ ...base, size: 30, magnet: { count: 2, diameter: 12, thickness: 3 } }), /side by side|does not fit/);
});

test('text artwork stays inside the rim and the plate', { skip: skipFont }, () => {
  for (const s of SHAPES) {
    const r = buildMagnet({ ...base, groups: s.groups(), art: 'text', text: 'Mom', font, artSize: 80, magnet: { count: 0 } });
    const art = meshes(r, 'art');
    assert.ok(art.length >= 1);
    art.forEach(m => assertWatertight(m, assert));
    const plate = new THREE.Box3().setFromObject(meshes(r, 'base')[0]), top = new THREE.Box3().setFromObject(art[0]);
    assert.ok(top.min.x >= plate.min.x - 1e-6 && top.max.x <= plate.max.x + 1e-6 && top.min.y >= plate.min.y - 1e-6 && top.max.y <= plate.max.y + 1e-6, s.id);
  }
  assert.throws(() => buildMagnet({ ...base, art: 'text', text: ' ', font }), /Type some text/);
  assert.throws(() => buildMagnet({ ...base, art: 'text', text: 'x', font: null }), /font/);
});

test('picture artwork is traced, centred and fitted, and a picture can also give the outline', () => {
  const pic = imageToGroups(disc(), { tolerance: 1 }).groups;
  const r = buildMagnet({ ...base, groups: shape('square').groups(), art: 'picture', pictureGroups: pic, artSize: 50, rim: 0, magnet: { count: 0 } });
  meshes(r, 'art').forEach(m => assertWatertight(m, assert));
  const bb = new THREE.Box3().setFromObject(meshes(r, 'art')[0]), plate = new THREE.Box3().setFromObject(meshes(r, 'base')[0]);
  assert.ok(Math.abs((bb.max.x - bb.min.x) - 0.5 * (plate.max.x - plate.min.x)) < 4, `${bb.max.x - bb.min.x}`);
  assert.ok(Math.abs(bb.min.x + bb.max.x) < 0.5);
  const own = buildMagnet({ ...base, groups: pic, magnet: { count: 1, diameter: 10, thickness: 3 } });
  own.group.children.forEach(m => assertWatertight(m, assert));
});

test('a hanging loop extends the top; the artwork stays on the plate, not the loop', () => {
  const circle = { ...base, groups: shape('circle').groups(), magnet: { count: 0 } };
  const none = buildMagnet(circle), top = buildMagnet({ ...circle, loop: { position: 'top', style: 'round', size: 12, holeDiameter: 4.5 } });
  assert.ok(top.info.depth > none.info.depth + 8 && Math.abs(top.info.width - none.info.width) < 0.5);
  assert.ok(top.info.loop && top.info.loop.holeCentre);
  assert.throws(() => buildMagnet({ ...base, loop: { position: 'top', style: 'round', size: 5, holeDiameter: 4.5 } }), /wall/);
  assert.ok(buildMagnet({ ...base, magnet: { count: 0 }, loop: { position: 'top', style: 'round', size: 12, holeDiameter: 4.5 } }).info.loop, 'a heart takes a loop in its cleft');
});

test('exports STL and a 3MF with plate and raised parts', () => {
  const r = buildMagnet({ ...base, art: 'none' });
  assert.ok(exportSTL(r.group).size > 84);
  assert.ok(export3MF(r.group, { title: 'Magnet', parts: [{ name: 'base', label: 'Plate' }, { name: 'art', label: 'Raised' }] }).size > 100);
});
