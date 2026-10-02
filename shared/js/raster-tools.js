// Copyright (c) 2025 cmutnik
// Small raster helpers for checking printability of flat artwork.

/** Raised or black features narrower than this (mm) are flagged: a 0.4 mm nozzle prints them unreliably. Shared by the stamp and Image Prep. */
export const MIN_FEATURE_MM = 0.6;

/** Exact squared Euclidean distance (Felzenszwalb) from every pixel to the nearest pixel where `isSource(i)`. */
export function distanceSquared(w, h, isSource) {
  const INF = 1e20, d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = isSource(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n), g = new Float64Array(n);
  // 1-D squared-distance transform of f[0..len) via the lower envelope of parabolas; result written back to f
  const pass = len => {
    for (let q = 0; q < len; q++) g[q] = f[q];
    const inter = (q, p) => ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = inter(q, v[k]);
      while (s <= z[k]) { k--; s = inter(q, v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      f[q] = (q - v[k]) ** 2 + g[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = f[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) d[y * w + x] = f[x];
  }
  return d;
}

/**
 * Ink pixels that belong to features narrower than ~2*radius (they vanish under a morphological opening).
 * @param {Uint8Array} mask w*h, nonzero = ink
 * @returns {{ thin: Uint8Array, inkPixels: number, thinPixels: number }}
 */
export function thinFeatures(mask, w, h, radius) {
  const r2 = radius * radius;
  // erode: keep ink pixels at least `radius` from paper (pad the border as paper)
  const pw = w + 2, ph = h + 2;
  const dPaper = distanceSquared(pw, ph, i => {
    const x = i % pw - 1, y = ((i / pw) | 0) - 1;
    return x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x];
  });
  const eroded = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] && dPaper[(y + 1) * pw + x + 1] >= r2) eroded[y * w + x] = 1;
  // dilate: everything within `radius` of the eroded core survives the opening
  const dCore = distanceSquared(w, h, i => eroded[i] === 1);
  const thin = new Uint8Array(w * h);
  let ink = 0, thinPx = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    ink++;
    if (dCore[i] > r2) { thin[i] = 1; thinPx++; }
  }
  return { thin, inkPixels: ink, thinPixels: thinPx };
}
