// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isCurrent } from '../shared/js/nav.js';

const root = path.join(import.meta.dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'registry.json'), 'utf8'));
const live = registry.filter(t => t.status === 'live');

test('isCurrent: matches the tool page with or without index.html, at any hosting path, and not its neighbours', () => {
  assert.equal(isCurrent('/tools/stamp/', '/tools/stamp/'), true);
  assert.equal(isCurrent('/tools/stamp/index.html', '/tools/stamp/'), true);
  assert.equal(isCurrent('/tools/stamp/', '/tools/stamp/index.html'), true);
  assert.equal(isCurrent('/etsy_shop_tool_generator/tools/stamp/', '/etsy_shop_tool_generator/tools/stamp/'), true);   // GitHub Pages project path
  assert.equal(isCurrent('/tools/qr-keychain/', '/tools/stamp/'), false);
  assert.equal(isCurrent('/', '/tools/stamp/'), false);
  assert.equal(isCurrent('/tools/stamp-extra/', '/tools/stamp/'), false, 'a tool whose name starts the same is not the same tool');
});

test('every page has the tool navigation and loads the nav script', () => {
  const pages = ['index.html', ...live.map(t => path.join('tools', t.path, 'index.html'))];
  assert.ok(live.length >= 3);
  for (const p of pages) {
    const html = fs.readFileSync(path.join(root, p), 'utf8');
    assert.match(html, /<nav id="toolnav"/, `${p}: nav element`);
    assert.match(html, /<script type="module" src="(\.\.\/)*(\.\/)?(shared\/js\/nav\.js|\.\.\/\.\.\/shared\/js\/nav\.js)"/, `${p}: loads nav.js`);
    assert.match(html, /class="brand" href="[^"]+"/, `${p}: brand link back to the menu`);
  }
});

test('every live tool in the registry has a page, a title and a unique path', () => {
  const paths = new Set();
  for (const t of live) {
    assert.ok(t.title && t.path, `${t.id}: title and path`);
    assert.ok(fs.existsSync(path.join(root, 'tools', t.path, 'index.html')), `${t.id}: tools/${t.path}index.html exists`);
    assert.ok(!paths.has(t.path), `${t.id}: duplicate path`);
    paths.add(t.path);
  }
});
