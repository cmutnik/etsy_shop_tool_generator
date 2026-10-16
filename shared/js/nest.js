// Copyright (c) 2025 cmutnik
// Plate nesting: arrange many models on print beds so they do not touch, using each model's real footprint (not its bounding box),
// so an L or a ring lets a small piece sit in its corner. Pure (no DOM, no three.js), so it is tested in Node.
//
// Each model is projected onto the bed, painted into a bit grid (about 2 mm cells), grown by half the spacing, and then slid into the first free
// spot on the plate, trying each allowed rotation. Bit rows make a collision test a few AND operations per grid row.
//
// Models are plain `parts` ({ positions, indices }) already sitting on the bed (z >= 0) and centred; nesting only moves them in x and y and turns them about z.

/** Rotate a point about the z axis, degrees counter-clockwise. */
export const rot = (x, y, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };

/** Point-to-segment squared distance. */
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}

/**
 * The footprint of `parts` turned by `angle`, as a bit grid. Cells the model touches are set (conservatively: any cell within 0.71 cell of a triangle),
 * then grown by `halo` cells all round. Returns { w, h, rows, minX, minY, halo, cells, shifts }.
 */
export function makeMask(parts, angle, cell, halo) {
  const pts = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parts) {
    const xy = new Float64Array(p.positions.length / 3 * 2);
    for (let i = 0, j = 0; i < p.positions.length; i += 3, j += 2) {
      const [x, y] = rot(p.positions[i], p.positions[i + 1], angle);
      xy[j] = x; xy[j + 1] = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    pts.push(xy);
  }
  const gw = Math.floor((maxX - minX) / cell) + 1, gh = Math.floor((maxY - minY) / cell) + 1;
  const grid = new Uint8Array(gw * gh), reach2 = (cell * 0.7072) ** 2;
  parts.forEach((p, k) => {
    const xy = pts[k], idx = p.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const ax = xy[idx[t] * 2], ay = xy[idx[t] * 2 + 1], bx = xy[idx[t + 1] * 2], by = xy[idx[t + 1] * 2 + 1], cx = xy[idx[t + 2] * 2], cy = xy[idx[t + 2] * 2 + 1];
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell) - 0), x1 = Math.min(gw - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cell));
      const y0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - minY) / cell) - 0), y1 = Math.min(gh - 1, Math.floor((Math.max(ay, by, cy) - minY) / cell));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) === 1) { grid[y0 * gw + x0] = 1; continue; }            // most triangles fall in one cell
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (grid[y * gw + x]) continue;
        const px = minX + (x + 0.5) * cell, py = minY + (y + 0.5) * cell;
        let hit = false;
        if (Math.abs(det) > 1e-12) {
          const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
          hit = l1 >= 0 && l2 >= 0 && l1 + l2 <= 1;
        }
        if (!hit) hit = segDist2(px, py, ax, ay, bx, by) <= reach2 || segDist2(px, py, bx, by, cx, cy) <= reach2 || segDist2(px, py, cx, cy, ax, ay) <= reach2;
        if (hit) grid[y * gw + x] = 1;
      }
    }
  });
  // grow by halo cells (square), then pack into bit rows
  const w = gw + 2 * halo, h = gh + 2 * halo, grown = new Uint8Array(w * h);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y * gw + x]) grown[(y + halo) * w + x + halo] = 1;
  const dilate = (src, horizontal) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let d = -halo; d <= halo; d++) { const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d; if (xx >= 0 && xx < w && yy >= 0 && yy < h) out[yy * w + xx] = 1; }
    }
    return out;
  };
  const full = halo ? dilate(dilate(grown, true), false) : grown;
  const wordsPerRow = Math.ceil(w / 32), rows = [];
  let cells = 0;
  for (let y = 0; y < h; y++) {
    const row = new Uint32Array(wordsPerRow);
    for (let x = 0; x < w; x++) if (full[y * w + x]) { row[x >> 5] |= 1 << (x & 31); cells++; }
    rows.push(row);
  }
  return { w, h, rows, minX, minY, halo, cells, shifts: new Array(32) };
}

/** The mask's rows moved right by s bits (0-31), widened by a word. Cached. */
function shifted(mask, s) {
  if (mask.shifts[s]) return mask.shifts[s];
  const n = mask.rows[0].length + 1;
  const out = mask.rows.map(row => {
    const r = new Uint32Array(n);
    for (let k = 0; k < row.length; k++) { r[k] |= row[k] << s; if (s) r[k + 1] |= row[k] >>> (32 - s); }
    return r;
  });
  return (mask.shifts[s] = out);
}

class Plate {
  constructor(W, H) { this.W = W; this.H = H; this.rows = Array.from({ length: H }, () => new Uint32Array((W >> 5) + 2)); this.placements = []; this.used = 0; }
  fits(mask, x, y) {
    const sr = shifted(mask, x & 31), wx = x >> 5;
    for (let r = 0; r < mask.h; r++) { const occ = this.rows[y + r], row = sr[r]; for (let k = 0; k < row.length; k++) if (row[k] & occ[wx + k]) return false; }
    return true;
  }
  put(mask, x, y) {
    const sr = shifted(mask, x & 31), wx = x >> 5;
    for (let r = 0; r < mask.h; r++) { const occ = this.rows[y + r], row = sr[r]; for (let k = 0; k < row.length; k++) occ[wx + k] |= row[k]; }
    this.used += mask.cells;
  }
  /** First free spot, lowest row first. Returns [x, y] or null. */
  firstFit(mask) {
    for (let y = 0; y + mask.h <= this.H; y++) for (let x = 0; x + mask.w <= this.W; x++) if (this.fits(mask, x, y)) return [x, y];
    return null;
  }
}

/**
 * @param {{ name, parts, copies }[]} items   parts are centred on the bed and sit at z >= 0; copies >= 1, or 0 = as many as fit on one plate (after the others)
 * @param {object} o  bed: { width, depth } mm; spacing (mm between models); edge (mm kept free at the bed edge); cell (mm per grid cell, 2 is a good speed / fit balance);
 *                    angles: rotations to try, degrees (default [0, 90, 180, 270]); maxPlates; fillLimit (most copies for a "fill the plate" item)
 * @returns {{ plates: { placements: { item, copy, angle, tx, ty, w, h }[], used }[], unplaced: { item, copy, reason }[], cell, W, H }}
 *  A placement says: turn the model by `angle` about z, then move it by (tx, ty); the plate's bed runs from (0, 0) to (bed.width, bed.depth).
 */
export function nest(items, { bed, spacing = 4, edge = 3, cell = 2, angles = [0, 90, 180, 270], maxPlates = 20, fillLimit = 200 } = {}) {
  const halo = Math.max(0, Math.ceil(spacing / 2 / cell));
  const W = Math.floor((bed.width - 2 * edge) / cell) + 2 * halo, H = Math.floor((bed.depth - 2 * edge) / cell) + 2 * halo;
  if (W < 4 || H < 4) throw new Error('The bed is too small once the edge margin is taken off.');
  const masks = items.map(it => angles.map(a => makeMask(it.parts, a, cell, halo)));
  const area = masks.map(m => m[0].cells);
  const plates = [new Plate(W, H)], unplaced = [];
  const place = (item, copy) => {
    const options = [];
    for (let pi = 0; pi < plates.length; pi++) {
      for (let k = 0; k < angles.length; k++) {
        const m = masks[item][k];
        if (m.w > W || m.h > H) continue;
        const f = plates[pi].firstFit(m);
        if (f) options.push({ plate: pi, k, x: f[0], y: f[1], key: (f[1] + m.h) * W + f[0] });
      }
      if (options.length) break;                                   // fill the earliest plate that can take it
    }
    if (!options.length) {
      if (plates.length >= maxPlates) return unplaced.push({ item, copy, reason: 'plates' });
      const fresh = new Plate(W, H), fit = masks[item].some(m => m.w <= W && m.h <= H && fresh.firstFit(m));
      if (!fit) return unplaced.push({ item, copy, reason: 'size' });
      plates.push(fresh);
      return place(item, copy);
    }
    const best = options.sort((a, b) => a.key - b.key)[0], m = masks[item][best.k], plate = plates[best.plate];
    plate.put(m, best.x, best.y);
    plate.placements.push({ item, copy, angle: angles[best.k], tx: edge + best.x * cell - m.minX, ty: edge + best.y * cell - m.minY, w: (m.w - 2 * halo) * cell, h: (m.h - 2 * halo) * cell });
  };
  // biggest footprints first packs best; "fill" items go last, into whatever is left of the first plate
  const order = items.map((_, i) => i).filter(i => items[i].copies > 0).sort((a, b) => area[b] - area[a]);
  for (const i of order) for (let c = 0; c < items[i].copies; c++) place(i, c);
  for (const i of items.map((_, k) => k).filter(k => items[k].copies === 0)) {
    for (let c = 0; c < fillLimit; c++) {
      const before = plates[0].placements.length;
      const tryPlate = plates[0];
      const options = masks[i].map((m, k) => ({ m, k, f: m.w <= W && m.h <= H ? tryPlate.firstFit(m) : null })).filter(o => o.f);
      if (!options.length) break;
      const best = options.sort((a, b) => ((a.f[1] + a.m.h) * W + a.f[0]) - ((b.f[1] + b.m.h) * W + b.f[0]))[0];
      tryPlate.put(best.m, best.f[0], best.f[1]);
      tryPlate.placements.push({ item: i, copy: c, angle: angles[best.k], tx: edge + best.f[0] * cell - best.m.minX, ty: edge + best.f[1] * cell - best.m.minY, w: (best.m.w - 2 * halo) * cell, h: (best.m.h - 2 * halo) * cell });
      if (tryPlate.placements.length === before) break;
    }
  }
  return {
    plates: plates.filter(p => p.placements.length).map(p => ({ placements: p.placements, used: p.used * cell * cell })),
    unplaced, cell, W, H,
  };
}

/** A part moved by a placement: turned about z by `angle`, then moved by (tx, ty). Returns a new part. */
export function applyPlacement(part, { angle, tx, ty }) {
  const pos = new Float32Array(part.positions.length);
  for (let i = 0; i < pos.length; i += 3) {
    const [x, y] = rot(part.positions[i], part.positions[i + 1], angle);
    pos[i] = x + tx; pos[i + 1] = y + ty; pos[i + 2] = part.positions[i + 2];
  }
  return { ...part, positions: pos };
}

/** Footprint area of parts in mm^2 (projected triangles, summed: a quick size figure for the page). */
export function footprintArea(parts, cell = 2) {
  const m = makeMask(parts, 0, cell, 0);
  return m.cells * cell * cell;
}
