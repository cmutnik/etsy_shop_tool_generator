// Copyright (c) 2025 cmutnik
// Colour image tools: background removal and colour posterizing (for multi-colour stamps).
// Pure functions on typed arrays, no browser APIs, so everything here is tested in Node.
import { boxBlur } from './image-trace.js';
import { despeckle, erodeMask, maskToSvg } from './image-ops.js';

/** Perceptually weighted RGB distance ("redmean"), 0 .. ~765. Cheap and close to how colours look different. */
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

// ---------- background removal ----------

/**
 * The picture's background colour: the most common colour along the border.
 * @returns {{ color: number[], share: number } | null}  share = fraction of border pixels close to it; null if the border is transparent
 */
export function estimateBackground(img, { band = 0.02 } = {}) {
  const { data, width: w, height: h } = img;
  const t = Math.max(1, Math.round(Math.min(w, h) * band));
  const bins = new Map();
  let total = 0;
  const visit = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return;
    total++;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    bins.set(key, b);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < t || y < t || x >= w - t || y >= h - t) visit(x, y);
  if (!total) return null;
  let best = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  // include neighbouring bins so a colour straddling a bin edge is still counted as one background
  const color = [best.r / best.n, best.g / best.n, best.b / best.n].map(Math.round);
  let close = 0;
  for (const b of bins.values()) if (colorDistance(color[0], color[1], color[2], b.r / b.n, b.g / b.n, b.b / b.n) < 60) close += b.n;
  return { color, share: close / total };
}

/**
 * How far (as a multiple of the tolerance distance) gradient following may drift from the edge colour. A smooth lighting
 * gradient stays inside it; the soft edge of a blurry subject, which changes just as smoothly pixel to pixel, does not.
 * A bigger gradient needs a bigger tolerance.
 */
export const CAP_FACTOR = 1.8;

/** How many separate pieces the subject is in, and the share of it held by the largest piece (4-connected). */
export function subjectPieces(subject, w, h) {
  const seen = new Uint8Array(w * h);
  let pieces = 0, total = 0, biggest = 0;
  for (let s = 0; s < w * h; s++) {
    if (!subject[s] || seen[s]) continue;
    pieces++;
    let n = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      n++;
      if (x > 0 && subject[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && subject[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && subject[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && subject[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    total += n;
    if (n > biggest) biggest = n;
  }
  return { pieces, largestShare: total ? biggest / total : 0 };
}

/**
 * Cut the background out of a picture.
 * @param {object} o
 *  color      'auto' (the border's most common colour) or [r, g, b]
 *  tolerance  0-100: how far from the background colour still counts as background
 *  contiguous true: only remove background connected to the picture's edge (so a same-coloured area inside the
 *             subject, like a white eye, is kept); false: remove that colour everywhere
 *  gradient   (needs contiguous) also treat a pixel as background when it is only slightly different from the background
 *             pixel next to it, so smooth gradients, vignettes and soft shadows are followed all the way across, while a
 *             sharp edge (the subject's outline) still stops the spread
 *  feather    px of soft edge, applied inwards only (no halo of old background)
 *  shrink     px to eat into the subject, removing a fringe of background colour
 *  minSubject px^2: drop floating specks of subject smaller than this
 * @returns {{ rgba: Uint8ClampedArray, alpha: Uint8Array, subject: Uint8Array, background: number[] | null, removed: number }}
 */
export function removeBackground(img, { color = 'auto', tolerance = 25, contiguous = true, gradient = false, feather = 1, shrink = 0, minSubject = 0 } = {}) {
  const { data, width: w, height: h } = img, n = w * h;
  let bg = color;
  if (color === 'auto') { const est = estimateBackground(img); bg = est ? est.color : null; }
  const isBg = new Uint8Array(n);
  const thr = tolerance * 3;
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] < 128) isBg[p] = 1;
    else if (bg && colorDistance(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], bg[0], bg[1], bg[2]) <= thr) isBg[p] = 1;
  }
  let removedMask = isBg;
  if (contiguous) {
    removedMask = new Uint8Array(n);
    // Gradient following: a pixel also joins the background when it is close to an accepted neighbour (and not wildly
    // far from the edge colour). The step is a little larger than sensor noise; and since a pixel can be reached from any
    // of its neighbours, a single noisy pixel cannot block the spread. A sharp outline is a far bigger jump, so it stops it.
    const step = Math.max(10, tolerance * 1.1), cap = thr * CAP_FACTOR, follow = gradient && !!bg;
    const near = (i, j) => colorDistance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[j * 4], data[j * 4 + 1], data[j * 4 + 2]) <= step
      && colorDistance(data[j * 4], data[j * 4 + 1], data[j * 4 + 2], bg[0], bg[1], bg[2]) <= cap;
    const stack = [];
    const seed = (x, y) => { const i = y * w + x; if (isBg[i] && !removedMask[i]) { removedMask[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    const visit = (i, j) => { if (!removedMask[j] && data[j * 4 + 3] >= 128 && (isBg[j] || (follow && near(i, j)))) { removedMask[j] = 1; stack.push(j); } };
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      if (x > 0) visit(i, i - 1);
      if (x < w - 1) visit(i, i + 1);
      if (y > 0) visit(i, i - w);
      if (y < h - 1) visit(i, i + w);
    }
    for (let p = 0; p < n; p++) if (data[p * 4 + 3] < 128) removedMask[p] = 1;   // already transparent
  }
  const subject = new Uint8Array(n);
  for (let p = 0; p < n; p++) subject[p] = removedMask[p] ? 0 : 1;
  return { ...cutOut(img, subject, { feather, shrink, minSubject }), background: bg };
}

/**
 * Turn a subject mask (1 = keep) into a cut-out picture: drop floating specks, optionally shrink the edge, soften it inwards only
 * (no halo of old background), and make everything else transparent. Used by removeBackground and by mark-based segmentation.
 * @returns {{ rgba: Uint8ClampedArray, alpha: Uint8Array, subject: Uint8Array, removed: number }}
 */
export function cutOut(img, subjectMask, { feather = 1, shrink = 0, minSubject = 0 } = {}) {
  const { data, width: w, height: h } = img, n = w * h;
  let subject = despeckle(subjectMask, w, h, { minInk: minSubject });
  if (shrink > 0) subject = erodeMask(subject, w, h, shrink);
  // soft edge, inwards only: partially transparent just inside the cut, nothing outside it
  let soft = null;
  if (feather > 0) { const f = Float32Array.from(subject, v => v * 255); soft = boxBlur(f, w, h, Math.max(1, Math.round(feather))); }
  const alpha = new Uint8Array(n), rgba = new Uint8ClampedArray(data);
  let removed = 0;
  for (let p = 0; p < n; p++) {
    alpha[p] = subject[p] ? (soft ? Math.round(soft[p]) : 255) : 0;
    if (!subject[p]) removed++;
    rgba[p * 4 + 3] = Math.round((alpha[p] * data[p * 4 + 3]) / 255);
  }
  return { rgba, alpha, subject, removed: removed / n };
}

// ---------- posterize ----------

const luminance = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

/**
 * Reduce a picture to `k` colours with k-means (k-means++ start, fixed seed so the result is repeatable).
 * Transparent pixels get label 255 and take no part.
 * @returns {{ palette: number[][], labels: Uint8Array, counts: number[] }}  palette is sorted dark to light
 */
export function quantize(img, k, { sample = 20000, iterations = 12, seed = 7 } = {}) {
  const { data, width: w, height: h } = img, n = w * h;
  const opaque = [];
  for (let p = 0; p < n; p++) if (data[p * 4 + 3] >= 128) opaque.push(p);
  const labels = new Uint8Array(n).fill(255);
  if (!opaque.length) return { palette: [], labels, counts: [] };
  const step = Math.max(1, Math.floor(opaque.length / sample)), pts = [];
  for (let i = 0; i < opaque.length; i += step) { const p = opaque[i]; pts.push([data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]); }
  const rand = rng(seed), d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // k-means++ initial centres
  const cents = [pts[Math.floor(rand() * pts.length)].slice()];
  while (cents.length < Math.min(k, pts.length)) {
    const dist = pts.map(p => Math.min(...cents.map(c => d2(p, c))));
    const total = dist.reduce((a, b) => a + b, 0);
    if (total === 0) break;                                   // fewer distinct colours than k
    let r = rand() * total, i = 0;
    while (i < dist.length - 1 && (r -= dist[i]) > 0) i++;
    cents.push(pts[i].slice());
  }
  for (let it = 0; it < iterations; it++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) { const d = d2(p, cents[c]); if (d < bd) { bd = d; bi = c; } }
      const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    let moved = 0;
    for (let c = 0; c < cents.length; c++) if (sum[c][3]) { const nc = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]]; moved += d2(nc, cents[c]); cents[c] = nc; }
    if (moved < 0.5) break;
  }
  // order dark -> light, then label every pixel
  const order = cents.map((c, i) => i).sort((a, b) => luminance(cents[a]) - luminance(cents[b]));
  const palette = order.map(i => cents[i].map(Math.round)), counts = new Array(palette.length).fill(0);
  for (const p of opaque) {
    const px = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
    let bi = 0, bd = Infinity;
    for (let c = 0; c < palette.length; c++) { const d = d2(px, palette[c]); if (d < bd) { bd = d; bi = c; } }
    labels[p] = bi; counts[bi]++;
  }
  return { palette, labels, counts };
}

/** Majority filter on a label map: removes isolated mislabelled pixels and ragged edges. Label 255 is left alone. */
export function smoothLabels(labels, w, h, passes = 1) {
  let cur = labels;
  for (let pass = 0; pass < passes; pass++) {
    const out = Uint8Array.from(cur), count = new Uint16Array(256);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cur[i] === 255) continue;
      const seen = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const l = cur[ny * w + nx];
        if (l === 255) continue;
        if (!count[l]) seen.push(l);
        count[l]++;
      }
      let best = cur[i], bc = count[cur[i]];
      for (const l of seen) if (count[l] > bc) { bc = count[l]; best = l; }
      out[i] = best;
      for (const l of seen) count[l] = 0;
    }
    cur = out;
  }
  return cur;
}

/**
 * Posterize into printable layers. Every layer is a mask on the SAME canvas, so the layers line up exactly
 * (that is the whole point for stamping each colour separately). Cropping, if asked, uses the union of all layers.
 * @param {object} o
 *  colors (2-8), smooth (label-smoothing passes), paper ('lightest' | 'none' | palette index): the colour that is
 *  the paper, not a layer; minInk / fillHoles (px^2, per layer); crop (bool) + cropPad (px)
 * @returns {{ palette, labels, width, height, paper: number | null, layers: { index, color, mask, coverage }[] }}
 */
export function posterize(img, { colors = 4, smooth = 1, paper = 'lightest', minInk = 0, fillHoles = 0, crop = false, cropPad = 0 } = {}) {
  const { width: w, height: h } = img;
  const q = quantize(img, colors);
  let labels = smooth > 0 ? smoothLabels(q.labels, w, h, smooth) : q.labels;
  const paperIdx = paper === 'lightest' ? q.palette.length - 1 : (paper === 'none' || paper == null ? null : paper);
  let layers = q.palette.map((color, index) => {
    if (index === paperIdx) return null;
    let mask = new Uint8Array(w * h);
    for (let p = 0; p < mask.length; p++) mask[p] = labels[p] === index ? 1 : 0;
    mask = despeckle(mask, w, h, { minInk, minHole: fillHoles });
    return { index, color, mask };
  }).filter(Boolean);
  let outW = w, outH = h, x0 = 0, y0 = 0;
  if (crop && layers.length) {
    let ax0 = w, ay0 = h, ax1 = -1, ay1 = -1;
    for (const { mask } of layers) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < ax0) ax0 = x; if (x > ax1) ax1 = x; if (y < ay0) ay0 = y; if (y > ay1) ay1 = y; }
    if (ax1 >= 0) {
      x0 = Math.max(0, ax0 - cropPad); y0 = Math.max(0, ay0 - cropPad);
      const x1 = Math.min(w - 1, ax1 + cropPad), y1 = Math.min(h - 1, ay1 + cropPad);
      outW = x1 - x0 + 1; outH = y1 - y0 + 1;
      const cut = src => { const o = new Uint8Array(outW * outH); for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) o[y * outW + x] = src[(y + y0) * w + x + x0]; return o; };
      layers = layers.map(l => ({ ...l, mask: cut(l.mask) }));
      labels = cut(labels);
    }
  }
  layers = layers.map(l => ({ ...l, coverage: l.mask.reduce((s, v) => s + v, 0) / (outW * outH) }));
  return { palette: q.palette, labels, width: outW, height: outH, paper: paperIdx, layers, crop: { x0, y0 } };
}

/** Preview image of a posterize result: each pixel in its palette colour, paper and transparent as `paperColor`. */
export function posterPreview(res, { paperColor = [255, 255, 255, 255] } = {}) {
  const { labels, palette, width: w, height: h, paper } = res;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const l = labels[p];
    if (l === 255 || l === paper) out.set(paperColor, p * 4);
    else out.set([palette[l][0], palette[l][1], palette[l][2], 255], p * 4);
  }
  return out;
}

export const rgbToHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/**
 * SVGs for the layers of a posterize result. Every layer has the same viewBox, so they register exactly.
 * @param {{ layers: {index, color, mask}[], width: number, height: number }} res
 * @param {object} o  tolerance, minArea, smooth (as maskToSvg); fill: override every layer's fill (e.g. '#000000' for the stamp generator)
 * @returns {{ layers: { index, color, svg, shapes }[], combined: string }}  combined = one SVG, one path per layer in its colour
 */
export function layersToSvg(res, { fill = null, ...opts } = {}) {
  const { width: w, height: h } = res;
  const layers = res.layers.map(l => {
    const out = maskToSvg(l.mask, w, h, { ...opts, color: fill || rgbToHex(l.color) });
    return { index: l.index, color: l.color, svg: out.svg, shapes: out.shapes, d: out.d };
  });
  const paths = layers.filter(l => l.d).map(l => `<path fill="${fill || rgbToHex(l.color)}" fill-rule="evenodd" d="${l.d}"/>`).join('');
  return { layers, combined: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths}</svg>` };
}
