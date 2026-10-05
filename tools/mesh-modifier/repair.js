// Copyright (c) 2025 cmutnik
// Mesh repair for one part ({ name, color, positions, indices }): weld near-duplicate vertices, drop degenerate and duplicate
// triangles, make the winding consistent and outward-facing, and fill small holes. Pure, no dependencies.
// It only reports success when the part really ends up closed; anything it cannot fix is left and described.
import { partStats } from './geometry.js';

export const DEFAULTS = { relTolerance: 1e-5, maxHoleEdges: 200 };   // vertices closer than relTolerance x the model's diagonal are merged

function weld(part, tol) {
  const inv = 1 / tol, ids = new Map(), pos = [], remap = new Uint32Array(part.positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = part.positions[i * 3], y = part.positions[i * 3 + 1], z = part.positions[i * 3 + 2];
    const key = Math.round(x * inv) + ',' + Math.round(y * inv) + ',' + Math.round(z * inv);
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); pos.push(x, y, z); }
    remap[i] = id;
  }
  const tris = new Uint32Array(part.indices.length);
  for (let i = 0; i < tris.length; i++) tris[i] = remap[part.indices[i]];
  return { pos, tris, merged: remap.length - ids.size };
}

/**
 * Drop triangles with a repeated corner, no area, or the same three corners as an earlier triangle.
 * (Typed arrays and numeric hashes throughout: models from scanners and AI tools have millions of triangles.)
 */
function cleanTriangles(pos, tris) {
  const T = tris.length / 3, out = new Uint32Array(tris.length), first = new Map(), more = new Map();
  let n = 0, removed = 0;
  const same = (t, a, b, c) => { const x = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]].sort((p, q) => p - q); return x[0] === a && x[1] === b && x[2] === c; };
  for (let t = 0; t < T; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    if (a === b || b === c || a === c) { removed++; continue; }
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az, vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-12) { removed++; continue; }
    // duplicate check: order the corners, hash them, and compare against the triangles seen with the same hash
    let lo = a, mid = b, hi = c, k;
    if (lo > mid) { k = lo; lo = mid; mid = k; } if (mid > hi) { k = mid; mid = hi; hi = k; } if (lo > mid) { k = lo; lo = mid; mid = k; }
    const h = (Math.imul(lo, 73856093) ^ Math.imul(mid, 19349663) ^ Math.imul(hi, 83492791)) >>> 0;
    const f = first.get(h);
    let dup = false;
    if (f === undefined) first.set(h, t);
    else {
      dup = same(f, lo, mid, hi) || (more.get(h) || []).some(u => same(u, lo, mid, hi));
      if (!dup) { if (!more.has(h)) more.set(h, []); more.get(h).push(t); }
    }
    if (dup) { removed++; continue; }
    out[n * 3] = a; out[n * 3 + 1] = b; out[n * 3 + 2] = c; n++;
  }
  return { tris: out.slice(0, n * 3), removed };
}

const signedVolume = (pos, tris, list, from, to) => {
  let v = 0;
  for (let i = from; i < to; i++) {
    const t = list[i], a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    v += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
  }
  return v;
};

/**
 * Who shares each edge. Entry h = t * 3 + e is the edge of triangle t from corner e to e + 1; the result holds the other triangle's
 * entry for that same edge, -1 for an edge only one triangle has (a boundary), and -2 for an edge three or more triangles share.
 */
function adjacency(tris, vertexCount) {
  const H = tris.length, other = new Int32Array(H).fill(-1), first = new Map(), N = vertexCount + 1;
  for (let h = 0; h < H; h++) {
    const t = (h / 3) | 0, e = h - t * 3, a = tris[h], b = tris[t * 3 + (e + 1) % 3], key = a < b ? a * N + b : b * N + a;
    const f = first.get(key);
    if (f === undefined) { first.set(key, h); continue; }
    if (other[f] === -1) { other[f] = h; other[h] = f; }
    else { other[h] = -2; if (other[f] >= 0) other[other[f]] = -2; other[f] = -2; }
  }
  return other;
}

/**
 * Make neighbouring triangles agree on direction (every shared edge is walked in opposite directions), then turn each connected
 * piece outward (positive volume). Edges shared by more than two triangles are not followed. Returns the number of triangles flipped.
 */
function orient(pos, tris, other) {
  const T = tris.length / 3, flip = new Int8Array(T).fill(-1), queue = new Int32Array(T);
  let flipped = 0, tail = 0;
  const swap = t => { const k = tris[t * 3 + 1]; tris[t * 3 + 1] = tris[t * 3 + 2]; tris[t * 3 + 2] = k; };
  for (let s = 0; s < T; s++) {
    if (flip[s] !== -1) continue;
    flip[s] = 0;
    const start = tail;
    queue[tail++] = s;
    for (let head = start; head < tail; head++) {
      const t = queue[head];
      for (let e = 0; e < 3; e++) {
        const h = t * 3 + e, nb = other[h];
        if (nb < 0) continue;
        const tn = (nb / 3) | 0;
        if (flip[tn] !== -1) continue;
        const from = flip[t] ? tris[t * 3 + (e + 1) % 3] : tris[h];             // the corner this triangle's edge starts at, after its own flip
        flip[tn] = tris[nb] === from ? 1 : 0;                                  // the neighbour must walk the edge the other way
        queue[tail++] = tn;
      }
    }
    for (let i = start; i < tail; i++) if (flip[queue[i]]) { swap(queue[i]); flipped++; }
    if (signedVolume(pos, tris, queue, start, tail) < 0) for (let i = start; i < tail; i++) { swap(queue[i]); flipped += flip[queue[i]] ? -1 : 1; }
  }
  return Math.max(0, flipped);
}

/**
 * Pull apart surfaces that touch along an edge (an edge shared by three or more triangles: two sheets of the surface pinched together,
 * common in scanned and AI-generated models). At each end of such an edge the triangles around the vertex are grouped into fans connected
 * through ordinary (two-triangle) edges; every fan after the first gets its own copy of the vertex, moved `nudge` along the inside of
 * that fan so the sheets no longer touch. Only vertices on such edges are touched, so healthy models are left exactly as they are.
 * Returns the number of vertices split. `pos` is a plain array that this appends to; `tris` is changed in place.
 */
function splitPinches(pos, tris, other, nudge) {
  const flagged = new Set();
  for (let h = 0; h < other.length; h++) {
    if (other[h] !== -2) continue;
    const t = (h / 3) | 0, e = h - t * 3;
    flagged.add(tris[h]); flagged.add(tris[t * 3 + (e + 1) % 3]);
  }
  if (!flagged.size) return 0;
  const around = new Map();
  for (let t = 0; t < tris.length / 3; t++) for (let c = 0; c < 3; c++) {
    const v = tris[t * 3 + c];
    if (flagged.has(v)) { if (!around.has(v)) around.set(v, []); around.get(v).push(t); }
  }
  let split = 0;
  for (const [v, list] of around) {
    const d = list.length, parent = Array.from({ length: d }, (_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const corner = t => (tris[t * 3] === v ? 0 : tris[t * 3 + 1] === v ? 1 : 2);
    for (let i = 0; i < d; i++) {
      const t = list[i], c = corner(t);
      for (const h of [t * 3 + c, t * 3 + (c + 2) % 3]) {                       // the two edges of this triangle that meet at v
        const nb = other[h];
        if (nb < 0) continue;                                                  // boundary or shared by 3+: does not connect fans
        const j = list.indexOf((nb / 3) | 0);
        if (j >= 0) parent[find(i)] = find(j);
      }
    }
    const fans = new Map();
    for (let i = 0; i < d; i++) { const r = find(i); if (!fans.has(r)) fans.set(r, []); fans.get(r).push(list[i]); }
    if (fans.size < 2) continue;
    let first = true;
    for (const members of fans.values()) {
      if (first) { first = false; continue; }                                  // the first fan keeps the original vertex
      let nx = 0, ny = 0, nz = 0;
      for (const t of members) {
        const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx;   // outward, once the triangles are oriented
      }
      const len = Math.hypot(nx, ny, nz) || 1, id = pos.length / 3;
      pos.push(pos[v * 3] - (nx / len) * nudge, pos[v * 3 + 1] - (ny / len) * nudge, pos[v * 3 + 2] - (nz / len) * nudge);   // inwards: away from the sheet it touched
      for (const t of members) tris[t * 3 + corner(t)] = id;
      split++;
    }
  }
  return split;
}

/** Boundary loops: chains of edges that belong to one triangle only, followed end to start. Ambiguous or open chains are counted as skipped. */
function boundaryLoops(tris, other, maxEdges) {
  const from = new Map();
  for (let h = 0; h < other.length; h++) {
    if (other[h] !== -1) continue;
    const t = (h / 3) | 0, e = h - t * 3, a = tris[h], b = tris[t * 3 + (e + 1) % 3];
    if (!from.has(a)) from.set(a, []);
    from.get(a).push(b);
  }
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
 * Repair one part. opts: { tolerance (in the part's own units: vertices closer than this are merged; by default 1e-5 of the model's diagonal, so it works
 * whether the file is in millimetres or normalised to one unit), maxHoleEdges (bigger holes are left alone) }
 * Returns { part, report }: `part` is the repaired copy (the input is not changed), `report` says what was done and whether the
 * part is now closed (`closed`), with `openBefore` / `openAfter` counting edges that are not shared by exactly two triangles.
 */
export function repairPart(part, opts = {}) {
  const { maxHoleEdges, relTolerance } = { ...DEFAULTS, ...opts };
  const bbMin = [Infinity, Infinity, Infinity], bbMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < part.positions.length; i += 3) for (let k = 0; k < 3; k++) { const v = part.positions[i + k]; if (v < bbMin[k]) bbMin[k] = v; if (v > bbMax[k]) bbMax[k] = v; }
  const diagonal = Math.hypot(bbMax[0] - bbMin[0], bbMax[1] - bbMin[1], bbMax[2] - bbMin[2]);
  const tolerance = opts.tolerance ?? Math.max(diagonal * relTolerance, 1e-9);
  const before = partStats(part);
  const w = weld(part, tolerance), pos = w.pos;
  const c = cleanTriangles(pos, w.tris);
  let tris = c.tris;
  const nv = pos.length / 3;
  let adj = adjacency(tris, nv);
  let flipped = orient(pos, tris, adj), filled = 0, skipped = 0;
  const separated = splitPinches(pos, tris, adj, diagonal * 3e-4);
  const nv2 = pos.length / 3;
  adj = adjacency(tris, nv2);
  if (separated) flipped += orient(pos, tris, adj);                            // each separated piece is turned outward on its own
  const { loops, skipped: bad } = boundaryLoops(tris, adj, maxHoleEdges);
  skipped += bad;
  const patches = [];
  for (const loop of loops) {
    const patch = fillRing(pos, loop.slice().reverse());                       // the patch walks each boundary edge the opposite way
    if (patch && patch.length) { patches.push(patch); filled++; } else skipped++;
  }
  if (filled) {
    const grown = new Uint32Array(tris.length + patches.reduce((n, p) => n + p.length, 0));
    grown.set(tris);
    let at = tris.length;
    for (const p of patches) { grown.set(p, at); at += p.length; }
    tris = grown;
    flipped += orient(pos, tris, adjacency(tris, nv2));
  }
  // keep only the vertices still in use
  const used = new Map(), np = [];
  const indices = Uint32Array.from(tris, v => { let k = used.get(v); if (k === undefined) { k = used.size; used.set(v, k); np.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); } return k; });
  const repaired = { ...part, positions: Float32Array.from(np), indices };
  const after = partStats(repaired);
  // a flat double skin (a lone triangle plus its patch) has no open edges but no volume either, so it does not count as a solid
  let lo = Infinity, hi = -Infinity;
  for (const v of repaired.positions) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const closed = after.openEdges === 0 && after.volume > 1e-6 * Math.pow(Math.max(hi - lo, 1e-9), 3);
  return { part: repaired, report: { mergedVertices: w.merged, removedTriangles: c.removed, flippedTriangles: flipped, filledHoles: filled, separatedPoints: separated, skippedHoles: skipped, openBefore: before.openEdges, openAfter: after.openEdges, closed, tolerance } };
}

/** One sentence for the page. */
export function describeRepair(name, r) {
  const did = [];
  if (r.mergedVertices) did.push(`merged ${r.mergedVertices.toLocaleString()} duplicate points`);
  if (r.removedTriangles) did.push(`removed ${r.removedTriangles.toLocaleString()} bad triangles`);
  if (r.flippedTriangles) did.push(`turned ${r.flippedTriangles.toLocaleString()} triangles the right way round`);
  if (r.separatedPoints) did.push(`pulled apart ${r.separatedPoints} point${r.separatedPoints === 1 ? '' : 's'} where the surface touched itself`);
  if (r.filledHoles) did.push(`filled ${r.filledHoles} hole${r.filledHoles === 1 ? '' : 's'}`);
  const what = did.length ? did.join(', ') : 'found nothing it could change';
  if (r.closed) return `${name}: ${what}. It is now a closed solid.`;
  const left = r.skippedHoles ? ` ${r.skippedHoles} hole${r.skippedHoles === 1 ? ' was' : 's were'} too large or too tangled to fill.` : '';
  return `${name}: ${what}, but ${r.openAfter.toLocaleString()} open or shared edges remain.${left} This needs a proper mesh tool.`;
}
