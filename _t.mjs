import fs from 'node:fs'; import { JSDOM } from 'jsdom';
globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { parseMesh } = await import('./shared/js/mesh-import.js');
const { partStats } = await import('./tools/mesh-modifier/geometry.js');
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f); const t0 = Date.now();
  const parts = await parseMesh(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  console.log(f.split('/').pop(), parts.length, 'parts', Date.now() - t0, 'ms');
  const by = {}; for (const p of parts) { const k = (p.color || 'none') + ' slot ' + (p.slot || '-'); by[k] = (by[k] || 0) + p.indices.length / 3; }
  console.log(by);
  console.log(parts.slice(0, 4).map(p => [p.name, p.color, p.slot, p.indices.length / 3, p.group]));
}
