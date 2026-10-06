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

/**
 * Parts that are patches of one surface (they share a `group`, as the colours of a painted model do) are not closed on their own but are
 * together. This joins each such group into one part with `labels` (the member's number for every triangle), keeping its member list as
 * `members`, and passes every other part through. Returns the new list.
 */
export function mergeGroups(parts) {
  const groups = new Map(), out = [];
  for (const p of parts) {
    if (!p.group) { out.push(p); continue; }
    if (!groups.has(p.group)) { const g = { members: [] }; groups.set(p.group, g); out.push(g); }
    groups.get(p.group).members.push(p);
  }
  return out.map(g => {
    if (!g.members) return g;
    if (g.members.length === 1) return g.members[0];
    const nv = g.members.reduce((n, m) => n + m.positions.length / 3, 0), nt = g.members.reduce((n, m) => n + m.indices.length / 3, 0);
    const positions = new Float32Array(nv * 3), indices = new Uint32Array(nt * 3), labels = new Uint32Array(nt);
    let v = 0, t = 0;
    g.members.forEach((m, k) => {
      positions.set(m.positions, v * 3);
      for (let i = 0; i < m.indices.length; i++) indices[t * 3 + i] = m.indices[i] + v;
      labels.fill(k, t, t + m.indices.length / 3);
      v += m.positions.length / 3; t += m.indices.length / 3;
    });
    return { name: g.members[0].name, color: g.members[0].color, positions, indices, labels, members: g.members, group: g.members[0].group };
  });
}

/**
 * partStats for every part, treating colour patches of one surface (parts sharing a `group`) as the one solid they make together: a patch is
 * never closed on its own. The group's volume and open edges are put on its first member (the others get 0, so sums stay right);
 * every part keeps its own triangle count.
 */
export function partsStats(parts) {
  const stats = new Array(parts.length), groups = new Map();
  parts.forEach((p, i) => {
    if (!p.group) { stats[i] = partStats(p); return; }
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(i);
  });
  for (const list of groups.values()) {
    const whole = list.length === 1 ? partStats(parts[list[0]]) : partStats(mergeGroups(list.map(i => parts[i]))[0]);
    list.forEach((i, k) => { stats[i] = { triangles: parts[i].indices.length / 3, volume: k === 0 ? whole.volume : 0, openEdges: k === 0 ? whole.openEdges : 0 }; });
  }
  return stats;
}

/** Turn inside-out solids the right way round (a group of colour patches is judged, and turned, as one). Returns { parts, stats, flipped }. */
export function analyseParts(parts) {
  let stats = partsStats(parts);
  const turn = new Set(), firstOf = new Map();
  parts.forEach((p, i) => { if (p.group && !firstOf.has(p.group)) firstOf.set(p.group, i); });
  parts.forEach((p, i) => { const lead = p.group ? firstOf.get(p.group) : i; if (stats[lead].volume < 0) turn.add(i); });
  if (!turn.size) return { parts, stats, flipped: 0 };
  const flippedGroups = new Set([...turn].map(i => (parts[i].group ? parts[i].group : i)));
  const out = parts.map((p, i) => (turn.has(i) ? flipPart(p) : p));
  stats = partsStats(out);
  return { parts: out, stats, flipped: flippedGroups.size };
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

/** Reverse every triangle's winding (turns an inside-out part the right way round). Returns a new part. */
export function flipPart(part) {
  const indices = part.indices.slice();
  for (let t = 0; t < indices.length; t += 3) { const k = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = k; }
  return { ...part, indices };
}

/**
 * The rotation that lays the model's largest flat face on the bed, or null if there is nothing to lay down.
 * Triangles are grouped by direction (to about 1 degree); the group with the most area wins.
 * `parts` must be in their final orientation but unscaled.
 */
export function layFlatRotation(parts) {
  const groups = new Map();
  for (const p of parts) {
    const pos = p.positions, idx = p.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, area2 = Math.hypot(nx, ny, nz);
      if (area2 < 1e-12) continue;
      const key = [nx, ny, nz].map(v => Math.round((v / area2) * 60)).join(',');
      const g = groups.get(key) || { area: 0, n: [0, 0, 0] };
      g.area += area2; g.n[0] += nx; g.n[1] += ny; g.n[2] += nz;
      groups.set(key, g);
    }
  }
  let best = null;
  for (const g of groups.values()) if (!best || g.area > best.area) best = g;
  if (!best) return null;
  const n = new THREE.Vector3(...best.n).normalize();
  return new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, -1)));
}

/**
 * New rotation angles (degrees, for the page's X, Y, Z fields) that lay the largest face down, given the current rotation and mirror.
 * The pipeline applies mirror after rotation, so the extra turn is expressed back in the pre-mirror frame.
 */
export function layFlatAngles(parts, { unit = 1, rotate = [0, 0, 0], mirror = [false, false, false] }) {
  const cur = transformParts(parts, { unit, rotate, mirror, scale: [1, 1, 1], center: false, onBed: false });
  const extra = layFlatRotation(cur.parts);
  if (!extra) return null;
  const rad = d => (d * Math.PI) / 180;
  const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rad(rotate[0]), rad(rotate[1]), rad(rotate[2]), 'XYZ'));
  const F = new THREE.Matrix4().makeScale(...mirror.map(m => (m ? -1 : 1)));
  const next = F.clone().multiply(extra).multiply(F).multiply(R);               // F is its own inverse
  const e = new THREE.Euler().setFromRotationMatrix(next, 'XYZ');
  return [e.x, e.y, e.z].map(v => { const d = Math.round(((v * 180) / Math.PI) * 1e4) / 1e4; return Math.abs(d) < 1e-9 ? 0 : d; });
}

/**
 * Filament slot for each item ({ color, slot? }), in order. An explicit `slot` is kept. The others share a slot when they share a
 * colour: slots are handed out in order of first appearance, skipping numbers an explicit slot already uses.
 */
export function assignSlots(items) {
  const taken = new Set(items.map(i => i.slot).filter(Boolean)), byColor = new Map();
  let next = 1;
  return items.map(i => {
    if (i.slot) return i.slot;
    const key = (i.color || DEFAULT_COLOR).toUpperCase();
    if (!byColor.has(key)) { while (taken.has(next)) next++; byColor.set(key, next++); }
    return byColor.get(key);
  });
}
