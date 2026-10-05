// Copyright (c) 2025 cmutnik
// Turn a model into a print-in-place articulated ("flexi") one: cut it across at a few places and join the pieces with ball-and-socket joints
// that print assembled. Parts are { name, color, slot?, positions, indices } in their final orientation (z up). Never changes its input.
//
// At each cut, every separate piece of the cross-section gets one joint, centred where the biggest circle fits. Around the joint a V-shaped
// notch (flat gap plus a cone) is removed so the two sides can tilt. The ball is added to the lower segment, in the colour of whichever
// part it grows out of; the socket is carved out of every part above it. Each original part (so each colour) stays its own part in every segment.
import { loadManifold, toManifold, fromManifold } from '../mesh-modifier/boolean3d.js';
import { cutPositions, poleOfInaccessibility, ballDims, hookDims } from './joints.js';

const SEGMENTS = 48;
const CUP_WALL = 1.4;       // the cup's wall, as in ballDims()
const MIN_BALL = 2.5;       // smaller than this and a joint is not worth printing
const MIN_THICKNESS = 3;    // what a notch may not eat into at a segment's rim

// Put the cut axis on z (cyclic, so triangle winding is kept) and back again.
const FORWARD = { x: [1, 2, 0], y: [2, 0, 1], z: [0, 1, 2] };                   // new [x, y, z] = old [a, b, c]
function permute(part, axis, back = false) {
  const f = FORWARD[axis], positions = new Float32Array(part.positions.length);
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    if (back) positions[i + f[k]] = part.positions[i + k]; else positions[i + k] = part.positions[i + f[k]];
  }
  return { ...part, positions };
}

/** A point in the cut-axis frame (cut axis on z) back in the model's own axes. */
export function fromAxisFrame(v, axis) { const f = FORWARD[axis], out = [0, 0, 0]; for (let k = 0; k < 3; k++) out[f[k]] = v[k]; return out; }

/** The radius a notch must reach to clear everything around the joint (x, y): the cut outline, and any vertex between z0 and z1 (an overhang the outline does not show). */
function reachOf(parts, rings, x, y, z0, z1) {
  let r = Math.max(...rings.flatMap(ring => ring.map(p => Math.hypot(p[0] - x, p[1] - y))));
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) {
    const z = p.positions[i + 2];
    if (z >= z0 && z <= z1) r = Math.max(r, Math.hypot(p.positions[i] - x, p.positions[i + 1] - y));
  }
  return r;
}

/**
 * opts: { axis: 'x' | 'y' | 'z', count (segments), positions (optional list of cuts, mm along the axis),
 *         joint: 'hook' (a closed loop on each segment, the two linked like a chain) | 'ball' (ball and socket),
 *         ball (mm radius, 0 = auto), bar (mm, the loops' bar thickness, 0 = auto), bend (degrees each joint should reach),
 *         clearance }                                                          (the gap between segments follows from the joint's size)
 * Returns { parts, cuts: [mm along the axis], joints: [{ half (half the distance between the two faces), at (the cut, mm along the axis), pivot (the ball's centre, same axis, model coordinates), x, y, radius }], bend (degrees actually allowed), warnings }.
 */
export async function makeFlexi(parts, { axis = 'z', count = 4, positions = null, joint = 'hook', ball = 0, bar = 0, bend = 20, clearance = 0.4 } = {}) {
  if (!FORWARD[axis]) throw new Error(`Unknown axis: ${axis}`);
  if (!(clearance >= 0.1)) throw new Error('The joint clearance must be at least 0.1 mm, or the pieces fuse together.');
  const w = await loadManifold(), made = [], keep = m => { made.push(m); return m; }, warnings = [];
  try {
    const src = parts.map(p => permute(p, axis));
    const solids = src.map(p => keep(toManifold(w, p)));
    const whole = keep(w.Manifold.union(solids));
    const { min, max } = whole.boundingBox(), lo = min[2], hi = max[2];
    const cuts = cutPositions(lo, hi, count, positions);
    if (!cuts.length) throw new Error('Nothing to cut: ask for at least 2 segments, or give cut positions inside the model.');
    const edges = [lo, ...cuts, hi], thick = i => edges[i + 1] - edges[i];       // segment i runs edges[i] .. edges[i + 1]

    // 1. a joint site for every separate piece of the model's cross-section at each cut
    const sites = [], skipped = [];
    cuts.forEach((c, k) => {
      const section = keep(whole.slice(c));
      const comps = section.decompose().filter(c => keep(c) && !c.isEmpty());
      if (!comps.length) skipped.push({ k, why: 'empty', comp: null });          // the cut passes between separate parts
      for (const comp of comps) {
        const rings = comp.toPolygons().map(r => r.map(p => [p[0], p[1]])), area = comp.area();
        const pole = area >= 4 ? poleOfInaccessibility(rings) : null;
        if (!pole) { skipped.push({ k, why: 'a sliver', comp }); continue; }
        sites.push({ k, c, comp, x: pole.x, y: pole.y, room: pole.r, reach: reachOf(src, rings, pole.x, pole.y, edges[k], edges[k + 2]) });
      }
    });

    // 2. which sites can hold a joint, and how far apart the two faces of each cut must be
    const hook = joint !== 'ball', viable = [];
    for (const s of sites) {
      const tMin = Math.min(thick(s.k), thick(s.k + 1));
      let dims = null;
      if (hook) dims = hookDims(s.room, tMin, clearance, bar);
      else {                                                                    // the biggest ball whose cup fits the room and whose segments are long enough
        const fit = R => R >= MIN_BALL && R + clearance + CUP_WALL + 0.5 <= s.room && (ballDims(R, clearance)?.G ?? Infinity) + 8 <= tMin;
        for (let R = ball > 0 ? ball : Math.min(Math.max(0.6 * s.room, 2.5), 12); R >= MIN_BALL && !dims; R *= 0.93) if (fit(R)) dims = ballDims(R, clearance);
      }
      if (dims) viable.push({ ...s, ...dims }); else skipped.push({ k: s.k, why: s.room < 6 ? 'too thin' : 'the segments are too short', comp: s.comp, });
    }

    // 3. how far the notches may cut in before a segment gets too thin at its rim
    const tReq = Math.tan((Math.min(Math.max(bend, 0), 90) * Math.PI) / 360);   // each side of the notch tilts half of the bend
    let t = tReq;
    const at_ = (k, f, init) => viable.filter(s => s.k === k).reduce((m, s) => f(m, s), init);
    for (let i = 0; i < edges.length - 1; i++) {
      const reachAt = k => at_(k, (m, s) => Math.max(m, s.reach), 0), halfAt = k => at_(k, (m, s) => Math.max(m, s.half), 0);
      const rLow = i > 0 ? reachAt(i - 1) : 0, rHigh = i < cuts.length ? reachAt(i) : 0;
      const free = thick(i) - (i > 0 ? halfAt(i - 1) : 0) - (i < cuts.length ? halfAt(i) : 0) - MIN_THICKNESS;
      if (rLow + rHigh > 0) t = Math.min(t, Math.max(free, 0) / (rLow + rHigh));
    }
    let allowed = (Math.atan(t) * 360) / Math.PI;
    if (viable.length) allowed = Math.min(allowed, ...viable.map(s => s.tilt));                          // where the loops (or the neck and the cup) meet each other
    if (tReq > 0 && allowed < bend - 1e-6) warnings.push(`${allowed < (Math.atan(t) * 360) / Math.PI - 1e-6 ? (hook ? 'The loops' : 'The ball joints') : 'The pieces are too short and thin, so the joints'} will bend about ${Math.round(allowed)} degrees, not ${Math.round(bend)}. ${hook ? 'Thicker bars and fewer segments allow more.' : 'Bigger balls and fewer segments allow more.'}`);

    const joints = viable;
    if (!joints.length) throw new Error(`No joint fits at the cut${cuts.length === 1 ? '' : 's'}. The model is too thin there, or the segments are too short: use fewer segments, or cut where the model is thicker.`);
    for (const k of new Set(skipped.map(s => s.k))) {
      const why = skipped.filter(s => s.k === k).map(s => s.why), at = `${(cuts[k] - lo).toFixed(1)} mm`, here = joints.filter(j => j.k === k).length;
      if (!here && why.every(x => x === 'empty')) warnings.push(`The cut at ${at} along the model falls in the space between separate parts, so there is nothing to cut or join there. Move it onto the model, or use fewer segments.`);
      else if (!here) warnings.push(`At ${at} along the model nothing fits a joint (${[...new Set(why.filter(x => x !== 'empty'))].join(', ')}), so the cut is left solid. Move it or use fewer segments.`);
      else warnings.push(`At ${at} along the model, ${why.length} thin piece${why.length === 1 ? ' is' : 's are'} left solid (${[...new Set(why)].join(', ')}), so ${why.length === 1 ? 'it limits' : 'they limit'} the bend there.`);
    }

    // 5. the notch of every joint, then what it is built from: a socket and a ball, or two interlocked loops
    const voids = [], sockets = [], adds = [];
    const at = (m, x, y, z) => keep(keep(m).translate([x, y, z]));
    for (const j of joints) {
      const h = j.half, reach = j.reach + 1, rim = h + reach * t;
      const profile = keep(new w.CrossSection([[[0, -h], [reach, -rim], [reach, rim], [0, h]]]));
      const notch = at(w.Manifold.revolve(profile, SEGMENTS), j.x, j.y, j.c);
      let cut = notch;
      for (const o of joints) {                                                 // two joints at one cut: each clears the half of the model nearer to it
        if (o === j || o.k !== j.k) continue;
        const dx = j.x - o.x, dy = j.y - o.y, len = Math.hypot(dx, dy);
        cut = keep(cut.trimByPlane([dx / len, dy / len, 0], (dx * (j.x + o.x) / 2 + dy * (j.y + o.y) / 2) / len));
      }
      for (const sk of skipped) if (sk.k === j.k && sk.comp) {                   // pieces too thin for a joint stay whole
        cut = keep(cut.subtract(at(sk.comp.extrude(2 * rim + 2), 0, 0, j.c - rim - 1)));
      }
      voids.push(cut);
      if (hook) {
        // a rectangular link of bar thickness d standing in a plane; its feet reach `foot` into the segment, past the sloping notch face
        const foot = 2 + (j.W / 2) * t, link = (zOuter0, zOuter1, zInner0, zInner1) => {
          const box = (x0, z0, x1, z1) => keep(w.CrossSection.square([x1 - x0, z1 - z0], false)).translate([x0, z0]);
          const flat = keep(keep(box(-j.W / 2, zOuter0, j.W / 2, zOuter1)).subtract(box(-j.wi / 2, zInner0, j.wi / 2, zInner1)));
          return keep(keep(flat.extrude(j.d)).rotate([90, 0, 0])).translate([0, j.d / 2, 0]);   // 2D y -> z, thickness along y, centred
        };
        const zb = -h + clearance + j.slack, za = h - clearance - j.slack;       // the upper link's lower bar, the lower link's upper bar (relative to the cut)
        const lower = at(link(-h - foot, za, -h, za - j.d), j.x, j.y, j.c);
        const upper = at(keep(link(zb, h + foot, zb + j.d, h)).rotate([0, 0, 90]), j.x, j.y, j.c);
        adds.push({ j, anchor: lower, solid: lower }, { j, anchor: upper, solid: upper });
      } else {
        // the ball stands on the lower face on a short neck; the cup hangs from the upper face and wraps over it
        const zp = j.c - h + j.a, embed = j.neck * t + 2, z0 = j.c - h - embed;      // the ball's centre; how far the neck reaches into the segment below
        const cavity = at(w.Manifold.sphere(j.Rc, SEGMENTS), j.x, j.y, zp);
        sockets.push(cavity);
        const outer = at(w.Manifold.sphere(j.Ro, SEGMENTS), j.x, j.y, zp).trimByPlane([0, 0, 1], zp - j.lip);
        adds.push({ j, solid: keep(keep(outer).subtract(cavity)), anchor: null });
        const neck = at(w.Manifold.cylinder(zp - z0, j.neck, j.neck, SEGMENTS, false), j.x, j.y, z0);
        const anchor = at(w.Manifold.cylinder(embed - 0.2, j.neck, j.neck, SEGMENTS, false), j.x, j.y, z0);
        adds.push({ j, anchor, solid: keep(at(w.Manifold.sphere(j.R, SEGMENTS), j.x, j.y, zp).add(neck)) });
      }
    }
    const carve = keep(w.Manifold.union([...voids, ...sockets]));

    // 6. carve every part, split what is left into its separate pieces, then grow the balls / loops out of the pieces they stand on
    let pieces = [];
    const segmentOf = m => { const bb = m.boundingBox(), mid = (bb.min[2] + bb.max[2]) / 2; return cuts.filter(c => c < mid).length; };   // before balls are added: a ball reaches into the next segment
    src.forEach((p, pi) => {
      const rest = keep(solids[pi].subtract(carve));
      for (const m of rest.decompose()) { keep(m); if (m.volume() > 0.5) pieces.push({ pi, m, seg: segmentOf(m) }); }
    });
    for (const b of adds) {
      let best = null, volume = 0;
      for (const piece of pieces) {
        const v = keep(piece.m.intersect(b.anchor || b.solid)).volume();
        if (v > volume) { volume = v; best = piece; }
      }
      if (!best) throw new Error(`Could not attach a joint at ${(b.j.c - lo).toFixed(1)} mm along the model. Try a different cut position.`);
      best.m = keep(best.m.add(b.solid));
      for (const other of pieces) if (other !== best) other.m = keep(other.m.subtract(b.solid));   // where the neck runs through another colour, that colour gives way
    }

    // 7. name the pieces by segment and hand them back in the original orientation
    pieces.sort((a, b) => a.seg - b.seg || a.pi - b.pi);
    const many = parts.length > 1;
    const out = pieces.map(p => {
      const like = parts[p.pi], name = many ? `Segment ${p.seg + 1} - ${like.name}` : `Segment ${p.seg + 1}`;
      return permute({ ...fromManifold(p.m, like), name, color: like.color, slot: like.slot, seg: p.seg }, axis, true);
    });
    return { parts: out, cuts, joints: joints.map(j => ({ k: j.k, at: j.c, half: j.half, pivot: hook ? j.c : j.c - j.half + j.a, x: j.x, y: j.y, radius: hook ? j.d : j.R })), bend: allowed, warnings };
  } finally { made.forEach(m => m.delete()); }
}
