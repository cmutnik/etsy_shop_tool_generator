// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceSquared, thinFeatures } from '../shared/js/raster-tools.js';
import { buildMask, otsuThreshold, imageToGroups } from '../shared/js/image-trace.js';

test('distanceSquared matches brute force', () => {
  const w = 23, h = 17, src = new Set([5 * w + 3, 11 * w + 20, 0, 16 * w + 22]);
  const d = distanceSquared(w, h, i => src.has(i));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = Infinity;
    for (const s of src) best = Math.min(best, (x - (s % w)) ** 2 + (y - Math.floor(s / w)) ** 2);
    assert.equal(d[y * w + x], best, `(${x},${y})`);
  }
});

test('thinFeatures flags a 2px line but not a 20px block', () => {
  const w = 60, h = 40, mask = new Uint8Array(w * h);
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) mask[y * w + x] = 1;      // block
  for (let x = 30; x < 55; x++) for (let y = 10; y < 12; y++) mask[y * w + x] = 1;   // 2px line
  const { thin, inkPixels, thinPixels } = thinFeatures(mask, w, h, 2);
  assert.equal(inkPixels, 400 + 50);
  assert.ok(thinPixels >= 50 && thinPixels < 70, `thin ${thinPixels}`);          // the line, maybe block corners
  assert.equal(thin[10 * w + 40], 1);
  assert.equal(thin[15 * w + 15], 0);
});

test('otsu splits a bimodal image', () => {
  const g = new Float32Array(1000).map((_, i) => (i % 2 ? 40 : 210));
  const t = otsuThreshold(g);
  assert.ok(t > 40 && t <= 210, `t=${t}`);
});

function rgba(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}

test('buildMask auto: uses alpha for transparent logos, even with light colours', () => {
  const img = rgba(30, 30, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? [250, 250, 250, 255] : [255, 255, 255, 0]));
  const m = buildMask(img);
  assert.equal(m.source, 'alpha');
  assert.equal(m.mask.reduce((a, b) => a + b, 0), 100);
});

test('buildMask auto: brightness for opaque images, Otsu finds the cut for mid-grey logos', () => {
  const img = rgba(30, 30, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? [150, 150, 150, 255] : [235, 235, 235, 255]));
  const m = buildMask(img);
  assert.equal(m.source, 'brightness');
  assert.equal(m.mask.reduce((a, b) => a + b, 0), 100);
  // a fixed threshold of 128 would miss it entirely
  assert.equal(buildMask(img, { threshold: 128 }).mask.reduce((a, b) => a + b, 0), 0);
});

test('smoothing removes salt-and-pepper noise', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const img = rgba(60, 60, (x, y) => {
    const base = x >= 15 && x < 45 && y >= 15 && y < 45 ? 40 : 220;
    const v = rnd() < 0.08 ? 255 - base : base;
    return [v, v, v, 255];
  });
  const rough = imageToGroups(img, { minArea: 0 }), smooth = imageToGroups(img, { smooth: 1, minArea: 0 });
  assert.ok(smooth.groups.length < rough.groups.length / 3, `${smooth.groups.length} vs ${rough.groups.length}`);
});
