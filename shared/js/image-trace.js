// Copyright (c) 2025 cmutnik
// Raster -> groups: threshold to a mask, trace with marching squares, simplify.
import { contoursToGroups, centerGroups, signedArea, simplifyRing } from './geometry2d.js';

// Corner bits: TL=8 TR=4 BR=2 BL=1. Each entry is [from, to] edge-midpoint pairs, oriented with
// "ink" on the right-hand side in y-down image coordinates (T/R/B/L = edge of the cell).
const CASES = {
  1: [['L', 'B']], 2: [['B', 'R']], 3: [['L', 'R']], 4: [['R', 'T']],
  5: [['R', 'T'], ['L', 'B']], 6: [['B', 'T']], 7: [['L', 'T']], 8: [['T', 'L']],
  9: [['T', 'B']], 10: [['T', 'L'], ['B', 'R']], 11: [['T', 'R']], 12: [['R', 'L']],
  13: [['R', 'B']], 14: [['B', 'L']],
};

/** @param {Uint8Array} mask w*h, nonzero = ink. Returns closed rings in pixel coords (y-down). */
export function traceMask(mask, w, h) {
  const f = (i, j) => (i >= 0 && i < w && j >= 0 && j < h && mask[j * w + i] ? 1 : 0);
  const mid = (i, j, e) => (e === 'T' ? [2 * i + 1, 2 * j] : e === 'R' ? [2 * i + 2, 2 * j + 1] : e === 'B' ? [2 * i + 1, 2 * j + 2] : [2 * i, 2 * j + 1]);
  const next = new Map();
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const c = f(i, j) * 8 + f(i + 1, j) * 4 + f(i + 1, j + 1) * 2 + f(i, j + 1);
      const segs = CASES[c];
      if (!segs) continue;
      for (const [a, b] of segs) {
        const p = mid(i, j, a), q = mid(i, j, b);
        next.set(p[0] + ',' + p[1], q);
      }
    }
  }
  const rings = [];
  for (const startKey of [...next.keys()]) {
    if (!next.has(startKey)) continue;
    const ring = [];
    let key = startKey;
    while (next.has(key)) {
      const q = next.get(key);
      next.delete(key);
      ring.push(key.split(',').map(n => n / 2));
      key = q[0] + ',' + q[1];
    }
    if (ring.length > 2) rings.push(ring);
  }
  return rings;
}

/** Otsu's method on 0-255 values: the cut-off that best separates dark from light. */
export function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sumB = 0, best = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t + 1; } // pixels < thr count as dark
  }
  return thr;
}

function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * Turn RGBA pixels into an ink mask (1 = raised).
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} img
 * @param {object} o
 *  source    'auto' | 'brightness' | 'alpha'. Auto uses transparency when the image has any, else brightness.
 *            (alpha: opaque = ink - right for transparent logos whose colours are light; brightness: dark = ink.)
 *  threshold 'auto' (Otsu) or 0-255 - pixels darker than this become ink
 *  smooth    box-blur radius in px applied before thresholding (softens jagged/noisy edges)
 *  invert    swap ink and paper
 * @returns {{ mask: Uint8Array, width, height, threshold: number, source: string }}
 */
export function buildMask(img, { source = 'auto', threshold = 'auto', smooth = 0, invert = false } = {}) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  let transparent = 0;
  for (let p = 0; p < n; p++) if (data[p * 4 + 3] < 128) transparent++;
  const src = source === 'auto' ? (transparent / n > 0.01 ? 'alpha' : 'brightness') : source;
  let gray = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const a = data[p * 4 + 3] / 255;
    if (src === 'alpha') gray[p] = 255 * (1 - a);
    else gray[p] = (0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2]) * a + 255 * (1 - a);
  }
  gray = boxBlur(gray, w, h, Math.round(smooth));
  const thr = threshold === 'auto' ? (src === 'alpha' ? 128 : otsuThreshold(gray)) : threshold;
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = (gray[p] < thr) !== invert ? 1 : 0;
  return { mask, width: w, height: h, threshold: thr, source: src };
}

/**
 * Raster -> groups (y-up, centred, units = source pixels). Options as buildMask plus
 *  tolerance  outline simplification in px (higher = smoother, fewer points)
 *  minArea    drop specks smaller than this many px^2
 * Returns { groups, width, height, threshold, source }.
 */
export function imageToGroups(img, { tolerance = 0.7, minArea = 6, ...maskOpts } = {}) {
  const { mask, width: w, height: h, threshold, source } = buildMask(img, maskOpts);
  const rings = traceMask(mask, w, h)
    .filter(r => Math.abs(signedArea(r)) >= minArea)
    .map(r => simplifyRing(r, tolerance).map(([x, y]) => [x, -y])); // flip to y-up
  return { ...centerGroups(contoursToGroups(rings)), threshold, source };
}

/** Browser only: decode an image File to RGBA pixels, downscaled so the long side <= maxSize. */
export async function readImageFile(file, maxSize = 640) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
