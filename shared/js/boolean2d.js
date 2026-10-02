// Copyright (c) 2025 cmutnik
// 2D polygon booleans (union / difference) and small shape generators. Rings are arrays of [x, y].
// Built on polygon-clipping so tools can combine shapes (a loop and a neck, a slot cut out of a base)
// without a 3D CSG library: combine in 2D, then extrude.
import polygonClipping from 'polygon-clipping';

/** Circle as a ring (counter-clockwise). */
export function circleRing(cx, cy, r, steps = 64) {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/**
 * Axis-aligned rectangle with individually rounded corners, counter-clockwise.
 * radii = [bottom-left, bottom-right, top-right, top-left] (mm). Radii are clamped to fit.
 */
export function roundedRectRing(x0, y0, x1, y1, radii = [0, 0, 0, 0], steps = 16) {
  const lim = Math.min(x1 - x0, y1 - y0) / 2;
  const [bl, br, tr, tl] = radii.map(r => Math.max(0, Math.min(r, lim)));
  const ring = [];
  const corner = (cx, cy, r, a0) => {
    if (r < 1e-9) { ring.push([cx, cy]); return; }
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x0 + bl, y0 + bl, bl, Math.PI);          // bottom-left
  corner(x1 - br, y0 + br, br, Math.PI * 1.5);    // bottom-right
  corner(x1 - tr, y1 - tr, tr, 0);                // top-right
  corner(x0 + tl, y1 - tl, tl, Math.PI / 2);      // top-left
  return ring;
}

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

/** MultiPolygon -> groups ({ outer, holes }), dropping the closing duplicate point of each ring. */
export function multiPolygonToGroups(mp) {
  const open = ring => ring.slice(0, -1);
  return asMulti(mp).map(([outer, ...holes]) => ({ outer: open(outer), holes: holes.map(open) }));
}

export function flipYGroups(groups) {
  const f = ring => ring.map(([x, y]) => [x, -y]);
  return groups.map(g => ({ outer: f(g.outer), holes: g.holes.map(f) }));
}
