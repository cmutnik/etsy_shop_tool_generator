// Copyright (c) 2025 cmutnik
// 3D cuts with manifold-3d (WASM): a hole through the model, engraved text, and a split at a height with alignment pegs.
// The library is loaded on first use, so pages that never cut do not download it. Parts are { name, color, positions, indices }.
// Every function takes parts in their final orientation (on the bed, z up) and returns new parts; it never changes its input.
import { pointInPoly } from '../../shared/js/geometry-pure.js';

let wasm = null;
export async function loadManifold() {
  if (!wasm) {
    const mod = await import('manifold-3d');
    const w = await mod.default();
    w.setup();
    wasm = w;
  }
  return wasm;
}

const SEGMENTS = 64;
const notClosed = part => new Error(`"${part.name}" is not a closed (watertight) solid, so it cannot be cut. Use "Repair open edges" first, or untick that part.`);

export function toManifold(w, part) {
  const mesh = new w.Mesh({ numProp: 3, vertProperties: part.positions, triVerts: part.indices });
  mesh.merge();
  let m;
  try { m = w.Manifold.ofMesh(mesh); } catch { throw notClosed(part); }
  if (m.isEmpty() || (m.status && m.status() !== 'NoError')) { m.delete(); throw notClosed(part); }
  return m;
}

export function fromManifold(m, like) {
  const mesh = m.getMesh(), n = mesh.numProp, count = mesh.vertProperties.length / n;
  let positions = mesh.vertProperties;
  if (n !== 3) { positions = new Float32Array(count * 3); for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] = mesh.vertProperties[i * n + k]; }
  else positions = Float32Array.from(positions);
  return { ...like, positions, indices: Uint32Array.from(mesh.triVerts) };
}

function partBounds(part) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < part.positions.length; i += 3) for (let k = 0; k < 3; k++) { const v = part.positions[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max };
}
const overlaps = (a, b) => [0, 1, 2].every(k => a.min[k] <= b.max[k] && a.max[k] >= b.min[k]);

/** Subtract a cutter (a Manifold built by `makeCutter(w)`, inside `box` = { min, max }) from every part it touches. Other parts pass through untouched. */
async function subtractFrom(parts, box, makeCutter) {
  const w = await loadManifold(), cutter = makeCutter(w), made = [cutter];
  try {
    return parts.map(p => {
      if (!overlaps(partBounds(p), box)) return p;
      const m = toManifold(w, p); made.push(m);
      const r = m.subtract(cutter); made.push(r);
      return r.isEmpty() ? null : fromManifold(r, p);
    }).filter(Boolean);
  } finally { made.forEach(m => m.delete()); }
}

const AXIS = { x: 0, y: 1, z: 2 };

/**
 * A round hole along one axis. opts: { axis: 'z' | 'x' | 'y', from: 1 | -1, a, b, diameter, depth }
 *  axis   the direction the hole runs: 'z' is straight down / up, 'x' and 'y' are sideways
 *  from   the end it is drilled from: 1 = the high end (top, +X, +Y), -1 = the low end (bottom, -X, -Y)
 *  a, b   the hole's centre across the axis: z -> (x, y); x -> (y, z); y -> (x, z), all in model coordinates (centred, on the bed at z = 0)
 *  depth  how far in from that end; null or 0 goes all the way through
 * `x` and `y` are accepted instead of `a` and `b` for a vertical hole. Returns { parts, touched }: `touched` says whether the hole met any material.
 */
export async function cutHole(parts, { axis = 'z', from = 1, a, b, x, y, diameter, depth = null }) {
  if (!(axis in AXIS)) throw new Error(`Unknown hole direction: ${axis}`);
  if (a === undefined && axis === 'z') { a = x; b = y; }
  if (!(diameter >= 1)) throw new Error('The hole must be at least 1 mm across.');
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Enter where the hole goes.');
  const k = AXIS[axis], r = diameter / 2;
  let lo = Infinity, hi = -Infinity;
  for (const p of parts) { const q = partBounds(p); lo = Math.min(lo, q.min[k]); hi = Math.max(hi, q.max[k]); }
  const start = depth ? (from > 0 ? hi - depth : lo - 1) : lo - 1, end = depth ? (from > 0 ? hi + 1 : lo + depth) : hi + 1;
  const centre = axis === 'z' ? [a, b, null] : axis === 'x' ? [null, a, b] : [a, null, b];     // across-axis position; null on the hole's own axis
  const min = centre.map((c, i) => (c === null ? start : c - r)), max = centre.map((c, i) => (c === null ? end : c + r));
  const out = await subtractFrom(parts, { min, max }, w => {
    const cyl = w.Manifold.cylinder(end - start, r, r, SEGMENTS, false);               // along +z from 0
    if (axis === 'z') return cyl.translate([a, b, start]);
    if (axis === 'x') return cyl.rotate([0, 90, 0]).translate([start, a, b]);           // +z turned onto +x
    return cyl.rotate([-90, 0, 0]).translate([a, start, b]);                          // +z turned onto +y
  });
  return { parts: out, touched: out.length !== parts.length || out.some(p => !parts.includes(p)) };
}

/** Cut text (groups of rings, in model x / y) from z0 up to z1. Uses even-odd filling so letter counters stay open. */
export async function cutText(parts, groups, z0, z1) {
  const rings = groups.flatMap(g => [g.outer, ...g.holes]);
  const xs = rings.flatMap(r => r.map(p => p[0])), ys = rings.flatMap(r => r.map(p => p[1]));
  const box = { min: [Math.min(...xs), Math.min(...ys), z0], max: [Math.max(...xs), Math.max(...ys), z1] };
  return subtractFrom(parts, box, w => w.CrossSection.ofPolygons(rings, 'EvenOdd').extrude(z1 - z0).translate([0, 0, z0]));
}

/** Two pegs (or one on a small face) placed well inside the cross-section `cs`, as far apart as possible. */
function pegSpots(cs, radius) {
  const inset = cs.offset(-(radius + 1.5), 'Round'), rings = inset.toPolygons().map(r => r.map(p => [p[0], p[1]]));
  inset.delete();
  if (!rings.length) return [];
  const inside = pt => rings.filter(r => pointInPoly(pt, r)).length % 2 === 1;
  const xs = rings.flatMap(r => r.map(p => p[0])), ys = rings.flatMap(r => r.map(p => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), N = 14, pts = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) { const pt = [x0 + ((x1 - x0) * i) / N, y0 + ((y1 - y0) * j) / N]; if (inside(pt)) pts.push(pt); }
  if (!pts.length) return [];
  let best = null;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (!best || d > best.d) best = { d, a: pts[i], b: pts[j] };
  }
  if (best && best.d >= radius * 6) return [best.a, best.b];
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [pts.reduce((a, p) => (Math.hypot(p[0] - cx, p[1] - cy) < Math.hypot(a[0] - cx, a[1] - cy) ? p : a))];
}

/**
 * Cut the model at height `z`. opts: { z, keep: 'both' | 'lower' | 'upper', pegs, pegDiameter, pegHeight, clearance, gap }
 *  lower  keeps the part below the plane, flat side up
 *  upper  keeps the part above, dropped to the bed so its cut face is the bottom
 *  both   lower stays where it is; upper is dropped to the bed beside it (gap mm apart); with `pegs`, the lower half gets pegs on
 *         its cut face and the upper half gets matching sockets (peg plus `clearance`).
 * Returns { parts, warnings }. The result is centred in x / y.
 */
export async function splitModel(parts, { z, keep = 'both', pegs = false, pegDiameter = 5, pegHeight = 4, clearance = 0.25, gap = 8 }) {
  const w = await loadManifold(), made = [], warnings = [];
  const top = Math.max(...parts.map(p => partBounds(p).max[2]));
  if (!(z > 0.5 && z < top - 0.5)) throw new Error(`Cut at a height between 0.5 and ${(top - 0.5).toFixed(1)} mm (the model is ${top.toFixed(1)} mm tall).`);
  const lower = [], upper = [];
  let cross = null;
  try {
    for (const p of parts) {
      const m = toManifold(w, p); made.push(m);
      const [hi, lo] = m.splitByPlane([0, 0, 1], z); made.push(hi, lo);
      if (!lo.isEmpty()) lower.push(fromManifold(lo, p));
      if (!hi.isEmpty()) upper.push(fromManifold(hi, p));
      if (keep === 'both' && pegs) { const s = m.slice(z); made.push(s); if (cross) { const sum = cross.add(s); made.push(sum); cross = sum; } else cross = s; }
    }
    let pegPart = null, socketed = upper;
    if (keep === 'both' && pegs && lower.length && upper.length) {
      const r = pegDiameter / 2, spots = cross ? pegSpots(cross, r) : [];
      if (!spots.length) warnings.push('The cut face is too small for alignment pegs, so none were added.');
      else {
        const peg = ([px, py]) => w.Manifold.cylinder(pegHeight + 0.5, r, r, SEGMENTS, false).translate([px, py, z - 0.5]);
        const socket = ([px, py]) => w.Manifold.cylinder(pegHeight + clearance + 0.5, r + clearance, r + clearance, SEGMENTS, false).translate([px, py, z - 0.01]);
        const pegSolid = w.Manifold.union(spots.map(peg)); made.push(pegSolid);
        const sockets = w.Manifold.union(spots.map(socket)); made.push(sockets);
        const topOfUpper = Math.max(...upper.map(p => partBounds(p).max[2]));
        if (topOfUpper - z < pegHeight + clearance + 1) warnings.push('The upper half is too thin for pegs this tall: they would nearly come through the top. Use shorter pegs or cut lower.');
        socketed = upper.map(p => {
          const m = toManifold(w, p); made.push(m);
          const r2 = m.subtract(sockets); made.push(r2);
          return fromManifold(r2, p);
        });
        pegPart = { ...fromManifold(pegSolid, lower[0]), name: 'Alignment pegs', color: lower[0].color };
      }
    }
    let out;
    const dropTo = list => { for (const p of list) for (let i = 2; i < p.positions.length; i += 3) p.positions[i] -= z; };
    if (keep === 'lower') out = lower;
    else if (keep === 'upper') { dropTo(socketed); out = socketed; }
    else {
      dropTo(socketed);
      const lo = lower.map(partBounds), up = socketed.map(partBounds);
      const dx = Math.max(...lo.map(b => b.max[0])) - Math.min(...up.map(b => b.min[0])) + gap;
      for (const p of socketed) for (let i = 0; i < p.positions.length; i += 3) p.positions[i] += dx;
      out = [...lower, ...(pegPart ? [pegPart] : []), ...socketed];
    }
    if (!out.length) throw new Error('Nothing is left on that side of the cut.');
    const b = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    for (const p of out) { const q = partBounds(p); for (let k = 0; k < 2; k++) { b.min[k] = Math.min(b.min[k], q.min[k]); b.max[k] = Math.max(b.max[k], q.max[k]); } }
    const sx = -(b.min[0] + b.max[0]) / 2, sy = -(b.min[1] + b.max[1]) / 2;
    for (const p of out) for (let i = 0; i < p.positions.length; i += 3) { p.positions[i] += sx; p.positions[i + 1] += sy; }
    return { parts: out, warnings };
  } finally { made.forEach(m => { try { m.delete(); } catch { /* already freed */ } }); }
}
