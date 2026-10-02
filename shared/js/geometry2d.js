// Copyright (c) 2025 cmutnik
// 2D helpers shared by every tool. Units are millimetres unless a function says otherwise.
//
// The common currency is a "group": { outer: [[x, y], ...], holes: [[[x, y], ...], ...] }.
// Text, SVG import and traced images all produce groups; groupsToShapes() turns them into
// THREE.Shape objects ready to extrude.
import * as THREE from 'three';

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPoly(pt, poly) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Bounding box of groups (outer rings only). */
export function boundsOf(groups) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of groups) for (const [x, y] of g.outer) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function mapGroups(groups, fn) {
  const m = ring => ring.map(([x, y]) => fn(x, y));
  return groups.map(g => ({ outer: m(g.outer), holes: g.holes.map(m) }));
}

/** Shift so the bounding box is centred on the origin. Returns { groups, width, height }. */
export function centerGroups(groups) {
  if (!groups.length) return { groups: [], width: 0, height: 0 };
  const b = boundsOf(groups);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  return { groups: mapGroups(groups, (x, y) => [x - cx, y - cy]), width: b.width, height: b.height };
}

/**
 * Sort loose closed rings into outer shapes + holes. A ring is a hole when its winding is
 * opposite to the (solid) ring that immediately encloses it - the non-zero fill rule that
 * fonts and tracers use. Same-direction overlaps stay solid.
 */
export function contoursToGroups(contours) {
  const items = contours.map(pts => ({ pts, area: signedArea(pts) })).filter(i => Math.abs(i.area) > 1e-6);
  items.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  for (const it of items) {
    let parent = null;
    for (const o of items) {
      if (o === it || Math.abs(o.area) <= Math.abs(it.area)) continue;
      if (pointInPoly(it.pts[0], o.pts) && (!parent || Math.abs(o.area) < Math.abs(parent.area))) parent = o;
    }
    it.parent = parent;
    it.hole = !!parent && !parent.hole && Math.sign(parent.area) !== Math.sign(it.area);
  }
  const groups = new Map();
  for (const it of items) if (!it.hole) groups.set(it, { outer: it.pts, holes: [] });
  for (const it of items) if (it.hole && groups.has(it.parent)) groups.get(it.parent).holes.push(it.pts);
  return [...groups.values()];
}

/**
 * Groups -> THREE.Shape. The outer ring is forced counter-clockwise: ExtrudeGeometry only re-orients holes
 * when it has to flip the outer ring, so a clockwise outer with a clockwise hole would extrude with
 * inconsistent triangle winding (slicers have to repair it).
 */
export function groupsToShapes(groups) {
  const v = ring => ring.map(([x, y]) => new THREE.Vector2(x, y));
  const ccw = ring => (signedArea(ring) < 0 ? ring.slice().reverse() : ring);
  return groups.map(g => {
    const s = new THREE.Shape(v(ccw(g.outer)));
    for (const h of g.holes) s.holes.push(new THREE.Path(v(h)));
    return s;
  });
}

/** Closed outline: 'rect' (with corner radius) or 'ellipse'. Centred on origin. */
export function outlineShape(type, w, h, r = 0) {
  const s = new THREE.Shape();
  if (type === 'ellipse') {
    s.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
    return s;
  }
  const hw = w / 2, hh = h / 2;
  r = Math.max(0, Math.min(r, hw, hh));
  if (r < 0.01) {
    s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.closePath();
    return s;
  }
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Extrude shapes along +z from z0 to z0 + depth. */
export function extrudeShapes(shapes, depth, z0 = 0) {
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 48 });
  g.translate(0, 0, z0);
  return g;
}

/** Douglas-Peucker on a closed ring. */
export function simplifyRing(pts, tol) {
  if (pts.length < 8) return pts;
  // split the ring at its two farthest-apart-ish points so DP has fixed anchors
  let a = 0, b = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) { best = d; b = i; }
  }
  const dp = (list) => {
    if (list.length < 3) return list;
    const [x1, y1] = list[0], [x2, y2] = list[list.length - 1];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-9;
    let idx = -1, max = 0;
    for (let i = 1; i < list.length - 1; i++) {
      const d = Math.abs(dy * list[i][0] - dx * list[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max <= tol) return [list[0], list[list.length - 1]];
    const l = dp(list.slice(0, idx + 1)), r = dp(list.slice(idx));
    return l.slice(0, -1).concat(r);
  };
  const first = pts.slice(a, b + 1), second = pts.slice(b).concat([pts[a]]);
  const out = dp(first).slice(0, -1).concat(dp(second).slice(0, -1));
  return out.length >= 3 ? out : pts;
}
