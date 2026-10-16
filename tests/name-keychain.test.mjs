// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildNameKeychain, NAME_LOOPS } from '../tools/name-keychain/geometry.js';
import { export3MF, exportSTL } from '../shared/js/export.js';
import { unzip } from '../shared/js/zip.js';
import { assertWatertight, testFont } from './helpers.mjs';

const roboto = await testFont('roboto', 700), script = await testFont('pacifico', 400);
const skip = !roboto || !script ? 'fonts unavailable (offline)' : false;
const base = { text: 'Emma', fontSize: 14, lineSpacing: 1.2, backing: 'outline', margin: 2.5, cornerRadius: 3, thickness: 2.4, raise: 0.8, loopStyle: 'round', loopPosition: 'left', loopSize: 12, holeDiameter: 4.5 };
const build = o => buildNameKeychain({ font: roboto, ...base, ...o });

test('every backing and loop position is watertight, in two parts (plate + letters) unless there is no plate', { skip }, () => {
  for (const backing of ['outline', 'rectangle', 'none'])
    for (const loopPosition of ['left', 'top', 'none'])
      for (const font of [roboto, script]) {
        const r = build({ backing, loopPosition, font });
        r.group.children.forEach(m => assertWatertight(m, assert));
        assert.equal(r.group.children.length, backing === 'none' ? 1 : 2, `${backing} ${loopPosition}`);
      }
});

test('heights: the plate is `thickness` tall and the letters sit on it', { skip }, () => {
  const r = build({});
  const [plate, text] = r.group.children.map(m => new THREE.Box3().setFromObject(m));
  assert.ok(Math.abs(plate.min.z) < 1e-6 && Math.abs(plate.max.z - 2.4) < 1e-6);
  assert.ok(Math.abs(text.min.z - 2.4) < 1e-6 && Math.abs(text.max.z - 3.2) < 1e-6);
  assert.ok(Math.abs(r.info.height - 3.2) < 1e-5 && r.info.filamentChangeZ === 2.4);
  const flat = build({ backing: 'none' });
  assert.ok(Math.abs(flat.info.height - 3.2) < 1e-6, 'with no plate the letters are plate + letter height');
});

test('the loop goes on the chosen side and adds to that dimension only', { skip }, () => {
  const none = build({ loopPosition: 'none' }), left = build({ loopPosition: 'left' }), top = build({ loopPosition: 'top' });
  assert.ok(left.info.width > none.info.width + 8 && Math.abs(left.info.depth - none.info.depth) < 1.5, `left ${left.info.width} ${left.info.depth} vs ${none.info.width} ${none.info.depth}`);
  assert.ok(top.info.depth > none.info.depth + 8 && Math.abs(top.info.width - none.info.width) < 1.5);
  // the loop is on the left: the plate's left edge is the loop, so the hole centre is left of the letters
  const pos = left.group.children[0].geometry.attributes.position, bb = new THREE.Box3().setFromObject(left.group.children[0]);
  assert.ok(pos.count > 0 && bb.min.x < -left.info.width / 2 + 0.01);
});

test('the plate follows the letters by the margin: a bigger margin makes a bigger plate', { skip }, () => {
  const a = build({ margin: 2, loopPosition: 'none' }), b = build({ margin: 4, loopPosition: 'none' });
  assert.ok(Math.abs(b.info.width - a.info.width - 4) < 0.3, `${a.info.width} ${b.info.width}`);
  const rect = build({ backing: 'rectangle', margin: 3, loopPosition: 'none' });
  assert.ok(Math.abs(rect.info.width - (rect.info.letterWidth + 6)) < 0.05);
});

test('every loop style attaches, on both sides, and multi-line names work', { skip }, () => {
  for (const loopStyle of NAME_LOOPS) for (const loopPosition of ['left', 'top']) {
    const r = build({ loopStyle, loopPosition, loopSize: 14, holeDiameter: 4 });
    r.group.children.forEach(m => assertWatertight(m, assert));
  }
  const two = build({ text: 'Ann\nMarie', backing: 'outline' });
  two.group.children.forEach(m => assertWatertight(m, assert));
  assert.ok(two.info.depth > build({ text: 'Ann' }).info.depth);
});

test('bad input is refused with a message', { skip }, () => {
  assert.throws(() => build({ text: '  ' }), /Type a name/);
  assert.throws(() => build({ fontSize: 1 }), /at least 3 mm/);
  assert.throws(() => build({ raise: 0.1 }), /at least 1 mm/);
  assert.throws(() => build({ loopSize: 5, holeDiameter: 4.5 }), /wall/);
  assert.throws(() => buildNameKeychain({ ...base, font: null }), /font/);
  assert.match(build({ backing: 'none', loopPosition: 'none', text: 'i i' }).info.warnings.join(' '), /separate pieces/);
});

test('exports STL and a two-part 3MF with the letters in filament slot 2', { skip }, async () => {
  const r = build({});
  assert.ok(exportSTL(r.group).size > 84);
  const blob = export3MF(r.group, { title: 'Name keychain', parts: [{ name: 'base', label: 'Plate' }, { name: 'text', label: 'Letters' }] });
  const zip = unzip(new Uint8Array(await blob.arrayBuffer()));
  const cfg = new TextDecoder().decode(await zip.read('Metadata/model_settings.config'));
  assert.match(cfg, /value="1"[\s\S]*value="2"/);
});
