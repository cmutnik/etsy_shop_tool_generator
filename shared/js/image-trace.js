// Copyright (c) 2025 cmutnik
// Raster -> groups: threshold to a mask, trace with marching squares, simplify.
import { contoursToGroups, centerGroups, mapGroups, signedArea, simplifyRing } from './geometry-pure.js';

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

export function boxBlur(src, w, h, r) {
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
 * Brightness values (0 = black, 255 = white) from RGBA pixels, plus which source was used.
 * source 'auto' | 'brightness' | 'alpha' as in buildMask.
 */
export function grayFromImage(img, source = 'auto') {
  const { data, width: w, height: h } = img;
  const n = w * h;
  let transparent = 0;
  for (let p = 0; p < n; p++) if (data[p * 4 + 3] < 128) transparent++;
  const src = source === 'auto' ? (transparent / n > 0.01 ? 'alpha' : 'brightness') : source;
  const gray = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const a = data[p * 4 + 3] / 255;
    if (src === 'alpha') gray[p] = 255 * (1 - a);
    else gray[p] = (0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2]) * a + 255 * (1 - a);
  }
  return { gray, source: src };
}

/**
 * Turn RGBA pixels into an ink mask (1 = raised).
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} img
 * @param {object} o
 *  source    'auto' | 'brightness' | 'alpha'. Auto uses transparency when the image has any, else brightness.
 *  threshold 'auto' (Otsu) or 0-255 - pixels darker than this become ink
 *  smooth    box-blur radius in px applied before thresholding
 *  invert    swap ink and paper
 * @returns {{ mask: Uint8Array, width, height, threshold: number, source: string }}
 */
export function buildMask(img, { source = 'auto', threshold = 'auto', smooth = 0, invert = false } = {}) {
  const { width: w, height: h } = img;
  const n = w * h;
  const { gray: raw, source: src } = grayFromImage(img, source);
  const gray = boxBlur(raw, w, h, Math.round(smooth));
  const thr = threshold === 'auto' ? (src === 'alpha' ? 128 : otsuThreshold(gray)) : threshold;
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = (gray[p] < thr) !== invert ? 1 : 0;
  return { mask, width: w, height: h, threshold: thr, source: src };
}

/**
 * Raster -> groups (y-up, centred, units = source pixels). Options as buildMask plus
 *  tolerance  outline simplification in px (higher = smoother, fewer points)
 *  minArea    drop specks smaller than this many px^2
 *  frame      position and size by the whole picture (width x height) instead of the ink's bounding box, so several
 *             layers cut from one picture keep their relative positions (see svgToGroups)
 * Returns { groups, width, height, threshold, source }.
 */
export function imageToGroups(img, { tolerance = 0.7, minArea = 6, frame = false, ...maskOpts } = {}) {
  const { mask, width: w, height: h, threshold, source } = buildMask(img, maskOpts);
  const rings = traceMask(mask, w, h)
    .filter(r => Math.abs(signedArea(r)) >= minArea)
    .map(r => simplifyRing(r, tolerance).map(([x, y]) => [x, -y])); // flip to y-up
  if (frame) {
    // the picture spans [-0.5, w-0.5] x [-0.5, h-0.5] in pixel-centre units; after the y flip its centre is ((w-1)/2, -(h-1)/2)
    const groups = mapGroups(contoursToGroups(rings), (x, y) => [x - (w - 1) / 2, y + (h - 1) / 2]);
    return { groups, width: w, height: h, threshold, source, framed: true };
  }
  return { ...centerGroups(contoursToGroups(rings)), threshold, source, framed: false };
}

/** A plain-language reason (and a way out) for a picture the browser could not open. Pure, so it is tested in Node. */
export function explainImageError(file) {
  const name = (file && file.name) || '', type = (file && file.type) || '';
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  if (/hei[cf]/i.test(type) || ext === 'heic' || ext === 'heif') return 'This is an iPhone HEIC photo, which most browsers cannot open. Save or export it as a JPG or PNG (on an iPhone: Settings > Camera > Formats > Most Compatible) and try again.';
  if (ext === 'tif' || ext === 'tiff' || /tiff/i.test(type)) return 'TIFF files cannot be opened by a browser. Convert it to a PNG or JPG first.';
  if (['psd', 'ai', 'eps', 'pdf', 'cdr', 'xcf'].includes(ext) || /pdf|photoshop/i.test(type)) return `.${ext} files cannot be read here. Export the picture as a PNG, JPG or SVG first.`;
  if (['cr2', 'nef', 'arw', 'dng', 'raf', 'orf'].includes(ext)) return 'RAW camera files cannot be opened. Export the photo as a JPG first.';
  if (ext === 'svg' || /svg/i.test(type)) return 'That SVG could not be drawn. It may use features browsers cannot render as an image (external files or scripts). Try exporting it again as a plain SVG, or as a PNG.';
  if (file && file.size === 0) return 'That file is empty.';
  return 'This browser could not read that file. Try a PNG, JPG, WebP or SVG.';
}

/**
 * Browser only: decode an image File to RGBA pixels. Raster pictures are only ever scaled down, to a long side <= maxSize.
 * SVG (and anything createImageBitmap cannot decode, which an <img> often can) goes through an <img>; a vector is drawn at maxSize
 * so it is crisp, on a transparent canvas, so a logo keeps its transparent background.
 */
export async function readImageFile(file, maxSize = 640) {
  const isSvg = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
  let source = null, sw = 0, sh = 0, url = null;
  if (!isSvg) {
    try { source = await createImageBitmap(file); sw = source.width; sh = source.height; } catch { source = null; }
  }
  if (!source) {
    url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      sw = img.naturalWidth; sh = img.naturalHeight;
      if (!sw || !sh) { sw = sh = 1000; }                    // an SVG with no size of its own: draw it square at the working size
      source = img;
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(explainImageError(file));
    }
  }
  const s = isSvg ? maxSize / Math.max(sw, sh) : Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  if (url) URL.revokeObjectURL(url);
  return ctx.getImageData(0, 0, w, h);
}
