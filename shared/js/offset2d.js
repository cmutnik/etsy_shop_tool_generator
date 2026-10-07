// Copyright (c) 2025 cmutnik
// 2D offsetting without a library: a ring's "stroke" (everything within r of its outline) is the union of one capsule per edge.
// From that: dilate a shape by r, or take a band of width r along its outline. Used for name-keychain backing plates and
// cookie-cutter walls. Units are millimetres; shapes are groups ({ outer, holes }) as everywhere else.
import polygonClipping from 'polygon-clipping';
import { simplifyRing, signedArea } from './geometry-pure.js';

/** A stadium around the segment a-b: a rectangle of half-width r with a half-disc on each end. */
function capsule(a, b, r, arc) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), pts = [];
  for (let i = 0; i <= arc; i++) { const t = ang - Math.PI / 2 + (i / arc) * Math.PI; pts.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]); }
  for (let i = 0; i <= arc; i++) { const t = ang + Math.PI / 2 + (i / arc) * Math.PI; pts.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]); }
  return pts;
}

/**
 * polygon-clipping can throw ("Unable to find segment ... in SweepLine tree") on input with near-coincident edges, which
 * capsules round curved letters produce. Snapping coordinates to a coarse grid and trying again clears it; the snap is far
 * below anything a printer can resolve (the first try is 0.005 mm, the last 0.05 mm).
 */
function robust(op, ...args) {
  try { return op(...args); } catch (first) {
    for (const step of [0.005, 0.01, 0.02, 0.05]) {
      const snap = v => (Array.isArray(v) ? v.map(snap) : Math.round(v / step) * step);
      try { return op(...args.map(snap)); } catch { /* try a coarser grid */ }
    }
    throw first;
  }
}
const clipUnion = (...a) => robust(polygonClipping.union, ...a);
const clipDifference = (...a) => robust(polygonClipping.difference, ...a);

const polygonsOf = groups => groups.map(g => [g.outer, ...g.holes]);

/** Closed rings -> MultiPolygon covering every point within r of an outline. `tol` thins the rings first (mm). */
export function strokeRings(rings, r, { tol = 0.04, arc = 6 } = {}) {
  const caps = [];
  for (const ring of rings) {
    const pts = ring.length > 8 ? simplifyRing(ring, tol) : ring;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) caps.push([capsule(a, b, r, arc)]);
    }
  }
  if (!caps.length) return [];
  return clipUnion(caps[0], ...caps.slice(1));
}

const ringsOf = groups => groups.flatMap(g => [g.outer, ...g.holes]);

/** The shape grown outwards by r (holes shrink, and close up where they are narrower than 2r). Returns a MultiPolygon. */
export function dilate(groups, r, o) {
  if (!groups.length) return [];
  return clipUnion(polygonsOf(groups), strokeRings(ringsOf(groups), r, o));
}

/** The band of width r just outside the shape's outline (outside the outer edge, and inside each hole). Returns a MultiPolygon. */
export function outerBand(groups, r, o) {
  if (!groups.length) return [];
  return clipDifference(strokeRings(ringsOf(groups), r, o), polygonsOf(groups));
}

/** The shape shrunk inwards by r (thin parts vanish, and holes grow). Returns a MultiPolygon. */
export function inset(groups, r, o) {
  if (!groups.length) return [];
  return clipDifference(polygonsOf(groups), strokeRings(ringsOf(groups), r, o));
}

/** The shape with its holes removed. */
export const fillHoles = groups => groups.map(g => ({ outer: g.outer, holes: [] }));

/** Polygon area of a MultiPolygon (holes subtracted). */
export function multiArea(mp) {
  let a = 0;
  for (const [outer, ...holes] of mp) { a += Math.abs(signedArea(outer)); for (const h of holes) a -= Math.abs(signedArea(h)); }
  return a;
}
