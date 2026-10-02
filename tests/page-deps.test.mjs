// Copyright (c) 2025 cmutnik
// Node resolves bare imports (`three`, `jsqr`...) from node_modules, so a page that forgets to list one in its import
// map passes every other test and then fails to load in the browser. This walks each tool page's module graph and
// checks every bare import is covered by that page's import map.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const toolsDir = path.join(root, 'tools');
const pages = fs.readdirSync(toolsDir).map(d => path.join(toolsDir, d, 'index.html')).filter(f => fs.existsSync(f));

function importMap(html) {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]).imports : {};
}
function imports(src) {
  const out = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}
const covered = (spec, map) => spec in map || Object.keys(map).some(k => k.endsWith('/') && spec.startsWith(k));

test('every tool page has at least one module script', () => {
  assert.ok(pages.length >= 3, `found ${pages.length} pages`);
});

for (const page of pages) {
  const tool = path.basename(path.dirname(page));
  test(`tool "${tool}": every bare import in its module graph is in the page's import map`, () => {
    const html = fs.readFileSync(page, 'utf8');
    const map = importMap(html);
    const entries = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(m => path.join(path.dirname(page), m[1]));
    assert.ok(entries.length, 'page has a module script');
    const seen = new Set(), bare = new Map(), queue = [...entries];
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      assert.ok(fs.existsSync(file), `${path.relative(root, file)} exists`);
      for (const spec of imports(fs.readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) queue.push(path.resolve(path.dirname(file), spec));
        else if (!bare.has(spec)) bare.set(spec, path.relative(root, file));
      }
    }
    for (const [spec, from] of bare) assert.ok(covered(spec, map), `"${spec}" (imported by ${from}) is missing from the import map of tools/${tool}/index.html`);
    // and nothing unused is listed, so pages don't load libraries they don't need
    for (const key of Object.keys(map)) assert.ok([...bare.keys()].some(s => s === key || (key.endsWith('/') && s.startsWith(key))), `import map entry "${key}" is not used by tools/${tool}`);
  });
}
