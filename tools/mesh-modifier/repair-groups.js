// Copyright (c) 2025 cmutnik
// Repair that understands colour patches: parts that share a `group` are patches of one surface (a painted model), so they are repaired as the
// one solid they make, then split by colour again. Plain parts are repaired as they are.
import { repairPart, describeRepair } from './repair.js';
import { mergeGroups, partStats } from './geometry.js';

/** The label of the nearest old triangle for every triangle of `part` (nearest centre; a repaired mesh mostly keeps its triangles, new ones sit beside them). */
export function relabel(part, old) {
  const T0 = old.indices.length / 3, T = part.indices.length / 3, labels = new Uint32Array(T);
  const centre = (m, t) => [0, 1, 2].map(k => (m.positions[m.indices[t * 3] * 3 + k] + m.positions[m.indices[t * 3 + 1] * 3 + k] + m.positions[m.indices[t * 3 + 2] * 3 + k]) / 3);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], oc = new Float32Array(T0 * 3);
  for (let t = 0; t < T0; t++) { const c = centre(old, t); for (let k = 0; k < 3; k++) { oc[t * 3 + k] = c[k]; lo[k] = Math.min(lo[k], c[k]); hi[k] = Math.max(hi[k], c[k]); } }
  const N = Math.min(128, Math.max(8, Math.round(Math.cbrt(T0 / 4)))), cell = Math.max(Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / N, 1e-9), grid = new Map();
  const at = (v, k) => Math.min(N - 1, Math.max(0, Math.floor((v - lo[k]) / cell)));
  for (let t = 0; t < T0; t++) { const key = (at(oc[t * 3], 0) * N + at(oc[t * 3 + 1], 1)) * N + at(oc[t * 3 + 2], 2); (grid.get(key) || grid.set(key, []).get(key)).push(t); }
  for (let t = 0; t < T; t++) {
    const c = centre(part, t), cx = at(c[0], 0), cy = at(c[1], 1), cz = at(c[2], 2);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= N && !(best >= 0 && Math.sqrt(bd) <= (r - 1) * cell); r++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(N - 1, cx + r); x++) for (let y = Math.max(0, cy - r); y <= Math.min(N - 1, cy + r); y++) for (let z = Math.max(0, cz - r); z <= Math.min(N - 1, cz + r); z++) {
        if (r > 0 && Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== r) continue;
        for (const u of grid.get((x * N + y) * N + z) || []) {
          const d = (oc[u * 3] - c[0]) ** 2 + (oc[u * 3 + 1] - c[1]) ** 2 + (oc[u * 3 + 2] - c[2]) ** 2;
          if (d < bd) { bd = d; best = u; }
        }
      }
    }
    labels[t] = best >= 0 ? old.labels[best] : 0;
  }
  return labels;
}

/** Split a part that has `labels` into one part per label, each with compact vertices. Returns [{ label, positions, indices }]. */
export function splitLabelled(part, labels = part.labels) {
  const lists = new Map();
  for (let t = 0; t < labels.length; t++) { if (!lists.has(labels[t])) lists.set(labels[t], []); lists.get(labels[t]).push(t); }
  return [...lists].map(([label, list]) => {
    const ids = new Map(), pos = [], indices = new Uint32Array(list.length * 3);
    list.forEach((t, k) => {
      for (let c = 0; c < 3; c++) {
        const v = part.indices[t * 3 + c];
        let id = ids.get(v);
        if (id === undefined) { id = ids.size; ids.set(v, id); pos.push(part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]); }
        indices[k * 3 + c] = id;
      }
    });
    return { label, positions: Float32Array.from(pos), indices };
  });
}

/**
 * Drop every triangle that touches an edge not shared by exactly two triangles (an open boundary, or three or more triangles meeting at an edge).
 * What is left has a slightly larger hole where the bad spots were, usually a clean one that can then be filled. Returns a copy of the part.
 */
export function stripBadEdges(part) {
  const V = part.positions.length / 3 + 1, T = part.indices.length / 3, idx = part.indices, count = new Map();
  const key = (a, b) => (a < b ? a * V + b : b * V + a);
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) { const k = key(idx[t * 3 + e], idx[t * 3 + (e + 1) % 3]); count.set(k, (count.get(k) || 0) + 1); }
  const keep = [];
  for (let t = 0; t < T; t++) {
    let ok = true;
    for (let e = 0; e < 3 && ok; e++) if (count.get(key(idx[t * 3 + e], idx[t * 3 + (e + 1) % 3])) !== 2) ok = false;
    if (ok) keep.push(t);
  }
  const indices = new Uint32Array(keep.length * 3);
  keep.forEach((t, k) => { for (let c = 0; c < 3; c++) indices[k * 3 + c] = idx[t * 3 + c]; });
  return { ...part, indices, labels: undefined, dropped: T - keep.length };
}

/**
 * Repair every ticked part that is not closed. `parts` is the whole list, `include` says which are ticked.
 * Returns { list: [{ part, from }], changed, log }: the new list (same order; a repaired group is split into its colours again), `from` the index
 * each entry came from. Nothing is claimed fixed unless the result really is closed.
 */
export function repairParts(parts, include = parts.map(() => true)) {
  const log = [], list = [], done = new Set();
  let changed = false;
  parts.forEach((p, i) => {
    if (done.has(i)) return;
    const members = p.group ? parts.map((q, j) => j).filter(j => parts[j].group === p.group && include[j]) : [i];
    members.forEach(j => done.add(j));
    if (!include[i]) { list.push({ part: p, from: i }); return; }
    const item = members.length > 1 ? mergeGroups(members.map(j => parts[j]))[0] : parts[members[0]];
    if (partStats(item).openEdges === 0) { members.forEach(j => list.push({ part: parts[j], from: j })); return; }
    const label = members.length > 1 ? `${p.name} and its other colours` : p.name;
    let { part: fixed, report } = repairPart(item);
    log.push(describeRepair(label, report));
    if (!report.closed && report.openAfter > 0 && report.openAfter <= 2000) {
      // a few stubborn edges (a scan or AI model with pinched spots): cut the triangles around them out and fill the clean hole that is left
      const stripped = stripBadEdges(fixed), second = repairPart(stripped, { maxHoleEdges: 1500 });
      if (second.report.openAfter < report.openAfter) {
        log.push(`${label}: removed ${stripped.dropped} triangles around ${report.openAfter} stubborn edges and filled the gap${second.report.closed ? ': now a closed solid.' : `, but ${second.report.openAfter} open or shared edges remain.`}`);
        fixed = second.part; report = second.report;
      }
    }
    if (!(report.openAfter < report.openBefore)) { members.forEach(j => list.push({ part: parts[j], from: j })); return; }   // nothing got better: leave it alone
    changed = true;
    if (members.length === 1) { list.push({ part: fixed, from: members[0] }); return; }
    const labels = relabel(fixed, item);
    for (const sub of splitLabelled(fixed, labels)) {
      const from = members[sub.label], src = parts[from];
      list.push({ part: { ...src, positions: sub.positions, indices: sub.indices }, from });
    }
  });
  return { list, changed, log };
}
