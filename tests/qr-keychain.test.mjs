// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import jsQR from 'jsqr';
import { buildKeychain, loopOutline } from '../tools/qr-keychain/geometry.js';
import { qrMatrix, gridRects, rasterizeTopDown } from '../shared/js/qr-plate.js';
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

test('the loop outline is a closed simple shape clockwise-over-the-top with the neck inside the circle', () => {
  for (const neckWidth of [4, 10, 15.9, 16, 20]) {
    const { pts } = loopOutline({ loopDiameter: 16, neckWidth, neckHeight: 2 });
    const ys = pts.map(p => p[1]), xs = pts.map(p => p[0]);
    assert.ok(Math.abs(Math.max(...ys) - (2 + 16)) < 1e-6, `top ${Math.max(...ys)} @${neckWidth}`);
    assert.ok(Math.abs(Math.min(...ys) + 0.2) < 1e-9);
    assert.ok(Math.max(...xs) <= Math.max(8, neckWidth / 2) + 1e-9);
  }
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
