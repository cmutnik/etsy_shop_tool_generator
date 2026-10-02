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

/** Extrude shapes along +z from z0 to z0 + depth. */
export function extrudeShapes(shapes, depth, z0 = 0) {
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 48 });
  g.translate(0, 0, z0);
  return g;
}

