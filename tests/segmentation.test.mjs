// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { downscale, downscaleMarks, randomWalker, upsample, segmentWithMarks } from '../shared/js/segmentation.js';
import { removeBackground } from '../shared/js/image-color.js';

let seed = 99;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rgba = (w, h, fn) => { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4); return { data, width: w, height: h }; };
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return i / u; };
const brush = (marks, w, h, cx, cy, r, v) => { for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) marks[y * w + x] = v; };

test('randomWalker: on a uniform chain the probability falls off in a straight line between the marks', () => {
  const N = 41, rgb = new Float32Array(N * 3).fill(0.5), marks = new Uint8Array(N);
  marks[0] = 1; marks[N - 1] = 2;
  const { prob, iterations } = randomWalker({ rgb, width: N, height: 1 }, marks, { tol: 1e-9, maxIter: 500 });
  for (let i = 0; i < N; i++) assert.ok(Math.abs(prob[i] - (1 - i / (N - 1))) < 1e-3, `i=${i}: ${prob[i]}`);
  assert.ok(iterations > 0);
});

test('randomWalker: needs both kinds of mark, and returns the marks themselves as 1 and 0', () => {
  const rgb = new Float32Array(30).fill(0.5), onlyFg = new Uint8Array(10); onlyFg[2] = 1;
  assert.equal(randomWalker({ rgb, width: 10, height: 1 }, onlyFg).iterations, 0);
  const marks = new Uint8Array(10); marks[1] = 1; marks[8] = 2;
  const { prob } = randomWalker({ rgb, width: 10, height: 1 }, marks);
  assert.equal(prob[1], 1); assert.equal(prob[8], 0);
  const img = rgba(10, 10, () => [100, 100, 100, 255]);
  assert.equal(segmentWithMarks(img, Uint8Array.from({ length: 100 }, (_, i) => (i === 5 ? 1 : 0))), null, 'null until both kinds exist');
});

test('randomWalker snaps to the image edge, not to the halfway point between the marks', () => {
  const w = 60, h = 30, edge = 12;
  const img = rgba(w, h, (x) => (x < edge ? [200, 40, 40, 255] : [40, 60, 190, 255]).map((v, k) => (k < 3 ? Math.max(0, Math.min(255, v + (rnd() - 0.5) * 10)) : v)));
  const marks = new Uint8Array(w * h);
  brush(marks, w, h, 5, 15, 1, 1); brush(marks, w, h, 52, 15, 1, 2);       // halfway between the marks would be x = 28
  const r = segmentWithMarks(img, marks, { maxSide: 200 });
  for (const y of [3, 15, 26]) {
    let boundary = 0; for (let x = 0; x < w; x++) if (r.subject[y * w + x]) boundary = x + 1;
    assert.ok(Math.abs(boundary - edge) <= 1, `row ${y}: boundary at ${boundary}, edge at ${edge}`);
  }
});

/** A shaded red disc on a busy background of random colour patches (some dark, some reddish) with noise. */
function busyPicture() {
  const w = 140, h = 110, cx = 70, cy = 55, R = 28;
  const patches = Array.from({ length: 36 }, () => ({ x: rnd() * w, y: rnd() * h, c: [rnd() * 255, rnd() * 255, rnd() * 255] }));
  patches.push({ x: 8, y: 8, c: [120, 25, 30] }, { x: 130, y: 100, c: [150, 40, 40] }, { x: 20, y: 95, c: [90, 20, 25] });        // some reddish patches too
  const inDisc = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
  const img = rgba(w, h, (x, y) => {
    if (inDisc(x, y)) { const d = Math.hypot(x - cx, y - cy) / R; return [230 - 70 * d * d + (rnd() - 0.5) * 12, 40 + 25 * (1 - d) + (rnd() - 0.5) * 12, 45 + (rnd() - 0.5) * 12, 255]; }
    let best = patches[0], bd = Infinity; for (const p of patches) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return [...best.c.map(v => Math.max(0, Math.min(255, v + (rnd() - 0.5) * 14))), 255];
  });
  const truth = Uint8Array.from({ length: w * h }, (_, i) => (inDisc(i % w, (i / w) | 0) ? 1 : 0));
  return { img, w, h, truth };
}

test('segmentWithMarks recovers a subject from a busy background where colour removal cannot', () => {
  const { img, w, h, truth } = busyPicture();
  // colour removal: no single background colour exists here
  const keyed = removeBackground(img, { tolerance: 25, feather: 0 });
  assert.ok(iou(keyed.subject, truth) < 0.5, `plain colour removal should fail on this picture, IoU ${iou(keyed.subject, truth)}`);
  // a few strokes: one through the disc, and several on different background patches
  const marks = new Uint8Array(w * h);
  brush(marks, w, h, 70, 55, 3, 1); brush(marks, w, h, 62, 45, 2, 1); brush(marks, w, h, 78, 66, 2, 1);
  for (const [x, y] of [[10, 10], [130, 12], [12, 98], [128, 98], [70, 6], [70, 104], [20, 55], [122, 55]]) brush(marks, w, h, x, y, 3, 2);
  const r = segmentWithMarks(img, marks, { maxSide: 160 });
  assert.ok(iou(r.subject, truth) > 0.9, `marked segmentation IoU ${iou(r.subject, truth)}`);
});

test('segmentWithMarks: the marks are always honoured, and bias moves the boundary', () => {
  const { img, w, h } = busyPicture();
  const marks = new Uint8Array(w * h);
  brush(marks, w, h, 70, 55, 3, 1);
  for (const [x, y] of [[10, 10], [130, 12], [12, 98], [128, 98]]) brush(marks, w, h, x, y, 3, 2);
  brush(marks, w, h, 100, 30, 2, 1);                                  // a (wrong, user-chosen) subject mark far from the disc
  const r = segmentWithMarks(img, marks, { maxSide: 160 });
  assert.equal(r.subject[30 * w + 100], 1, 'a subject mark stays subject whatever the colours say');
  assert.equal(r.subject[10 * w + 10], 0, 'a background mark stays background');
  const area = bias => segmentWithMarks(img, marks, { maxSide: 160, bias }).subject.reduce((s, v) => s + v, 0);
  assert.ok(area(0.75) >= area(0.5) && area(0.5) >= area(0.25), 'a higher bias includes more');
});

test('downscale averages exactly, downscaleMarks takes the majority, upsample keeps constants and ramps', () => {
  const img = rgba(4, 4, (x, y) => [x < 2 ? 0 : 255, y < 2 ? 0 : 255, 0, 255]);
  const g = downscale(img, 2);
  assert.equal(g.width, 2); assert.equal(g.height, 2);
  assert.deepEqual([...g.rgb.slice(0, 3)].map(v => +v.toFixed(3)), [0, 0, 0]);
  assert.deepEqual([...g.rgb.slice(3, 6)].map(v => +v.toFixed(3)), [1, 0, 0]);
  const marks = new Uint8Array(16); marks[0] = 1; marks[1] = 1; marks[4] = 2;
  assert.equal(downscaleMarks(marks, 4, 4, 2, 2)[0], 1, 'two subject marks beat one background mark');
  const flat = upsample(new Float32Array(4).fill(0.3), 2, 2, 8, 8);
  assert.ok(flat.every(v => Math.abs(v - 0.3) < 1e-6));
  const ramp = upsample(Float32Array.from([0, 1, 0, 1]), 2, 2, 8, 2);
  for (let i = 1; i < 8; i++) assert.ok(ramp[i] >= ramp[i - 1] - 1e-6, 'monotonic left to right');
});

test('segmentation is fast enough to rerun after each stroke', () => {
  const w = 1200, h = 800, img = rgba(w, h, (x, y) => (Math.hypot(x - 600, y - 400) < 250 ? [200, 50, 50, 255] : [60, 90, 150, 255]));
  const marks = new Uint8Array(w * h); brush(marks, w, h, 600, 400, 10, 1); brush(marks, w, h, 50, 50, 10, 2);
  const t = performance.now(); const r = segmentWithMarks(img, marks, { maxSide: 480 }); const ms = performance.now() - t;
  assert.ok(ms < 4000, `${Math.round(ms)} ms (${r.iterations} iterations)`);
  const truth = Uint8Array.from({ length: w * h }, (_, i) => (Math.hypot((i % w) - 600, ((i / w) | 0) - 400) < 250 ? 1 : 0));
  assert.ok(iou(r.subject, truth) > 0.97, `IoU at full size from a 480 px solve: ${iou(r.subject, truth)}`);
});
