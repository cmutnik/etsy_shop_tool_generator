// Copyright (c) 2025 cmutnik
// 2D helpers shared by every tool. Units are millimetres unless a function says otherwise.
//
// The common currency is a "group": { outer: [[x, y], ...], holes: [[[x, y], ...], ...] }.
// Text, SVG import and traced images all produce groups; groupsToShapes() turns them into
// THREE.Shape objects ready to extrude.
import * as THREE from 'three';
import { signedArea } from './geometry-pure.js';

// the pure helpers moved to geometry-pure.js (no dependencies); re-exported so existing imports keep working
export { signedArea, pointInPoly, boundsOf, mapGroups, centerGroups, contoursToGroups, simplifyRing } from './geometry-pure.js';

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

/**
 * Fix T-junctions in the flat caps of an extrusion. The cap triangulator can draw a long diagonal that skips a vertex lying
 * exactly on it (typical when many letter bottoms share one baseline); the neighbouring triangle then has two shorter edges
 * there, so the shared edge has a single triangle: a crack in the mesh. Every interior cap edge is split at the vertices that lie
 * on it, so both sides use the same edges (outline edges are shared with the side walls and stay whole). Returns a new non-indexed geometry.
 */
export function repairCapJunctions(geo, eps = 2e-6) {   // eps (mm): a few ULPs of a float32 coordinate near 10 mm, so collinear stretches are recognised consistently
  const pos = geo.attributes.position, n = pos.count;
  const P = i => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  // the distinct vertices of each flat horizontal level, in a coarse grid for fast lookup
  const levels = new Map(), CELL = 1;
  const keyOf = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
  const flat = [], ringEdges = new Set();           // ringEdges: outline edges, which the vertical side walls share with the caps
  const ek = (a, b) => { const ka = a.map(v => v.toFixed(6)).join(','), kb = b.map(v => v.toFixed(6)).join(','); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
  for (let t = 0; t < n; t += 3) {
    const a = P(t), b = P(t + 1), c = P(t + 2);
    if (!(Math.abs(a[2] - b[2]) < 1e-9 && Math.abs(b[2] - c[2]) < 1e-9)) {
      const tri = [a, b, c];
      for (let e = 0; e < 3; e++) if (Math.abs(tri[e][2] - tri[(e + 1) % 3][2]) < 1e-9) ringEdges.add(ek(tri[e], tri[(e + 1) % 3]));
    }
    if (Math.abs(a[2] - b[2]) < 1e-9 && Math.abs(b[2] - c[2]) < 1e-9) {
      flat.push(t);
      const zk = a[2].toFixed(6);
      if (!levels.has(zk)) levels.set(zk, { grid: new Map(), seen: new Set() });
      const lv = levels.get(zk);
      for (const v of [a, b, c]) {
        const vk = v[0].toFixed(7) + ',' + v[1].toFixed(7);
        if (lv.seen.has(vk)) continue;
        lv.seen.add(vk);
        const ck = keyOf(v[0], v[1]);
        if (!lv.grid.has(ck)) lv.grid.set(ck, []);
        lv.grid.get(ck).push(v);
      }
    }
  }
  const flatSet = new Set(flat), out = [];
  const onEdge = (a, b, lv) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1e-6) return [];
    const found = [];
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5))), seenCells = new Set();
    for (let k = 0; k <= steps; k++) {
      const x = a[0] + (dx * k) / steps, y = a[1] + (dy * k) / steps;
      for (let cx = -1; cx <= 1; cx++) for (let cy = -1; cy <= 1; cy++) {
        const ck = keyOf(x + cx * CELL, y + cy * CELL);
        if (seenCells.has(ck)) continue;
        seenCells.add(ck);
        for (const v of lv.grid.get(ck) || []) {
          const t = ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / (len * len);
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          const dist = Math.abs((v[0] - a[0]) * dy - (v[1] - a[1]) * dx) / len;
          if (dist <= eps) found.push({ t, v });
        }
      }
    }
    found.sort((p, q) => p.t - q.t);
    return found.filter((f, i) => i === 0 || f.t - found[i - 1].t > 1e-9).map(f => f.v);
  };
  for (let t = 0; t < n; t += 3) {
    if (!flatSet.has(t)) { out.push(...P(t), ...P(t + 1), ...P(t + 2)); continue; }
    const tri = [P(t), P(t + 1), P(t + 2)], lv = levels.get(tri[0][2].toFixed(6));
    // A flat triangle whose three distinct corners are collinear (a zero-area sliver, common along nearly straight outline stretches)
    // is dropped: the triangles beside it are then split at the vertex, which keeps every edge shared by exactly two.
    const L = Math.max(...[0, 1, 2].map(e => Math.hypot(tri[(e + 1) % 3][0] - tri[e][0], tri[(e + 1) % 3][1] - tri[e][1])));
    const area2 = Math.abs((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]));
    const shortest = Math.min(...[0, 1, 2].map(e => Math.hypot(tri[(e + 1) % 3][0] - tri[e][0], tri[(e + 1) % 3][1] - tri[e][1])));
    // (a sliver with two coincident corners comes from a duplicated outline point and is needed by its neighbours: keep it)
    if (L > 0 && shortest > 1e-5 && area2 / L <= eps) continue;
    // the polygon of this triangle with every edge split at the vertices on it; fan it from the first corner
    const ring = [];
    for (let e = 0; e < 3; e++) { const a = tri[e], b = tri[(e + 1) % 3]; ring.push(a, ...(ringEdges.has(ek(a, b)) ? [] : onEdge(a, b, lv).map(v => [v[0], v[1], a[2]]))); }   // outline edges stay whole
    if (ring.length === 3) { out.push(...tri[0], ...tri[1], ...tri[2]); continue; }
    for (let i = 1; i < ring.length - 1; i++) out.push(...ring[0], ...ring[i], ...ring[i + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

const CURVE_SEGMENTS = 48;

/**
 * The shape as plain polylines with coincident consecutive points removed. THREE's arc helpers leave micro-segments (about
 * 1e-15 mm) where a straight edge meets an arc, which extrude to degenerate wall triangles and duplicated vertices.
 */
export function cleanShape(shape) {
  const { shape: outer, holes } = shape.extractPoints(CURVE_SEGMENTS);
  const dedupe = pts => {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) out.push(p); }
    while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) out.pop();
    return out;
  };
  const s = new THREE.Shape(dedupe(outer));
  for (const h of holes) s.holes.push(new THREE.Path(dedupe(h)));
  return s;
}

/** Extrude shapes along +z from z0 to z0 + depth (shapes cleaned, caps repaired: see cleanShape and repairCapJunctions). */
export function extrudeShapes(shapes, depth, z0 = 0) {
  const raw = new THREE.ExtrudeGeometry(shapes.map(cleanShape), { depth, bevelEnabled: false, curveSegments: CURVE_SEGMENTS });
  raw.translate(0, 0, z0);
  const g = repairCapJunctions(raw);
  raw.dispose();
  return g;
}
