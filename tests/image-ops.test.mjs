// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { gaussianBlur, stretchContrast, thresholdMask, adaptiveMask, ditherMask, edgeMask, dilateMask, erodeMask, despeckle, cropToContent, prepare, maskToRGBA, maskToSvg } from '../shared/js/image-ops.js';
import { grayFromImage } from '../shared/js/image-trace.js';
import { signedArea } from '../shared/js/geometry2d.js';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { svgToGroups } = await import('../shared/js/svg-import.js');

const rgba = (w, h, fn) => { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4); return { data, width: w, height: h }; };
const gray = (w, h, fn) => Float32Array.from({ length: w * h }, (_, i) => fn(i % w, (i / w) | 0));
const sum = a => a.reduce((s, v) => s + v, 0);
const px = v => [v, v, v, 255];

test('grayFromImage: brightness vs transparency', () => {
  const img = rgba(4, 1, x => (x < 2 ? [10, 10, 10, 255] : [255, 255, 255, 0]));
  assert.equal(grayFromImage(img).source, 'alpha');
  assert.equal(grayFromImage(img, 'brightness').source, 'brightness');
  assert.deepEqual([...grayFromImage(img, 'alpha').gray], [0, 0, 255, 255]);
});

test('gaussianBlur keeps the average and smooths', () => {
  const w = 40, h = 40, g = gray(w, h, (x, y) => ((x + y) % 2 ? 255 : 0));
  const b = gaussianBlur(g, w, h, 2);
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(Math.abs(mean(b) - mean(g)) < 6, `mean ${mean(b)} vs ${mean(g)}`);
  assert.ok(Math.max(...b) - Math.min(...b) < 40, 'checkerboard is flattened');
  assert.equal(gaussianBlur(g, w, h, 0), g, 'sigma 0 is a no-op');
});

test('stretchContrast spreads a washed-out image over the full range', () => {
  const g = gray(100, 1, x => 100 + x * 0.5);   // 100..150
  const s = stretchContrast(g);
  assert.ok(Math.min(...s) <= 2 && Math.max(...s) >= 253, `${Math.min(...s)}..${Math.max(...s)}`);
  assert.equal(stretchContrast(gray(10, 1, () => 128)).length, 10, 'flat image is left alone');
});

test('adaptive threshold recovers text under uneven lighting where a global threshold fails', () => {
  const w = 120, h = 60;
  // lighting falls from 250 (left) to 70 (right); "ink" strokes are 55 darker than the local background
  const stroke = (x, y) => y % 10 < 3 && x > 8 && x < w - 8;
  const g = gray(w, h, (x, y) => 250 - (x / w) * 180 - (stroke(x, y) ? 55 : 0));
  const truth = i => stroke(i % w, (i / w) | 0);
  const score = m => { let hit = 0, miss = 0, fp = 0, total = 0; for (let i = 0; i < m.length; i++) { if (truth(i)) { total++; m[i] ? hit++ : miss++; } else if (m[i]) fp++; } return { recall: hit / total, fp: fp / (m.length - total) }; };
  const adaptive = score(adaptiveMask(g, w, h, { radius: 12, offset: 20 }));
  const global = score(thresholdMask(g, 128));
  assert.ok(adaptive.recall > 0.9 && adaptive.fp < 0.03, `adaptive ${JSON.stringify(adaptive)}`);
  assert.ok(global.recall < 0.6 || global.fp > 0.2, `a global threshold should fail here: ${JSON.stringify(global)}`);
});

test('dither keeps the overall tone', () => {
  const w = 60, h = 60;
  for (const [v, ink] of [[128, 0.5], [64, 0.75], [192, 0.25], [255, 0], [0, 1]]) {
    const frac = sum(ditherMask(gray(w, h, () => v), w, h)) / (w * h);
    assert.ok(Math.abs(frac - ink) < 0.04, `grey ${v}: ${frac} vs ${ink}`);
  }
});

test('edgeMask: a dark square gives a thin outline, nothing inside or outside', () => {
  const w = 80, h = 80, g = gray(w, h, (x, y) => (x >= 20 && x < 60 && y >= 20 && y < 60 ? 30 : 230));
  const e = edgeMask(g, w, h, { sigma: 1.2, sens: 0.6 });
  const n = sum(e);
  assert.ok(n > 120 && n < 260, `edge pixels ${n} (perimeter is 160)`);
  assert.equal(e[40 * w + 40], 0, 'interior is empty');
  assert.equal(e[5 * w + 5], 0, 'background is empty');
  // every edge pixel lies within 2px of the true boundary
  for (let i = 0; i < e.length; i++) if (e[i]) {
    const x = i % w, y = (i / w) | 0, dx = Math.min(Math.abs(x - 19.5), Math.abs(x - 59.5)), dy = Math.min(Math.abs(y - 19.5), Math.abs(y - 59.5));
    assert.ok(Math.min(dx, dy) <= 2.5, `edge pixel (${x},${y}) is off the boundary`);
  }
  assert.equal(sum(edgeMask(gray(w, h, () => 128), w, h)), 0, 'flat image has no edges');
});

test('dilate / erode change line width by twice the radius; despeckle and crop', () => {
  const w = 40, h = 20, m = new Uint8Array(w * h);
  for (let x = 5; x < 35; x++) for (let y = 9; y < 12; y++) m[y * w + x] = 1;      // 3 px thick line
  const d = dilateMask(m, w, h, 2), e = erodeMask(m, w, h, 1);
  const thickness = mask => { let c = 0; for (let y = 0; y < h; y++) c += mask[y * w + 20]; return c; };
  assert.equal(thickness(m), 3);
  assert.ok(thickness(d) >= 6 && thickness(d) <= 8, `dilated ${thickness(d)}`);
  assert.equal(thickness(e), 1, `eroded ${thickness(e)}`);
  // specks and holes
  const big = new Uint8Array(30 * 30);
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) big[y * 30 + x] = 1;   // 20x20 block
  big[15 * 30 + 15] = 0; big[15 * 30 + 16] = 0;                                    // 2 px hole
  big[1 * 30 + 1] = 1;                                                              // 1 px speck
  const clean = despeckle(big, 30, 30, { minInk: 4, minHole: 5 });
  assert.equal(clean[1 * 30 + 1], 0, 'speck removed');
  assert.equal(clean[15 * 30 + 15], 1, 'small hole filled');
  assert.equal(clean[10 * 30 + 10], 1, 'block kept');
  const keepHole = despeckle(big, 30, 30, { minInk: 4, minHole: 1 });
  assert.equal(keepHole[15 * 30 + 15], 0, 'hole larger than the limit stays');
  const c = cropToContent(clean, 30, 30, 2);
  assert.deepEqual([c.x0, c.y0, c.width, c.height], [3, 3, 24, 24]);
  const empty = cropToContent(new Uint8Array(100), 10, 10, 1);
  assert.equal(empty.width, 10);
});

test('prepare: methods, invert, options are applied', () => {
  const img = rgba(40, 40, (x, y) => px(x >= 10 && x < 30 && y >= 10 && y < 30 ? 40 : 220));
  const t = prepare(img, { method: 'threshold' });
  assert.equal(sum(t.mask), 400); assert.ok(t.threshold > 40 && t.threshold < 220);
  assert.equal(sum(prepare(img, { method: 'threshold', invert: true }).mask), 1600 - 400);
  assert.equal(sum(prepare(img, { method: 'threshold', threshold: 20 }).mask), 0);
  assert.equal(prepare(img, { method: 'threshold', crop: true, cropPad: 0 }).width, 20);
  assert.ok(sum(prepare(img, { method: 'edges', lineWidth: 1 }).mask) > 40);
  assert.ok(sum(prepare(img, { method: 'edges', lineWidth: 5 }).mask) > sum(prepare(img, { method: 'edges', lineWidth: 1 }).mask) * 2, 'thicker lines');
  // dithering preserves tone: ink = sum of (255 - value) / 255 over the image (the 220 background is ~14% ink)
  const tone = (400 * (255 - 40) + 1200 * (255 - 220)) / 255;
  assert.ok(Math.abs(sum(prepare(img, { method: 'dither' }).mask) - tone) < 40, `dither ${sum(prepare(img, { method: 'dither' }).mask)} vs ${tone}`);
  assert.equal(sum(prepare(img, { method: 'adaptive', adaptiveRadius: 15, adaptiveOffset: 10 }).mask) > 300, true);
});

test('maskToRGBA: ink, paper and transparent paper', () => {
  const d = maskToRGBA(Uint8Array.from([1, 0]), 2, 1, { ink: [10, 20, 30], paper: [0, 0, 0, 0] });
  assert.deepEqual([...d], [10, 20, 30, 255, 0, 0, 0, 0]);
});

const ringMask = () => { const w = 60, h = 40, m = new Uint8Array(w * h); for (let y = 5; y < 35; y++) for (let x = 8; x < 52; x++) if (!(x >= 20 && x < 40 && y >= 14 && y < 26)) m[y * w + x] = 1; return { m, w, h }; };
const pathD = svg => svg.match(/ d="([^"]+)"/)[1];
const pathArea = d => d.split('Z').filter(Boolean).map(s => { const pts = s.replace(/^M/, '').split(/[LQ]/).map(p => p.trim().split(/\s+/).map(Number)).map(p => p.slice(-2)); return signedArea(pts); });

test('maskToSvg: a block with a hole becomes one even-odd path whose area matches the pixels', () => {
  const { m, w, h } = ringMask();
  const { svg, shapes } = maskToSvg(m, w, h, { tolerance: 0.3 });
  assert.match(svg, /viewBox="0 0 60 40"/);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.equal(shapes, 2);
  const areas = pathArea(pathD(svg));
  assert.equal(areas.length, 2);
  const net = Math.abs(areas[0]) - Math.abs(areas[1]);
  assert.ok(Math.abs(net - sum(m)) / sum(m) < 0.01, `svg area ${net} vs ${sum(m)} px`);
  assert.ok(Math.abs(areas[0] + areas[1]) < Math.abs(areas[0]) , 'outer and hole wind in opposite directions');
  assert.match(maskToSvg(m, w, h, { color: '#ff0000', background: '#ffffff', scale: 2 }).svg, /fill="#ff0000"[\s\S]*width="120"|rect width="60" height="40" fill="#ffffff"/);
});

test('maskToSvg: smooth curves keep the area and add Q segments; specks are dropped', () => {
  const { m, w, h } = ringMask();
  m[1 * w + 1] = 1;
  const sharp = maskToSvg(m, w, h, { minArea: 6 }), smooth = maskToSvg(m, w, h, { minArea: 6, smooth: true });
  assert.equal(sharp.shapes, 2, 'speck dropped');
  assert.ok(!pathD(sharp.svg).includes('Q') && pathD(smooth.svg).includes('Q'));
  const net = s => { const a = pathArea(pathD(s)); return Math.abs(a[0]) - Math.abs(a[1]); };
  assert.ok(Math.abs(net(smooth.svg) - net(sharp.svg)) / net(sharp.svg) < 0.02, 'smoothing barely changes the area');
});

test('the SVG imports into the stamp tool: holes survive and the size matches', () => {
  const { m, w, h } = ringMask();
  for (const smooth of [false, true]) {
    const { groups, width, height } = svgToGroups(maskToSvg(m, w, h, { smooth }).svg, { ignoreWhite: true });
    assert.equal(groups.length, 1, `smooth ${smooth}`);
    assert.equal(groups[0].holes.length, 1);
    assert.ok(Math.abs(width - 44) < 1 && Math.abs(height - 30) < 1, `${width} x ${height}`);
  }
});

test('edge sensitivity decides whether a faint edge next to a strong one is kept', () => {
  const w = 120, h = 60;
  const picture = gray(w, h, x => (x < 30 ? 20 : x < 60 ? 240 : x < 90 ? 150 : 185));   // steps of 220, 90 and 35 levels
  const near = (e, x0) => { let c = 0; for (let y = 5; y < h - 5; y++) for (let x = x0 - 2; x <= x0 + 2; x++) c += e[y * w + x]; return c; };
  const detailed = edgeMask(picture, w, h, { sigma: 1.2, sens: 0.9 }), strict = edgeMask(picture, w, h, { sigma: 1.2, sens: 0.1 });
  for (const x of [30, 60, 90]) assert.ok(near(detailed, x) > 40, `high sensitivity finds the edge at x=${x} (${near(detailed, x)})`);
  assert.ok(near(strict, 30) > 40, 'low sensitivity still keeps the strong edge');
  assert.equal(near(strict, 90), 0, 'low sensitivity drops the faint edge');
  // noise on a flat field does not produce a forest of edges
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noisy = gray(w, h, () => 128 + (rnd() - 0.5) * 6);
  assert.ok(sum(edgeMask(noisy, w, h, { sigma: 1.6, sens: 0.3 })) < w * h * 0.04, 'flat noisy field stays mostly empty');
});

test('edgeMask on a soft, low-contrast picture (like a blurry photo) gives a sensible amount of line work', () => {
  const w = 160, h = 120;
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = Float32Array.from({ length: w * h }, () => rnd() * 255);
  const soft = gaussianBlur(noise, w, h, 6);                       // smooth blobs with low, varied contrast
  let lo = Infinity, hi = -Infinity; for (const v of soft) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const picture = soft.map(v => 90 + ((v - lo) / (hi - lo)) * 70);  // squeezed into 90..160: a washed-out picture
  const frac = s => sum(edgeMask(picture, w, h, { sigma: 1.4, sens: s })) / (w * h);
  assert.ok(frac(0.5) > 0.01 && frac(0.5) < 0.2, `default amount of edges ${frac(0.5)}`);
  assert.ok(frac(0.9) > frac(0.5) && frac(0.5) > frac(0.1), 'monotonic in sensitivity');
});

test('edge sensitivity: more detail finds more edges', () => {
  const w = 100, h = 100;
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = gray(w, h, (x, y) => (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 200 : 60 + rnd() * 40);
  const lo = sum(edgeMask(g, w, h, { sigma: 1.4, sens: 0.1 })), hi = sum(edgeMask(g, w, h, { sigma: 1.4, sens: 0.9 }));
  assert.ok(hi > lo, `${hi} vs ${lo}`);
});
