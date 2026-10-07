// Copyright (c) 2025 cmutnik
// 2D polygon booleans (union / difference) and small shape generators. Rings are arrays of [x, y].
// Built on polygon-clipping so tools can combine shapes (a loop and a neck, a slot cut out of a base)
// without a 3D CSG library: combine in 2D, then extrude.
import polygonClipping from 'polygon-clipping';
import { circleRing, roundedRectRing, dropCollinear, roundCorners } from './rings.js';

// the ring helpers live in rings.js (no dependencies); re-exported so existing imports keep working
export { circleRing, roundedRectRing, dropCollinear, roundCorners };

const poly = ring => [ring];
const asMulti = g => (Array.isArray(g[0][0][0]) ? g : [g]); // Polygon -> MultiPolygon

/** Union of rings and/or multipolygons. Returns a MultiPolygon. */
export function union(...shapes) {
  const [first, ...rest] = shapes.map(s => (typeof s[0][0] === 'number' ? poly(s) : s));
  return polygonClipping.union(first, ...rest);
}

/** subject minus each clip. Returns a MultiPolygon. */
export function difference(subject, ...clips) {
  const norm = s => (typeof s[0][0] === 'number' ? poly(s) : s);
  return polygonClipping.difference(norm(subject), ...clips.map(norm));
}

/** Overlap of the subject with every clip. Returns a MultiPolygon. */
export function intersection(subject, ...clips) {
  const norm = s => (typeof s[0][0] === 'number' ? poly(s) : s);
  return polygonClipping.intersection(norm(subject), ...clips.map(norm));
}

/** MultiPolygon -> groups ({ outer, holes }), dropping the closing duplicate point of each ring. */
export function multiPolygonToGroups(mp) {
  if (!mp.length) return [];
  const open = ring => ring.slice(0, -1);
  return asMulti(mp).map(([outer, ...holes]) => ({ outer: open(outer), holes: holes.map(open) }));
}

export function flipYGroups(groups) {
  const f = ring => ring.map(([x, y]) => [x, -y]);
  return groups.map(g => ({ outer: f(g.outer), holes: g.holes.map(f) }));
}
