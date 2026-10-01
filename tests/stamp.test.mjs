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
    const xml = execFileSync('unzip', ['-p', file, '3D/3dmodel.model']).toString();
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
