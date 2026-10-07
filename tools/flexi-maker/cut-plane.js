// Copyright (c) 2025 cmutnik
// Cut planes in any direction: an axis (x, y or z) with two tilts, a point it passes through, and the frame that turns its normal into +z, which
// is what the joint builder works in. Pure maths (no DOM, no 3D library), so it is tested in Node.
//
// A cut is { axis: 'x' | 'y' | 'z', tilt: [a, b] degrees, point: [x, y, z], anchor?: [x, y, z] }.
//   normal  the axis unit vector turned by `a` about the first of the other two axes, then by `b` about the second
//           (for a z cut: a about x, b about y; for an x cut: a about y, b about z; for a y cut: a about z, b about x)
//   point   any point on the plane (the page uses where you clicked)
//   anchor  a point inside the piece the cut is meant for (where you clicked), so several cuts can each work on their own piece

export const AXES = ['x', 'y', 'z'];
export const axisIndex = a => AXES.indexOf(a);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const unitAxis = k => [0, 1, 2].map(i => (i === k ? 1 : 0));

/** v turned by `deg` about the unit vector `u` (Rodrigues). */
export function rotateAbout(v, u, deg) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), d = dot(u, v), x = cross(u, v);
  return v.map((q, i) => q * c + x[i] * s + u[i] * d * (1 - c));
}

/** The plane's unit normal for an axis and its two tilts. */
export function normalOf(axis, tilt = [0, 0]) {
  const k = axisIndex(axis);
  if (k < 0) throw new Error(`Unknown cut axis: ${axis}`);
  let n = unitAxis(k);
  n = rotateAbout(n, unitAxis((k + 1) % 3), tilt[0] || 0);
  n = rotateAbout(n, unitAxis((k + 2) % 3), tilt[1] || 0);
  return norm(n);
}

/**
 * The turn that carries `normal` onto +z (a proper rotation, so triangle winding is kept). Returns { R } with R as three rows:
 * q = R p. The frame's x axis is R[0]: the page bends joints about it.
 */
export function frameOf(normal) {
  const z = norm(normal), h = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], d = dot(h, z);
  const x = norm(h.map((v, i) => v - d * z[i])), y = cross(z, x);                      // x cross y = z
  return { R: [x, y, z] };
}
export const toFrame = (p, frame, origin) => { const v = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]; return frame.R.map(row => dot(row, v)); };
export const fromFrame = (q, frame, origin) => [0, 1, 2].map(i => frame.R[0][i] * q[0] + frame.R[1][i] * q[1] + frame.R[2][i] * q[2] + origin[i]);
/** A direction (no origin) from the frame back to model coordinates. */
export const dirFromFrame = (q, frame) => [0, 1, 2].map(i => frame.R[0][i] * q[0] + frame.R[1][i] * q[1] + frame.R[2][i] * q[2]);

/** Parts with every position passed through fn(point) -> point. A rotation keeps triangle winding, so indices are shared. */
export function mapParts(parts, fn) {
  return parts.map(p => {
    const positions = new Float32Array(p.positions.length);
    for (let i = 0; i < positions.length; i += 3) { const q = fn([p.positions[i], p.positions[i + 1], p.positions[i + 2]]); positions[i] = q[0]; positions[i + 1] = q[1]; positions[i + 2] = q[2]; }
    return { ...p, positions };
  });
}

/** Signed distance from a point to the plane (positive on the side the normal points to). */
export const planeDistance = (p, point, normal) => dot([p[0] - point[0], p[1] - point[1], p[2] - point[2]], normal);

/** Do two cuts lie in parallel planes (same axis, same tilt)? */
export function sameDirection(a, b) {
  return a.axis === b.axis && Math.abs((a.tilt?.[0] || 0) - (b.tilt?.[0] || 0)) < 0.01 && Math.abs((a.tilt?.[1] || 0) - (b.tilt?.[1] || 0)) < 0.01;
}

/** The old engine cuts the whole model by parallel planes along one axis; anything else (another axis, a tilt, a different piece) needs the general one. */
export function needsGeneral(cuts) {
  if (!cuts.length) return false;
  return cuts.some(c => !sameDirection(c, cuts[0]) || Math.abs(c.tilt?.[0] || 0) > 0.01 || Math.abs(c.tilt?.[1] || 0) > 0.01);
}

/** Where along its axis a cut crosses `bounds` (mm from the model's low end), for a point on the plane. */
export const positionOf = (cut, lo) => cut.point[axisIndex(cut.axis)] - lo;

/** Move a cut's point along its normal until it passes through `coord` on its axis. A plane nearly parallel to the axis cannot (returns the cut unchanged). */
export function setPosition(cut, coord) {
  const k = axisIndex(cut.axis), n = normalOf(cut.axis, cut.tilt);
  if (Math.abs(n[k]) < 0.2) return cut;
  const t = (coord - cut.point[k]) / n[k];
  return { ...cut, point: cut.point.map((v, i) => v + n[i] * t) };
}

/** One line for the cut list. */
export function describeCut(cut, lo) {
  const t = cut.tilt || [0, 0], tilted = Math.abs(t[0]) > 0.01 || Math.abs(t[1]) > 0.01;
  return `${cut.axis.toUpperCase()} ${Math.round(positionOf(cut, lo) * 10) / 10} mm${tilted ? `, tilted ${t.map(v => Math.round(v * 10) / 10).join(' / ')} deg` : ''}`;
}
