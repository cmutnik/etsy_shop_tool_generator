// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import jsQR from 'jsqr';
import { JSDOM } from 'jsdom';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { buildStand, buildStrip, centered } = await import('../tools/qr-stand/geometry.js');
const { iconGroups, titleGroups, layoutBanner, toOrigin } = await import('../tools/qr-stand/banner.js');
const { baseCrossSection, buildBase, seatMatrix } = await import('../tools/qr-stand/base.js');
const { ICON_NAMES } = await import('../shared/js/icons.js');
const { rasterizeTopDown } = await import('../shared/js/qr-plate.js');
const { export3MF } = await import('../shared/js/export.js');
const { boundsOf, signedArea } = await import('../shared/js/geometry-pure.js');
const { testFont, assertWatertight } = await import('./helpers.mjs');

const font = await testFont();
const skipFont = font ? false : 'font not available offline';

const base = {
  data: 'https://my.shop', errorCorrection: 'M', module: 2, margin: 8, mode: 'raised', thickness: 2.5, depth: 0.8, baseColor: '#ffffff', qrColor: '#111111',
  iconName: null, iconSize: 12, title: '', titleHeight: 8, bannerPosition: 'above', baseDepth: 40, baseHeight: 18, tilt: 15, slotDepth: 12, slotClearance: 0.3,
};
const area = g => Math.abs(signedArea(g.outer)) - g.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
const square = (x, y, s) => ({ outer: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]], holes: [] });

// ---------- icons ----------
test('every icon becomes shapes of the requested size with its corner at the origin', () => {
  assert.equal(ICON_NAMES.length, 6);
  for (const name of ICON_NAMES) for (const size of [8, 12, 30]) {
    const g = iconGroups(name, size), b = boundsOf(g);
    assert.ok(g.length >= 1, name);
    assert.ok(Math.abs(b.minX) < 1e-9 && Math.abs(b.minY) < 1e-9, `${name}: starts at the origin`);
    assert.ok(Math.max(b.width, b.height) <= size * 1.01 && Math.max(b.width, b.height) >= size * 0.75,   // a glyph may overshoot its box by a hair
       `${name} @${size}: ${b.width.toFixed(2)} x ${b.height.toFixed(2)}`);
  }
  assert.ok(iconGroups('Instagram', 12).some(g => g.holes.length >= 1), 'Instagram has holes (the camera ring)');
  assert.throws(() => iconGroups('Nope', 12), /Unknown icon/);
});

// ---------- banner layout ----------
test('layoutBanner: icon only is right-aligned, title only is centred, both are centred as a group', () => {
  const W = 66, icon = toOrigin([square(0, 0, 12)]), title = { groups: toOrigin([{ outer: [[0, 0], [30, 0], [30, 8], [0, 8]], holes: [] }]), width: 30, height: 8 };
  const only = layoutBanner({ plateWidth: W, icon, iconSize: 12 });
  assert.ok(Math.abs(boundsOf(only.groups).maxX - (W - 4)) < 1e-9, 'right edge at plate width minus side padding');
  assert.equal(only.height, 12 + 6);
  const t = layoutBanner({ plateWidth: W, title });
  const tb = boundsOf(t.groups);
  assert.ok(Math.abs((tb.minX + tb.maxX) / 2 - W / 2) < 1e-9);
  assert.equal(t.height, 8 + 6);
  const both = layoutBanner({ plateWidth: W, icon, iconSize: 12, title });
  const b = boundsOf(both.groups), ib = boundsOf([both.groups[0]]), tb2 = boundsOf([both.groups[1]]);
  assert.ok(Math.abs((b.minX + b.maxX) / 2 - W / 2) < 1e-9, 'centred as one group');
  assert.ok(Math.abs(tb2.minX - ib.maxX - 4) < 1e-9, '4 mm between icon and title');
  assert.equal(both.height, 12 + 6, 'as tall as the taller of the two plus padding');
  assert.deepEqual(layoutBanner({ plateWidth: W }), { groups: [], height: 0 });
});

test('layoutBanner: too-wide content shrinks (icon too) to fit inside the side padding', () => {
  const W = 50, icon = toOrigin([square(0, 0, 12)]), title = { groups: toOrigin([{ outer: [[0, 0], [80, 0], [80, 8], [0, 8]], holes: [] }]), width: 80, height: 8 };
  const r = layoutBanner({ plateWidth: W, icon, iconSize: 12, title });
  const b = boundsOf(r.groups);
  assert.ok(b.minX >= 4 - 1e-9 && b.maxX <= W - 4 + 1e-9, `content ${b.minX}..${b.maxX} inside ${4}..${W - 4}`);
  const ib = boundsOf([r.groups[0]]);
  assert.ok(ib.width < 12 - 1e-6, 'the icon shrank too, to stay in proportion');
  assert.ok(r.height < 12 + 6);
});

// ---------- base ----------
test('base cross-section: one piece, slot of the right width and lean, area = block minus the slot', () => {
  const o = { depth: 40, height: 18, thickness: 2.5, tilt: 15, clearance: 0.3, slotDepth: 12 };
  const sec = baseCrossSection(o);
  assert.equal(sec.groups.length, 1);
  assert.ok(Math.abs(sec.slotWidth - 3.1) < 1e-9);
  // the slot's long edges: width 3.1, running down and toward the front (x smaller) by 15 degrees from vertical
  const s = sec.slot;
  const edge = (a, b) => [b[0] - a[0], b[1] - a[1]];
  const long = [edge(s[1], s[2]), edge(s[3], s[0])].map(v => ({ v, len: Math.hypot(...v), ang: (Math.acos(Math.abs(v[1]) / Math.hypot(...v)) * 180) / Math.PI }));
  assert.ok(long.every(l => Math.abs(l.len - (12 + 2)) < 1e-6), 'cut length = depth + 2 mm overshoot');
  assert.ok(long.every(l => Math.abs(l.ang - 15) < 1e-6), 'tilted 15 degrees from vertical');
  assert.ok(long[0].v[0] > 0, 'going up from the buried end the slot moves back: the buried end is toward the front');
  const width = Math.hypot(...edge(s[0], s[1]));
  assert.ok(Math.abs(width - 3.1) < 1e-9);
  // area: the block minus the part of the slot that is inside it (the slot is a 3.1 x 12 strip below the top face, give or take the tilted top)
  const slotInside = 3.1 * 12;
  assert.ok(Math.abs(area(sec.groups[0]) - (40 * 18 - slotInside)) < 6, `area ${area(sec.groups[0])} vs ${40 * 18 - slotInside}`);
  // tilt 0 gives a straight vertical slot
  const upright = baseCrossSection({ ...o, tilt: 0 }).slot;
  assert.ok(Math.abs(upright[0][0] - upright[3][0]) < 1e-9, 'vertical slot at 0 degrees');
});

test('base cross-section: refuses slots that do not fit', () => {
  const o = { depth: 40, height: 18, thickness: 2.5, tilt: 15, clearance: 0.3, slotDepth: 12 };
  assert.throws(() => baseCrossSection({ ...o, slotDepth: 18 }), /less than the base height/);
  assert.throws(() => baseCrossSection({ ...o, slotDepth: 17 }), /too close to the base's (front|bottom)/);
  assert.throws(() => baseCrossSection({ ...o, tilt: 35, slotDepth: 16, depth: 20 }), /too close|cuts the base/);
  assert.doesNotThrow(() => baseCrossSection({ ...o, tilt: 35, slotDepth: 12 }));
});

test('base mesh: lies flat with x = width, y = depth, z = height; watertight; outward faces', () => {
  const mat = new THREE.MeshStandardMaterial();
  const { mesh } = buildBase({ width: 66, depth: 40, height: 18, thickness: 2.5, tilt: 15, clearance: 0.3, slotDepth: 12 }, mat);
  const b = new THREE.Box3().setFromObject(mesh);
  assert.deepEqual([b.min.x, b.min.y, b.min.z].map(v => +v.toFixed(6)), [0, 0, 0]);
  assert.deepEqual([b.max.x, b.max.y, b.max.z].map(v => +v.toFixed(5)), [66, 40, 18]);
  assertWatertight(mesh, assert);
  // volume = (block - slot) * width
  const sec = baseCrossSection({ depth: 40, height: 18, thickness: 2.5, tilt: 15, clearance: 0.3, slotDepth: 12 });
  const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index; let vol = 0;
  const n = idx ? idx.count : pos.count, at = i => (idx ? idx.getX(i) : i);
  for (let t = 0; t < n; t += 3) { const p = [0, 1, 2].map(j => { const i = at(t + j); return [pos.getX(i), pos.getY(i), pos.getZ(i)]; }); vol += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6; }
  assert.ok(Math.abs(vol - area(sec.groups[0]) * 66) / vol < 1e-3, `volume ${vol}`);
});

test('seat: the plate stands in the slot with its thickness centred, leans back by the tilt, and faces the front', () => {
  for (const tilt of [0, 10, 15, 30]) {
    const o = { depth: 40, height: 18, tilt, slotDepth: 12, thickness: 2.5 }, clearance = 0.3;
    const M = seatMatrix(o), t = (tilt * Math.PI) / 180;
    const world = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);          // (width, depth, height)
    // lean: going up the plate moves it back (greater depth) by sin(tilt) per unit
    const lo = world(0, 0, 1.25), hi = world(0, 30, 1.25);
    assert.ok(Math.abs((hi.y - lo.y) - 30 * Math.sin(t)) < 1e-9 && Math.abs((hi.z - lo.z) - 30 * Math.cos(t)) < 1e-9, `tilt ${tilt}`);
    // the plate's width axis is untouched
    assert.ok(Math.abs(world(10, 0, 0).x - world(0, 0, 0).x - 10) < 1e-9);
    // face (z up) points to the front (-y), back face toward the back
    assert.ok(world(0, 0, 2.5).y < world(0, 0, 0).y - 1e-9 || tilt === 90, 'face toward the front');
    // fit: the slot is centred on the line through the mouth (entry, H) with direction (sin t, cos t) in (depth, height);
    // every corner of the plate's buried edge must be within thickness/2 of that line, i.e. inside the slot with `clearance` to spare
    const entry = 40 * 0.35, n = [Math.cos(t), -Math.sin(t)];
    for (const z of [0, 2.5]) for (const y of [0, 12]) {
      const w = world(0, y, z), off = (w.y - entry) * n[0] + (w.z - 18) * n[1];
      assert.ok(Math.abs(off) <= 1.25 + 1e-9, `tilt ${tilt}: corner (y=${y}, z=${z}) is ${off.toFixed(3)} from the slot centre line`);
      assert.ok(1.25 + clearance - Math.abs(off) >= clearance - 1e-9, 'the clearance is left on both sides');
    }
    const det = M.determinant();
    assert.ok(Math.abs(det - 1) < 1e-9, 'a pure rotation + shift (no mirroring)');
  }
});

// ---------- the stand ----------
const configs = () => {
  const list = [];
  for (const mode of ['raised', 'indented']) for (const bannerPosition of ['above', 'below']) for (const iconName of [null, 'Etsy', 'Instagram', 'TikTok']) list.push({ ...base, mode, bannerPosition, iconName });
  return list;
};

test('stand: every configuration builds into watertight meshes with the right sizes', () => {
  for (const o of configs()) {
    const r = buildStand(o), tag = `${o.mode}/${o.bannerPosition}/${o.iconName}`;
    r.plate.traverse(c => { if (c.isMesh) assertWatertight(c, assert); });
    assertWatertight(r.base, assert);
    const P = 25 * 2 + 16;
    assert.ok(Math.abs(r.info.plateWidth - P) < 1e-9, tag);
    assert.ok(Math.abs(r.info.baseSize[0] - P) < 1e-6 && Math.abs(r.info.baseSize[1] - 40) < 1e-6 && Math.abs(r.info.baseSize[2] - 18) < 1e-6, `${tag}: base size`);
    const b = new THREE.Box3().setFromObject(r.plate);
    assert.ok(Math.abs(b.min.x) < 0.02 && Math.abs(b.min.y) < 0.02 && Math.abs(b.min.z) < 1e-5, `${tag}: plate sits at the origin on the bed`);
    const bannerH = o.iconName ? 12 + 6 : 0;
    assert.ok(Math.abs(r.info.plateHeight - (P + bannerH + r.info.shortfall)) < 0.03, `${tag}: height ${r.info.plateHeight} vs ${P + bannerH + r.info.shortfall}`);
  }
});

test('stand: a blank insertion tab always keeps the slot clear of artwork, and is only as long as needed', () => {
  for (const o of configs()) for (const slotDepth of [8, 12, 20]) {
    const r = buildStand({ ...o, slotDepth, baseHeight: Math.max(18, slotDepth + 4) }), tag = `${o.bannerPosition}/${o.iconName}/${slotDepth}`;
    assert.ok(r.info.insertionGap >= slotDepth + 2 - 1e-9, `${tag}: gap ${r.info.insertionGap}`);
    if (r.info.shortfall > 1e-6) assert.ok(Math.abs(r.info.insertionGap - (slotDepth + 2)) < 1e-9, `${tag}: no longer than needed`);
    if (o.mode === 'raised') {
      // the real geometry agrees: no raised artwork starts below the gap
      r.plate.updateMatrixWorld(true);
      let minY = Infinity;
      r.plate.traverse(c => { if (c.isMesh && c.name === 'qr') { const bb = new THREE.Box3().setFromObject(c); minY = Math.min(minY, bb.min.y); } });
      assert.ok(minY >= slotDepth + 2 - 0.02, `${tag}: lowest artwork at y=${minY}`);
    }
  }
  // with a roomy quiet zone and no banner no tab is needed at all
  const roomy = buildStand({ ...base, margin: 16, slotDepth: 8 });
  assert.equal(roomy.info.shortfall, 0);
});

test('stand: the QR code on the plate scans, in every configuration', () => {
  for (const o of configs()) {
    const r = buildStand(o);
    const img = rasterizeTopDown(r.qrMeshes, o.mode, r.info.plateWidth, 8), pad = 40, w = img.width + 2 * pad;
    const data = new Uint8ClampedArray(w * w * 4).fill(255);
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + pad) * w + pad) * 4);
    assert.equal(jsQR(data, w, w)?.data, o.data, `${o.mode}/${o.bannerPosition}/${o.iconName}`);
  }
});

test('stand: assembled preview has both parts, the plate leaning back inside the base', () => {
  const r = buildStand(base);
  assert.equal(r.assembled.children.length, 2);
  const [bm, seated] = r.assembled.children;
  assert.equal(bm.name, 'stand');
  const box = new THREE.Box3().setFromObject(r.assembled);
  // the plate pokes out above the base: assembled is taller than the base alone
  assert.ok(box.max.z > 18 + 20, `assembled height ${box.max.z}`);
  const seatedBox = new THREE.Box3().setFromObject(seated);
  assert.ok(seatedBox.min.z >= 18 - 12 - 0.5, 'the buried end reaches about slot depth below the top of the base');
  assert.ok(seatedBox.min.z < 18, 'and sits inside the base');
  // leaning back: the top of the plate is behind (greater depth than) the buried end
  assert.ok(seatedBox.max.y > seatedBox.min.y + 5);
});

test('stand: centered() puts the bounding box on the origin and the lowest point on the bed', () => {
  const r = buildStand(base);
  const c = centered(r.plate), b = new THREE.Box3().setFromObject(c);
  assert.ok(Math.abs(b.min.x + b.max.x) < 1e-6 && Math.abs(b.min.y + b.max.y) < 1e-6 && Math.abs(b.min.z) < 1e-6);
  assert.ok(r.plate.parent === null, 'the original was not modified');
});

test('stand: invalid input gives readable errors', () => {
  assert.throws(() => buildStand({ ...base, data: '' }), /Enter some text/);
  assert.throws(() => buildStand({ ...base, slotDepth: 18 }), /less than the base height/);
  assert.throws(() => buildStand({ ...base, iconName: 'Nope' }), /Unknown icon/);
  assert.throws(() => buildStand({ ...base, title: 'Hello' }), /font/);
  assert.throws(() => buildStand({ ...base, mode: 'indented', thickness: 2, depth: 1.8 }), /Engrave depth/);
});

test('stand: warnings for risky settings', () => {
  const w = o => buildStand({ ...base, data: 'https://my.shop', ...o }).info.warnings.join('\n');
  assert.equal(w({}), '');
  assert.match(w({ data: 'https://example.com' }), /sample link/);
  assert.match(w({ module: 1.0, margin: 8 }), /small for a stand/);
  assert.match(w({ margin: 2 }), /Quiet zone/);
  assert.match(w({ tilt: 30, baseDepth: 60 }), /prone to tipping/);
  assert.match(w({ iconName: 'Etsy', bannerPosition: 'below' }), /upper-right/);
});

test('stand: plate 3MF has the plate and QR as two parts (slots 1 and 2); base exports as STL-ready mesh', async () => {
  for (const mode of ['raised', 'indented']) {
    const r = buildStand({ ...base, mode, iconName: 'Etsy' });
    const blob = export3MF(r.plate, { title: 'plate', parts: [{ name: 'base', label: 'Plate' }, { name: 'qr', label: 'QR code and branding' }] });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qs-')), 'p.3mf');
    fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    assert.match(execFileSync('unzip', ['-t', file]).toString(), /No errors detected/);
    const cfg = execFileSync('unzip', ['-p', file, 'Metadata/model_settings.config']).toString();
    assert.match(cfg, /value="Plate"\/>\s*<metadata key="extruder" value="1"/);
    assert.match(cfg, /value="QR code and branding"\/>\s*<metadata key="extruder" value="2"/);
  }
});

// ---------- title text (needs a font) ----------
test('title: text is scaled to the requested height and sits in the banner', { skip: skipFont }, () => {
  const t = titleGroups(font, 'Handmade by Ana', 8), b = boundsOf(t.groups);
  assert.ok(Math.abs(b.height - 8) < 1e-6 && Math.abs(b.minX) < 1e-9 && Math.abs(b.minY) < 1e-9);
  assert.ok(Math.abs(t.width - b.width) < 1e-6);
  assert.throws(() => titleGroups(font, '   ', 8), /Enter a title/);
});

test('stand with a title: builds, is watertight, scans, banner is as tall as the text plus padding', { skip: skipFont }, () => {
  for (const mode of ['raised', 'indented']) for (const bannerPosition of ['above', 'below']) for (const iconName of [null, 'Instagram']) {
    const o = { ...base, mode, bannerPosition, iconName, title: 'Handmade by Ana', titleHeight: 8, font }, r = buildStand(o), tag = `${mode}/${bannerPosition}/${iconName}`;
    r.plate.traverse(c => { if (c.isMesh) assertWatertight(c, assert); });
    // 'Handmade by Ana' at 8 mm is wider than the plate, so it shrinks: the banner is no taller than the unshrunk size
    assert.ok(r.info.bannerHeight <= Math.max(8, iconName ? 12 : 0) + 6 + 1e-6 && r.info.bannerHeight > 6 + 4, `${tag}: banner ${r.info.bannerHeight}`);
    assert.ok(r.info.warnings.every(w => !/upper-right/.test(w)));
  }
  // a short title that fits keeps exactly the requested height
  const short = buildStand({ ...base, title: 'Ana', titleHeight: 8, font });
  assert.ok(Math.abs(short.info.bannerHeight - 14) < 1e-6, `banner ${short.info.bannerHeight}`);
  // a very long title shrinks to fit rather than overhanging the plate
  const r = buildStand({ ...base, title: 'A really quite long company name that cannot fit on the plate', titleHeight: 10, font });
  const b = new THREE.Box3().setFromObject(r.plate);
  assert.ok(b.min.x > -0.02 && b.max.x < r.info.plateWidth + 0.02, 'nothing hangs over the sides');
});

test('titles in very different fonts and with awkward text stay watertight and the code still scans', { skip: skipFont }, async () => {
  const fonts = [['roboto', 700], ['lobster', 400], ['bebas-neue', 400], ['special-elite', 400]];
  const titles = ['Ana', 'Studio 22 & Co.', 'ÅÉÎÕÜ ñ', 'LLLLLL IIIII', 'Etsy: hand-made!'];
  for (const [id, weight] of fonts) {
    const f = await testFont(id, weight);
    if (!f) continue;
    for (const title of titles) for (const mode of ['raised', 'indented']) {
      const r = buildStand({ ...base, mode, title, titleHeight: 7, font: f, iconName: title.length % 2 ? 'Etsy' : null });
      r.plate.traverse(c => { if (c.isMesh) assertWatertight(c, assert); });
      const img = rasterizeTopDown(r.qrMeshes, mode, r.info.plateWidth, 8), pad = 40, w = img.width + 2 * pad;
      const data = new Uint8ClampedArray(w * w * 4).fill(255);
      for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + pad) * w + pad) * 4);
      assert.equal(jsQR(data, w, w)?.data, base.data, `${id} / ${title} / ${mode}`);
    }
  }
});
