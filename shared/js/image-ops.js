// Copyright (c) 2025 cmutnik
// Image preprocessing: RGBA -> black & white masks (threshold / adaptive / dither / edges), cleanup, and SVG output.
// Pure functions on typed arrays, no browser APIs, so everything here is tested in Node.
// A "mask" is a Uint8Array (w*h) where 1 = ink (black) and 0 = paper.
import { grayFromImage, boxBlur, otsuThreshold, traceMask } from './image-trace.js';
import { distanceSquared } from './raster-tools.js';
import { signedArea, simplifyRing } from './geometry-pure.js';

// ---------- grayscale tools ----------

/** Gaussian blur approximated by three box blurs (fast, close enough for preprocessing). */
export function gaussianBlur(gray, w, h, sigma) {
  if (!(sigma > 0.3)) return gray;
  const n = 3, wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  let out = gray;
  for (let i = 0; i < n; i++) out = boxBlur(out, w, h, ((i < m ? wl : wu) - 1) / 2);
  return out;
}

/** Linear contrast stretch: the lowPct-th percentile becomes black, the highPct-th white. */
export function stretchContrast(gray, lowPct = 1, highPct = 99) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
  const find = pct => { let acc = 0; const target = (pct / 100) * gray.length; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; } return 255; };
  const lo = find(lowPct), hi = find(highPct);
  if (hi - lo < 8) return gray;
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / (hi - lo)));
  return out;
}

// ---------- gray -> mask ----------

export function thresholdMask(gray, t) {
  const m = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) m[i] = gray[i] < t ? 1 : 0;
  return m;
}

/** Local threshold: ink where a pixel is darker than the mean of its neighbourhood minus `offset`. Handles uneven lighting. */
export function adaptiveMask(gray, w, h, { radius = 15, offset = 8 } = {}) {
  const W = w + 1, integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row; }
  }
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      m[y * w + x] = gray[y * w + x] < mean - offset ? 1 : 0;
    }
  }
  return m;
}

/** Floyd-Steinberg error diffusion: a halftone that keeps the overall tone. */
export function ditherMask(gray, w, h) {
  const g = Float32Array.from(gray), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, old = g[i], v = old < 128 ? 0 : 255, err = old - v;
    m[i] = v === 0 ? 1 : 0;
    if (x + 1 < w) g[i + 1] += (err * 7) / 16;
    if (y + 1 < h) {
      if (x > 0) g[i + w - 1] += (err * 3) / 16;
      g[i + w] += (err * 5) / 16;
      if (x + 1 < w) g[i + w + 1] += err / 16;
    }
  }
  return m;
}

/**
 * Canny-style edge map: blur, Sobel gradient, non-maximum suppression, hysteresis. 1 px wide lines.
 * @param sens 0-1: lower = only the strongest edges, higher = more detail. The thresholds come from the picture's own edge
 *   strengths (a percentile of the thinned ridges), so faint-but-real edges are found even when one edge is very strong.
 */
export function edgeMask(gray, w, h, { sigma = 1.4, sens = 0.5 } = {}) {
  const g = gaussianBlur(gray, w, h, sigma), mag = new Float32Array(w * h), dir = new Uint8Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
    const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
    const mg = Math.hypot(gx, gy);
    mag[i] = mg; if (mg > max) max = mg;
    let a = (Math.atan2(gy, gx) * 180) / Math.PI; if (a < 0) a += 180;
    dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3; // 0: horizontal gradient, 1: diagonal, 2: vertical, 3: anti-diagonal
  }
  if (max === 0) return new Uint8Array(w * h);
  const thin = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, m = mag[i];
    const [a, b] = dir[i] === 0 ? [i - 1, i + 1] : dir[i] === 2 ? [i - w, i + w] : dir[i] === 1 ? [i - w - 1, i + w + 1] : [i - w + 1, i + w - 1];
    if (m > mag[a] && m >= mag[b]) thin[i] = m;       // strict on one side: a perfect step gives two equal pixels, keep one
  }
  // seeds = the strongest `strong` fraction of ridge pixels; weaker ridges (>= half the seed level) join if connected
  const ridges = [];
  // Sobel gives 4x the per-pixel brightness change, so a floor of 8 ignores changes under ~2 grey levels per pixel (the
  // noise level of a flat picture; soft, blurry edges are well above it). Without an absolute floor a flat but noisy
  // picture would still be "relatively" full of edges.
  const floor = Math.max(max * 0.01, 8);
  for (let i = 0; i < thin.length; i++) if (thin[i] > floor) ridges.push(thin[i]);
  if (!ridges.length) return new Uint8Array(w * h);
  ridges.sort((a, b) => a - b);
  const sv = Math.max(0, Math.min(1, sens)), strong = 0.02 + 0.93 * sv * sv;   // squared: gentle at the low end, nearly everything at 1
  const high = ridges[Math.min(ridges.length - 1, Math.floor(ridges.length * (1 - strong)))], low = high * 0.5;
  const out = new Uint8Array(w * h), stack = [];
  for (let i = 0; i < thin.length; i++) if (thin[i] >= high) { out[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!out[j] && thin[j] >= low) { out[j] = 1; stack.push(j); }
    }
  }
  return out;
}

// ---------- mask cleanup ----------

/** Grow ink by `radius` px (round brush). */
export function dilateMask(mask, w, h, radius) {
  if (!(radius > 0)) return mask;
  const d = distanceSquared(w, h, i => mask[i] === 1), r2 = radius * radius, out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r2 ? 1 : 0;
  return out;
}

/** Shrink ink by `radius` px. */
export function erodeMask(mask, w, h, radius) {
  if (!(radius > 0)) return mask;
  const d = distanceSquared(w, h, i => mask[i] === 0), r2 = radius * radius, out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] && d[i] > r2 ? 1 : 0;   // drop everything within `radius` of paper
  return out;
}

/**
 * Remove ink specks smaller than minInk px and fill paper holes smaller than minHole px
 * (holes touching the border are never filled). 4-connected components.
 */
export function despeckle(mask, w, h, { minInk = 0, minHole = 0 } = {}) {
  if (!(minInk > 0) && !(minHole > 0)) return mask;
  const out = Uint8Array.from(mask), seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let start = 0; start < out.length; start++) {
    if (seen[start]) continue;
    const v = out[start];
    let sp = 0, count = 0, touches = false;
    const members = [];
    stack[sp++] = start; seen[start] = 1;
    while (sp) {
      const i = stack[--sp]; members.push(i); count++;
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x > 0 && !seen[i - 1] && out[i - 1] === v) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && !seen[i + 1] && out[i + 1] === v) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !seen[i - w] && out[i - w] === v) { seen[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && !seen[i + w] && out[i + w] === v) { seen[i + w] = 1; stack[sp++] = i + w; }
    }
    if (v === 1 && count < minInk) for (const i of members) out[i] = 0;
    else if (v === 0 && !touches && count < minHole) for (const i of members) out[i] = 1;
  }
  return out;
}

/** Trim blank margins (keeping `pad` px). Returns { mask, width, height, x0, y0 }; unchanged if there is no ink. */
export function cropToContent(mask, w, h, pad = 0) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { mask, width: w, height: h, x0: 0, y0: 0 };
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1, out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) out[y * nw + x] = mask[(y + y0) * w + x + x0];
  return { mask: out, width: nw, height: nh, x0, y0 };
}

// ---------- the whole pipeline ----------

/**
 * RGBA -> mask, with every preprocessing option.
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} img
 * @param {object} o
 *  source 'auto'|'brightness'|'alpha'; method 'threshold'|'adaptive'|'dither'|'edges'
 *  threshold 'auto' | 0-255 (method threshold); blur (sigma px); stretch (auto contrast); invert
 *  adaptiveRadius (px), adaptiveOffset (0-255)           (method adaptive)
 *  edgeSigma (px), edgeSens (0-1), lineWidth (px)         (method edges)
 *  minInk, fillHoles (px^2); crop (bool), cropPad (px)
 * @returns {{ mask, width, height, threshold: number|null, source: string, crop: {x0, y0} }}
 */
export function prepare(img, o = {}) {
  const { source = 'auto', method = 'threshold', threshold = 'auto', blur = 0, stretch = false, invert = false,
    adaptiveRadius = Math.max(5, Math.round(Math.min(img.width, img.height) * 0.08)), adaptiveOffset = 8,
    edgeSigma = 1.4, edgeSens = 0.5, lineWidth = 2, minInk = 0, fillHoles = 0, crop = false, cropPad = 0 } = o;
  const { width: w, height: h } = img;
  const { gray: raw, source: src } = grayFromImage(img, source);
  let gray = stretch ? stretchContrast(raw) : raw;
  let mask, thr = null;
  if (method === 'edges') {
    mask = dilateMask(edgeMask(gray, w, h, { sigma: edgeSigma, sens: edgeSens }), w, h, Math.max(0, (lineWidth - 1) / 2));
  } else {
    gray = gaussianBlur(gray, w, h, blur);
    if (method === 'adaptive') mask = adaptiveMask(gray, w, h, { radius: adaptiveRadius, offset: adaptiveOffset });
    else if (method === 'dither') mask = ditherMask(gray, w, h);
    else { thr = threshold === 'auto' ? (src === 'alpha' ? 128 : otsuThreshold(gray)) : threshold; mask = thresholdMask(gray, thr); }
  }
  if (invert) { const m = new Uint8Array(mask.length); for (let i = 0; i < m.length; i++) m[i] = mask[i] ? 0 : 1; mask = m; }
  mask = despeckle(mask, w, h, { minInk, minHole: fillHoles });
  let outW = w, outH = h, x0 = 0, y0 = 0;
  if (crop) ({ mask, width: outW, height: outH, x0, y0 } = cropToContent(mask, w, h, cropPad));
  return { mask, width: outW, height: outH, threshold: thr, source: src, crop: { x0, y0 } };
}

// ---------- output ----------

/** Mask -> RGBA pixels. paper = [r, g, b, a]; ink = [r, g, b]. */
export function maskToRGBA(mask, w, h, { ink = [0, 0, 0], paper = [255, 255, 255, 255] } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) data.set([ink[0], ink[1], ink[2], 255], i * 4);
    else data.set(paper, i * 4);
  }
  return data;
}

const fmt = n => String(Math.round(n * 100) / 100);

/** Add points so no segment is longer than maxSeg. */
function densify(ring, maxSeg) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / maxSeg));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

/**
 * Trace a mask into an SVG: one path of filled shapes (holes via even-odd), in pixel units.
 * @param {object} o
 *  tolerance (px, outline simplification), minArea (px^2, drop specks), smooth (round the corners slightly with
 *  quadratic curves), color (fill), background (CSS colour or null for transparent), scale (output size multiplier)
 * @returns {{ svg: string, shapes: number, nodes: number }}
 */
export function maskToSvg(mask, w, h, { tolerance = 0.7, minArea = 6, smooth = false, color = '#000000', background = null, scale = 1 } = {}) {
  const rings = traceMask(mask, w, h)
    .filter(r => Math.abs(signedArea(r)) >= minArea)
    .map(r => simplifyRing(r, tolerance).map(([x, y]) => [x + 0.5, y + 0.5])); // pixel centres -> pixel corners
  let d = '', nodes = 0;
  for (const ring of rings) {
    if (smooth && ring.length >= 3) {
      const P = densify(ring, 2), n = P.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const s = mid(P[n - 1], P[0]);
      d += `M${fmt(s[0])} ${fmt(s[1])}`;
      for (let i = 0; i < n; i++) { const m = mid(P[i], P[(i + 1) % n]); d += `Q${fmt(P[i][0])} ${fmt(P[i][1])} ${fmt(m[0])} ${fmt(m[1])}`; }
      d += 'Z'; nodes += n;
    } else {
      d += 'M' + ring.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L') + 'Z'; nodes += ring.length;
    }
  }
  const bg = background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${fmt(w * scale)}" height="${fmt(h * scale)}">${bg}<path fill="${color}" fill-rule="evenodd" d="${d}"/></svg>`;
  return { svg, shapes: rings.length, nodes };
}
