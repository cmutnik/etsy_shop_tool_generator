// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseOBJ, parseMTL, parseMesh, readModelFiles } = await import('../shared/js/mesh-import.js');
const { partStats, boundsOfParts } = await import('../tools/mesh-modifier/geometry.js');

/** A cube as OBJ text with quad faces, starting at vertex number `base`. */
function cube(x0, z0, size, base = 0, mat = null) {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(([x, y, z]) => `v ${x0 + x * size} ${y * size} ${z0 + z * size}`);
  const q = [[1, 4, 3, 2], [5, 6, 7, 8], [1, 2, 6, 5], [2, 3, 7, 6], [3, 4, 8, 7], [4, 1, 5, 8]].map(f => `f ${f.map(i => i + base).join(' ')}`);
  return [...v, ...(mat ? [`usemtl ${mat}`] : []), ...q].join('\n');
}
const enc = s => new TextEncoder().encode(s);
const MTL = 'newmtl Red\nKd 1 0 0\nnewmtl Blue\nKd 0 0 1\nnewmtl Skin\nKd 0.8 0.6 0.4\nmap_Kd skin.png\n';

test('parseMTL reads diffuse colours and notices textures', () => {
  const m = parseMTL(MTL);
  assert.equal(m.get('Red').color, '#FF0000');
  assert.equal(m.get('Blue').color, '#0000FF');
  assert.equal(m.get('Skin').color, '#CC9966');
  assert.equal(m.get('Skin').texture, true);
});

test('OBJ with two materials becomes two coloured, closed parts (quads split into triangles)', () => {
  const text = ['mtllib m.mtl', cube(0, 0, 10, 0, 'Red'), cube(20, 0, 10, 8, 'Blue')].join('\n');
  const parts = parseOBJ(enc(text), { mtl: MTL, name: 'two' });
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(p => p.name), ['Red', 'Blue']);
  assert.deepEqual(parts.map(p => p.color), ['#FF0000', '#0000FF']);
  for (const p of parts) { const s = partStats(p); assert.equal(s.triangles, 12, 'six quads = twelve triangles'); assert.equal(s.openEdges, 0); assert.ok(s.volume > 0); }
  assert.deepEqual(boundsOfParts(parts).size, [30, 10, 10]);
  assert.deepEqual(parts.notes.filter(n => /mtl|texture/.test(n)), [], 'nothing to warn about');
});

test('OBJ without its .mtl keeps the parts and says where the colours are', () => {
  const parts = parseOBJ(enc(['mtllib m.mtl', cube(0, 0, 10, 0, 'Red'), cube(20, 0, 10, 8, 'Blue')].join('\n')));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(p => p.color), [null, null]);
  assert.ok(parts.notes.some(n => /\.mtl/.test(n)));
});

test('OBJ: unknown materials, textures, negative indices and v/vt/vn faces', () => {
  const t = ['v 0 0 0', 'v 10 0 0', 'v 0 10 0', 'v 0 0 10', 'vt 0 0', 'vn 0 0 1', 'usemtl Skin', 'f 1/1/1 3/1/1 2/1/1', 'f 1//1 2//1 4//1', 'usemtl Ghost', 'f -4 -3 -1', 'f -4 -1 -2'].join('\n');
  const parts = parseOBJ(enc(t), { mtl: MTL });
  assert.equal(parts.length, 2);
  assert.equal(parts[0].color, '#CC9966');
  assert.equal(parts[1].color, null);
  assert.ok(parts.notes.some(n => /not described/.test(n)) && parts.notes.some(n => /textures/.test(n)));
  assert.equal(partStats(parts[0]).triangles + partStats(parts[1]).triangles, 4);
});

test('OBJ with vertex colours: one part per colour', () => {
  const lines = [];
  const add = (x0, rgb) => { const base = lines.filter(l => l.startsWith('v ')).length; [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]].forEach(p => lines.push(`v ${p[0] + x0} ${p[1]} ${p[2]} ${rgb.join(' ')}`)); [[1, 3, 2], [1, 2, 4], [2, 3, 4], [3, 1, 4]].forEach(f => lines.push(`f ${f.map(i => i + base).join(' ')}`)); };
  add(0, [255, 0, 0]); add(30, [0, 255, 0]);
  const parts = parseOBJ(enc(lines.join('\n')));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(p => p.color).sort(), ['#00FF00', '#FF0000']);
  for (const p of parts) assert.equal(partStats(p).openEdges, 0);
});

test('OBJ painted point by point keeps a palette of the asked-for number of colours', () => {
  // a cube whose vertex colours run from red (bottom) to blue (top)
  const verts = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
  const lines = verts.map(([x, y, z]) => `v ${x} ${y} ${z} ${z ? '0 0 1' : '1 0 0'}`);
  for (const f of [[1, 4, 3, 2], [5, 6, 7, 8], [1, 2, 6, 5], [2, 3, 7, 6], [3, 4, 8, 7], [4, 1, 5, 8]]) lines.push(`f ${f.join(' ')}`);
  const cube = parseOBJ(enc(lines.join('\n')), { colors: 3 });
  assert.ok(cube.length >= 2 && cube.length <= 3, `${cube.length} colour parts`);
  assert.ok(cube.every(p => /^#[0-9A-F]{6}$/.test(p.color) && p.group === 'obj-colours'), 'all coloured, all one group');
  assert.equal(cube.reduce((n, p) => n + partStats(p).triangles, 0), 12, 'no triangle lost');
  assert.deepEqual(cube.painted, { colors: cube.length });
  assert.ok(cube.notes.some(n => /Colours to keep/.test(n)));

  // more than a thousand shades: reduced to the number asked for, not rejected
  const many = [];
  for (let i = 0; i < 1200; i++) many.push(`v ${i % 40} ${Math.floor(i / 40)} ${(i * 7) % 5} ${(i % 200) / 200} ${(i % 7) / 7} ${(i % 3) / 3}`);
  for (let i = 0; i < 1100; i++) many.push(`f ${i + 1} ${i + 2} ${i + 3}`);
  for (const k of [2, 5, 8]) {
    const heavy = parseOBJ(enc(many.join('\n')), { colors: k });
    assert.equal(heavy.length, k);
    assert.equal(new Set(heavy.map(p => p.color)).size, k, 'distinct colours');
    assert.equal(heavy.reduce((n, p) => n + partStats(p).triangles, 0), 1100);
  }
});

test('OBJ groups without materials become parts; too many groups stay one part', () => {
  const two = ['g left', cube(0, 0, 10, 0), 'g right', cube(20, 0, 10, 8)].join('\n');
  assert.deepEqual(parseOBJ(enc(two)).map(p => p.name), ['left', 'right']);
  const many = Array.from({ length: 40 }, (_, i) => `g part${i}\n${cube(i * 12, 0, 10, i * 8)}`).join('\n');
  assert.equal(parseOBJ(enc(many)).length, 1);
});

test('OBJ errors are plain', () => {
  assert.throws(() => parseOBJ(enc('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9')), /missing vertex/);
  assert.throws(() => parseOBJ(enc('# nothing here')), /triangles/);
});

test('OBJ saved Y-up gets a hint to rotate', () => {
  const tall = parseOBJ(enc(cube(0, 0, 10, 0).replace(/^v (\S+) (\S+) (\S+)$/gm, (_, x, y, z) => `v ${x} ${+y * 5} ${z}`)));
  assert.ok(tall.notes.some(n => /Y up/.test(n)));
  assert.ok(!parseOBJ(enc(cube(0, 0, 10, 0))).notes.some(n => /Y up/.test(n)));
});

test('readModelFiles finds the .obj and the .mtl it names among several files', async () => {
  const obj = new File([['mtllib b.mtl', cube(0, 0, 10, 0, 'Red')].join('\n')], 'thing.obj');
  const wrong = new File(['newmtl Red\nKd 0 1 0\n'], 'a.mtl'), right = new File(['newmtl Red\nKd 1 0 0\n'], 'b.mtl');
  const r = await readModelFiles([wrong, obj, right]);
  assert.equal(r.file.name, 'thing.obj');
  assert.equal(r.parts[0].color, '#FF0000');
  assert.equal((await readModelFiles([obj, wrong])).parts[0].color, '#00FF00', 'the only .mtl is used when the name differs');
  await assert.rejects(readModelFiles([wrong]), /\.stl, \.3mf or \.obj/);
  assert.equal((await parseMesh('x.obj', enc(cube(0, 0, 10, 0)))).length, 1);
});
