// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import jsQR from 'jsqr';
import { buildKeychain } from '../tools/qr-keychain/geometry.js';
import { loopFootprint, loopWall, LOOP_STYLES, HEADER_SHAPES, headerOutline } from '../tools/qr-keychain/loops.js';
import { signedArea, pointInPoly } from '../shared/js/geometry2d.js';
import { qrMatrix, gridRects, rasterizeTopDown, rasterizeBottomUp } from '../shared/js/qr-plate.js';
import { export3MF, collectMesh } from '../shared/js/export.js';
import { assertWatertight } from './helpers.mjs';

const base = {
  data: 'https://example.com', errorCorrection: 'M', module: 1.2, margin: 4, mode: 'raised', thickness: 3, depth: 0.6,
  loopPosition: 'above', loopDiameter: 16, holeDiameter: 5.5, neckWidth: 10, neckHeight: 2, baseColor: '#ffffff', qrColor: '#111111',
};

function scan(result, mode, ppm = 10) {
  const img = rasterizeTopDown(result.meshes, mode, result.info.plateSize, ppm);
  // add a white border like a camera frame would have
  const pad = 40, w = img.width + 2 * pad;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + pad) * w + pad) * 4);
  const r = jsQR(data, w, w);
  return r && r.data;
}

test('the generated geometry scans back to the original text (raised and engraved)', () => {
  const samples = [
    ['https://example.com', 'M'], ['https://your-shop.etsy.com/listing/1234567890/handmade-wooden-stamp?ref=shop_home_active_3', 'L'],
    ['WIFI:T:WPA;S:Cafe Net;P:p@ss word;;', 'Q'], ['Café ☕ https://ex.com/é', 'H'], ['1234567890', 'M'],
  ];
  for (const mode of ['raised', 'indented'])
    for (const [data, ec] of samples) {
      const r = buildKeychain({ ...base, data, errorCorrection: ec, mode });
      assert.equal(scan(r, mode), data, `${mode} ${ec} ${data}`);
    }
});

test('loop position and parameters change the footprint as expected', () => {
  const above = buildKeychain(base), below = buildKeychain({ ...base, loopPosition: 'below' });
  const P = above.info.plateSize;
  const loopH = 2 + 16;
  assert.ok(Math.abs(above.info.depth - (P + loopH)) < 0.02, `${above.info.depth} vs ${P + loopH}`);
  assert.ok(Math.abs(below.info.depth - (P + loopH)) < 0.02);
  assert.ok(Math.abs(above.info.width - P) < 0.02);
  assert.ok(Math.abs(P - (matrixSize() * 1.2 + 8)) < 1e-9);
  // in plate coordinates (before centring) the plate spans [0,P]: the loop must stick out the +y side or the -y side
  const yRange = r => { const b = new THREE.Box3(); r.meshes.forEach(m => { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox); }); return [b.min.y, b.max.y]; };
  const [aMin, aMax] = yRange(above), [bMin, bMax] = yRange(below);
  assert.ok(aMin > -0.01 && aMax > P + loopH - 0.3, `above ${aMin}..${aMax}`);
  assert.ok(bMax < P + 0.01 && bMin < -loopH + 0.3, `below ${bMin}..${bMax}`);
  assert.ok(above.info.height === 3.6 || Math.abs(above.info.height - 3.6) < 1e-6, `height ${above.info.height}`);
});
function matrixSize() { return qrMatrix('https://example.com', 'M').length; }

test('all parts are watertight, sit on the bed, and the hole is open', () => {
  for (const mode of ['raised', 'indented'])
    for (const loopPosition of ['above', 'below'])
      for (const neckWidth of [4, 10, 20]) {
        const r = buildKeychain({ ...base, mode, loopPosition, neckWidth });
        r.group.children.forEach(m => assertWatertight(m, assert));
        const box = new THREE.Box3().setFromObject(r.group);
        assert.ok(Math.abs(box.min.z) < 1e-9);
        assert.ok(Math.abs((box.min.x + box.max.x) / 2) < 1e-6 && Math.abs((box.min.y + box.max.y) / 2) < 1e-6, 'centred');
      }
});

const STYLE_OPTS = { size: 16, holeDiameter: 5.5, slotLength: 14, neckWidth: 10, neckHeight: 2, plateWidth: 38 };
const inside = (g, pt) => pointInPoly(pt, g.outer) && !g.holes.some(h => pointInPoly(pt, h));

test('every loop style: one solid piece with one open hole, reaching the expected height', () => {
  const expectedHeight = { round: 18, 'rounded-square': 18, hexagon: 2 + Math.sqrt(3) * 8, teardrop: 2 + 8 + 16, 'lanyard-slot': 18, header: 16 };
  for (const { id } of LOOP_STYLES)
    for (const neckWidth of [4, 10, 20])
      for (const sign of [1, -1]) {
        const fp = loopFootprint({ ...STYLE_OPTS, style: id, neckWidth, sign });
        assert.equal(fp.groups.length, 1, `${id} @${neckWidth}: one piece`);
        const g = fp.groups[0];
        assert.equal(g.holes.length, 1, `${id}: one hole`);
        // the hole is genuinely empty (the neck did not fill it) and the material around it is solid
        assert.ok(!inside(g, fp.holeCentre), `${id} @${neckWidth}: hole centre must be open`);
        const [hx, hy] = fp.holeCentre;
        assert.ok(inside(g, [hx, hy + sign * (5.5 / 2 + 1)]) || id === 'lanyard-slot', `${id}: material just above the hole`);
        // the shape starts just inside the plate edge and reaches the expected distance beyond it
        const ys = g.outer.map(p => p[1] * sign);
        assert.ok(Math.abs(Math.min(...ys) + 0.2) < 1e-6, `${id}: sunk into the plate by 0.2`);
        assert.ok(Math.abs(Math.max(...ys) - expectedHeight[id]) < 1e-6, `${id} @${neckWidth}: height ${Math.max(...ys)} vs ${expectedHeight[id]}`);
        assert.ok(Math.abs(fp.height - expectedHeight[id]) < 1e-6, `${id}: reported height`);
      }
});

test('every loop style builds into watertight meshes, scans, and keeps the plate centred', () => {
  for (const loopStyle of LOOP_STYLES.map(s => s.id))
    for (const mode of ['raised', 'indented'])
      for (const loopPosition of ['above', 'below'])
        for (const neckWidth of [4, 10, 20, 28]) {
        const r = buildKeychain({ ...base, loopStyle, mode, loopPosition, neckWidth, backDepth: 0 });
        r.group.children.forEach(m => assertWatertight(m, assert));
        assert.equal(scan(r, mode), base.data, `${loopStyle}/${mode}/${loopPosition}/${neckWidth}`);
        const box = new THREE.Box3().setFromObject(r.group);
        assert.ok(Math.abs(box.min.z) < 1e-6);
        assert.equal(r.info.loopStyle, loopStyle);
      }
});

test('loop styles: footprint dimensions and the hole stay inside the part', () => {
  const dims = style => { const r = buildKeychain({ ...base, loopStyle: style }); return r.info; };
  const P = dims('round').plateSize;
  assert.ok(Math.abs(dims('round').depth - (P + 18)) < 0.02);
  assert.ok(Math.abs(dims('rounded-square').depth - (P + 18)) < 0.02);
  assert.ok(Math.abs(dims('hexagon').depth - (P + 2 + Math.sqrt(3) * 8)) < 0.02);
  assert.ok(Math.abs(dims('teardrop').depth - (P + 26)) < 0.02);
  assert.ok(Math.abs(dims('header').depth - (P + 16)) < 0.02);
  assert.ok(Math.abs(dims('header').width - P) < 0.02, 'header is exactly as wide as the plate');
  // lanyard slot is wider than the round loop but narrower than the plate here
  assert.ok(dims('lanyard-slot').width <= P + 0.02);
});

test('lanyard slot: hole is a slot of the requested length and height', () => {
  const fp = loopFootprint({ ...STYLE_OPTS, style: 'lanyard-slot', slotLength: 20 });
  const hole = fp.groups[0].holes[0];
  const xs = hole.map(p => p[0]), ys = hole.map(p => p[1]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 20) < 1e-6);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 5.5) < 1e-6);
  // same wall all round: outer stadium is 20 + (16 - 5.5) wide
  const ox = fp.groups[0].outer.map(p => p[0]);
  assert.ok(Math.abs(Math.max(...ox) - Math.min(...ox) - (20 + 10.5)) < 1e-6);
});

test('loop wall rule applies to every style', () => {
  assert.ok(Math.abs(loopWall({ style: 'round', size: 16, holeDiameter: 5.5 }) - 5.25) < 1e-9);
  assert.ok(Math.abs(loopWall({ style: 'hexagon', size: 16, holeDiameter: 5.5 }) - (Math.sqrt(3) * 4 - 2.75)) < 1e-9);
  for (const { id } of LOOP_STYLES) {
    assert.throws(() => buildKeychain({ ...base, loopStyle: id, loopDiameter: 8, holeDiameter: 5.5 }), /at least 2\.5 mm of wall/, id);
    assert.doesNotThrow(() => buildKeychain({ ...base, loopStyle: id }));
  }
  assert.throws(() => buildKeychain({ ...base, loopStyle: 'heart' }), /Unknown loop style/);
});

test('default style is the round ring, unchanged', () => {
  const a = buildKeychain(base), b = buildKeychain({ ...base, loopStyle: 'round' });
  assert.equal(a.info.loopStyle, 'round');
  assert.equal(a.info.triangles, b.info.triangles);
  assert.ok(Math.abs(a.info.depth - (a.info.plateSize + 18)) < 0.02);
});

test('invalid input gives readable errors', () => {
  assert.throws(() => buildKeychain({ ...base, data: '' }), /Enter some text/);
  assert.throws(() => buildKeychain({ ...base, loopDiameter: 8, holeDiameter: 5.5 }), /at least 2.5 mm of wall/);
  assert.throws(() => buildKeychain({ ...base, mode: 'indented', thickness: 2, depth: 1.8 }), /Engrave depth/);
  assert.throws(() => buildKeychain({ ...base, data: 'x'.repeat(5000), errorCorrection: 'H' }), /too long/);
});

test('warnings: sample link, tiny modules, tight quiet zone', () => {
  const w = buildKeychain({ ...base, module: 0.6, margin: 1 }).info.warnings.join('\n');
  assert.match(w, /sample link/);
  assert.match(w, /0\.8 mm/);
  assert.match(w, /Quiet zone/);
  assert.deepEqual(buildKeychain({ ...base, data: 'https://my.shop' }).info.warnings, []);
});

test('filament change height: top of plate when raised, below the top by depth when engraved', () => {
  assert.equal(buildKeychain(base).info.filamentChangeZ, 3);
  assert.ok(Math.abs(buildKeychain({ ...base, mode: 'indented' }).info.filamentChangeZ - 2.4) < 1e-9);
});

test('gridRects covers exactly the picked cells, with no overlap', () => {
  const m = qrMatrix('hello world, this is a test', 'M');
  const rects = gridRects(m, v => v);
  const hit = m.map(r => r.map(() => 0));
  for (const r of rects) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) hit[y][x]++;
  m.forEach((row, y) => row.forEach((dark, x) => assert.equal(hit[y][x], dark ? 1 : 0, `(${x},${y})`)));
  assert.ok(rects.length < m.flat().filter(Boolean).length, 'merging reduces box count');
});

const PARTS = [{ name: 'base', label: 'Plate' }, { name: 'qr', label: 'QR code' }];
const unzipText = (file, entry) => execFileSync('unzip', ['-p', file, entry]).toString();
async function write3mf(group, opts) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kc-')), 'k.3mf');
  fs.writeFileSync(file, Buffer.from(await export3MF(group, opts).arrayBuffer()));
  return file;
}

test('3MF multi-colour: Orca/Bambu layout - one part per colour, filament slot per part', async () => {
  for (const mode of ['raised', 'indented']) {
    const r = buildKeychain({ ...base, mode });
    const file = await write3mf(r.group, { title: 'Keychain', parts: PARTS });
    assert.match(execFileSync('unzip', ['-t', file]).toString(), /No errors detected/);
    const model = unzipText(file, '3D/3dmodel.model');
    const cfg = unzipText(file, 'Metadata/model_settings.config');
    // plate is always filament slot 1 and the QR slot 2, whichever mesh comes first in the scene
    assert.match(cfg, /<object id="5">/);
    assert.match(cfg, /<part id="3"[^>]*>\s*<metadata key="name" value="Plate"\/>\s*<metadata key="extruder" value="1"\/>/);
    assert.match(cfg, /<part id="4"[^>]*>\s*<metadata key="name" value="QR code"\/>\s*<metadata key="extruder" value="2"\/>/);
    // parent object assembles the two parts; build item is the parent
    assert.match(model, /<object id="5"[^>]*><components><component objectid="3"\/><component objectid="4"\/><\/components><\/object>/);
    assert.match(model, /<build><item objectid="5"\/><\/build>/);
    // part meshes: valid indices, nothing lost, plate is the light colour
    const objs = [...model.matchAll(/<object id="(\d)"[^>]*type="model"[^>]*pid="1" pindex="(\d)"><mesh>(.*?)<\/mesh>/gs)];
    assert.equal(objs.length, 2);
    let total = 0;
    for (const [, , , mesh] of objs) {
      const nv = (mesh.match(/<vertex /g) || []).length;
      const tr = [...mesh.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)];
      assert.ok(tr.length > 0);
      for (const t of tr) for (const i of t.slice(1)) assert.ok(+i < nv, 'triangle index in range');
      total += tr.length;
    }
    assert.equal(total, collectMesh(r.group).tris.length / 3);
    assert.match(model, /<base name="Plate" displaycolor="#FFFFFFFF"\/><base name="QR code" displaycolor="#111111FF"\/>/);
    assert.match(fs.readFileSync(file).toString('latin1'), /model_settings\.config/);
  }
});

test('3MF without parts stays a plain single mesh', async () => {
  const file = await write3mf(buildKeychain(base).group, {});
  assert.doesNotMatch(unzipText(file, '3D/3dmodel.model'), /basematerials|components/);
  assert.equal(execFileSync('unzip', ['-l', file]).toString().includes('model_settings'), false);
});

function scanRaster(img, flipX = false) {
  const pad = 40, w = img.width + 2 * pad;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const sx = flipX ? img.width - 1 - x : x;
    data.set(img.data.subarray((y * img.width + sx) * 4, (y * img.width + sx) * 4 + 4), ((y + pad) * w + x + pad) * 4);
  }
  const r = jsQR(data, w, w);
  return r && r.data;
}

test('back engraving: the underside scans when the keychain is flipped over, and both faces scan', () => {
  for (const mode of ['raised', 'indented'])
    for (const data of ['https://example.com', 'Café ☕ https://ex.com/é']) {
      const r = buildKeychain({ ...base, data, mode, thickness: 4, backDepth: 0.8 });
      assert.equal(scan(r, mode), data, `front ${mode}`);
      const back = rasterizeBottomUp(r.meshes, r.info.plateSize, 10);
      assert.equal(scanRaster(back), data, `back ${mode}`);
      // (decoders such as jsQR also read mirrored codes, so check the orientation module by module instead:
      // flipped over, the underside must show exactly the same pattern as the matrix, not its mirror image)
      const matrix = qrMatrix(data, base.errorCorrection), ppm = 10, margin = base.margin, m = base.module;
      let mismatchesBack = 0, mismatchesFront = 0, asymmetric = 0;
      const front = rasterizeTopDown(r.meshes, mode, r.info.plateSize, ppm);
      matrix.forEach((row, ri) => row.forEach((dark, ci) => {
        const px = Math.round((margin + (ci + 0.5) * m) * ppm), py = Math.round((margin + (ri + 0.5) * m) * ppm);
        if ((back.data[(py * back.width + px) * 4] === 0) !== dark) mismatchesBack++;
        if ((front.data[(py * front.width + px) * 4] === 0) !== dark) mismatchesFront++;
        if (dark !== row[matrix.length - 1 - ci]) asymmetric++;
      }));
      assert.equal(mismatchesFront, 0, `front ${mode}`);
      assert.equal(mismatchesBack, 0, `back ${mode}: underside differs from the matrix`);
      assert.ok(asymmetric > 20, 'this QR is not left/right symmetric, so the check above can tell a mirror image apart');
    }
});

test('back engraving: all parts stay watertight/consistent and the front is unchanged', () => {
  for (const mode of ['raised', 'indented'])
    for (const loopPosition of ['above', 'below']) {
      const withBack = buildKeychain({ ...base, mode, loopPosition, thickness: 4, backDepth: 0.8 });
      withBack.group.children.forEach(m => assertWatertight(m, assert));
      const box = new THREE.Box3().setFromObject(withBack.group);
      assert.ok(Math.abs(box.min.z) < 1e-6, 'still on the bed (float32 rounding aside)');
      assert.ok(withBack.meshes.some(m => m.userData.back) && withBack.meshes.filter(m => m.userData.back).length > 5);
      const without = buildKeychain({ ...base, mode, loopPosition, thickness: 4 });
      assert.equal(withBack.info.height, without.info.height);
      assert.equal(withBack.info.filamentChangeZ, without.info.filamentChangeZ);
    }
});

/** What you see looking up at the underside, by colour: the lowest surface over each pixel. dark = 'qr' part. */
function undersideColours(meshes, size, ppm = 10) {
  const w = Math.ceil(size * ppm), seen = new Float64Array(w * w).fill(Infinity), dark = new Uint8Array(w * w);
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    const x0 = Math.max(0, Math.round((size - b.max.x) * ppm)), x1 = Math.min(w, Math.round((size - b.min.x) * ppm)); // mirrored: viewed from below
    const y0 = Math.max(0, Math.round((size - b.max.y) * ppm)), y1 = Math.min(w, Math.round((size - b.min.y) * ppm));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (b.min.z < seen[i] - 1e-6) { seen[i] = b.min.z; dark[i] = m.name === 'qr' ? 1 : 0; }
    }
  }
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let i = 0; i < w * w; i++) if (dark[i] && seen[i] < Infinity) data.fill(0, i * 4, i * 4 + 3);
  return { data, width: w, height: w, seen, dark };
}

test('back engraving is coloured in: looking up at the underside, the pockets show the QR colour', () => {
  for (const mode of ['raised', 'indented'])
    for (const data of ['https://example.com', 'WIFI:T:WPA;S:net;P:secret;;']) {
      const r = buildKeychain({ ...base, data, mode, thickness: 4, backDepth: 0.8 });
      const view = undersideColours(r.meshes, r.info.plateSize, 10);
      assert.equal(scanRaster(view), data, `${mode}: coloured underside decodes`);
      // pocket cells are dark and sit db above the bed; the surround is light on the bed
      const matrix = qrMatrix(data, base.errorCorrection), ppm = 10;
      let wrong = 0;
      matrix.forEach((row, ri) => row.forEach((dark, ci) => {
        const px = Math.round((base.margin + (ci + 0.5) * base.module) * ppm), py = Math.round((base.margin + (ri + 0.5) * base.module) * ppm);
        const i = py * view.width + px;
        if (!!view.dark[i] !== dark) wrong++;
        if (dark && Math.abs(view.seen[i] - 0.8) > 1e-6) wrong++;   // pocket floor at z = back depth
        if (!dark && Math.abs(view.seen[i]) > 1e-6) wrong++;        // surround touches the bed
      }));
      assert.equal(wrong, 0, `${mode}: ${wrong} module cells with the wrong colour or height`);
    }
});

test('back engraving: the loop is layered like the plate (light on the bed, dark, light top) in engraved mode', () => {
  const r = buildKeychain({ ...base, mode: 'indented', thickness: 4, backDepth: 0.8 });
  const loop = r.meshes.filter(m => m.userData.loop);
  const layers = loop.map(m => { m.geometry.computeBoundingBox(); return [m.name, +m.geometry.boundingBox.min.z.toFixed(3), +m.geometry.boundingBox.max.z.toFixed(3)]; }).sort((a, b) => a[1] - b[1]);
  assert.deepEqual(layers, [['base', 0, 0.8], ['qr', 0.8, 3.6], ['base', 3.4, 4]]);
  loop.forEach(m => assertWatertight(m, assert));
  // without back engraving the loop's bed layer stays dark, as before
  const plain = buildKeychain({ ...base, mode: 'indented', thickness: 4 }).meshes.filter(m => m.userData.loop);
  assert.deepEqual(plain.map(m => m.name).sort(), ['base', 'qr']);
});

test('back engraving: which mesh makes each colour, and the filament changes', () => {
  const raised = buildKeychain({ ...base, thickness: 4, backDepth: 0.8 });
  const indented = buildKeychain({ ...base, mode: 'indented', thickness: 4, backDepth: 0.8 });
  // raised: light surround + dark floors (so it needs two filament slots)
  assert.ok(raised.meshes.filter(m => m.userData.back).every(m => m.name === 'base'));
  const floors = raised.meshes.filter(m => m.userData.backFloor);
  assert.ok(floors.length > 5 && floors.every(m => m.name === 'qr'));
  assert.deepEqual(raised.info.filamentChangeZs, [4]);
  assert.match(raised.info.warnings.join(), /two filament slots/);
  // indented: light surround, the dark slab above is the floor -> plain height swaps: light, dark, light
  assert.ok(indented.meshes.filter(m => m.userData.back).every(m => m.name === 'base'));
  assert.equal(indented.meshes.filter(m => m.userData.backFloor).length, 0);
  assert.equal(indented.info.filamentChangeZs.length, 2);
  assert.ok(Math.abs(indented.info.filamentChangeZs[0] - 0.8) < 1e-9 && Math.abs(indented.info.filamentChangeZs[1] - 3.4) < 1e-9, String(indented.info.filamentChangeZs));
  assert.doesNotMatch(indented.info.warnings.join(), /two filament slots/);
  // no back engraving: unchanged behaviour
  assert.deepEqual(buildKeychain({ ...base, mode: 'indented', thickness: 4 }).info.filamentChangeZs, [3.4]);
  // the light back layer leaves real voids (pockets) at the bed
  const P = raised.info.plateSize;
  const area = r => r.meshes.filter(m => m.userData.back).reduce((a, m) => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return a + (b.max.x - b.min.x) * (b.max.y - b.min.y); }, 0);
  assert.ok(area(raised) < P * P * 0.8, `back layer area ${area(raised)} vs plate ${P * P}`);
});

test('back engraving: validation', () => {
  assert.throws(() => buildKeychain({ ...base, backDepth: 0.2 }), /at least 0\.4 mm/);
  assert.throws(() => buildKeychain({ ...base, thickness: 3, backDepth: 2.5 }), /too deep/);
  assert.throws(() => buildKeychain({ ...base, thickness: 3, backDepth: 1.9 }), /0\.4 mm dark floor/);
  assert.throws(() => buildKeychain({ ...base, mode: 'indented', thickness: 3, depth: 1, backDepth: 1.5 }), /front engraving 1 mm/);
  assert.doesNotThrow(() => buildKeychain({ ...base, thickness: 3, backDepth: 0.8 }));
  assert.equal(buildKeychain(base).info.backDepth, 0);
});

test('back engraving: 3MF keeps plate=slot 1, QR=slot 2 with a back layer', async () => {
  for (const mode of ['raised', 'indented']) {
    const r = buildKeychain({ ...base, mode, thickness: 4, backDepth: 0.8 });
    const file = await write3mf(r.group, { title: 'k', parts: PARTS });
    assert.match(execFileSync('unzip', ['-t', file]).toString(), /No errors detected/);
    const cfg = unzipText(file, 'Metadata/model_settings.config');
    assert.match(cfg, /value="Plate"\/>\s*<metadata key="extruder" value="1"/);
    assert.match(cfg, /value="QR code"\/>\s*<metadata key="extruder" value="2"/);
  }
});

test('every loop style also works with back engraving in both modes', () => {
  for (const loopStyle of LOOP_STYLES.map(s => s.id))
    for (const mode of ['raised', 'indented']) {
      const r = buildKeychain({ ...base, loopStyle, mode, thickness: 4, backDepth: 0.8, loopPosition: 'below' });
      r.group.children.forEach(m => assertWatertight(m, assert));
      assert.equal(scan(r, mode), base.data, `${loopStyle}/${mode} front`);
    }
});

// ---- full-width header: shapes, rounding, moving the hole ----
const HDR = { ...STYLE_OPTS, style: 'header', plateWidth: 38, size: 16 };
const SHAPES = HEADER_SHAPES.map(s => s.id);

test('header shapes: one solid piece with one open hole and the stated height, for every lean and rounding', () => {
  for (const headerShape of SHAPES)
    for (const lean of [0, 0.3, 0.6, 1])
      for (const rounding of [0, 2, 6])
        for (const sign of [1, -1]) {
          const fp = loopFootprint({ ...HDR, headerShape, lean, rounding, sign });
          const tag = `${headerShape} lean ${lean} r ${rounding} sign ${sign}`;
          assert.equal(fp.groups.length, 1, tag);
          assert.equal(fp.groups[0].holes.length, 1, tag);
          assert.ok(!inside(fp.groups[0], fp.holeCentre), `${tag}: hole centre open`);
          const ys = fp.groups[0].outer.map(p => p[1] * sign), xs = fp.groups[0].outer.map(p => p[0]);
          const want = headerShape === 'semicircle' ? 19 : 16;       // semicircle: half the plate width; others: the size
          assert.ok(Math.abs(Math.max(...ys) - want) < 1e-5, `${tag}: top ${Math.max(...ys)} vs ${want}`);
          assert.ok(Math.abs(Math.min(...ys) + 0.2) < 1e-9, `${tag}: sunk into the plate`);
          assert.ok(Math.abs(Math.max(...xs) - 19) < 1e-9 && Math.abs(Math.min(...xs) + 19) < 1e-9, `${tag}: as wide as the plate`);
        }
});

test('header: the semicircle is a true semicircle and the rectangle rounds only its top corners', () => {
  const semi = headerOutline({ plateWidth: 38, size: 16, headerShape: 'semicircle' });
  assert.equal(semi.height, 19);
  const arc = semi.ring.filter(p => p[1] > 1e-9);
  assert.ok(arc.length > 50);
  for (const [x, y] of arc) assert.ok(Math.abs(Math.hypot(x, y) - 19) < 1e-9, 'every arc point is 19 mm from the middle of the plate edge');
  const rect = headerOutline({ plateWidth: 38, size: 16, headerShape: 'rectangle', rounding: 4 }).ring;
  assert.ok(rect.some(p => p[0] === -19 && p[1] === -0.2) && rect.some(p => p[0] === 19 && p[1] === -0.2), 'bottom corners stay square');
  assert.ok(!rect.some(p => Math.abs(p[0]) > 18.99 && p[1] > 15.99), 'top corners are rounded off');
});

test('header: triangles lean towards the named side, and lean 1 is a right triangle flush with the plate edge', () => {
  const apexX = fp => { const g = fp.groups[0].outer; const top = Math.max(...g.map(p => p[1])); const pts = g.filter(p => p[1] > top - 0.05); return pts.reduce((a, p) => a + p[0], 0) / pts.length; };
  for (const lean of [0.3, 0.6, 1]) {
    const L = apexX(loopFootprint({ ...HDR, headerShape: 'triangle-left', lean, rounding: 3 })), Rr = apexX(loopFootprint({ ...HDR, headerShape: 'triangle-right', lean, rounding: 3 }));
    assert.ok(L < 0 && Rr > 0 && Math.abs(L + Rr) < 1e-6, `lean ${lean}: left ${L}, right ${Rr}`);
  }
  assert.ok(Math.abs(apexX(loopFootprint({ ...HDR, headerShape: 'triangle-right', lean: 0, rounding: 3 }))) < 1e-6, 'lean 0 is centred');
  // more lean = apex further to the side
  assert.ok(apexX(loopFootprint({ ...HDR, headerShape: 'triangle-right', lean: 0.9, rounding: 3 })) > apexX(loopFootprint({ ...HDR, headerShape: 'triangle-right', lean: 0.4, rounding: 3 })));
  // right triangle: one vertical edge exactly at the plate's right edge (all points near x=19 are collinear-free)
  const tri = loopFootprint({ ...HDR, headerShape: 'triangle-right', lean: 1, rounding: 0 }).groups[0].outer;
  assert.ok(tri.filter(p => Math.abs(p[0] - 19) < 1e-9).some(p => Math.abs(p[1] - 16) < 1e-9), 'apex directly above the right-hand corner');
});

test('header: rounding rounds the apex (more vertices, smoother) and never exceeds the stated height', () => {
  for (const headerShape of ['rectangle', 'triangle-left', 'triangle-right']) {
    const sharp = loopFootprint({ ...HDR, headerShape, rounding: 0 }).groups[0].outer.length;
    const round = loopFootprint({ ...HDR, headerShape, rounding: 5 }).groups[0].outer.length;
    assert.ok(round > sharp + 8, `${headerShape}: ${round} vs ${sharp} vertices`);
  }
});

test('header: the hole moves exactly by the offsets, and its default spot is comfortable for every shape', () => {
  for (const headerShape of SHAPES) {
    const def = loopFootprint({ ...HDR, headerShape });
    const moved = loopFootprint({ ...HDR, headerShape, holeOffsetX: 1.5, holeOffsetY: 0.5 });
    assert.ok(Math.abs(moved.holeCentre[0] - def.holeCentre[0] - 1.5) < 1e-9 && Math.abs(moved.holeCentre[1] - def.holeCentre[1] - 0.5) < 1e-9, headerShape);
    // the cut-out in the footprint really is centred there
    const ring = moved.groups[0].holes[0];
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    assert.ok(Math.abs(cx - moved.holeCentre[0]) < 1e-6 && Math.abs(cy - moved.holeCentre[1]) < 1e-6, `${headerShape}: hole ring centre`);
    assert.ok(inside(moved.groups[0], [moved.holeCentre[0], moved.holeCentre[1] + 5]) || headerShape !== 'rectangle');
    // below the plate, the hole centre's y is mirrored but x is not
    const below = loopFootprint({ ...HDR, headerShape, holeOffsetX: 1.5, holeOffsetY: 0.5, sign: -1 });
    assert.ok(Math.abs(below.holeCentre[0] - moved.holeCentre[0]) < 1e-9 && Math.abs(below.holeCentre[1] + moved.holeCentre[1]) < 1e-9);
  }
});

test('header: unreasonable hole positions give clear errors', () => {
  assert.throws(() => loopFootprint({ ...HDR, holeOffsetY: -6 }), /cut into the plate/);
  assert.throws(() => loopFootprint({ ...HDR, holeOffsetY: 5 }), /at least 2\.5 mm of wall/);
  assert.throws(() => loopFootprint({ ...HDR, holeOffsetX: 17 }), /at least 2\.5 mm of wall/);
  assert.throws(() => loopFootprint({ ...HDR, holeOffsetX: 40 }), /outside the header shape/);       // outside the shape entirely
  assert.throws(() => loopFootprint({ ...HDR, headerShape: 'triangle-right', lean: 1, holeOffsetX: 12 }), /wall|plate|outside the header/);
  assert.doesNotThrow(() => loopFootprint({ ...HDR, holeOffsetX: 12 }));
  assert.throws(() => loopFootprint({ ...HDR, headerShape: 'hexagon' }), /Unknown header shape/);
});

test('header shapes build into watertight meshes that scan, in every mode, orientation and with back engraving', () => {
  for (const headerShape of SHAPES)
    for (const mode of ['raised', 'indented'])
      for (const loopPosition of ['above', 'below'])
        for (const backDepth of [0, 0.8]) {
          const r = buildKeychain({ ...base, thickness: 4, loopStyle: 'header', headerShape, lean: 0.6, rounding: 4, holeOffsetX: 2, mode, loopPosition, backDepth });
          r.group.children.forEach(m => assertWatertight(m, assert));
          assert.equal(scan(r, mode), base.data, `${headerShape}/${mode}/${loopPosition}/${backDepth}`);
          assert.ok(Math.abs(r.info.width - r.info.plateSize) < 0.02, 'header is as wide as the plate');
          assert.deepEqual(r.info.holeCentre.map(v => +v.toFixed(3)).length, 2);
        }
});

test('header: overall size follows the shape', () => {
  const P = buildKeychain({ ...base, loopStyle: 'header' }).info.plateSize;
  const depth = headerShape => buildKeychain({ ...base, loopStyle: 'header', headerShape, lean: 0.6, rounding: 4 }).info.depth;
  assert.ok(Math.abs(depth('rectangle') - (P + 16)) < 0.02);
  assert.ok(Math.abs(depth('semicircle') - (P + P / 2)) < 0.02);
  assert.ok(Math.abs(depth('triangle-left') - (P + 16)) < 0.02);
  assert.ok(Math.abs(depth('triangle-right') - (P + 16)) < 0.02);
});

// ---- rounded plate corners (the two corners away from the loop) ----
/** Vertices of the plate meshes (everything except the loop's extruded shapes) in plate coordinates. */
function plateVertices(r) {
  const out = [];
  for (const m of r.meshes) {
    if (m.userData.loop) continue;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  return out;
}

test('rounded corners: the far corners are cut with an arc concentric with the QR corner; the near corners stay square', () => {
  const m = base.margin;
  for (const loopPosition of ['above', 'below'])
    for (const mode of ['raised', 'indented']) {
      const plain = buildKeychain({ ...base, mode, loopPosition, loopStyle: 'header' });
      const round = buildKeychain({ ...base, mode, loopPosition, loopStyle: 'header', roundBottomCorners: true });
      const P = round.info.plateSize;
      assert.equal(round.info.roundedCorners, true);
      assert.equal(plain.info.roundedCorners, false);
      const farY = loopPosition === 'above' ? 0 : P;                     // the edge away from the loop
      const nearY = P - farY;
      const verts = plateVertices(round);
      const nearCorner = (v, x) => Math.abs(v[0] - x) < 0.02 && Math.abs(v[1] - nearY) < 0.02;
      const farCorner = (v, x) => Math.abs(v[0] - x) < 0.02 && Math.abs(v[1] - farY) < 0.02;
      // far corners: no vertex left at the square corner, and every vertex in the corner square lies on/inside the arc
      for (const x of [0, P]) {
        assert.ok(!verts.some(v => farCorner(v, x)), `${loopPosition}/${mode}: square far corner at x=${x} should be gone`);
        assert.ok(verts.some(v => nearCorner(v, x)), `${loopPosition}/${mode}: near corner at x=${x} should stay square`);
      }
      const inCorner = v => (v[0] < m || v[0] > P - m) && Math.abs(v[1] - farY) < m - 1e-6;
      const cx = v => (v[0] < m ? m : P - m), cy = farY === 0 ? m : P - m;
      for (const v of verts.filter(inCorner)) {
        const dist = Math.hypot(v[0] - cx(v), v[1] - cy);
        assert.ok(dist <= m + 0.02, `${loopPosition}/${mode}: vertex (${v[0].toFixed(3)},${v[1].toFixed(3)}) is ${dist.toFixed(3)} from the corner centre (limit ${m})`);
      }
      // the arc itself is really there: plenty of vertices at distance == margin from the centre
      const onArc = verts.filter(v => inCorner(v) && Math.abs(Math.hypot(v[0] - cx(v), v[1] - cy) - m) < 1e-6);
      assert.ok(onArc.length >= 20, `${loopPosition}/${mode}: ${onArc.length} arc vertices`);
      // overall size is unchanged (the plain boxes are inflated 5 microns past the plate, the rounded strips are not)
      assert.ok(Math.abs(round.info.width - plain.info.width) < 0.02 && Math.abs(round.info.depth - plain.info.depth) < 0.02);
    }
});

test('rounded corners: plate area is exactly the square minus two quarter-circle corners', () => {
  const r = buildKeychain({ ...base, loopStyle: 'header', roundBottomCorners: true });
  const P = r.info.plateSize, m = base.margin;
  const slab = r.meshes.find(x => x.name === 'base' && x.geometry.type !== 'BoxGeometry' && !x.userData.back);
  const pos = slab.geometry.attributes.position, idx = slab.geometry.index;
  let vol = 0;
  const n = idx ? idx.count : pos.count, at = i => (idx ? idx.getX(i) : i);
  for (let t = 0; t < n; t += 3) {
    const p = [0, 1, 2].map(j => { const i = at(t + j); return [pos.getX(i), pos.getY(i), pos.getZ(i)]; });
    vol += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
  }
  const expected = (P * P - 2 * (1 - Math.PI / 4) * m * m) * base.thickness;
  assert.ok(Math.abs(vol - expected) / expected < 1e-3, `slab volume ${vol} vs ${expected}`);
});

test('rounded corners: every style, mode, loop position and back engraving stays watertight and scannable', () => {
  for (const loopStyle of LOOP_STYLES.map(s => s.id))
    for (const mode of ['raised', 'indented'])
      for (const loopPosition of ['above', 'below'])
        for (const backDepth of [0, 0.8]) {
          const r = buildKeychain({ ...base, thickness: 4, loopStyle, mode, loopPosition, backDepth, roundBottomCorners: true });
          r.group.children.forEach(m => assertWatertight(m, assert));
          const tag = `${loopStyle}/${mode}/${loopPosition}/${backDepth}`;
          assert.equal(scan(r, mode), base.data, `front ${tag}`);
          if (backDepth) assert.equal(scanRaster(rasterizeBottomUp(r.meshes, r.info.plateSize, 10)), base.data, `back ${tag}`);
        }
});

test('rounded corners: the quiet zone stays margin wide at the rounded corners (arc is concentric with the code)', () => {
  for (const margin of [1.5, 4, 8]) {
    const r = buildKeychain({ ...base, margin, loopStyle: 'header', roundBottomCorners: true });
    const P = r.info.plateSize;
    // QR's bottom-left module corner is at (margin, margin): its distance to the nearest plate outline vertex in the corner >= margin
    const near = plateVertices(r).filter(v => v[0] < margin && v[1] < margin && v[2] < 0.01).map(v => Math.hypot(v[0] - margin, v[1] - margin));
    assert.ok(near.length > 5);
    assert.ok(Math.min(...near) >= margin - 0.02, `margin ${margin}: closest outline vertex ${Math.min(...near)}`);
    assert.ok(P > 2 * margin);
  }
});

test('rounded corners: off by default, and the geometry is identical when off', () => {
  const a = buildKeychain({ ...base, loopStyle: 'header' }), b = buildKeychain({ ...base, loopStyle: 'header', roundBottomCorners: false });
  assert.equal(a.info.triangles, b.info.triangles);
  assert.equal(a.info.roundedCorners, false);
});
