// Copyright (c) 2025 cmutnik
// Cubic Bezier curve fitting (Philip Schneider's algorithm, "An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems).
// Turns a dense, slightly noisy outline (the 1 px steps of a traced bitmap) into a few smooth cubic curves, keeping real corners
// sharp. Pure functions; points are [x, y].

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = a => Math.hypot(a[0], a[1]);
const unit = a => { const l = len(a); return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l]; };

/** Point on a cubic Bezier [p0, c1, c2, p3] at t. */
export function bezierAt(b, t) {
  const u = 1 - t, a = u * u * u, c = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * b[0][0] + c * b[1][0] + d * b[2][0] + e * b[3][0], a * b[0][1] + c * b[1][1] + d * b[2][1] + e * b[3][1]];
}
const bezierD1 = (b, t) => { const u = 1 - t; return add(add(mul(sub(b[1], b[0]), 3 * u * u), mul(sub(b[2], b[1]), 6 * u * t)), mul(sub(b[3], b[2]), 3 * t * t)); };
const bezierD2 = (b, t) => add(mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6 * (1 - t)), mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6 * t));

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map(v => v / total);
}

/** Least-squares Bezier through pts with the given end tangents and parameter values. */
function generateBezier(pts, u, t1, t2) {
  const p0 = pts[0], p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], m = 1 - t, b0 = m * m * m, b1 = 3 * t * m * m, b2 = 3 * t * t * m, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const alpha1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0, alpha2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0;
  const seg = len(sub(p3, p0)), eps = 1e-6 * seg;
  if (alpha1 < eps || alpha2 < eps) {                       // fall back to a third of the chord (a gentle, safe curve)
    return [p0, add(p0, mul(t1, seg / 3)), add(p3, mul(t2, seg / 3)), p3];
  }
  return [p0, add(p0, mul(t1, alpha1)), add(p3, mul(t2, alpha2)), p3];
}

function maxError(pts, bez, u) {
  let max = 0, at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = bezierAt(bez, u[i]), d = (p[0] - pts[i][0]) ** 2 + (p[1] - pts[i][1]) ** 2;
    if (d >= max) { max = d; at = i; }
  }
  return { max, at };
}

function reparameterize(bez, pts, u) {
  return u.map((t, i) => {
    const d = sub(bezierAt(bez, t), pts[i]), d1 = bezierD1(bez, t), d2 = bezierD2(bez, t);
    const num = dot(d, d1), den = dot(d1, d1) + dot(d, d2);
    return Math.abs(den) < 1e-12 ? t : Math.max(0, Math.min(1, t - num / den));
  });
}

function fitCubic(pts, t1, t2, errSq, out, sm = pts, depth = 0) {
  if (depth > 200) {                                         // pathological data: give up on curves and keep the points as straight pieces
    for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i], pts[i + 1], pts[i + 1]]);
    return;
  }
  if (pts.length === 2) {
    const dist = len(sub(pts[1], pts[0])) / 3;
    out.push([pts[0], add(pts[0], mul(t1, dist)), add(pts[1], mul(t2, dist)), pts[1]]);
    return;
  }
  let u = chordParams(pts), bez = generateBezier(pts, u, t1, t2), { max, at } = maxError(pts, bez, u);
  if (max < errSq) { out.push(bez); return; }
  if (max < errSq * 16) {                                    // close enough to be worth refining the parameter values
    for (let k = 0; k < 6; k++) {
      u = reparameterize(bez, pts, u);
      bez = generateBezier(pts, u, t1, t2);
      ({ max, at } = maxError(pts, bez, u));
      if (max < errSq) { out.push(bez); return; }
    }
  }
  at = Math.max(1, Math.min(pts.length - 2, at));
  // tangent through the split point (pointing backwards), from the smoothed copy and a few samples either side so noise does not steer it
  const r = Math.max(1, Math.min(3, at, pts.length - 1 - at)), centre = unit(sub(sm[at - r], sm[at + r]));
  fitCubic(pts.slice(0, at + 1), t1, centre, errSq, out, sm.slice(0, at + 1), depth + 1);
  fitCubic(pts.slice(at), mul(centre, -1), t2, errSq, out, sm.slice(at), depth + 1);
}

/** Solve a 3x3 linear system (Cramer's rule); null if singular. */
function solve3(m, r) {
  const det = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const D = det(m[0], m[1], m[2]);
  if (Math.abs(D) < 1e-12) return null;
  const col = k => m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)));
  return [0, 1, 2].map(k => det(...col(k)) / D);
}

/**
 * Direction of a run at its first point, from a least-squares quadratic through its first few points, x(s) = a0 + a1 s + a2 s^2
 * with s the distance along the run. The quadratic follows a curve's bend, and fitting many points averages out 1 px staircase noise
 * (a chord or a one-sided difference does one or the other, not both).
 */
function startTangent(pts, m, skip = 0) {
  const total = Math.min(pts.length, skip + m), s = [0];
  for (let i = 1; i < total; i++) s.push(s[i - 1] + len(sub(pts[i], pts[i - 1])));
  const k = total;
  if (k - skip < 3 || s[k - 1] < 1e-9) return unit(sub(pts[Math.min(1, pts.length - 1)], pts[0]));
  let S = [0, 0, 0, 0, 0];
  const X = [0, 0, 0], Y = [0, 0, 0];
  // `skip` leading samples are left out of the fit (a corner's position is only known to a sample or two, and they would pull the
  // tangent towards the adjacent side), but s still counts from the first point, so the quadratic extrapolates back to it
  for (let i = skip; i < k; i++) {
    let pw = 1;
    for (let e = 0; e < 5; e++) { S[e] += pw; if (e < 3) { X[e] += pw * pts[i][0]; Y[e] += pw * pts[i][1]; } pw *= s[i]; }
  }
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]], ax = solve3(M, X), ay = solve3(M, Y);
  if (!ax || !ay) return unit(sub(pts[1], pts[0]));
  const t = unit([ax[1], ay[1]]);
  return len(t) < 1e-9 ? unit(sub(pts[1], pts[0])) : t;
}

/**
 * Unit tangents at both ends of an open run (t1 points forward at the start, t2 points backward at the end), from a quadratic
 * least-squares fit over the first / last ~25% of the points (6 to 40 of them). skipStart / skipEnd: leave that many end samples out
 * of the fit (use 2 where an end sits on a corner).
 */
export function endTangents(pts, skipStart = 0, skipEnd = 0) {
  const n = pts.length;
  if (n < 3) { const d = unit(sub(pts[n - 1], pts[0])); return { t1: d, t2: mul(d, -1) }; }
  const m = Math.max(6, Math.min(40, Math.ceil(n * 0.25)));      // a window that grows with the run: noise matters less over a longer stretch
  const sk = k => (n >= 2 * (k + m) ? k : 0);
  return { t1: startTangent(pts, m, sk(skipStart)), t2: startTangent(pts.slice().reverse(), m, sk(skipEnd)) };
}

/**
 * Fit an open run of points with as few cubic Beziers as the tolerance allows.
 * @param {number[][]} pts  at least 2 points
 * @param {number} tolerance  maximum distance (same units as the points) between the curve and the points
 * @param {{ t1?: number[], t2?: number[], skipStart?: number, skipEnd?: number }} o  unit end tangents (default: estimated from the ends,
 *   leaving out skipStart / skipEnd end samples when that end is a corner)
 * @returns {number[][][]}  list of [p0, c1, c2, p3]
 */
export function fitCurve(pts, tolerance, { t1, t2, skipStart = 0, skipEnd = 0 } = {}) {
  const clean = pts.filter((p, i) => i === 0 || len(sub(p, pts[i - 1])) > 1e-9);
  if (clean.length < 2) return [];
  const est = endTangents(clean, skipStart, skipEnd), out = [];
  let sm = clean;
  if (clean.length > 8) for (let pass = 0; pass < 2; pass++) { const cur = sm; sm = cur.map((q, i) => (i === 0 || i === cur.length - 1 ? q : [(cur[i - 1][0] + 2 * q[0] + cur[i + 1][0]) / 4, (cur[i - 1][1] + 2 * q[1] + cur[i + 1][1]) / 4])); }
  fitCubic(clean, t1 || est.t1, t2 || est.t2, tolerance * tolerance, out, sm);
  return out;
}

// ---------- outlines ----------

function smoothClosed(ring, passes) {
  let cur = ring;
  for (let p = 0; p < passes; p++) cur = cur.map((q, i) => { const a = cur[(i + cur.length - 1) % cur.length], c = cur[(i + 1) % cur.length]; return [(a[0] + 2 * q[0] + c[0]) / 4, (a[1] + 2 * q[1] + c[1]) / 4]; });
  return cur;
}

/** Indices of corners on a closed ring: places where the outline turns by more than `angle` degrees within a short window. */
export function findCorners(ring, { angle = 55, window = 5 } = {}) {
  const n = ring.length;
  if (n < 2 * window + 2) return [];
  const sm = smoothClosed(ring, 2), turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = sub(sm[i], sm[(i - window + n) % n]), b = sub(sm[(i + window) % n], sm[i]);
    const la = len(a), lb = len(b);
    turn[i] = la < 1e-9 || lb < 1e-9 ? 0 : (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) * 180) / Math.PI;
  }
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < angle) continue;
    let peak = true;
    for (let d = -window; d <= window && peak; d++) { const j = (i + d + n) % n; if (turn[j] > turn[i] || (turn[j] === turn[i] && d < 0)) peak = false; }
    if (peak) corners.push(i);
  }
  return corners;
}

/**
 * Fit a closed outline with cubic Beziers, keeping corners sharp.
 * @param {number[][]} ring  dense closed ring (no repeated closing point)
 * @returns {number[][][]}  closed chain of [p0, c1, c2, p3] (each p3 is the next p0)
 */
export function fitClosed(ring, tolerance = 1, { cornerAngle = 55 } = {}) {
  const n = ring.length;
  if (n < 3) return [];
  const corners = findCorners(ring, { angle: cornerAngle });
  const sm = smoothClosed(ring, 2);
  const tangentAt = i => unit(sub(sm[(i + 2) % n], sm[(i - 2 + n) % n]));
  const out = [];
  if (!corners.length) {
    // a smooth loop: start anywhere, with the same tangent at the start and the end
    const run = ring.concat([ring[0]]), t = tangentAt(0);
    fitCubic(run, t, mul(t, -1), tolerance * tolerance, out, smoothClosed(ring, 2).concat([smoothClosed(ring, 2)[0]]));
    return out;
  }
  for (let c = 0; c < corners.length; c++) {
    const i = corners[c], j = corners[(c + 1) % corners.length];
    const run = [];
    for (let k = i; ; k = (k + 1) % n) { run.push(ring[k]); if (k === j && run.length > 1) break; }
    if (run.length < 2) continue;
    const est = endTangents(run, 2, 2);                      // both ends of a run are corners
    let smr = run;
    if (run.length > 8) for (let pass = 0; pass < 2; pass++) { const cur = smr; smr = cur.map((q, i) => (i === 0 || i === cur.length - 1 ? q : [(cur[i - 1][0] + 2 * q[0] + cur[i + 1][0]) / 4, (cur[i - 1][1] + 2 * q[1] + cur[i + 1][1]) / 4])); }
    fitCubic(run, est.t1, est.t2, tolerance * tolerance, out, smr);
  }
  return out;
}

/** Indices of corners on an open polyline (never its two ends). */
export function findCornersOpen(pts, { angle = 55, window = 5 } = {}) {
  const n = pts.length;
  if (n < 2 * window + 1) return [];
  const turn = new Float64Array(n);
  for (let i = window; i < n - window; i++) {
    const a = sub(pts[i], pts[i - window]), b = sub(pts[i + window], pts[i]), la = len(a), lb = len(b);
    turn[i] = la < 1e-9 || lb < 1e-9 ? 0 : (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) * 180) / Math.PI;
  }
  const corners = [];
  for (let i = window; i < n - window; i++) {
    if (turn[i] < angle) continue;
    let peak = true;
    for (let d = -window; d <= window && peak; d++) { const j = i + d; if (j >= window && j < n - window && (turn[j] > turn[i] || (turn[j] === turn[i] && d < 0))) peak = false; }
    if (peak) corners.push(i);
  }
  return corners;
}

/** Fit an open polyline with Beziers, keeping corners sharp (it is cut at each corner and every piece is fitted on its own). */
export function fitOpen(pts, tolerance = 1, { cornerAngle = 55 } = {}) {
  if (pts.length < 2) return [];
  const smooth = pts.length > 4 ? [pts[0], ...pts.slice(1, -1).map((q, i) => { const a = pts[i], c = pts[i + 2]; return [(a[0] + 2 * q[0] + c[0]) / 4, (a[1] + 2 * q[1] + c[1]) / 4]; }), pts[pts.length - 1]] : pts;
  const cuts = [0, ...findCornersOpen(smooth, { angle: cornerAngle }), pts.length - 1], out = [];
  for (let c = 0; c + 1 < cuts.length; c++) out.push(...fitCurve(pts.slice(cuts[c], cuts[c + 1] + 1), tolerance, { skipStart: c > 0 ? 2 : 0, skipEnd: c + 2 < cuts.length ? 2 : 0 }));
  return out;
}

const fmt = n => String(Math.round(n * 100) / 100);

/** SVG path data (one closed subpath) for a chain from fitClosed. */
export function closedChainToPath(chain) {
  if (!chain.length) return '';
  let d = `M${fmt(chain[0][0][0])} ${fmt(chain[0][0][1])}`;
  for (const [, c1, c2, p3] of chain) d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p3[0])} ${fmt(p3[1])}`;
  return d + 'Z';
}

/** SVG path data for an open run fitted with fitCurve. */
export function openChainToPath(chain) {
  if (!chain.length) return '';
  let d = `M${fmt(chain[0][0][0])} ${fmt(chain[0][0][1])}`;
  for (const [, c1, c2, p3] of chain) d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p3[0])} ${fmt(p3[1])}`;
  return d;
}

/** Points along a chain at about `step` spacing (for measuring fit quality and areas). */
export function sampleChain(chain, step = 0.25) {
  const pts = [];
  for (const b of chain) {
    const ctrl = len(sub(b[1], b[0])) + len(sub(b[2], b[1])) + len(sub(b[3], b[2])), n = Math.max(8, Math.ceil(ctrl / step));
    for (let i = 0; i < n; i++) pts.push(bezierAt(b, i / n));
  }
  if (chain.length) pts.push(chain[chain.length - 1][3]);
  return pts;
}
