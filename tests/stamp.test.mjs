// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { buildStamp, splitRegions } from '../tools/stamp/geometry.js';
import { export3MF, exportSTL, collectMesh, crc32 } from '../shared/js/export.js';
import { imageToGroups } from '../shared/js/image-trace.js';
import { testFont, baseStamp, assertWatertight } from './helpers.mjs';

const font = await testFont();
const skip = font ? false : 'font not available offline';

function logoFixture() {
  const w = 60, h = 40, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - 30, y - 20);
    if (d < 18 && d > 8) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
  }
  return imageToGroups({ data, width: w, height: h });
}

const assertWatertightMesh = m => assertWatertight(m, assert);

test('stamp: text stamp sits on the bed and parts are watertight', { skip }, () => {
  const { group, info } = buildStamp({ ...baseStamp, font });
  const box = new THREE.Box3().setFromObject(group);
  assert.equal(box.min.z, 0);
  assert.ok(Math.abs(box.max.z - 16.5) < 1e-6);
  assert.deepEqual(info.warnings, []);
  const relief = new THREE.Box3();
  group.children.filter(c => c.name === 'relief').forEach(c => relief.expandByObject(c));
  assert.equal(relief.min.z, 0);
  assert.ok(relief.max.x <= 25 - 1.5 + 1e-6 && relief.max.y <= 15 - 1.5 + 1e-6, 'relief stays inside the margin');
  group.children.forEach(assertWatertightMesh);
});

test('stamp: every layout and shape builds', { skip }, () => {
  const logo = logoFixture();
  for (const artMode of ['text', 'logo', 'logo-above', 'logo-left'])
    for (const shape of ['rect', 'ellipse'])
      for (const handle of ['none', 'knob', 'bar']) {
        const { group, info } = buildStamp({ ...baseStamp, font, logo, artMode, shape, handle, cornerRadius: shape === 'rect' ? 3 : 0 });
        assert.ok(group.children.some(c => c.name === 'relief'), `${artMode}/${shape}/${handle}`);
        assert.deepEqual(info.warnings.filter(w => !/^Effective font size/.test(w)), [], `${artMode}/${shape}/${handle}`); // small-text warning is legitimate in tight layouts
        group.children.forEach(assertWatertightMesh);
      }
});

test('stamp: logo layout needs a logo', { skip }, () => {
  const { info } = buildStamp({ ...baseStamp, font, artMode: 'logo', border: false });
  assert.ok(info.warnings.some(w => /logo/i.test(w)));
});

test('splitRegions: regions tile the area without overlap', () => {
  for (const mode of ['logo-above', 'logo-left']) {
    const r = splitRegions(mode, 40, 20, 0.5);
    const horizontal = mode === 'logo-left';
    const a = horizontal ? [r.logo.cx - r.logo.w / 2, r.logo.cx + r.logo.w / 2] : [r.logo.cy - r.logo.h / 2, r.logo.cy + r.logo.h / 2];
    const b = horizontal ? [r.text.cx - r.text.w / 2, r.text.cx + r.text.w / 2] : [r.text.cy - r.text.h / 2, r.text.cy + r.text.h / 2];
    assert.ok(a[1] <= b[0] + 1e-9 || b[1] <= a[0] + 1e-9, mode);
  }
});

test('export: 3MF is a valid zip with matching counts; STL has the right size', { skip }, () => {
  const { group } = buildStamp({ ...baseStamp, font });
  const { verts, tris } = collectMesh(group);
  assert.ok(verts.length / 3 < tris.length, 'vertices are welded');
  const blob = export3MF(group, { title: 'Test' });
  return blob.arrayBuffer().then(buf => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), '3mf-')), 't.3mf');
    fs.writeFileSync(file, Buffer.from(buf));
    assert.match(execFileSync('unzip', ['-t', file]).toString(), /No errors detected/);
    const xml = execFileSync('unzip', ['-p', file, '3D/3dmodel.model'], { maxBuffer: 1 << 28 }).toString();
    assert.equal((xml.match(/<vertex /g) || []).length, verts.length / 3);
    assert.equal((xml.match(/<triangle /g) || []).length, tris.length / 3);
    assert.match(xml, /unit="millimeter"/);
    return exportSTL(group).arrayBuffer().then(stl => {
      const tcount = new DataView(stl).getUint32(80, true);
      assert.equal(stl.byteLength, 84 + 50 * tcount);
    });
  });
});

test('crc32 known vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

// ---- two-part 3MF (face = slot 1, base + handle = slot 2) ----
const STAMP_PARTS = [{ name: 'relief', label: 'Stamp face (artwork)' }, { name: 'base', label: 'Base and handle', names: ['base', 'handle'] }];
const zRange = (group, names) => {
  const b = new THREE.Box3();
  group.children.filter(c => names.includes(c.name)).forEach(c => { c.geometry.computeBoundingBox(); b.union(c.geometry.boundingBox); });
  return [b.min.z, b.max.z];
};

test('stamp: separateParts makes the face and base meet exactly, with no overlap between them', { skip }, () => {
  const fused = buildStamp({ ...baseStamp, font }).group;
  const split = buildStamp({ ...baseStamp, font, separateParts: true }).group;
  // single mesh: relief sinks into the base by 0.2 so slicers union them
  assert.ok(zRange(fused, ['relief'])[1] > 1.5 + 0.1);
  assert.ok(zRange(fused, ['base'])[0] < 1.5 - 0.1);
  // two parts: relief ends at 1.5, base starts at 1.5
  const [rMin, rMax] = zRange(split, ['relief']), [bMin, bMax] = zRange(split, ['base']);
  assert.ok(Math.abs(rMin) < 1e-6 && Math.abs(rMax - 1.5) < 1e-5, `relief ${rMin}..${rMax}`);
  assert.ok(Math.abs(bMin - 1.5) < 1e-5 && Math.abs(bMax - 4.5) < 1e-5, `base ${bMin}..${bMax}`);
  split.children.forEach(assertWatertightMesh);
  // overall size unchanged
  assert.ok(Math.abs(new THREE.Box3().setFromObject(split).max.z - 16.5) < 1e-5);
});

test('stamp: 2-part 3MF has the face in slot 1 and base+handle in slot 2, nothing lost', { skip }, async () => {
  for (const handle of ['knob', 'bar', 'none'])
    for (const artMode of ['text', 'logo-above']) {
      const { group } = buildStamp({ ...baseStamp, font, handle, artMode, logo: artMode === 'text' ? null : logoFixture(), separateParts: true });
      const blob = export3MF(group, { title: 'Stamp', parts: STAMP_PARTS });
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), 's.3mf');
      fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
      assert.match(execFileSync('unzip', ['-t', file]).toString(), /No errors detected/);
      const model = execFileSync('unzip', ['-p', file, '3D/3dmodel.model'], { maxBuffer: 1 << 28 }).toString();
      const cfg = execFileSync('unzip', ['-p', file, 'Metadata/model_settings.config'], { maxBuffer: 1 << 28 }).toString();
      assert.match(cfg, /value="Stamp face \(artwork\)"\/>\s*<metadata key="extruder" value="1"/);
      assert.match(cfg, /value="Base and handle"\/>\s*<metadata key="extruder" value="2"/);
      const objs = [...model.matchAll(/<object id="(\d+)" name="([^"]*)" type="model" pid="1" pindex="(\d)"><mesh>(.*?)<\/mesh>/gs)];
      assert.equal(objs.length, 2);
      let total = 0;
      for (const [, , , , mesh] of objs) {
        const nv = (mesh.match(/<vertex /g) || []).length;
        const tr = [...mesh.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)];
        assert.ok(tr.length > 0);
        for (const t of tr) for (const i of t.slice(1)) assert.ok(+i < nv);
        total += tr.length;
      }
      assert.equal(total, collectMesh(group).tris.length / 3, `${handle}/${artMode}: every triangle is in exactly one part`);
      assert.match(model, /<base name="Stamp face \(artwork\)" displaycolor="#E8743BFF"\/><base name="Base and handle" displaycolor="#B9C0C9FF"\/>/);
    }
});

test('stamp: the plain 3MF is still a single mesh with no parts', { skip }, async () => {
  const { group } = buildStamp({ ...baseStamp, font });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), 's.3mf');
  fs.writeFileSync(file, Buffer.from(await export3MF(group, { title: 'Stamp' }).arrayBuffer()));
  assert.doesNotMatch(execFileSync('unzip', ['-p', file, '3D/3dmodel.model'], { maxBuffer: 1 << 28 }).toString(), /components|basematerials/);
});
