// Copyright (c) 2025 cmutnik
// Mesh repair for one part ({ name, color, positions, indices }): weld near-duplicate vertices, drop degenerate and duplicate
// triangles, make the winding consistent and outward-facing, and fill small holes. Pure, no dependencies.
// It only reports success when the part really ends up closed; anything it cannot fix is left and described.
import { partStats } from './geometry.js';

export const DEFAULTS = { tolerance: 0.01, maxHoleEdges: 200 };

function weld(part, tol) {
  const inv = 1 / tol, ids = new Map(), pos = [], remap = new Uint32Array(part.positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = part.positions[i * 3], y = part.positions[i * 3 + 1], z = part.positions[i * 3 + 2];
    const key = Math.round(x * inv) + ',' + Math.round(y * inv) + ',' + Math.round(z * inv);
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); pos.push(x, y, z); }
    remap[i] = id;
  }
  return { pos, tris: Array.from(part.indices, v => remap[v]), merged: remap.length - ids.size };
}

/** Drop triangles with a repeated corner, no area, or the same three corners as an earlier triangle. */
function cleanTriangles(pos, tris) {
  const seen = new Set(), out = [];
  let removed = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const area2 = Math.hypot(
      (pos[b * 3 + 1] - pos[a * 3 + 1]) * (pos[c * 3 + 2] - pos[a * 3 + 2]) - (pos[b * 3 + 2] - pos[a * 3 + 2]) * (pos[c * 3 + 1] - pos[a * 3 + 1]),
      (pos[b * 3 + 2] - pos[a * 3 + 2]) * (pos[c * 3] - pos[a * 3]) - (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 2] - pos[a * 3 + 2]),
      (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 1] - pos[a * 3 + 1]) - (pos[b * 3 + 1] - pos[a * 3 + 1]) * (pos[c * 3] - pos[a * 3]));
    const key = [a, b, c].sort((p, q) => p - q).join(',');
    if (a === b || b === c || a === c || area2 < 1e-12 || seen.has(key)) { removed++; continue; }
    seen.add(key);
    out.push(a, b, c);
  }
  return { tris: out, removed };
}

const signedVolume = (pos, tris, list) => {
  let v = 0;
  for (const t of list) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    v += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
  }
  return v;
};

/**
 * Make neighbouring triangles agree on direction (every shared edge is walked in opposite directions), then turn each connected
 * piece outward (positive volume). Edges shared by more than two triangles are not followed. Returns the number of triangles flipped.
 */
function orient(pos, tris) {
  const n = tris.length / 3, N = pos.length / 3 + 1, edges = new Map();
  for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
    const a = tris[t * 3 + e], b = tris[t * 3 + (e + 1) % 3], key = a < b ? a * N + b : b * N + a;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push([t, a, b]);
  }
  const flip = new Int8Array(n).fill(-1);
  let flipped = 0;
  for (let s = 0; s < n; s++) {
    if (flip[s] !== -1) continue;
    flip[s] = 0;
    const comp = [s], queue = [s];
    while (queue.length) {
      const t = queue.pop();
      for (let e = 0; e < 3; e++) {
        const a = tris[t * 3 + e], b = tris[t * 3 + (e + 1) % 3], list = edges.get(a < b ? a * N + b : b * N + a);
        if (list.length !== 2) continue;
        const other = list[0][0] === t ? list[1] : list[0];
        const from = flip[t] ? b : a;                                          // direction this triangle walks the edge, after its flip
        const want = other[1] === from ? 1 : 0;                                // the neighbour must walk it the other way
        if (flip[other[0]] === -1) { flip[other[0]] = want; comp.push(other[0]); queue.push(other[0]); }
      }
    }
    for (const t of comp) if (flip[t]) { const k = tris[t * 3 + 1]; tris[t * 3 + 1] = tris[t * 3 + 2]; tris[t * 3 + 2] = k; flipped++; }
    if (signedVolume(pos, tris, comp) < 0) for (const t of comp) { const k = tris[t * 3 + 1]; tris[t * 3 + 1] = tris[t * 3 + 2]; tris[t * 3 + 2] = k; flipped += flip[t] ? -1 : 1; }
  }
  return Math.max(0, flipped);
}

/** Boundary loops: chains of edges that belong to one triangle only, followed end to start. Ambiguous or open chains are returned as skipped. */
function boundaryLoops(tris, maxEdges) {
  const n = tris.length / 3, N = Math.max(...tris) + 2, count = new Map(), dir = new Map();
  for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
    const a = tris[t * 3 + e], b = tris[t * 3 + (e + 1) % 3], key = a < b ? a * N + b : b * N + a;
    count.set(key, (count.get(key) || 0) + 1);
    dir.set(key, [a, b]);
  }
  const from = new Map();
  for (const [key, c] of count) if (c === 1) { const [a, b] = dir.get(key); if (!from.has(a)) from.set(a, []); from.get(a).push(b); }
  const loops = [];
  let skipped = 0;
  for (const [start] of from) {
    while (from.get(start)?.length) {
      const loop = [start];
      let cur = from.get(start).pop(), ok = true;
      while (cur !== start) {
        loop.push(cur);
        const next = from.get(cur);
        if (!next || next.length !== 1 || loop.length > maxEdges + 1) { ok = false; break; }
        cur = next.pop();
      }
      if (ok && loop.length >= 3 && loop.length <= maxEdges) loops.push(loop); else skipped++;   // a closed loop has as many edges as vertices
    }
  }
  return { loops, skipped };
}

/** Triangulate a ring of vertex ids by ear clipping in the plane of its Newell normal. Triangles keep the ring's winding. Null if it cannot. */
function fillRing(pos, ring) {
  const P = i => [pos[ring[i] * 3], pos[ring[i] * 3 + 1], pos[ring[i] * 3 + 2]];
  const nrm = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = P(i), b = P((i + 1) % ring.length);
    nrm[0] += (a[1] - b[1]) * (a[2] + b[2]); nrm[1] += (a[2] - b[2]) * (a[0] + b[0]); nrm[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(...nrm);
  if (len < 1e-12) return null;
  const nz = nrm.map(v => v / len), helper = Math.abs(nz[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = [nz[1] * helper[2] - nz[2] * helper[1], nz[2] * helper[0] - nz[0] * helper[2], nz[0] * helper[1] - nz[1] * helper[0]], ul = Math.hypot(...ux);
  const u = ux.map(v => v / ul), v = [nz[1] * u[2] - nz[2] * u[1], nz[2] * u[0] - nz[0] * u[2], nz[0] * u[1] - nz[1] * u[0]];
  const pts = ring.map((_, i) => { const p = P(i); return [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]]; });
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  const idx = ring.map((_, i) => i), out = [];
  let guard = idx.length * idx.length + 10;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      if (cross(pts[i0], pts[i1], pts[i2]) <= 1e-12) continue;                 // reflex or flat corner
      if (idx.some(j => j !== i0 && j !== i1 && j !== i2 && inside(pts[j], pts[i0], pts[i1], pts[i2]))) continue;
      out.push(ring[i0], ring[i1], ring[i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) { for (let k = 1; k < idx.length - 1; k++) out.push(ring[idx[0]], ring[idx[k]], ring[idx[k + 1]]); return out; }   // degenerate outline: fan it
  }
  if (idx.length === 3) out.push(ring[idx[0]], ring[idx[1]], ring[idx[2]]);
  return out;
}

/**
 * Repair one part. opts: { tolerance (mm, vertices closer than this are merged), maxHoleEdges (bigger holes are left alone) }
 * Returns { part, report }: `part` is the repaired copy (the input is not changed), `report` says what was done and whether the
 * part is now closed (`closed`), with `openBefore` / `openAfter` counting edges that are not shared by exactly two triangles.
 */
export function repairPart(part, opts = {}) {
  const { tolerance, maxHoleEdges } = { ...DEFAULTS, ...opts };
  const before = partStats(part);
  const w = weld(part, tolerance), pos = w.pos;
  const c = cleanTriangles(pos, w.tris);
  let tris = c.tris;
  let flipped = orient(pos, tris), filled = 0, skipped = 0;
  const { loops, skipped: bad } = boundaryLoops(tris, maxHoleEdges);
  skipped += bad;
  for (const loop of loops) {
    const patch = fillRing(pos, loop.slice().reverse());                       // the patch walks each boundary edge the opposite way
    if (patch && patch.length) { tris = tris.concat(patch); filled++; } else skipped++;
  }
  if (filled) flipped += orient(pos, tris);
  // keep only the vertices still in use
  const used = new Map(), np = [];
  const indices = Uint32Array.from(tris, v => { let k = used.get(v); if (k === undefined) { k = used.size; used.set(v, k); np.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); } return k; });
  const repaired = { ...part, positions: Float32Array.from(np), indices };
  const after = partStats(repaired);
  // a flat double skin (a lone triangle plus its patch) has no open edges but no volume either, so it does not count as a solid
  let lo = Infinity, hi = -Infinity;
  for (const v of repaired.positions) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const closed = after.openEdges === 0 && after.volume > 1e-6 * Math.pow(Math.max(hi - lo, 1e-9), 3);
  return { part: repaired, report: { mergedVertices: w.merged, removedTriangles: c.removed, flippedTriangles: flipped, filledHoles: filled, skippedHoles: skipped, openBefore: before.openEdges, openAfter: after.openEdges, closed } };
}

/** One sentence for the page. */
export function describeRepair(name, r) {
  const did = [];
  if (r.mergedVertices) did.push(`merged ${r.mergedVertices.toLocaleString()} duplicate points`);
  if (r.removedTriangles) did.push(`removed ${r.removedTriangles.toLocaleString()} bad triangles`);
  if (r.flippedTriangles) did.push(`turned ${r.flippedTriangles.toLocaleString()} triangles the right way round`);
  if (r.filledHoles) did.push(`filled ${r.filledHoles} hole${r.filledHoles === 1 ? '' : 's'}`);
  const what = did.length ? did.join(', ') : 'found nothing it could change';
  if (r.closed) return `${name}: ${what}. It is now a closed solid.`;
  const left = r.skippedHoles ? ` ${r.skippedHoles} hole${r.skippedHoles === 1 ? ' was' : 's were'} too large or too tangled to fill.` : '';
  return `${name}: ${what}, but ${r.openAfter.toLocaleString()} open or shared edges remain.${left} This needs a proper mesh tool.`;
}
