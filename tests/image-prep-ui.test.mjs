// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PRESETS } from '../tools/image-prep/presets.js';

const html = fs.readFileSync(path.join(import.meta.dirname, '..', 'tools', 'image-prep', 'index.html'), 'utf8');
const control = id => { const m = html.match(new RegExp(`<(input|select)[^>]*\\bid="${id}"[^>]*>`)); return m && { tag: m[1], tagHtml: m[0] }; };   // the opening tag only
const optionsOf = id => { const m = html.match(new RegExp(`<select[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</select>`)); return m ? [...m[1].matchAll(/value="([^"]*)"/g)].map(x => x[1]) : []; };
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? m[1] : null; };

test('presets have unique ids, labels and a valid output mode', () => {
  assert.ok(PRESETS.length >= 6);
  assert.equal(new Set(PRESETS.map(p => p.id)).size, PRESETS.length);
  for (const p of PRESETS) { assert.ok(p.label.length > 5, p.id); assert.ok(['png', 'svg', 'colors', 'cutout'].includes(p.out), `${p.id}: ${p.out}`); assert.ok(Object.keys(p.set).length >= 3, p.id); }
});

test('every preset only sets controls that exist, with values those controls accept', () => {
  for (const p of PRESETS) for (const [id, value] of Object.entries(p.set)) {
    const c = control(id);
    assert.ok(c, `${p.id}: no control with id "${id}" in the page`);
    if (c.tag === 'select') assert.ok(optionsOf(id).includes(String(value)), `${p.id}: "${value}" is not an option of #${id} (${optionsOf(id)})`);
    else if (/type="checkbox"/.test(c.tagHtml)) assert.equal(typeof value, 'boolean', `${p.id}: #${id} is a checkbox`);
    else {
      assert.equal(typeof value, 'number', `${p.id}: #${id} takes a number`);
      const min = attr(c.tagHtml, 'min'), max = attr(c.tagHtml, 'max');
      if (min !== null) assert.ok(value >= Number(min), `${p.id}: #${id} = ${value} is below its minimum ${min}`);
      if (max !== null) assert.ok(value <= Number(max), `${p.id}: #${id} = ${value} is above its maximum ${max}`);
    }
  }
});

test('the page has the controls the new features need', () => {
  for (const id of ['preset', 'bgMode', 'brushSize', 'marksBias', 'clearMarks', 'printWidth', 'showThin', 'marks', 'thin', 'original', 'resultPng', 'resultSvg', 'smoothCurves']) assert.ok(control(id) || new RegExp(`id="${id}"`).test(html), `#${id}`);
  assert.ok(optionsOf('bgMode').includes('marks'));
  for (const z of ['fit', '1', '2', '4']) assert.match(html, new RegExp(`data-zoom="${z}"`));
  for (const b of ['subject', 'background', 'erase']) assert.match(html, new RegExp(`data-brush="${b}"`));
});

test('the original picture sits on a checkerboard (so light artwork on a transparent background is visible), errors show at the top, SVG is accepted', () => {
  assert.match(html, /class="frame checker" id="frameOrig"/);
  assert.match(html, /id="previewError"/);
  assert.match(html, /<input[^>]*id="file"[^>]*accept="[^"]*image\/svg\+xml/);
});
