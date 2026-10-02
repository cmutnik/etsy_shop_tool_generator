// Copyright (c) 2025 cmutnik
// Seeded segmentation (a "random walker", Grady 2006): the user marks a few pixels as subject and a few as background, and every
// other pixel gets the probability that a random walk started there reaches a subject mark before a background mark. Walks are
// biased against crossing image edges, so the boundary settles on the real outline. Pure functions on typed arrays.

/** Box-average RGBA down to at most maxSide on the long side. Returns { rgb: Float32Array(n*3, 0..1), width, height, scale }. */
export function downscale(img, maxSide) {
  const { data, width: w, height: h } = img;
  const scale = Math.max(1, Math.max(w, h) / maxSide);
  const cw = Math.max(1, Math.round(w / scale)), ch = Math.max(1, Math.round(h / scale));
  const rgb = new Float32Array(cw * ch * 3), count = new Float32Array(cw * ch);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(ch - 1, Math.floor((y * ch) / h));
    for (let x = 0; x < w; x++) {
      const cx = Math.min(cw - 1, Math.floor((x * cw) / w)), i = (cy * cw + cx), p = (y * w + x) * 4, a = data[p + 3] / 255;
      // transparent pixels count as white paper
      rgb[i * 3] += (data[p] * a + 255 * (1 - a)) / 255; rgb[i * 3 + 1] += (data[p + 1] * a + 255 * (1 - a)) / 255; rgb[i * 3 + 2] += (data[p + 2] * a + 255 * (1 - a)) / 255;
      count[i]++;
    }
  }
  for (let i = 0; i < cw * ch; i++) if (count[i]) { rgb[i * 3] /= count[i]; rgb[i * 3 + 1] /= count[i]; rgb[i * 3 + 2] /= count[i]; }
  return { rgb, width: cw, height: ch, scale };
}

/** Marks (0 none, 1 subject, 2 background) at full resolution -> the coarse grid. A cell takes the label that has more marked pixels in it. */
export function downscaleMarks(marks, w, h, cw, ch) {
  const fg = new Uint32Array(cw * ch), bg = new Uint32Array(cw * ch);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(ch - 1, Math.floor((y * ch) / h));
    for (let x = 0; x < w; x++) {
      const m = marks[y * w + x];
      if (!m) continue;
      const cx = Math.min(cw - 1, Math.floor((x * cw) / w));
      if (m === 1) fg[cy * cw + cx]++; else bg[cy * cw + cx]++;
    }
  }
  const out = new Uint8Array(cw * ch);
  for (let i = 0; i < out.length; i++) out[i] = fg[i] === 0 && bg[i] === 0 ? 0 : fg[i] >= bg[i] ? 1 : 2;
  return out;
}

/**
 * Probability (0..1) that each pixel belongs to the subject.
 * @param {{ rgb: Float32Array, width: number, height: number }} grid  colours 0..1
 * @param {Uint8Array} marks  0 none, 1 subject, 2 background (same grid)
 * @param {object} o  beta: how strongly image edges block the walk (higher = the boundary sticks to weaker edges); maxIter; tol
 * @returns {{ prob: Float32Array, iterations: number }}
 */
export function randomWalker(grid, marks, { beta = 120, maxIter = 600, tol = 1e-5 } = {}) {
  const { rgb, width: w, height: h } = grid, n = w * h;
  // edge weights between a pixel and its right / lower neighbour: exp(-beta * colour distance^2), colours 0..1 per channel.
  // An absolute scale (not relative to the picture's average edge) keeps ordinary noise cheap to cross however many strong
  // edges the picture has; a 14% colour step weighs about 0.1, a 50% step about 1e-13.
  const dist2 = (i, j) => (rgb[i * 3] - rgb[j * 3]) ** 2 + (rgb[i * 3 + 1] - rgb[j * 3 + 1]) ** 2 + (rgb[i * 3 + 2] - rgb[j * 3 + 2]) ** 2;
  const wr = new Float32Array(n), wd = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x + 1 < w) wr[i] = Math.exp(-beta * dist2(i, i + 1)) + 1e-6;
    if (y + 1 < h) wd[i] = Math.exp(-beta * dist2(i, i + w)) + 1e-6;
  }
  const x = new Float32Array(n), unknown = new Uint8Array(n);
  let anyFg = false, anyBg = false;
  for (let i = 0; i < n; i++) { if (marks[i] === 1) { x[i] = 1; anyFg = true; } else if (marks[i] === 2) { x[i] = 0; anyBg = true; } else unknown[i] = 1; }
  if (!anyFg || !anyBg) return { prob: x, iterations: 0 };
  // neighbour weights as a function: w(i, direction)
  const neighbours = i => {
    const px = i % w, out = [];
    if (px > 0) out.push([i - 1, wr[i - 1]]);
    if (px + 1 < w) out.push([i + 1, wr[i]]);
    if (i >= w) out.push([i - w, wd[i - w]]);
    if (i + w < n) out.push([i + w, wd[i]]);
    return out;
  };
  const diag = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!unknown[i]) continue;
    let d = 1e-6;                                            // tiny regulariser: pixels cut off from every mark fall to background
    for (const [j, wgt] of neighbours(i)) { d += wgt; if (!unknown[j]) b[i] += wgt * x[j]; }
    diag[i] = d;
  }
  const A = (v, out) => {                                    // out = L_uu v
    for (let i = 0; i < n; i++) {
      if (!unknown[i]) { out[i] = 0; continue; }
      let s = diag[i] * v[i];
      const px = i % w;
      if (px > 0 && unknown[i - 1]) s -= wr[i - 1] * v[i - 1];
      if (px + 1 < w && unknown[i + 1]) s -= wr[i] * v[i + 1];
      if (i >= w && unknown[i - w]) s -= wd[i - w] * v[i - w];
      if (i + w < n && unknown[i + w]) s -= wd[i] * v[i + w];
      out[i] = s;
    }
  };
  // Jacobi-preconditioned conjugate gradients on the unknown pixels
  const u = new Float32Array(n), r = Float32Array.from(b), z = new Float32Array(n), p = new Float32Array(n), Ap = new Float32Array(n);
  let rz = 0, bnorm = 0;
  for (let i = 0; i < n; i++) if (unknown[i]) { z[i] = r[i] / diag[i]; p[i] = z[i]; rz += r[i] * z[i]; bnorm += b[i] * b[i]; }
  let it = 0;
  if (bnorm > 0) {
    for (; it < maxIter; it++) {
      A(p, Ap);
      let pAp = 0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      if (pAp <= 0) break;
      const alpha = rz / pAp;
      let rnorm = 0, rzNew = 0;
      for (let i = 0; i < n; i++) { if (!unknown[i]) continue; u[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rnorm += r[i] * r[i]; z[i] = r[i] / diag[i]; rzNew += r[i] * z[i]; }
      if (Math.sqrt(rnorm / bnorm) < tol) { it++; break; }
      const beta2 = rzNew / rz; rz = rzNew;
      for (let i = 0; i < n; i++) if (unknown[i]) p[i] = z[i] + beta2 * p[i];
    }
  }
  for (let i = 0; i < n; i++) if (unknown[i]) x[i] = Math.max(0, Math.min(1, u[i]));
  return { prob: x, iterations: it };
}

/** Bilinear upsample of a coarse probability grid to full size. */
export function upsample(prob, cw, ch, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(ch - 1, ((y + 0.5) * ch) / h - 0.5)), y0 = Math.floor(fy), y1 = Math.min(ch - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(cw - 1, ((x + 0.5) * cw) / w - 0.5)), x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), tx = fx - x0;
      out[y * w + x] = (prob[y0 * cw + x0] * (1 - tx) + prob[y0 * cw + x1] * tx) * (1 - ty) + (prob[y1 * cw + x0] * (1 - tx) + prob[y1 * cw + x1] * tx) * ty;
    }
  }
  return out;
}

/**
 * Subject mask from user marks, at the picture's full size.
 * @param {{ data, width, height }} img  RGBA
 * @param {Uint8Array} marks  full-size: 0 none, 1 subject, 2 background
 * @param {object} o  maxSide (solve on a grid this big), bias (0..1: the cut-off; lower includes more), beta
 * @returns {{ subject: Uint8Array, prob: Float32Array, iterations: number } | null}  null until both kinds of mark exist
 */
export function segmentWithMarks(img, marks, { maxSide = 480, bias = 0.5, beta = 120 } = {}) {
  const { width: w, height: h } = img;
  let hasFg = false, hasBg = false;
  for (let i = 0; i < marks.length && !(hasFg && hasBg); i++) { if (marks[i] === 1) hasFg = true; else if (marks[i] === 2) hasBg = true; }
  if (!hasFg || !hasBg) return null;
  const grid = downscale(img, maxSide);
  const cm = downscaleMarks(marks, w, h, grid.width, grid.height);
  const { prob: coarse, iterations } = randomWalker(grid, cm, { beta });
  const prob = grid.width === w && grid.height === h ? coarse : upsample(coarse, grid.width, grid.height, w, h);
  const subject = new Uint8Array(w * h), cut = 1 - bias;
  for (let i = 0; i < subject.length; i++) subject[i] = prob[i] >= cut ? 1 : 0;
  for (let i = 0; i < subject.length; i++) { if (marks[i] === 1) subject[i] = 1; else if (marks[i] === 2) subject[i] = 0; }    // marks are always honoured
  return { subject, prob, iterations };
}
