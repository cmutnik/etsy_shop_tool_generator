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

/**
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} img RGBA pixels
 * @param {{ threshold?: number, invert?: boolean, tolerance?: number, minArea?: number }} opts
 *   threshold 0-255 luminance cut-off (darker = ink); transparent pixels count as white.
 */
export function imageToGroups(img, { threshold = 128, invert = false, tolerance = 0.7, minArea = 6 } = {}) {
  const { data, width: w, height: h } = img;
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const a = data[p * 4 + 3] / 255;
    const lum = 0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];
    const v = lum * a + 255 * (1 - a);
    mask[p] = (v < threshold) !== invert ? 1 : 0;
  }
  const rings = traceMask(mask, w, h)
    .filter(r => Math.abs(signedArea(r)) >= minArea)
    .map(r => simplifyRing(r, tolerance).map(([x, y]) => [x, -y])); // flip to y-up
  return centerGroups(contoursToGroups(rings));
}

/** Browser only: decode an image File to RGBA pixels, downscaled so the long side <= maxSize. */
export async function readImageFile(file, maxSize = 512) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
