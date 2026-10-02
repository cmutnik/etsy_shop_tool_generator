// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { colorDistance, estimateBackground, removeBackground, quantize, smoothLabels, posterize, posterPreview, rgbToHex, CAP_FACTOR, subjectPieces } from '../shared/js/image-color.js';

let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rgba = (w, h, fn) => { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4); return { data, width: w, height: h }; };
const sum = a => a.reduce((s, v) => s + v, 0);
const jitter = (c, a = 6) => c.map(v => Math.max(0, Math.min(255, v + (rnd() - 0.5) * 2 * a)));
const cream = [244, 236, 220], red = [200, 40, 50];

/** A red disc (radius 30) on a cream background with a soft gradient and noise. Returns the picture and the disc. */
function discPicture({ eye = false } = {}) {
  const w = 100, h = 100, inDisc = (x, y) => (x - 50) ** 2 + (y - 50) ** 2 <= 900, inEye = (x, y) => eye && (x - 50) ** 2 + (y - 50) ** 2 <= 49;
  const img = rgba(w, h, (x, y) => {
    if (inEye(x, y)) return [...jitter(cream, 3), 255];
    if (inDisc(x, y)) return [...jitter(red, 8), 255];
    const g = (y / h) * 14;                                   // gentle lighting gradient
    return [...jitter([cream[0] - g, cream[1] - g, cream[2] - g], 4), 255];
  });
  return { img, w, h, inDisc, inEye };
}
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return i / u; };

test('colorDistance: zero for equal colours, larger for more different ones', () => {
  assert.equal(colorDistance(10, 20, 30, 10, 20, 30), 0);
  assert.ok(colorDistance(255, 255, 255, 0, 0, 0) > 600);
  assert.ok(colorDistance(244, 236, 220, 240, 232, 216) < colorDistance(244, 236, 220, 200, 40, 50));
});

test('estimateBackground finds the border colour; a busy border gets a low share', () => {
  const { img } = discPicture();
  const est = estimateBackground(img);
  assert.ok(colorDistance(...est.color, ...cream) < 40, `estimated ${est.color}`);
  assert.ok(est.share > 0.9);
  const busy = rgba(60, 60, () => [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), 255]);
  assert.ok(estimateBackground(busy).share < 0.3);
  assert.equal(estimateBackground(rgba(20, 20, () => [255, 255, 255, 0])), null, 'a transparent border has no colour');
});

test('removeBackground cuts out the subject (auto colour, noisy gradient background)', () => {
  const { img, inDisc, w, h } = discPicture();
  const r = removeBackground(img, { tolerance: 25, feather: 0 });
  const truth = Uint8Array.from({ length: w * h }, (_, i) => (inDisc(i % w, (i / w) | 0) ? 1 : 0));
  assert.ok(iou(r.subject, truth) > 0.97, `IoU ${iou(r.subject, truth)}`);
  assert.ok(colorDistance(...r.background, ...cream) < 40);
  assert.ok(Math.abs(r.removed - (1 - sum(truth) / (w * h))) < 0.03, `removed ${r.removed}`);
  // colours of the subject are untouched, the background becomes transparent
  const centre = (50 * w + 50) * 4;
  assert.deepEqual([...r.rgba.slice(centre, centre + 3)], [...img.data.slice(centre, centre + 3)]);
  assert.equal(r.rgba[3], 0, 'corner is transparent');
  assert.equal(r.rgba[centre + 3], 255, 'centre is opaque');
});

test('removeBackground: contiguous keeps an enclosed same-coloured area, non-contiguous removes it', () => {
  const { img, w, inEye } = discPicture({ eye: true });
  const eye = (50 * w + 50);
  assert.ok(inEye(50, 50));
  const keep = removeBackground(img, { tolerance: 25, feather: 0, contiguous: true });
  const drop = removeBackground(img, { tolerance: 25, feather: 0, contiguous: false });
  assert.equal(keep.alpha[eye], 255, 'the eye is part of the subject');
  assert.equal(drop.alpha[eye], 0, 'the same colour is removed everywhere');
});

test('removeBackground: tolerance, explicit colour, shrink and specks', () => {
  const { img, w, h } = discPicture();
  const area = o => sum(removeBackground(img, { feather: 0, ...o }).subject);
  assert.ok(area({ tolerance: 5 }) >= area({ tolerance: 25 }) && area({ tolerance: 25 }) >= area({ tolerance: 90 }), 'higher tolerance removes more');
  assert.ok(area({ tolerance: 90 }) < area({ tolerance: 5 }), 'and it actually changes');
  assert.ok(area({ shrink: 2 }) < area({ shrink: 0 }) * 0.9, 'shrink eats into the subject');
  const forced = removeBackground(img, { color: cream, tolerance: 25, feather: 0 });
  assert.ok(sum(forced.subject) > 2500 && sum(forced.subject) < 3200);
  const withSpeck = rgba(w, h, (x, y) => (x === 10 && y === 10 ? [200, 40, 50, 255] : (x - 50) ** 2 + (y - 50) ** 2 <= 900 ? [200, 40, 50, 255] : [...cream, 255]));
  assert.equal(removeBackground(withSpeck, { feather: 0, minSubject: 0 }).subject[10 * w + 10], 1);
  assert.equal(removeBackground(withSpeck, { feather: 0, minSubject: 5 }).subject[10 * w + 10], 0, 'floating speck removed');
});

test('removeBackground feather: soft edge inside the cut, no halo outside it', () => {
  const { img } = discPicture();
  const hard = removeBackground(img, { feather: 0 }), soft = removeBackground(img, { feather: 3 });
  let partial = 0, halo = 0;
  for (let i = 0; i < soft.alpha.length; i++) {
    if (soft.alpha[i] > 0 && soft.alpha[i] < 255) partial++;
    if (!hard.subject[i] && soft.alpha[i] > 0) halo++;
  }
  assert.ok(partial > 100, `${partial} semi-transparent edge pixels`);
  assert.equal(halo, 0, 'nothing outside the hard cut-out');
});

test('removeBackground keeps already-transparent pixels transparent and works on a subject touching the border', () => {
  // left 10 columns already transparent; a red subject touching the top border; cream everywhere else
  const img = rgba(40, 40, (x, y) => (x < 10 ? [0, 0, 0, 0] : x >= 18 && x < 30 && y < 14 ? [200, 40, 50, 255] : [...cream, 255]));
  const r = removeBackground(img, { feather: 0 });
  assert.equal(r.alpha[5 * 40 + 2], 0, 'transparent stays transparent');
  assert.equal(r.alpha[5 * 40 + 24], 255, 'subject touching the border is kept');
  assert.equal(r.alpha[30 * 40 + 24], 0, 'cream background removed');
});

// ---- posterize ----
function threeColour() {
  const w = 90, h = 60, cols = [[210, 40, 50], [40, 160, 70], [50, 70, 200]];
  const which = x => (x >= 10 && x < 30 ? 0 : x >= 35 && x < 55 ? 1 : x >= 60 && x < 80 ? 2 : -1);
  const img = rgba(w, h, (x, y) => (y >= 10 && y < 50 && which(x) >= 0 ? [...jitter(cols[which(x)], 14), 255] : [...jitter(cream, 6), 255]));
  return { img, w, h, cols, which, inShape: (x, y) => y >= 10 && y < 50 && which(x) >= 0 };
}

test('quantize finds the colours that are really in the picture', () => {
  const { img, cols } = threeColour();
  const { palette, labels, counts } = quantize(img, 4);
  assert.equal(palette.length, 4);
  for (const c of [...cols, cream]) assert.ok(palette.some(p => colorDistance(...p, ...c) < 30), `palette misses ${c}: ${JSON.stringify(palette)}`);
  assert.equal(sum(counts), img.width * img.height);
  assert.ok(labels.every(l => l < 4));
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(palette.every((c, i) => i === 0 || lum(c) >= lum(palette[i - 1])), 'palette is sorted dark to light');
  assert.deepEqual(quantize(img, 4).palette, palette, 'repeatable');
});

test('quantize: fewer distinct colours than asked for, and transparent pixels', () => {
  const two = rgba(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.equal(quantize(two, 6).palette.length, 2);
  const withHole = rgba(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : [255, 0, 0, 0]));
  const q = quantize(withHole, 3);
  assert.ok(q.labels[15] === 255 && q.labels[0] !== 255, 'transparent pixels have no label');
  assert.deepEqual(quantize(rgba(4, 4, () => [1, 2, 3, 0]), 3).palette, []);
});

test('smoothLabels removes isolated mislabelled pixels and keeps real regions', () => {
  const w = 30, h = 30, labels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 15; x < w; x++) labels[y * w + x] = 1;
  labels[5 * w + 5] = 1; labels[20 * w + 22] = 0; labels[10 * w + 10] = 255;
  const s = smoothLabels(labels, w, h, 1);
  assert.equal(s[5 * w + 5], 0); assert.equal(s[20 * w + 22], 1); assert.equal(s[10 * w + 10], 255);
  assert.equal(s[3 * w + 3], 0); assert.equal(s[3 * w + 25], 1);
});

test('posterize: one layer per ink colour, paper is not a layer, masks match the shapes and never overlap', () => {
  const { img, w, h, which, inShape } = threeColour();
  const p = posterize(img, { colors: 4, smooth: 1, paper: 'lightest', minInk: 6 });
  assert.equal(p.layers.length, 3);
  assert.equal(p.paper, 3);
  const shapes = [0, 1, 2].map(c => Uint8Array.from({ length: w * h }, (_, i) => (inShape(i % w, (i / w) | 0) && which(i % w) === c ? 1 : 0)));
  for (const layer of p.layers) {
    const best = Math.max(...shapes.map(s => iou(layer.mask, s)));
    assert.ok(best > 0.95, `layer ${layer.index} IoU ${best}`);
    assert.equal(layer.mask.length, w * h, 'same canvas for every layer');
  }
  for (let i = 0; i < w * h; i++) assert.ok(p.layers.reduce((s, l) => s + l.mask[i], 0) <= 1, 'a pixel belongs to one layer at most');
  assert.ok(p.layers.every(l => Math.abs(l.coverage - 0.2 * 0.667) < 0.02), 'each shape covers ~13% of the picture');
  assert.equal(posterize(img, { colors: 4, paper: 'none' }).layers.length, 4);
  assert.equal(posterize(img, { colors: 4, paper: 0 }).layers.length, 3);
});

test('posterize crop: every layer shares one crop (the union), so layers still line up', () => {
  const { img, w, h } = threeColour();
  const p = posterize(img, { colors: 4, crop: true, cropPad: 2, minInk: 6 });
  assert.ok(p.width < w && p.height < h);
  assert.deepEqual(p.layers.map(l => l.mask.length), p.layers.map(() => p.width * p.height));
  assert.equal(p.labels.length, p.width * p.height);
  assert.ok(Math.abs(p.width - (80 - 10 + 4)) <= 2 && Math.abs(p.height - (40 + 4)) <= 2, `${p.width} x ${p.height}`);
  assert.ok(p.crop.x0 >= 6 && p.crop.x0 <= 10);
});

test('posterPreview paints the palette; paper and transparent pixels use the paper colour', () => {
  const img = rgba(4, 1, (x) => (x === 0 ? [10, 10, 10, 255] : x === 1 ? [250, 250, 250, 255] : x === 2 ? [200, 0, 0, 255] : [0, 0, 0, 0]));
  const p = posterize(img, { colors: 3, smooth: 0, paper: 'lightest' });
  const d = posterPreview(p, { paperColor: [1, 2, 3, 255] });
  assert.deepEqual([...d.slice(4, 8)], [1, 2, 3, 255], 'paper');
  assert.deepEqual([...d.slice(12, 16)], [1, 2, 3, 255], 'transparent');
  assert.deepEqual([...d.slice(0, 4)], [10, 10, 10, 255]);
  assert.equal(rgbToHex([200, 0, 5]), '#c80005');
});

import { layersToSvg } from '../shared/js/image-color.js';
import { svgToGroups as svgToGroupsForLayers } from '../shared/js/svg-import.js';

test('layersToSvg: one SVG per layer plus a combined one, all with the same frame; fill can be overridden', async () => {
  const { img, w, h } = threeColour();
  const res = posterize(img, { colors: 4, minInk: 6 });
  const out = layersToSvg(res, { tolerance: 0.5 });
  assert.equal(out.layers.length, 3);
  for (const l of out.layers) { assert.match(l.svg, new RegExp(`viewBox="0 0 ${w} ${h}"`)); assert.ok(l.shapes >= 1); assert.ok(l.svg.includes(rgbToHex(l.color))); }
  assert.match(out.combined, new RegExp(`viewBox="0 0 ${w} ${h}"`));
  assert.equal((out.combined.match(/<path /g) || []).length, 3, 'one path per layer');
  for (const l of out.layers) assert.ok(out.combined.includes(rgbToHex(l.color)), 'each layer keeps its colour in the combined picture');
  const black = layersToSvg(res, { fill: '#000000' });
  assert.ok(black.layers.every(l => l.svg.includes('fill="#000000"')));
  // framed import: the three layers sit at their true relative positions in the stamp tool
  const { JSDOM } = await import('jsdom');
  globalThis.DOMParser = new JSDOM('').window.DOMParser;
  const centres = black.layers.map(l => { const g = svgToGroupsForLayers(l.svg, { frame: true }); assert.equal(g.width, w); assert.equal(g.height, h); const o = g.groups[0].outer; return o.reduce((s, p) => s + p[0], 0) / o.length; }).sort((a, b) => a - b);
  assert.ok(Math.abs(centres[1] - centres[0] - 25) < 1.5 && Math.abs(centres[2] - centres[1] - 25) < 1.5, `layer centres ${centres} should be 25 px apart`);
});

// ---- gradient following ----
function gradientPicture() {
  const w = 120, h = 100, inDisc = (x, y) => (x - 60) ** 2 + (y - 50) ** 2 <= 400;
  const img = rgba(w, h, (x, y) => {
    if (inDisc(x, y)) return [...jitter([120, 60, 40], 6), 255];
    const v = 238 - (y / h) * 70;                                // 238 at the top to 168 at the bottom: well beyond the tolerance
    return [...jitter([v, v - 4, v - 10], 5), 255];
  });
  return { img, w, h, inDisc };
}

test('gradient: a smooth background gradient is followed to the far edge, the subject is kept', () => {
  const { img, w, h, inDisc } = gradientPicture();
  const truth = Uint8Array.from({ length: w * h }, (_, i) => (inDisc(i % w, (i / w) | 0) ? 1 : 0));
  // this gradient drifts ~200 colour-distance units from the edge colour, so it needs tolerance 40 (drift limit = 1.8 x tolerance x 3)
  const plain = removeBackground(img, { tolerance: 40, feather: 0, gradient: false });
  const follow = removeBackground(img, { tolerance: 40, feather: 0, gradient: true });
  assert.ok(sum(plain.subject) > sum(truth) * 3, `without gradient following the darker lower background is kept (${sum(plain.subject)} px)`);
  assert.ok(iou(follow.subject, truth) > 0.97, `with it only the disc remains: IoU ${iou(follow.subject, truth)}`);
  assert.equal(follow.alpha[(h - 2) * w + 3], 0, 'bottom-left corner (far from the edge colour) is removed');
});

test('gradient: the drift limit stops a very large change even when every step is tiny (soft, blurry subjects must not be eaten)', () => {
  const { img, w, h, inDisc } = gradientPicture();
  const low = removeBackground(img, { tolerance: 25, feather: 0, gradient: true });       // limit ~135: the bottom of this gradient is ~198 away
  assert.ok(low.alpha[(h - 2) * w + 3] === 255, 'the far end of a large gradient is kept at low tolerance');
  assert.ok(low.alpha[3 * w + 3] === 0, 'near the edge colour it is still removed');
  const high = removeBackground(img, { tolerance: 40, feather: 0, gradient: true });
  assert.equal(high.alpha[(h - 2) * w + 3], 0, 'a higher tolerance raises the limit');
  assert.ok(inDisc(60, 50) && high.alpha[50 * w + 60] === 255);
  assert.equal(CAP_FACTOR, 1.8);
});

test('subjectPieces counts separate pieces and the largest one\'s share', () => {
  const w = 20, h = 10, s = new Uint8Array(w * h);
  for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) s[y * w + x] = 1;        // 64 px
  s[2 * w + 15] = 1; s[2 * w + 16] = 1;                                              // 2 px piece
  s[7 * w + 15] = 1;                                                                 // 1 px piece
  const p = subjectPieces(s, w, h);
  assert.equal(p.pieces, 3);
  assert.ok(Math.abs(p.largestShare - 64 / 67) < 1e-9);
  assert.deepEqual(subjectPieces(new Uint8Array(w * h), w, h), { pieces: 0, largestShare: 0 });
});

test('gradient: a sharp edge stops the spread, even where the colours are close', () => {
  const w = 100, h = 80;
  // background grades 235 -> 205 top to bottom; a grey subject (180) with a hard outline sits on it
  const img = rgba(w, h, (x, y) => (x >= 30 && x < 70 && y >= 20 && y < 60 ? [...jitter([180, 180, 182], 3), 255] : (() => { const v = 235 - (y / h) * 30; return [...jitter([v, v, v], 3), 255]; })()));
  const r = removeBackground(img, { tolerance: 25, feather: 0, gradient: true });
  const subject = Uint8Array.from({ length: w * h }, (_, i) => { const x = i % w, y = (i / w) | 0; return x >= 30 && x < 70 && y >= 20 && y < 60 ? 1 : 0; });
  assert.ok(iou(r.subject, subject) > 0.97, `IoU ${iou(r.subject, subject)}`);
});

test('gradient does nothing without contiguous, and defaults to off', () => {
  const { img } = gradientPicture();
  const a = removeBackground(img, { tolerance: 25, feather: 0, contiguous: false, gradient: true }), b = removeBackground(img, { tolerance: 25, feather: 0, contiguous: false, gradient: false });
  assert.deepEqual([...a.alpha], [...b.alpha]);
  assert.deepEqual([...removeBackground(img, { feather: 0 }).alpha], [...removeBackground(img, { feather: 0, gradient: false }).alpha]);
});
