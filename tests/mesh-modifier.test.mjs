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
  await assert.rejects(parseMesh("thing.ply", new ArrayBuffer(0)), /\.stl, \.3mf or \.obj/);
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

// ---------- lay flat, inside-out ----------
const { flipPart, layFlatAngles } = await import('../tools/mesh-modifier/geometry.js');

test('lay flat: a box saved on its side or at any angle ends up resting on its largest face', () => {
  const part = box(0, 0, 0, 40, 20, 6);                                        // largest face is 40 x 20
  for (const rotate of [[0, 0, 0], [90, 0, 0], [0, 90, 0], [37, 123, -58], [180, 0, 33]]) {
    const angles = layFlatAngles([part], { rotate });
    const r = transformParts([part], { rotate: angles });
    near(r.size[2], 6, `rotate ${rotate}: 6 mm tall`);
  }
});

test('lay flat: works through a mirror, and gives nothing for an empty model', () => {
  const part = box(0, 0, 0, 40, 20, 6);
  const mirror = [true, false, true];
  const angles = layFlatAngles([part], { rotate: [90, 30, 0], mirror });
  near(transformParts([part], { rotate: angles, mirror }).size[2], 6, 'mirrored and laid flat');
  assert.equal(layFlatAngles([{ ...part, indices: new Uint32Array(0) }], {}), null);
});

test('flipPart turns an inside-out part the right way round', () => {
  const b = box(0, 0, 0, 10, 10, 10), inside = flipPart(b);
  assert.ok(partStats(inside).volume < 0 && partStats(b).volume > 0);
  near(partStats(flipPart(inside)).volume, 1000, 'flipped back');
  assert.equal(partStats(inside).openEdges, 0);
});

// ---------- 3D cuts (manifold-3d) ----------
const { cutHole, cutText, splitModel } = await import('../tools/mesh-modifier/boolean3d.js');
const volume = parts => parts.reduce((s, p) => s + partStats(p).volume, 0);
const closed = parts => parts.every(p => partStats(p).openEdges === 0 && partStats(p).volume > 0);
const within = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tolerance ${tol})`);
const slab = () => transformParts([box(0, 0, 0, 40, 20, 10, '#CC2222', 'Slab')], {}).parts;      // 8000 mm3, centred, 10 tall
const ring = (x, y, w, h) => ({ outer: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], holes: [] });

test('hole: through the model, part-way down, and missing the model', async () => {
  const r = 2.5, circle = Math.PI * r * r;
  const through = await cutHole(slab(), { x: 0, y: 0, diameter: 5 });
  assert.ok(through.touched && closed(through.parts));
  within(volume(through.parts), 8000 - circle * 10, 8000 * 0.005, 'through hole removes pi r^2 x 10');
  const blind = await cutHole(slab(), { x: 5, y: 3, diameter: 5, depth: 4 });
  within(volume(blind.parts), 8000 - circle * 4, 8000 * 0.005, 'blind hole 4 mm deep');
  const miss = await cutHole(slab(), { x: 100, y: 0, diameter: 5 });
  assert.equal(miss.touched, false);
  await assert.rejects(cutHole(slab(), { x: 0, y: 0, diameter: 0.2 }), /at least 1 mm/);
});

test('hole: only the parts it touches are re-meshed, colours and names kept', async () => {
  const a = transformParts([box(0, 0, 0, 20, 20, 10, '#CC2222', 'A'), box(30, 0, 0, 50, 20, 10, '#2244CC', 'B')], {}).parts;
  const out = await cutHole(a, { x: a[0].positions[0] + 10, y: 0, diameter: 4 });
  assert.equal(out.parts.length, 2);
  assert.equal(out.parts[1], a[1], 'untouched part passes through as is');
  assert.deepEqual(out.parts.map(p => [p.name, p.color]), [['A', '#CC2222'], ['B', '#2244CC']]);
});

test('cut: an open (not watertight) part gives a readable error', async () => {
  const bad = slab();
  bad[0] = { ...bad[0], indices: bad[0].indices.slice(0, 33) };
  await assert.rejects(cutHole(bad, { x: 0, y: 0, diameter: 5 }), /not a closed \(watertight\) solid/);
});

test('engraved text: cuts the given outline to the given depth, letter counters stay open', async () => {
  const parts = slab(), square = ring(-5, -5, 10, 10);
  const out = await cutText(parts, [square], 8, 11);
  assert.ok(closed(out));
  within(volume(out), 8000 - 100 * 2, 1, 'a 10 x 10 pocket 2 mm deep');
  const donut = { outer: square.outer, holes: [ring(-2, -2, 4, 4).outer] };
  within(volume(await cutText(parts, [donut], 8, 11)), 8000 - (100 - 16) * 2, 1, 'the island inside the ring is kept');
});

test('split: both halves laid out for printing, with pegs and sockets', async () => {
  const parts = slab();
  const r = await splitModel(parts, { z: 4, keep: 'both', pegs: true, pegDiameter: 5, pegHeight: 3, clearance: 0.25, gap: 6 });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.parts.map(p => p.name), ['Slab', 'Alignment pegs', 'Slab']);
  assert.ok(closed(r.parts));
  const [lo, pegs, up] = r.parts.map(p => bounds(p));
  near(lo.min[2], 0, 'lower on the bed'); near(up.min[2], 0, 'upper dropped to the bed, cut face down');
  near(up.max[2], 6, 'upper is 10 - 4 = 6 tall');
  near(pegs.min[2], 3.5, 'pegs sink 0.5 mm into the lower half'); near(pegs.max[2], 7, 'and stand 3 mm above the cut (z = 4 + 3)');
  assert.ok(up.min[0] - lo.max[0] >= 5.99, `halves are at least the gap apart: ${up.min[0] - lo.max[0]}`);
  const all = boundsOfParts(r.parts);
  near((all.min[0] + all.max[0]) / 2, 0, 'centred');
  // volume: the slab, plus two pegs (3 mm above the cut + 0.5 mm sunk in), minus two sockets (radius 2.75, 3.74 mm into the upper half)
  const pegVolume = Math.PI * 2.5 ** 2 * 3.5 * 2, socketVolume = Math.PI * 2.75 ** 2 * 3.74 * 2;
  within(volume(r.parts), 8000 + pegVolume - socketVolume, 15, 'volume balances');
});

test('split: keep one half, and the checks', async () => {
  const lower = await splitModel(slab(), { z: 4, keep: 'lower' });
  within(volume(lower.parts), 3200, 1, 'lower half'); near(bounds(lower.parts[0]).max[2], 4, 'lower is 4 tall');
  const upper = await splitModel(slab(), { z: 4, keep: 'upper' });
  within(volume(upper.parts), 4800, 1, 'upper half'); near(bounds(upper.parts[0]).min[2], 0, 'dropped to the bed');
  await assert.rejects(splitModel(slab(), { z: 0.1, keep: 'both' }), /between 0\.5 and/);
  await assert.rejects(splitModel(slab(), { z: 10, keep: 'both' }), /between 0\.5 and/);
  const thin = await splitModel(slab(), { z: 8, keep: 'both', pegs: true, pegHeight: 4 });
  assert.ok(thin.warnings.some(w => /too thin/.test(w)));
  const tiny = await splitModel(transformParts([box(0, 0, 0, 6, 6, 10)], {}).parts, { z: 5, keep: 'both', pegs: true, pegDiameter: 5 });
  assert.ok(tiny.warnings.some(w => /too small for alignment pegs/.test(w)));
});

test('split: a multi-part model is cut at one plane, each part keeping its colour', async () => {
  const parts = transformParts([box(0, 0, 0, 20, 20, 10, '#CC2222', 'A'), box(0, 0, 10, 20, 20, 20, '#2244CC', 'B')], {}).parts;
  const r = await splitModel(parts, { z: 5, keep: 'both' });
  assert.deepEqual(r.parts.map(p => p.color), ['#CC2222', '#CC2222', '#2244CC']);
  assert.ok(closed(r.parts));
});

// ---------- repair ----------
const { repairPart, describeRepair } = await import('../tools/mesh-modifier/repair.js');
const dropTriangles = (part, list) => ({ ...part, indices: Uint32Array.from(Array.from(part.indices).filter((_, i) => !list.includes(Math.floor(i / 3)))) });
const soupToPart = (soup, name = 'soup') => { const positions = Float32Array.from(soup); return { name, color: null, positions, indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) }; };

test('repair: a missing face (two triangles) is filled and the volume comes back', () => {
  const broken = dropTriangles(box(0, 0, 0, 10, 10, 10), [2, 3]);               // the top face
  assert.ok(partStats(broken).openEdges > 0);
  const { part, report } = repairPart(broken);
  assert.equal(report.closed, true); assert.equal(report.filledHoles, 1); assert.equal(report.openAfter, 0);
  near(partStats(part).volume, 1000, 'volume'); assert.match(describeRepair('Box', report), /filled 1 hole.*closed solid/);
});

test('repair: unwelded copies of the same corner (a seam) are merged', () => {
  const soup = soupOf(box(0, 0, 0, 10, 10, 10)).map((v, i) => (i % 3 === 0 ? v + (i % 7) * 1e-4 : v));   // tiny differences: not identical, not welded
  const p = soupToPart(soup);
  assert.ok(partStats(p).openEdges > 0, 'every triangle is on its own');
  const { part, report } = repairPart(p, { tolerance: 0.01 });
  assert.equal(report.closed, true); assert.equal(report.mergedVertices, 36 - 8);
  within(partStats(part).volume, 1000, 0.1, 'volume (the corners were nudged by up to 0.0006 mm)');
});

test('repair: flipped triangles and a whole inside-out part are turned round', () => {
  const b = box(0, 0, 0, 10, 10, 10), flipped = b.indices.slice();
  for (const t of [0, 5, 9]) { const k = flipped[t * 3 + 1]; flipped[t * 3 + 1] = flipped[t * 3 + 2]; flipped[t * 3 + 2] = k; }
  let r = repairPart({ ...b, indices: flipped });
  assert.equal(r.report.closed, true); assert.equal(r.report.flippedTriangles, 3); near(partStats(r.part).volume, 1000, 'three flipped triangles');
  r = repairPart(flipPart(b));
  assert.equal(r.report.closed, true); near(partStats(r.part).volume, 1000, 'inside-out');
  assert.equal(repairPart(b).report.flippedTriangles, 0, 'a good part is not touched');
});

test('repair: degenerate and duplicated triangles are dropped', () => {
  const b = box(0, 0, 0, 10, 10, 10);
  const extra = Uint32Array.from([...b.indices, 0, 0, 1, 2, 2, 2, ...b.indices.slice(0, 3)]);   // two degenerate + one duplicate
  const { part, report } = repairPart({ ...b, indices: extra });
  assert.equal(report.removedTriangles, 3); assert.equal(report.closed, true); assert.equal(partStats(part).triangles, 12);
});

test('repair: a concave (L-shaped) hole and a patch on a sphere are filled with the right shape', () => {
  const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
  const shape = new THREE.Shape(L.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false }).toNonIndexed();
  const full = weldSoup(Array.from(geo.attributes.position.array), 'L'), expected = partStats(full).volume;
  const top = []; for (let t = 0; t < full.indices.length / 3; t++) if ([0, 1, 2].every(k => Math.abs(full.positions[full.indices[t * 3 + k] * 3 + 2] - 5) < 1e-6)) top.push(t);
  assert.ok(top.length >= 4, 'the L has a multi-triangle cap');
  const r = repairPart(dropTriangles(full, top));
  assert.equal(r.report.closed, true); near(partStats(r.part).volume, expected, 'L prism volume restored exactly (the hole is flat)');

  const sphere = weldSoup(Array.from(new THREE.SphereGeometry(10, 24, 16).toNonIndexed().attributes.position.array), 'ball');
  const patch = Array.from({ length: 6 }, (_, i) => 100 + i);                    // a few neighbouring triangles somewhere
  const holey = dropTriangles(sphere, patch), s = repairPart(holey);
  assert.equal(s.report.closed, true, describeRepair('ball', s.report));
  const v = partStats(s.part).volume, whole = partStats(sphere).volume;
  assert.ok(v > whole * 0.9 && v < whole * 1.1, `sphere volume ${v} vs ${whole}`);
});

test('repair: holes that are too large, and meshes that cannot be closed, are reported and not claimed fixed', () => {
  const broken = dropTriangles(box(0, 0, 0, 10, 10, 10), [2, 3]);
  const big = repairPart(broken, { maxHoleEdges: 3 });
  assert.equal(big.report.closed, false); assert.equal(big.report.skippedHoles, 1);
  assert.match(describeRepair('Box', big.report), /remain.*too large or too tangled/);
  const lone = { name: 'sheet', color: null, positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) };   // a single triangle: filling gives a flat double skin, zero volume
  assert.equal(repairPart(lone).report.closed, false);
});

test('repair: a repaired model can then be cut', async () => {
  const broken = dropTriangles(slab()[0], [2, 3]);
  await assert.rejects(cutHole([broken], { x: 0, y: 0, diameter: 5 }), /not a closed/);
  const { part } = repairPart(broken);
  const cut = await cutHole([part], { x: 0, y: 0, diameter: 5 });
  assert.ok(cut.touched && closed(cut.parts));
});

// ---------- filament slots ----------
const { assignSlots } = await import('../tools/mesh-modifier/geometry.js');

test('slots: parts of one colour share a slot, explicit slots are kept and not reused', () => {
  assert.deepEqual(assignSlots([{ color: '#AA0000' }, { color: '#00AA00' }, { color: '#aa0000' }]), [1, 2, 1]);
  assert.deepEqual(assignSlots([{ color: '#AA0000' }, { color: '#00AA00', slot: 1 }, { color: null }]), [2, 1, 3]);
  assert.deepEqual(assignSlots([{ color: null }, { color: null }]), [1, 1]);
});

test('slots: export writes an explicit slot, import reads it back; without one the order is used', async () => {
  const parts = [box(0, 0, 0, 20, 10, 5, '#CC2222', 'A'), box(5, 2, 5, 15, 8, 8, '#CC2222', 'B'), box(0, 0, 8, 10, 10, 12, '#2244CC', 'C')];
  const { group, parts: meta } = buildGroup(parts);
  const withSlots = meta.map((m, i) => ({ ...m, extruder: [2, 2, 1][i] }));
  const back = await parse3MF(await export3MF(group, { title: 't', parts: withSlots }).arrayBuffer());
  assert.deepEqual(back.map(p => p.slot), [2, 2, 1]);
  const plain = await parse3MF(await export3MF(buildGroup(parts).group, { title: 't', parts: buildGroup(parts).parts }).arrayBuffer());
  assert.deepEqual(plain.map(p => p.slot), [1, 2, 3], 'default: first part is slot 1, and so on');
});

test('slots: a part that is colour-split does not get one slot for all its colours', async () => {
  const cube = box(0, 0, 0, 1, 1, 1), tri = (t, p1) => `<triangle v1="${cube.indices[t * 3]}" v2="${cube.indices[t * 3 + 1]}" v3="${cube.indices[t * 3 + 2]}" pid="9" p1="${p1}"/>`;
  const verts = Array.from({ length: 8 }, (_, i) => `<vertex x="${cube.positions[i * 3]}" y="${cube.positions[i * 3 + 1]}" z="${cube.positions[i * 3 + 2]}"/>`).join('');
  const model = `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="9"><base name="a" displaycolor="#FF0000"/><base name="b" displaycolor="#0000FF"/></basematerials>
    <object id="1" name="Two" type="model"><mesh><vertices>${verts}</vertices><triangles>${Array.from({ length: 12 }, (_, t) => tri(t, t < 6 ? 0 : 1)).join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  const cfg = '<config><object id="1"><metadata key="extruder" value="3"/></object></config>';
  const parts = await parse3MF(zipStore([['3D/3dmodel.model', model], ['Metadata/model_settings.config', cfg]]));
  assert.equal(parts.length, 2); assert.deepEqual(parts.map(p => p.slot), [undefined, undefined]);
});

// ---------- engraving infill ----------
const { buildInfill } = await import('../tools/mesh-modifier/attach.js');

test('infill: it exactly fills the engraved pocket, so body + infill is the original solid', async () => {
  const parts = slab(), donut = { outer: ring(-5, -5, 10, 10).outer, holes: [ring(-2, -2, 4, 4).outer] }, depth = 2, top = 10;
  const body = await cutText(parts, [donut], top - depth, top + 1);
  const geo = buildInfill([donut], top - depth, depth);
  const mesh = new THREE.Mesh(geo); mesh.name = 'infill';
  assertWatertight(mesh, assert);
  geo.computeBoundingBox();
  near(geo.boundingBox.min.z, 8, 'starts at the pocket floor'); near(geo.boundingBox.max.z, 10, 'ends at the surface');
  const fill = weldSoup(Array.from(geo.attributes.position.array), 'fill');
  within(volume(body) + partStats(fill).volume, 8000, 1, 'body + infill = the original slab');
  // and the colour survives a 3MF round trip as its own part with its own slot
  const { group, parts: meta } = buildGroup(body, [{ name: 'infill', label: 'Engraving infill', color: '#111111', geometry: geo }]);
  meta.forEach((m, i) => { m.extruder = [1, 2][i]; });
  const back = await parse3MF(await export3MF(group, { title: 't', parts: meta }).arrayBuffer());
  assert.deepEqual(back.map(p => [p.name, p.color, p.slot]), [['Slab', '#CC2222', 1], ['Engraving infill', '#111111', 2]]);
});

// ---------- holes in any direction ----------
test('hole: sideways, from either end, and up from the bottom', async () => {
  const circle = Math.PI * 2 * 2;                                              // r = 2 mm: pi r^2 = 12.57 mm2
  const run = async opts => { const r = await cutHole(slab(), { diameter: 4, ...opts }); assert.ok(closed(r.parts), JSON.stringify(opts)); return r; };
  const alongX = await run({ axis: 'x', a: 0, b: 5 });                          // y = 0, height 5, through the 40 mm length
  within(volume(alongX.parts), 8000 - circle * 40, 8000 * 0.005, 'through along x');
  const alongY = await run({ axis: 'y', a: 5, b: 5 });                          // x = 5, height 5, through the 20 mm width
  within(volume(alongY.parts), 8000 - circle * 20, 8000 * 0.005, 'through along y');
  const fromRight = await run({ axis: 'x', from: 1, a: 0, b: 5, depth: 10 });
  const fromLeft = await run({ axis: 'x', from: -1, a: 0, b: 5, depth: 10 });
  within(volume(fromRight.parts), 8000 - circle * 10, 8000 * 0.005, 'blind from +X');
  within(volume(fromLeft.parts), 8000 - circle * 10, 8000 * 0.005, 'blind from -X');
  // the two blind holes are at opposite ends
  const slabs = slab();
  const near1 = (await cutHole(slabs, { axis: 'x', from: 1, a: 0, b: 5, diameter: 4, depth: 10 })).parts[0];
  assert.ok(partStats(near1).volume < 8000 && bounds(near1).max[0] > 19.99);
  const up = await run({ axis: 'z', from: -1, a: 0, b: 0, depth: 4 });
  within(volume(up.parts), 8000 - circle * 4, 8000 * 0.005, 'blind up from the bottom');
  const bb = bounds(up.parts[0]);
  assert.ok(bb.max[2] > 9.99 && bb.min[2] < 0.01, 'the outside of the slab is unchanged');
});

test('hole: a sideways hole above the model or beside it misses, and bad input is refused', async () => {
  assert.equal((await cutHole(slab(), { axis: 'x', a: 0, b: 20, diameter: 4 })).touched, false, 'above the model');
  assert.equal((await cutHole(slab(), { axis: 'y', a: 50, b: 5, diameter: 4 })).touched, false, 'beside the model');
  await assert.rejects(cutHole(slab(), { axis: 'q', a: 0, b: 0, diameter: 4 }), /Unknown hole direction/);
  await assert.rejects(cutHole(slab(), { axis: 'x', a: NaN, b: 5, diameter: 4 }), /where the hole goes/);
});

test('hole: a hole along x really is along x (the pocket is visible only from the sides)', async () => {
  const r = await cutHole(slab(), { axis: 'x', a: 0, b: 5, diameter: 4, depth: 6, from: 1 });
  // a blind hole 6 mm deep from +X: at x = 17 (inside) there is a hole at (y 0, z 5); at x = 10 (beyond its end) there is not
  const p = r.parts[0];
  const holeAt = x => Array.from(p.positions).some((v, i) => i % 3 === 0 && Math.abs(v - x) < 0.01);   // vertices at that x: only the hole's floor can be there
  assert.ok(holeAt(14), 'the hole ends at x = 14 (20 - 6): its floor is there');
  assert.ok(!holeAt(10), 'nothing was cut at x = 10');
});
