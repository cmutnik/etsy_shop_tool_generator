// Copyright (c) 2025 cmutnik
// 2D polygon booleans (union / difference) and small shape generators. Rings are arrays of [x, y].
// Built on polygon-clipping so tools can combine shapes (a loop and a neck, a slot cut out of a base)
// without a 3D CSG library: combine in 2D, then extrude.
import polygonClipping from 'polygon-clipping';

/** Circle as a ring (counter-clockwise). `phase` (radians) rotates where the vertices fall. */
export function circleRing(cx, cy, r, steps = 64, phase = 0) {
  return Array.from({ length: steps }, (_, i) => {
    const a = phase + (i / steps) * Math.PI * 2;
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

/** Drop vertices that lie on a straight line between their neighbours (they upset the cap triangulator). */
export function dropCollinear(ring, tol = 1e-9) {
  let pts = ring.slice(), changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cross) <= tol * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1])) && dot >= 0) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}

/**
 * Fillet selected corners of a closed ring with circular arcs.
 * @param {number[][]} ring
 * @param {(pt: number[], index: number) => number} radiusFor  radius for each vertex (0 = keep sharp)
 * The radius is reduced where needed so an arc never uses more than half of an adjacent edge.
 */
export function roundCorners(ring, radiusFor, arcSteps = 14) {
  const n = ring.length, out = [];
  for (let i = 0; i < n; i++) {
    const V = ring[i], P = ring[(i + n - 1) % n], N = ring[(i + 1) % n];
    const r = radiusFor(V, i);
    const u = [P[0] - V[0], P[1] - V[1]], w = [N[0] - V[0], N[1] - V[1]];
    const lu = Math.hypot(...u), lw = Math.hypot(...w);
    if (!(r > 1e-9) || lu < 1e-9 || lw < 1e-9) { out.push(V); continue; }
    u[0] /= lu; u[1] /= lu; w[0] /= lw; w[1] /= lw;
    const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1])));  // interior angle at V
    if (theta < 1e-6 || Math.abs(theta - Math.PI) < 1e-6) { out.push(V); continue; }
    const tan = Math.tan(theta / 2);
    const t = Math.min(r / tan, lu / 2, lw / 2);               // distance from V to each tangent point
    const rr = t * tan;                                         // effective radius
    const bis = [u[0] + w[0], u[1] + w[1]], lb = Math.hypot(...bis);
    const C = [V[0] + (bis[0] / lb) * (rr / Math.sin(theta / 2)), V[1] + (bis[1] / lb) * (rr / Math.sin(theta / 2))];
    const T1 = [V[0] + u[0] * t, V[1] + u[1] * t], T2 = [V[0] + w[0] * t, V[1] + w[1] * t];
    let a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    let sweep = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    for (let k = 0; k <= arcSteps; k++) {
      const a = a1 + sweep * (k / arcSteps);
      out.push([C[0] + rr * Math.cos(a), C[1] + rr * Math.sin(a)]);
    }
  }
  return out;
}
