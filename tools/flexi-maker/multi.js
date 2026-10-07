// Copyright (c) 2025 cmutnik
// Flexi cuts in any direction. flexi.js cuts a whole model by parallel planes along one axis, in a chain. This builds on it for cuts that each have
// their own axis and tilt, and that each work on one piece of the model, so the segments form a tree (a body with a tail bent off it, a curled snake).
//
// How: the cuts are applied in order. For each, the piece it is meant for is found (the one containing its anchor point, else the one the plane crosses the most),
// turned into the cut's own frame (the plane's normal becomes +z, the plane z = 0), and handed to makeFlexi with a single cut. That gives a lower and an upper
// side, each possibly several shells and colours; they are turned back and become two pieces. Each cut therefore slices every shell of the piece it works on,
// exactly as a single-axis cut slices every shell of the model.
import { loadManifold, toManifold } from '../mesh-modifier/boolean3d.js';
import { makeFlexi } from './flexi.js';
import { normalOf, frameOf, toFrame, fromFrame, dirFromFrame, mapParts, planeDistance } from './cut-plane.js';

/** How close a plane may pass to an earlier joint's centre: the joint's height above and below the cut or its width, whichever is more, plus a margin. */
export const joinReach = j => Math.max(j.half + (j.extent || j.radius), j.extent || 0) + 2;

/**
 * Room each cut has before another cut's plane: along its own normal, through its point, up to the nearest plane of any other cut (below and above).
 * makeFlexi sizes joints to the thickness of the segments next to them, so each is told this as the segment ends. Infinity when nothing is in the way.
 */
export function roomAround(cuts, i) {
  const c = cuts[i], n = normalOf(c.axis, c.tilt);
  let below = Infinity, above = Infinity;
  cuts.forEach((o, j) => {
    if (j === i) return;
    const m = normalOf(o.axis, o.tilt), denom = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
    if (Math.abs(denom) < 0.05) return;                                        // the line along n never meets a plane that runs along it
    const s = (m[0] * (o.point[0] - c.point[0]) + m[1] * (o.point[1] - c.point[1]) + m[2] * (o.point[2] - c.point[2])) / denom;
    if (s > 0) above = Math.min(above, s); else if (s < 0) below = Math.min(below, -s);
  });
  return { below, above };
}

const base = name => name.replace(/^Segment \d+( - )?/, '');

async function containsPoint(w, parts, p) {
  const solids = parts.map(x => toManifold(w, x)), whole = w.Manifold.union(solids), probe = w.Manifold.cube([1, 1, 1], true).translate(p), hit = probe.intersect(whole);
  const v = hit.volume();
  [...solids, whole, probe, hit].forEach(m => m.delete());
  return v > 1e-6;
}

async function sectionArea(w, parts) {
  const solids = parts.map(x => toManifold(w, x)), whole = w.Manifold.union(solids);
  let area = 0;
  const { min, max } = whole.boundingBox();
  if (min[2] < -1e-6 && max[2] > 1e-6) { const s = whole.slice(0); area = s.area(); s.delete(); }
  [...solids, whole].forEach(m => m.delete());
  return area;
}

/**
 * @param {object[]} parts  the model's parts (final orientation)
 * @param {{ axis, tilt, point, anchor? }[]} cuts  in the order they are applied
 * @param {object} o  joint, ball, bar, bend, clearance (as makeFlexi)
 * @returns {{ parts, joints, bend, warnings, applied }}  parts carry `seg` (the piece's number, from 0); joints are { cut, parent, child, pivot, axis, radius, half } in model coordinates
 */
export async function makeFlexiCuts(parts, cuts, o = {}) {
  if (!cuts.length) throw new Error('Place at least one cut.');
  const w = await loadManifold();
  const pieces = new Map([[0, parts.map(p => ({ ...p, base: p.name }))]]), joints = [], warnings = [], applied = [];
  let bend = Infinity, next = 1;
  for (const [ci, cut] of cuts.entries()) {
    const label = `Cut ${ci + 1}`, normal = normalOf(cut.axis, cut.tilt), frame = frameOf(normal), origin = cut.point;
    const into = ps => mapParts(ps, q => toFrame(q, frame, origin)), out = ps => mapParts(ps, q => fromFrame(q, frame, origin));

    // the piece this cut works on
    let pid = null;
    if (cut.anchor) for (const id of pieces.keys()) if (await containsPoint(w, pieces.get(id), cut.anchor)) { pid = id; break; }
    if (pid === null) {
      let best = 0;
      for (const id of pieces.keys()) { const a = await sectionArea(w, into(pieces.get(id))); if (a > best + 1e-9) { best = a; pid = id; } }
      if (pid === null) throw new Error(`${label} does not cross any part of the model. Move it onto the model.`);
    }
    applied.push({ cut: ci, piece: pid });

    // an earlier joint of this piece must be well clear of the plane
    for (const j of joints) {
      if (j.parent !== pid && j.child !== pid) continue;
      const d = Math.abs(planeDistance(j.pivot, origin, normal)), need = joinReach(j);
      if (d < need) throw new Error(`${label} passes ${d.toFixed(1)} mm from the joint of cut ${j.cut + 1}, which needs about ${need.toFixed(0)} mm clear round its centre. Move the cut further away, or make that joint smaller.`);
    }

    let r;
    try {
      const room = roomAround(cuts, ci);
      r = await makeFlexi(into(pieces.get(pid)).map(p => ({ ...p, name: p.base })), { axis: 'z', count: 2, positions: [0], joint: o.joint, ball: o.ball, bar: o.bar, bend: o.bend, clearance: o.clearance, clip: [-room.below, room.above] });
    } catch (e) { throw new Error(`${label}: ${e.message}`); }
    const lower = r.parts.filter(p => p.seg === 0), upper = r.parts.filter(p => p.seg === 1);
    if (!lower.length || !upper.length) throw new Error(`${label} does not split the piece it works on into two. Move it so it crosses the model.`);
    const clean = ps => out(ps).map(p => ({ ...p, base: base(p.name) }));
    const child = next++;
    pieces.set(pid, clean(lower));
    pieces.set(child, clean(upper));
    for (const j of r.joints) joints.push({ cut: ci, parent: pid, child, pivot: fromFrame([j.x, j.y, j.pivot], frame, origin), axis: dirFromFrame([1, 0, 0], frame), radius: j.radius, half: j.half, extent: j.extent });
    bend = Math.min(bend, r.bend);
    warnings.push(...r.warnings.map(t => `${label}: ${t}`));
  }
  const many = parts.length > 1, outParts = [];
  for (const id of [...pieces.keys()].sort((a, b) => a - b)) for (const p of pieces.get(id)) {
    const { base: b, ...rest } = p;
    outParts.push({ ...rest, name: many ? `Segment ${id + 1} - ${b}` : `Segment ${id + 1}`, seg: id });
  }
  return { parts: outParts, joints, bend: Number.isFinite(bend) ? bend : 0, warnings, applied };
}
