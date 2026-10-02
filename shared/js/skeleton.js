// Copyright (c) 2025 cmutnik
// Centre-line tracing: thin a mask to a 1 px skeleton, prune stray branches, and turn it into paths.
// Pure functions on typed arrays (mask: Uint8Array w*h, 1 = ink), no browser APIs.
import { fitOpen, fitClosed, openChainToPath, closedChainToPath } from './curves.js';

/** Zhang-Suen thinning: shrinks every stroke to a one pixel wide, 8-connected centre line. */
export function thin(mask, w, h) {
  const W = w + 2, H = h + 2, g = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[(y + 1) * W + x + 1] = mask[y * w + x] ? 1 : 0;
  const del = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!g[i]) continue;
        const p2 = g[i - W], p3 = g[i - W + 1], p4 = g[i + 1], p5 = g[i + W + 1], p6 = g[i + W], p7 = g[i + W - 1], p8 = g[i - 1], p9 = g[i - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (step === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        del.push(i);
      }
      for (const i of del) g[i] = 0;
      if (del.length) changed = true;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = g[(y + 1) * W + x + 1];
  return out;
}

const NB = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

/**
 * Indices of the neighbours of pixel i that count as connections. A diagonal neighbour is dropped when one of the two
 * pixels between them is also set (an L-shaped corner would otherwise look like a junction).
 */
function neighbours(g, w, h, i) {
  const x = i % w, y = (i / w) | 0, out = [];
  for (const [dx, dy] of NB) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h || !g[ny * w + nx]) continue;
    if (dx && dy && (g[y * w + nx] || g[ny * w + x])) continue;
    out.push(ny * w + nx);
  }
  return out;
}

/** Remove branches shorter than `length` px that end freely (spurs), keeping the real line ends at full length. */
export function pruneSpurs(skel, w, h, length) {
  if (!(length > 0)) return skel;
  const endsOf = g => { const e = []; for (let i = 0; i < g.length; i++) if (g[i] && neighbours(g, w, h, i).length <= 1) e.push(i); return e; };
  const x1 = Uint8Array.from(skel);
  for (let k = 0; k < length; k++) { const e = endsOf(x1); if (!e.length) break; for (const i of e) x1[i] = 0; }
  // grow the surviving line ends back along the original skeleton, `length` steps
  const out = Uint8Array.from(x1);
  let frontier = endsOf(x1);
  for (let k = 0; k < length && frontier.length; k++) {
    const next = [];
    for (const i of frontier) for (const j of neighbours(skel, w, h, i)) if (!out[j]) { out[j] = 1; next.push(j); }
    frontier = next;
  }
  return out;
}

/**
 * Walk a skeleton into paths. Paths run between end points and junctions; loops with no junction come out closed.
 * @returns {{ points: number[][], closed: boolean }[]}  points in pixel coordinates (pixel centres)
 */
export function skeletonPaths(skel, w, h) {
  const N = w * h, deg = new Int8Array(N), nb = new Map();
  for (let i = 0; i < N; i++) if (skel[i]) { const n = neighbours(skel, w, h, i); nb.set(i, n); deg[i] = n.length; }
  const seenEdge = new Set(), seenPixel = new Uint8Array(N), paths = [];
  const key = (a, b) => (a < b ? a * N + b : b * N + a);
  const pt = i => [i % w, (i / w) | 0];
  for (const [start, ns] of nb) {
    if (deg[start] === 2) continue;                                   // start only at end points and junctions
    if (ns.length === 0) { paths.push({ points: [pt(start), pt(start)], closed: false }); seenPixel[start] = 1; continue; }
    for (const first of ns) {
      if (seenEdge.has(key(start, first))) continue;
      const idx = [start];
      let prev = start, cur = first;
      seenEdge.add(key(start, first));
      for (;;) {
        idx.push(cur);
        if (deg[cur] !== 2) break;
        const nxt = nb.get(cur).find(j => j !== prev);
        if (nxt === undefined || seenEdge.has(key(cur, nxt))) break;
        seenEdge.add(key(cur, nxt));
        prev = cur; cur = nxt;
      }
      for (const i of idx) seenPixel[i] = 1;
      paths.push({ points: idx.map(pt), closed: false });
    }
  }
  // loops: every pixel has exactly two neighbours, so nothing above started on them
  for (const [start] of nb) {
    if (seenPixel[start] || deg[start] !== 2) continue;
    const idx = [start];
    seenPixel[start] = 1;
    let prev = start, cur = nb.get(start)[0];
    while (cur !== start) {
      idx.push(cur); seenPixel[cur] = 1;
      const nxt = nb.get(cur).find(j => j !== prev);
      if (nxt === undefined) break;
      prev = cur; cur = nxt;
    }
    paths.push({ points: idx.map(pt), closed: true });
  }
  return paths;
}

/** Douglas-Peucker on an open polyline. */
export function simplifyPolyline(pts, tol) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  let idx = -1, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len < 1e-9 ? Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [a, b];
  return simplifyPolyline(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplifyPolyline(pts.slice(idx), tol));
}

const fmt = n => String(Math.round(n * 100) / 100);

/**
 * Paths -> an SVG of round-capped strokes of uniform width.
 * @param {object} o  width (px), color, tolerance (simplification, px), smooth (curve the corners slightly), minLength (px, drop shorter paths)
 */
export function pathsToStrokeSvg(paths, w, h, { width = 3, color = '#000000', tolerance = 0.8, smooth = true, minLength = 0, scale = 1 } = {}) {
  let d = '', count = 0;
  for (const p of paths) {
    let pts = p.points.map(([x, y]) => [x + 0.5, y + 0.5]);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (length < minLength) continue;
    if (smooth && pts.length >= 3) {
      // real curves: Beziers fitted to the pixel path (corners kept), tolerance in px
      d += p.closed ? closedChainToPath(fitClosed(pts, Math.max(0.3, tolerance))) : openChainToPath(fitOpen(pts, Math.max(0.3, tolerance)));
      count++;
      continue;
    }
    pts = p.closed ? simplifyPolyline(pts.concat([pts[0]]), tolerance).slice(0, -1) : simplifyPolyline(pts, tolerance);
    if (pts.length < 2) continue;
    d += 'M' + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L') + (p.closed ? 'Z' : '');
    count++;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${fmt(w * scale)}" height="${fmt(h * scale)}"><path fill="none" stroke="${color}" stroke-width="${fmt(width)}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
  return { svg, paths: count };
}

/** Whole pipeline: mask -> skeleton -> pruned -> paths. */
export function centerline(mask, w, h, { prune = 6 } = {}) {
  const skeleton = pruneSpurs(thin(mask, w, h), w, h, prune);
  return { skeleton, paths: skeletonPaths(skeleton, w, h) };
}
