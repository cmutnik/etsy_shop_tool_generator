// Copyright (c) 2025 cmutnik
// Closed solids built from stacks of rings that share one vertex count (a "loft"): the rounded, chamfered profiles of a Gridfinity foot and
// stacking lip. Every function returns plain { pos: number[], idx: number[] } with outward-facing, consistently wound triangles.
import * as THREE from 'three';

/** Counter-clockwise ring (array of [x, y]) -> THREE geometry helpers. */
export class Mesh3 {
  constructor() { this.pos = []; this.idx = []; }
  vertex(x, y, z) { this.pos.push(x, y, z); return this.pos.length / 3 - 1; }
  /** Add a ring of points at height z, returns the vertex ids. */
  ring(pts, z, dx = 0, dy = 0) { return pts.map(p => this.vertex(p[0] + dx, p[1] + dy, z)); }
  tri(a, b, c) { this.idx.push(a, b, c); }
  /** The side wall between two rings of equal length, outward-facing when the rings are counter-clockwise and `lower` is below `upper`. Pass flip for an inward-facing wall. */
  band(lower, upper, flip = false) {
    const n = lower.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) { this.tri(lower[i], upper[j], lower[j]); this.tri(lower[i], upper[i], upper[j]); }
      else { this.tri(lower[i], lower[j], upper[j]); this.tri(lower[i], upper[j], upper[i]); }
    }
  }
  /** The flat strip between an outer ring and an inner ring (both counter-clockwise, same length). up = true: normal +z. */
  annulus(outer, inner, up) {
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (up) { this.tri(outer[i], outer[j], inner[j]); this.tri(outer[i], inner[j], inner[i]); }
      else { this.tri(outer[i], inner[j], outer[j]); this.tri(outer[i], inner[i], inner[j]); }
    }
  }
  /** A flat cap over a ring (and optional hole rings, each a list of [x, y]) at height z, normal +z when up. Triangulated with earcut, so concave outlines are fine. */
  cap(pts, z, up, holes = [], dx = 0, dy = 0) {
    const contour = pts.map(p => new THREE.Vector2(p[0] + dx, p[1] + dy)), hs = holes.map(h => h.map(p => new THREE.Vector2(p[0] + dx, p[1] + dy)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, hs), all = [...contour, ...hs.flat()];
    const ids = all.map(p => this.vertex(p.x, p.y, z));
    for (const [a, b, c] of faces) {
      const area = (all[b].x - all[a].x) * (all[c].y - all[a].y) - (all[b].y - all[a].y) * (all[c].x - all[a].x);   // > 0: counter-clockwise, normal +z
      if ((area > 0) === up) this.tri(ids[a], ids[b], ids[c]); else this.tri(ids[a], ids[c], ids[b]);
    }
  }
  mesh(color, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(this.pos), 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.BufferAttribute(Uint32Array.from(this.idx), 1) : new THREE.BufferAttribute(Uint16Array.from(this.idx), 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
    m.name = name;
    return m;
  }
}
