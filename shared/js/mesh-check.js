// Copyright (c) 2025 cmutnik
// Print-readiness checks for a model, in plain language. Pure (no DOM, no three.js), so it is tested in Node.
//
// Input: parts as read by mesh-import.js ({ name, positions, indices }) in millimetres, z up, sitting on the bed (z = 0).
// Output: { findings, verdict, stats, flags } where `flags` has one Uint8Array per part (bit 1 = overhang, bit 2 = thin wall)
// for colouring the preview.
//
// What it looks at: closedness (open and non-manifold edges, winding, inside-out), loose fragments, size against the bed,
// overhangs that need supports, how much of the model touches the bed, and wall thickness (rays cast inwards from sampled faces).

export const OVERHANG = 1, THIN = 2;
const BED_EPS = 0.1;                                             // faces this close to z = 0 sit on the bed

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** One part's geometry facts: welded topology, volume, area, shells, per-triangle normals and areas. */
export function analysePart(part) {
  const { positions: pos, indices: idx } = part, nv = pos.length / 3, nt = idx.length / 3;
  const ids = new Map(), canon = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) {
    const key = Math.round(pos[i * 3] * 1e4) + ',' + Math.round(pos[i * 3 + 1] * 1e4) + ',' + Math.round(pos[i * 3 + 2] * 1e4);
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    canon[i] = id;
  }
  const N = ids.size + 1, edges = new Map(), normals = new Float32Array(nt * 3), areas = new Float32Array(nt);
  const seen = new Set(), parent = Int32Array.from({ length: N }, (_, i) => i);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  let volume = 0, area = 0, degenerate = 0, duplicates = 0;
  for (let t = 0; t < nt; t++) {
    const ia = idx[t * 3], ib = idx[t * 3 + 1], ic = idx[t * 3 + 2];
    const a = [pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]], b = [pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]], c = [pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]];
    const n = cross(sub(b, a), sub(c, a)), len = Math.hypot(n[0], n[1], n[2]);
    volume += dot(a, cross(b, c)) / 6;
    areas[t] = len / 2; area += len / 2;
    if (len > 1e-12) { normals[t * 3] = n[0] / len; normals[t * 3 + 1] = n[1] / len; normals[t * 3 + 2] = n[2] / len; }
    const v = [canon[ia], canon[ib], canon[ic]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2] || len < 1e-9) { degenerate++; continue; }
    const key = [...v].sort((x, y) => x - y).join(',');
    if (seen.has(key)) duplicates++; else seen.add(key);
    for (let e = 0; e < 3; e++) {
      const p = v[e], q = v[(e + 1) % 3], k = p < q ? p * N + q : q * N + p, rec = edges.get(k) || { n: 0, fwd: 0 };
      rec.n++; rec.fwd += p < q ? 1 : -1;
      edges.set(k, rec);
    }
    parent[find(v[0])] = find(v[1]); parent[find(v[1])] = find(v[2]);
  }
  let open = 0, nonManifold = 0, inconsistent = 0;
  for (const r of edges.values()) { if (r.n === 1) open++; else if (r.n > 2) nonManifold++; else if (r.n === 2 && r.fwd !== 0) inconsistent++; }
  // shells: triangles grouped by the connected component of their first vertex
  const shells = new Map();
  for (let t = 0; t < nt; t++) {
    const root = find(canon[idx[t * 3]]);
    let s = shells.get(root);
    if (!s) { s = { triangles: 0, volume: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; shells.set(root, s); }
    s.triangles++;
    const ia = idx[t * 3], ib = idx[t * 3 + 1], ic = idx[t * 3 + 2];
    for (const i of [ia, ib, ic]) for (let k = 0; k < 3; k++) { const x = pos[i * 3 + k]; if (x < s.min[k]) s.min[k] = x; if (x > s.max[k]) s.max[k] = x; }
    const a = [pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]], b = [pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]], c = [pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]];
    s.volume += dot(a, cross(b, c)) / 6;
  }
  return { triangles: nt, volume, area, degenerate, duplicates, open, nonManifold, inconsistent, shells: [...shells.values()], normals, areas, closed: open === 0 && nonManifold === 0 };
}

/** A uniform grid over the triangles, for short ray casts. */
function buildGrid(pos, idx) {
  const nt = idx.length / 3, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { if (pos[i + k] < min[k]) min[k] = pos[i + k]; if (pos[i + k] > max[k]) max[k] = pos[i + k]; }
  const size = max.map((v, k) => Math.max(v - min[k], 1e-6)), res = Math.max(1, Math.min(96, Math.round(Math.cbrt(nt / 2))));
  const cell = Math.max(...size) / res, dims = size.map(s => Math.max(1, Math.ceil(s / cell)));
  const cells = new Map(), key = (x, y, z) => (z * dims[1] + y) * dims[0] + x;
  for (let t = 0; t < nt; t++) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) { const v = pos[idx[t * 3 + j] * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    const a = lo.map((v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - min[k]) / cell)))), b = hi.map((v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - min[k]) / cell))));
    for (let z = a[2]; z <= b[2]; z++) for (let y = a[1]; y <= b[1]; y++) for (let x = a[0]; x <= b[0]; x++) {
      const k = key(x, y, z);
      let list = cells.get(k);
      if (!list) cells.set(k, list = []);
      list.push(t);
    }
  }
  return { min, cell, dims, cells, key };
}

/** Distance along the ray (o + t d) to the nearest triangle other than `skip`, up to maxT, or Infinity. Möller-Trumbore, cells walked with a 3D DDA. */
function castRay(g, pos, idx, o, d, maxT, skip) {
  const { min, cell, dims, cells, key } = g;
  const pt = [o[0] + d[0] * 1e-4, o[1] + d[1] * 1e-4, o[2] + d[2] * 1e-4];
  const c = pt.map((v, k) => Math.floor((v - min[k]) / cell));
  const step = d.map(v => (v > 0 ? 1 : -1)), tDelta = d.map(v => (v === 0 ? Infinity : Math.abs(cell / v)));
  const tMax = d.map((v, k) => (v === 0 ? Infinity : ((v > 0 ? c[k] + 1 : c[k]) * cell + min[k] - pt[k]) / v));
  let best = Infinity;
  const tested = new Set();
  for (let guard = 0; guard < 4096; guard++) {
    if (c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] < dims[0] && c[1] < dims[1] && c[2] < dims[2]) {
      const list = cells.get(key(c[0], c[1], c[2]));
      if (list) for (const t of list) {
        if (t === skip || tested.has(t)) continue;
        tested.add(t);
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, cc = idx[t * 3 + 2] * 3;
        const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[cc] - pos[a], pos[cc + 1] - pos[a + 1], pos[cc + 2] - pos[a + 2]];
        const p = cross(d, e2), det = dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const s = [o[0] - pos[a], o[1] - pos[a + 1], o[2] - pos[a + 2]], u = dot(s, p) / det;
        if (u < 0 || u > 1) continue;
        const q = cross(s, e1), v = dot(d, q) / det;
        if (v < 0 || u + v > 1) continue;
        const tt = dot(e2, q) / det;
        if (tt > 1e-4 && tt < best) best = tt;
      }
    }
    const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    if (best <= tMax[k] || tMax[k] > maxT) break;                 // a hit before the next cell boundary is the nearest
    c[k] += step[k]; tMax[k] += tDelta[k];
  }
  return best <= maxT ? best : Infinity;
}

/**
 * Wall thickness by casting a ray inwards from sampled faces (area-weighted, evenly spread). Needs a closed, outward-facing part.
 * Returns { sampled, thin (count), min (mm), thinFlags: triangle indices }.
 */
export function wallThickness(part, facts, { minWall = 0.8, samples = 3000, maxLook = null } = {}) {
  const { positions: pos, indices: idx } = part, nt = idx.length / 3, look = maxLook ?? Math.max(minWall * 3, 2);
  const grid = buildGrid(pos, idx), cum = new Float64Array(nt);
  let total = 0;
  for (let t = 0; t < nt; t++) { total += facts.areas[t]; cum[t] = total; }
  const n = Math.min(samples, nt), picks = [];
  for (let s = 0, t = 0; s < n; s++) {                           // evenly spaced along the cumulative area: area-weighted and repeatable
    const target = ((s + 0.5) / n) * total;
    while (t < nt - 1 && cum[t] < target) t++;
    if (picks[picks.length - 1] !== t) picks.push(t);
  }
  let min = Infinity, thin = 0;
  const thinTris = [];
  for (const t of picks) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const o = [(pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3];
    const d = [-facts.normals[t * 3], -facts.normals[t * 3 + 1], -facts.normals[t * 3 + 2]];
    const hit = castRay(grid, pos, idx, o, d, look, t);
    if (hit < min) min = hit;
    if (hit < minWall) { thin++; thinTris.push(t); }
  }
  return { sampled: picks.length, thin, min, thinTris };
}

/**
 * @param {object[]} parts  mesh-import parts (z up, on the bed)
 * @param {object} o  bed [x, y, z] mm, overhangAngle (degrees from vertical; 45 is the usual slicer default), minWall (mm), samples, nozzle (mm)
 */
export function checkMesh(parts, { bed = [220, 220, 250], overhangAngle = 45, minWall = 0.8, samples = 3000, nozzle = 0.4 } = {}) {
  const findings = [], flags = [];
  const add = (level, id, title, detail = '', fix = '') => findings.push({ level, id, title, detail, fix });
  let tris = 0, volume = 0, area = 0, open = 0, nonManifold = 0, inconsistent = 0, degenerate = 0, duplicates = 0, insideOut = 0;
  let overhangArea = 0, bedArea = 0, thinCount = 0, thinSamples = 0, thinMin = Infinity, specks = 0, shellCount = 0, thinSkipped = false;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const cosLimit = Math.cos((overhangAngle * Math.PI) / 180);

  for (const part of parts) {
    const f = analysePart(part), fl = new Uint8Array(f.triangles);
    flags.push(fl);
    tris += f.triangles; volume += f.volume; area += f.area; open += f.open; nonManifold += f.nonManifold; inconsistent += f.inconsistent; degenerate += f.degenerate; duplicates += f.duplicates;
    if (f.volume < 0 && f.closed) insideOut++;
    shellCount += f.shells.length;
    for (const s of f.shells) {
      if (Math.max(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]) < 1 && f.shells.length > 1) specks++;
    }
    for (let i = 0; i < part.positions.length; i += 3) for (let k = 0; k < 3; k++) { const v = part.positions[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    const { indices: idx, positions: pos } = part;
    for (let t = 0; t < f.triangles; t++) {
      const nz = f.normals[t * 3 + 2];
      const zs = [pos[idx[t * 3] * 3 + 2], pos[idx[t * 3 + 1] * 3 + 2], pos[idx[t * 3 + 2] * 3 + 2]];
      if (nz < 0 && Math.max(...zs) < BED_EPS) bedArea += f.areas[t];
      else if (nz < -cosLimit) { overhangArea += f.areas[t]; fl[t] |= OVERHANG; }
    }
    if (f.closed && f.volume > 0 && f.degenerate === 0) {
      const w = wallThickness(part, f, { minWall, samples: Math.max(200, Math.round(samples / parts.length)) });
      thinCount += w.thin; thinSamples += w.sampled; thinMin = Math.min(thinMin, w.min);
      for (const t of w.thinTris) fl[t] |= THIN;
    } else thinSkipped = true;
  }
  const size = max.map((v, k) => v - min[k]);

  // ---- findings, worst first within each group ----
  if (open) add('bad', 'open', `${open.toLocaleString()} open edges: the model has holes`, 'Slicers cannot tell inside from outside at a hole, so the print can have gaps, missing walls or fail to slice.', 'Press "Repair and download" below, or use the repair in the STL / 3MF Modifier.');
  if (nonManifold) add('bad', 'non-manifold', `${nonManifold.toLocaleString()} edges shared by 3 or more faces`, 'Several surfaces meet along one edge, as when two solids are only touching. Slicers guess what you meant.', 'Repair splits these apart. If it persists, merge the pieces into one solid in your modelling program.');
  if (insideOut) add('bad', 'inside-out', `${insideOut} part${insideOut > 1 ? 's are' : ' is'} inside out`, 'The faces point inward, so a slicer may print nothing or fill the outside.', 'The repaired file is turned the right way round.');
  if (inconsistent) add('warn', 'winding', `${inconsistent.toLocaleString()} edges where neighbouring faces disagree on which way is out`, 'Some faces are flipped. Many slicers cope, some do not.', 'Repair turns them to match.');
  if (degenerate) add('warn', 'degenerate', `${degenerate.toLocaleString()} zero-area triangles`, 'Collapsed faces that carry no surface. They are harmless to most slicers but hint at a messy export.', 'Repair removes them.');
  if (duplicates) add('warn', 'duplicate', `${duplicates.toLocaleString()} duplicated faces`, 'The same face is in the file twice. This can make a slicer see a zero-thickness wall.', 'Repair removes them.');
  if (specks) add('warn', 'specks', `${specks} tiny floating fragment${specks > 1 ? 's' : ''} under 1 mm`, 'Specks left over from sculpting or boolean operations. They print as stray blobs or are ignored.', 'Delete them in your modelling program.');
  else if (shellCount > 1) add('info', 'shells', `${shellCount} separate pieces`, 'Fine if the model is meant to be several parts (an assembly or a flexi). If it should be one piece, they must touch or overlap.');

  const fit = (b, s) => s[0] <= b[0] + 1e-6 && s[1] <= b[1] + 1e-6 && s[2] <= b[2] + 1e-6;
  const fits = fit(bed, size) || fit([bed[1], bed[0], bed[2]], size);
  if (!fits) add('bad', 'size', `Too big for the bed: ${size.map(v => v.toFixed(0)).join(' x ')} mm against ${bed.join(' x ')} mm`, 'Even turned flat on the bed, it does not fit.', 'Scale it down, cut it in two (STL / 3MF Modifier has a cut with alignment pegs), or tilt it diagonally on the bed.');
  const longest = Math.max(...size);
  if (longest > 0 && longest < 5) add('warn', 'units', `Only ${longest.toFixed(1)} mm across: wrong units?`, 'Models exported in metres or inches come in tiny.', 'Set the file units to inches or centimetres above.');
  else if (longest > 600) add('warn', 'units', `${longest.toFixed(0)} mm across: wrong units?`, 'Models exported in micrometres come in huge.', 'Set the file units above.');
  if (tris > 1_000_000) add('warn', 'heavy', `${tris.toLocaleString()} triangles: heavier than a print needs`, 'Slow to slice, with files over 50 MB. Detail finer than the nozzle cannot be printed anyway.', 'Reduce triangles in the Flexi Maker ("Fix the model") or your modelling program.');

  const overFrac = area ? overhangArea / area : 0;
  if (overhangArea > 0) {
    const lvl = overFrac > 0.03 || overhangArea > 400 ? 'warn' : 'info';
    add(lvl, 'overhang', `${overhangArea.toFixed(0)} mm² of overhang (${(overFrac * 100).toFixed(1)}% of the surface) steeper than ${overhangAngle} degrees`, 'Surfaces that face downward and hang in the air need supports, or they sag. Shown in red in the "Overhangs" view.', 'Turn the model so fewer faces point down (STL / 3MF Modifier: Lay flat), split it, or add supports in your slicer.');
  } else add('ok', 'overhang', `No overhangs steeper than ${overhangAngle} degrees as it sits`, 'It should print without supports in this orientation.');
  if (bedArea < 100 && size[2] > 30 && area) add('warn', 'bed', `Only ${bedArea.toFixed(0)} mm² touches the bed`, 'A tall model on a small base can lift or topple.', 'Add a brim in your slicer, or give it a wider base.');

  if (thinSamples) {
    const frac = thinCount / thinSamples;
    if (thinMin < nozzle && frac > 0.01) add('bad', 'thin', `Walls as thin as ${thinMin.toFixed(2)} mm (nozzle is ${nozzle} mm)`, `${(frac * 100).toFixed(1)}% of the sampled surface is under ${minWall} mm thick. A wall thinner than one nozzle width cannot be printed and will be missing or broken. Shown in orange in the "Thin walls" view.`, 'Thicken those areas to at least 0.8 mm (two nozzle widths), or scale the model up.');
    else if (frac > 0.01) add('warn', 'thin', `${(frac * 100).toFixed(1)}% of the surface is under ${minWall} mm thick (thinnest ${thinMin.toFixed(2)} mm)`, 'Walls under two nozzle widths print as a single weak line. Shown in orange in the "Thin walls" view.', 'Thicken them to 0.8 mm or more if they carry any load.');
    else add('ok', 'thin', `Walls look thick enough (checked ${thinSamples.toLocaleString()} points, thinnest ${Number.isFinite(thinMin) ? (thinMin < 2 ? thinMin.toFixed(2) + ' mm' : 'over 2 mm') : 'n/a'})`, `Nothing under ${minWall} mm in the sample. A sample is not every face: a thin fin can slip through.`);
  } else if (thinSkipped) add('info', 'thin', 'Wall thickness was not checked', 'It needs a closed, outward-facing model. Repair the model and check again.');

  const verdict = findings.some(f => f.level === 'bad') ? 'problem' : findings.some(f => f.level === 'warn') ? 'caution' : 'ready';
  return {
    findings, verdict, flags,
    stats: { triangles: tris, volume, area, size, shells: shellCount, overhangArea, bedArea, thinMin: Number.isFinite(thinMin) ? thinMin : null, thinSamples, open, nonManifold },
  };
}
