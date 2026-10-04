// Copyright (c) 2025 cmutnik
// Pure model building for the STL / 3MF modifier: no DOM. Parts are { name, color, positions, indices } (see shared/js/mesh-import.js).
import * as THREE from 'three';

export const DEFAULT_COLOR = '#B8B8B8';

/** Triangle count, enclosed volume (mm^3) and how many edges are not shared by exactly two triangles, welding coincident corners. */
export function partStats(part) {
  const { positions: pos, indices: idx } = part, ids = new Map(), canon = new Uint32Array(pos.length / 3);
  for (let i = 0; i < canon.length; i++) {
    const key = Math.round(pos[i * 3] * 1e4) + ',' + Math.round(pos[i * 3 + 1] * 1e4) + ',' + Math.round(pos[i * 3 + 2] * 1e4);
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    canon[i] = id;
  }
  const N = ids.size + 1, edges = new Map();
  let volume = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    volume += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
    const v = [canon[idx[t]], canon[idx[t + 1]], canon[idx[t + 2]]];
    for (let e = 0; e < 3; e++) {
      const p = v[e], q = v[(e + 1) % 3], key = p < q ? p * N + q : q * N + p;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  return { triangles: idx.length / 3, volume, openEdges: open };
}

export function boundsOfParts(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p.positions[i + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  return { min, max, size: max.map((v, k) => v - min[k]) };
}

/**
 * Apply the user's changes to the loaded parts. Order: file units -> rotate (x, y, z degrees) -> mirror -> scale along the
 * world axes -> centre on the bed. Returns new parts plus the size before scaling (so a target size can be turned into a percentage).
 *  opts: { unit (mm per file unit), rotate: [x, y, z], mirror: [x, y, z], scale: [x, y, z] (1 = 100 %), center, onBed }
 */
export function transformParts(parts, opts) {
  const { unit = 1, rotate = [0, 0, 0], mirror = [false, false, false], scale = [1, 1, 1], center = true, onBed = true } = opts;
  const rad = d => (d * Math.PI) / 180;
  const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rad(rotate[0]), rad(rotate[1]), rad(rotate[2]), 'XYZ'));
  const flips = mirror.map(m => (m ? -1 : 1));
  const L = new THREE.Matrix4().makeScale(scale[0] * flips[0] * unit, scale[1] * flips[1] * unit, scale[2] * flips[2] * unit).multiply(R);
  const e = L.elements, reverse = L.determinant() < 0;
  const out = parts.map(p => {
    const src = p.positions, pos = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      pos[i] = e[0] * x + e[4] * y + e[8] * z;
      pos[i + 1] = e[1] * x + e[5] * y + e[9] * z;
      pos[i + 2] = e[2] * x + e[6] * y + e[10] * z;
    }
    let indices = p.indices;
    if (reverse) { indices = p.indices.slice(); for (let t = 0; t < indices.length; t += 3) { const k = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = k; } }
    return { ...p, positions: pos, indices };
  });
  const b = boundsOfParts(out);
  const shift = [center ? -(b.min[0] + b.max[0]) / 2 : 0, center ? -(b.min[1] + b.max[1]) / 2 : 0, onBed ? -b.min[2] : 0];
  if (shift.some(s => s !== 0)) for (const p of out) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) p.positions[i + k] += shift[k];
  const size = b.size;
  return { parts: out, size, unscaledSize: size.map((s, k) => s / scale[k]), min: b.min.map((v, k) => v + shift[k]), max: b.max.map((v, k) => v + shift[k]) };
}

/**
 * The preview / export group: one mesh per part, named `p0`, `p1`... (the 3MF writer groups triangles by mesh name).
 * `extras` are { name, geometry, color } meshes added by the tab and label.
 */
export function buildGroup(parts, extras = []) {
  const group = new THREE.Group(), list = [];
  const add = (name, label, color, geometry) => {
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, flatShading: true }));
    mesh.name = name;
    group.add(mesh);
    list.push({ name, label });
  };
  parts.forEach((p, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    g.setIndex(new THREE.BufferAttribute(p.indices, 1));
    add(`p${i}`, p.name, p.color || DEFAULT_COLOR, g);
  });
  for (const x of extras) add(x.name, x.label, x.color, x.geometry);
  return { group, parts: list };
}
