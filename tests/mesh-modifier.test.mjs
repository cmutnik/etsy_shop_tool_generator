// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { unzip, zipStore } = await import('../shared/js/zip.js');
const { parseSTL, parse3MF, parseMesh, weldSoup } = await import('../shared/js/mesh-import.js');
const { transformParts, partStats, boundsOfParts, buildGroup } = await import('../tools/mesh-modifier/geometry.js');
const { buildTab, buildLabel, reach, surfaceHeights } = await import('../tools/mesh-modifier/attach.js');
const { export3MF, exportSTL } = await import('../shared/js/export.js');
const { testFont, assertWatertight } = await import('./helpers.mjs');

const font = await testFont();
const skipFont = font ? false : 'font not available offline';

/** An indexed box, outward-facing. */
function box(x0, y0, z0, x1, y1, z1, color = null, name = 'Box') {
  const positions = Float32Array.from([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
  const indices = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { name, color, positions, indices };
}
const soupOf = part => { const s = []; for (const i of part.indices) s.push(part.positions[i * 3], part.positions[i * 3 + 1], part.positions[i * 3 + 2]); return s; };
function binarySTL(part) {
  const soup = soupOf(part), n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
}
const bounds = part => boundsOfParts([part]);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, `${msg}: ${a} vs ${b}`);

// ---------- zip + STL ----------
test('unzip reads stored and deflated entries (and our own zipStore output)', async () => {
  const text = 'hello hello hello hello hello';
  const stored = unzip(zipStore([['a.txt', text], ['dir/b.bin', Uint8Array.from([1, 2, 3])]]));
  assert.deepEqual(stored.names.sort(), ['a.txt', 'dir/b.bin']);
  assert.equal(new TextDecoder().decode(await stored.read('a.txt')), text);
  // a deflated entry, as written by other tools: take zipStore's layout and swap in compressed data
  const comp = zlib.deflateRawSync(Buffer.from(text));
  const raw = zipStore([['a.txt', text]]);
  const dv = new DataView(raw.buffer);
  const hdr = new Uint8Array(30 + 5 + comp.length);
  hdr.set(raw.subarray(0, 35)); hdr.set(comp, 35);
  const l = new DataView(hdr.buffer);
  l.setUint16(8, 8, true); l.setUint32(18, comp.length, true);
  const cdOff = 30 + 5 + text.length, cd = raw.slice(cdOff, cdOff + 46 + 5), eocd = raw.slice(cdOff + 46 + 5);
  const c = new DataView(cd.buffer, cd.byteOffset); c.setUint16(10, 8, true); c.setUint32(20, comp.length, true);
  const e = new DataView(eocd.buffer, eocd.byteOffset); e.setUint32(16, hdr.length, true);
  const z = new Uint8Array(hdr.length + cd.length + eocd.length); z.set(hdr); z.set(cd, hdr.length); z.set(eocd, hdr.length + cd.length);
  assert.equal(new TextDecoder().decode(await unzip(z).read('a.txt')), text);
  assert.throws(() => unzip(Uint8Array.from([1, 2, 3])), /not a valid zip/);
  void dv;
});

test('STL: binary and ASCII both load as one welded, closed part', () => {
  const b = box(0, 0, 0, 20, 10, 5);
  const bin = parseSTL(binarySTL(b), 'cube');
  assert.equal(bin.positions.length / 3, 8);
  const st = partStats(bin);
  assert.equal(st.triangles, 12); assert.equal(st.openEdges, 0); near(st.volume, 1000, 'volume');
  const soup = soupOf(b);
  let ascii = 'solid cube\n';
  for (let t = 0; t < soup.length; t += 9) ascii += `facet normal 0 0 0\nouter loop\n${[0, 3, 6].map(k => `vertex ${soup[t + k]} ${soup[t + k + 1]} ${soup[t + k + 2]}`).join('\n')}\nendloop\nendfacet\n`;
  ascii += 'endsolid cube\n';
  const a = parseSTL(new TextEncoder().encode(ascii));
  assert.equal(partStats(a).triangles, 12);
  assert.throws(() => parseSTL(Uint8Array.from([1, 2, 3, 4])), /STL/);
});

test('STL: an open mesh is reported', () => {
  const b = box(0, 0, 0, 1, 1, 1);
  b.indices = b.indices.slice(0, 33);                                          // drop a triangle
  assert.ok(partStats(b).openEdges > 0);
});

// ---------- transforms ----------
test('transform: scale, rotate, centre and drop to the bed', () => {
  const part = box(10, 20, 30, 30, 30, 35);                                    // 20 x 10 x 5, floating off-centre
  let r = transformParts([part], { scale: [1, 1, 1] });
  near(r.min[2], 0, 'on bed'); near((r.min[0] + r.max[0]) / 2, 0, 'centred x'); near((r.min[1] + r.max[1]) / 2, 0, 'centred y');
  r = transformParts([part], { scale: [2, 2, 2] });
  assert.deepEqual(r.size.map(v => +v.toFixed(3)), [40, 20, 10]);
  assert.deepEqual(r.unscaledSize.map(v => +v.toFixed(3)), [20, 10, 5]);
  r = transformParts([part], { rotate: [90, 0, 0] });                          // lay it on its side: z becomes the old y
  assert.deepEqual(r.size.map(v => +v.toFixed(3)), [20, 5, 10]);
  near(r.min[2], 0, 'still on the bed after rotating');
  r = transformParts([part], { unit: 25.4 });                                  // file in inches
  near(r.size[0], 508, 'inches to mm');
  r = transformParts([part], { center: false, onBed: false });
  near(r.min[0], 10, 'left alone'); near(r.min[2], 30, 'left alone z');
});

test('transform: a mirror keeps the part closed and outward-facing', () => {
  const r = transformParts([box(0, 0, 0, 20, 10, 5)], { mirror: [true, false, false] });
  const s = partStats(r.parts[0]);
  assert.equal(s.openEdges, 0); assert.ok(Math.abs(s.volume - 1000) < 1e-3, `volume ${s.volume}`);
  const t = transformParts([box(0, 0, 0, 20, 10, 5)], { mirror: [true, true, true], rotate: [30, 40, 50] });
  assert.ok(partStats(t.parts[0]).volume > 0);
});

// ---------- 3MF ----------
test('3MF: export from the tool, import it back with parts, names and colours intact', async () => {
  const parts = [box(0, 0, 0, 20, 10, 5, '#CC2222', 'Body'), box(5, 2, 5, 15, 8, 8, '#2244CC', 'Lid')];
  const { group, parts: meta } = buildGroup(parts);
  const back = await parse3MF(await export3MF(group, { title: 'two', parts: meta }).arrayBuffer());
  assert.equal(back.length, 2);
  assert.deepEqual(back.map(p => p.name), ['Body', 'Lid']);
  assert.deepEqual(back.map(p => p.color), ['#CC2222', '#2244CC']);
  for (const [p, o] of back.map((p, i) => [p, parts[i]])) {
    const a = bounds(p), b = bounds(o);
    for (let k = 0; k < 3; k++) { near(a.min[k], b.min[k], 'min'); near(a.max[k], b.max[k], 'max'); }
    assert.equal(partStats(p).openEdges, 0);
  }
  // a single-part export has no colour and one part
  const one = await parse3MF(await export3MF(buildGroup([parts[0]]).group).arrayBuffer());
  assert.equal(one.length, 1);
});

test('3MF: units, build transforms, components and per-triangle colours', async () => {
  const cube = box(0, 0, 0, 1, 1, 1);
  const verts = [...cube.positions].reduce((s, v, i) => s + (i % 3 === 0 ? '<vertex x="' + v + '"' : i % 3 === 1 ? ' y="' + v + '"' : ' z="' + v + '"/>'), '');
  const tris = [...cube.indices].reduce((s, v, i) => {
    const t = Math.floor(i / 3);
    return i % 3 === 0 ? s + `<triangle v1="${v}"` + (t < 6 ? ' pid="9" p1="0"' : ' pid="9" p1="1"') : s + ` v${(i % 3) + 1}="${v}"` + (i % 3 === 2 ? '/>' : '');
  }, '');
  const model = `<?xml version="1.0"?><model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><resources>
    <basematerials id="9"><base name="red" displaycolor="#FF0000FF"/><base name="blue" displaycolor="#0000FF"/></basematerials>
    <object id="1" name="Cube" type="model"><mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh></object>
    <object id="2" name="Pair" type="model"><components><component objectid="1"/><component objectid="1" transform="1 0 0 0 1 0 0 0 1 3 0 0"/></components></object>
    </resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 5 0"/></build></model>`;
  const pkg = zipStore([['[Content_Types].xml', '<Types/>'], ['3D/3dmodel.model', model]]);
  const parts = await parse3MF(pkg);
  assert.equal(parts.length, 4, 'two instances x two colours');
  assert.deepEqual([...new Set(parts.map(p => p.color))].sort(), ['#0000FF', '#FF0000']);
  const all = boundsOfParts(parts);
  near(all.size[0], 25.4 * 4, 'x extent: second cube at +3 in, both 1 in wide');
  near(all.min[1], 5 * 25.4, 'build transform moved it +5 in in y');
  assert.ok(parts.every(p => p.indices.length === 18), 'each colour has 6 triangles');
});

test('3MF: errors are readable', async () => {
  await assert.rejects(parse3MF(Uint8Array.from([1, 2, 3])), /zip/);
  await assert.rejects(parse3MF(zipStore([['x.txt', 'hi']])), /no model/);
  await assert.rejects(parseMesh('thing.obj', new ArrayBuffer(0)), /\.stl or \.3mf/);
});

// ---------- hanging tab ----------
const tabOpts = { style: 'round', side: 'top', hole: 5, wall: 3, thickness: 2.5, overlap: 1.5, shift: 0 };
const modelParts = () => transformParts([box(0, 0, 0, 40, 20, 6)], {}).parts;      // 40 x 20 x 6, centred, on the bed

test('tab: reach sees a flat side with no vertex in the strip, and respects the height limit', () => {
  const parts = modelParts();
  near(reach(parts, [0, 1], -3, 3, 2.5), 10, 'top edge (y = +10)');
  near(reach(parts, [1, 0], -3, 3, 2.5), 20, 'right edge (x = +20)');
  near(reach(parts, [0, -1], -3, 3, 2.5), 10, 'front edge');
  assert.equal(reach(parts, [0, 1], 30, 33, 2.5), null, 'a strip beside the model is empty');
});

test('tab: every style and side builds a closed ring that overlaps the model edge and leaves the hole outside it', () => {
  const parts = modelParts();
  for (const style of ['round', 'rounded-square', 'hexagon', 'slot']) for (const side of ['top', 'bottom', 'left', 'right']) {
    const { geometry, info } = buildTab(parts, [40, 20, 6], { ...tabOpts, style, side });
    const mesh = new THREE.Mesh(geometry); mesh.name = `${style}-${side}`;
    assertWatertight(mesh, assert);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox, reachAt = { top: 10, bottom: 10, right: 20, left: 20 }[side];   // how far the model reaches along the tab's direction
    const out = { top: bb.min.y, bottom: -bb.max.y, right: bb.min.x, left: -bb.max.x }[side];
    near(out, reachAt - 1.5, `${style} ${side}: inner edge sinks 1.5 mm into the model`);
    near(bb.min.z, 0, 'on the bed'); near(bb.max.z, 2.5, 'thickness');
    assert.ok(info.center.every(Number.isFinite));
  }
});

test('tab: moving it along the edge, and the checks that protect the user', () => {
  const parts = modelParts();
  const moved = buildTab(parts, [40, 20, 6], { ...tabOpts, shift: 8 });
  near(moved.info.center[0], 8, 'shifted +x along the top edge (clockwise)');
  assert.throws(() => buildTab(parts, [40, 20, 6], { ...tabOpts, shift: 60 }), /Nothing of the model/);
  assert.throws(() => buildTab(parts, [40, 20, 6], { ...tabOpts, wall: 2, overlap: 1.5 }), /cut into the model/);
  assert.throws(() => buildTab(parts, [40, 20, 6], { ...tabOpts, hole: 1 }), /at least 2 mm/);
  assert.throws(() => buildTab(parts, [40, 20, 6], { ...tabOpts, wall: 1 }), /wall/);
  assert.throws(() => buildTab(parts, [40, 20, 6], { ...tabOpts, thickness: 0.5 }), /1 mm thick/);
  assert.throws(() => buildTab(parts, [40, 20, 6], { ...tabOpts, side: 'nowhere' }), /which edge/);
  const thick = buildTab(parts, [40, 20, 6], { ...tabOpts, thickness: 8 });
  assert.ok(thick.warnings.some(w => /thicker than the model/.test(w)));
  assert.deepEqual(moved.warnings, []);
});

test('tab: it sits on a round model too (the edge is found from the mesh, not its bounding box)', () => {
  const sphere = new THREE.SphereGeometry(10, 24, 16).toNonIndexed();
  const part = weldSoup(Array.from(sphere.attributes.position.array.map(v => v)), 'ball');
  const parts = transformParts([part], { center: true, onBed: true }).parts;
  const { info } = buildTab(parts, [20, 20, 20], { ...tabOpts, thickness: 3 });
  assert.ok(info.center[1] > 0 && info.center[1] < 12, `ring centre at y = ${info.center[1]}`);
});

// ---------- label ----------
test('label: raised text sits on the top surface, fused 0.3 mm into it', { skip: skipFont }, () => {
  const parts = modelParts();
  const { geometry, warnings, top } = buildLabel(parts, { font, text: 'Ana', height: 8, raise: 1, x: 0, y: 0 });
  geometry.computeBoundingBox();
  near(top, 6, 'top found'); near(geometry.boundingBox.min.z, 5.7, 'sinks 0.3'); near(geometry.boundingBox.max.z, 7, 'raised 1 mm');
  assert.deepEqual(warnings, []);
  assert.throws(() => buildLabel(parts, { font, text: 'Ana', height: 8, raise: 1, x: 100, y: 0 }), /no model under/i);
  assert.throws(() => buildLabel(parts, { font, text: ' ', height: 8, raise: 1, x: 0, y: 0 }), /Enter/);
  assert.throws(() => buildLabel(parts, { font, text: 'A', height: 1, raise: 1, x: 0, y: 0 }), /3 mm/);
  const hang = buildLabel(parts, { font, text: 'Wide label here', height: 8, raise: 1, x: 17, y: 0 });
  assert.ok(hang.warnings.some(w => /hangs past/.test(w)));
});

test('label: warns when the surface under the text is not flat', { skip: skipFont }, () => {
  const parts = [box(-20, -10, 0, 0, 10, 6), box(0, -10, 0, 20, 10, 9)];        // a 3 mm step in the middle
  const { warnings } = buildLabel(parts, { font, text: 'Step', height: 8, raise: 1, x: 0, y: 0 });
  assert.ok(warnings.some(w => /not flat/.test(w)), warnings.join('|'));
  assert.deepEqual(surfaceHeights(parts, [[-5, 0], [5, 0], [50, 0]]).map(v => v === null ? null : +v.toFixed(2)), [6, 9, null]);
});

// ---------- the whole pipeline ----------
test('model + tab + label export as a coloured multi-part 3MF and as one STL', { skip: skipFont }, async () => {
  const { parts } = transformParts([box(0, 0, 0, 40, 20, 6, '#CC2222', 'Body')], {});
  const tab = buildTab(parts, [40, 20, 6], tabOpts), label = buildLabel(parts, { font, text: 'Hi', height: 8, raise: 1, x: 0, y: 0 });
  const { group, parts: meta } = buildGroup(parts, [
    { name: 'tab', label: 'Hanging tab', color: '#EEAA22', geometry: tab.geometry }, { name: 'label', label: 'Label', color: '#111111', geometry: label.geometry }]);
  const back = await parse3MF(await export3MF(group, { title: 'x', parts: meta }).arrayBuffer());
  assert.deepEqual(back.map(p => p.name), ['Body', 'Hanging tab', 'Label']);
  assert.deepEqual(back.map(p => p.color), ['#CC2222', '#EEAA22', '#111111']);
  const stl = parseSTL(await exportSTL(group).arrayBuffer());
  assert.ok(partStats(stl).triangles > 100);
});
