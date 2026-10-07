// Copyright (c) 2025 cmutnik
// Editing the cut planes by hand: pure functions on a list of cut positions, in mm along the cut direction measured from the model's low end
// (the same numbers as the page's "Cut positions" box). No DOM, no 3D library, so it is tested in Node.
//
// Every function returns a new sorted list. A segment is never shorter than `min` mm, because a joint needs room on both sides of its cut.

export const MIN_SEGMENT = 6;
export const SNAP = 0.5;

const r1 = v => Math.round(v * 10) / 10;
export const snap = (v, step = SNAP) => Math.round(v / step) * step;

/** Sorted, rounded to 0.1 mm, inside the model, and thinned so no segment is shorter than `min`. */
export function normalise(list, length, min = MIN_SEGMENT) {
  const out = [];
  for (const v of [...list].filter(Number.isFinite).map(r1).sort((a, b) => a - b)) {
    if (v < min - 1e-9 || v > length - min + 1e-9) continue;
    if (out.length && v - out[out.length - 1] < min - 1e-9) continue;
    out.push(v);
  }
  return out;
}

/** Evenly spaced cuts for a number of segments (the page's default). */
export function evenCuts(length, segments) {
  const n = Math.max(1, Math.floor(segments) || 1);
  return Array.from({ length: n - 1 }, (_, k) => r1((length * (k + 1)) / n));
}

/**
 * Add a cut at `value`. Returns { list, added, reason } and leaves the list alone, with a reason in words, when the spot is too close to the end or to another cut.
 */
export function addCut(list, value, length, min = MIN_SEGMENT) {
  const v = r1(snap(value));
  if (v < min || v > length - min) return { list, added: false, reason: `A cut needs ${min} mm of model on each side. Click further from the end.` };
  const near = list.find(c => Math.abs(c - v) < min);
  if (near !== undefined) return { list, added: false, reason: `That is only ${r1(Math.abs(near - v))} mm from another cut; segments must be at least ${min} mm long. Drag the existing cut instead.` };
  return { list: [...list, v].sort((a, b) => a - b), added: true, reason: '' };
}

/** Move cut `i` to `value`, held between its neighbours (and the ends) by `min`. */
export function moveCut(list, i, value, length, min = MIN_SEGMENT) {
  const lo = (i > 0 ? list[i - 1] : 0) + min, hi = (i < list.length - 1 ? list[i + 1] : length) - min;
  if (hi < lo) return list.slice();
  const out = list.slice();
  out[i] = r1(Math.min(hi, Math.max(lo, snap(value))));
  return out;
}

export function removeCut(list, i) { return list.filter((_, k) => k !== i); }

/** The segment lengths a list of cuts makes. */
export function segmentLengths(list, length) {
  const edges = [0, ...list, length];
  return edges.slice(1).map((e, k) => r1(e - edges[k]));
}

/**
 * How far to move a cut for a mouse drag. `axisPx` is the cut direction as it appears on screen: how many pixels one mm along it covers, as { x, y }.
 * Returns the new position; a drag across the screen at right angles to the axis moves nothing.
 */
export function dragValue(start, deltaPx, axisPx) {
  const l2 = axisPx.x * axisPx.x + axisPx.y * axisPx.y;
  if (l2 < 1e-9) return start;
  return start + (deltaPx.x * axisPx.x + deltaPx.y * axisPx.y) / l2;
}

/** The custom-position text the page keeps (it is also what the model is cut by). */
export const cutsToText = list => list.map(r1).join(', ');
export function textToCuts(text) { return (text || '').split(/[,;\s]+/).map(parseFloat).filter(Number.isFinite); }

// ---------------------------------------------------------------------------------------------------------------------------------
// Cuts with their own axis and tilt (see cut-plane.js). A cut is { axis, tilt: [a, b], point, anchor? } in the model's placed coordinates;
// `bounds` is the model's { min, max }. The list is kept in the order the cuts were placed, because each cut works on the piece its click
// was in, as the earlier cuts left it. Cuts in parallel planes (the same axis and tilt) keep the minimum segment length between them.
import { axisIndex, normalOf, positionOf, setPosition, sameDirection } from './cut-plane.js';

export const MAX_TILT = 60;
const lengthOf = (cut, bounds) => { const k = axisIndex(cut.axis); return bounds.max[k] - bounds.min[k]; };

/** The cuts from a list of positions (mm from the low end) all across one axis, through the middle of the model: the page's "even segments" and typed positions. */
export function cutsFromOffsets(offsets, axis, bounds) {
  const k = axisIndex(axis), centre = bounds.min.map((v, i) => (v + bounds.max[i]) / 2);
  return offsets.map(v => ({ axis, tilt: [0, 0], point: centre.map((c, i) => (i === k ? bounds.min[k] + v : c)), anchor: null }));
}
/** The other way, for cuts that are all parallel (sorted). */
export const offsetsOf = (cuts, bounds) => cuts.map(c => r1(positionOf(c, bounds.min[axisIndex(c.axis)]))).sort((a, b) => a - b);

/** Add a cut. Snaps its position to 0.5 mm. Refuses (with a reason in words) a spot without `min` mm of model on each side, or too near a parallel cut. */
export function addCutAt(cuts, cut, bounds, min = MIN_SEGMENT) {
  const k = axisIndex(cut.axis), snapped = setPosition(cut, bounds.min[k] + snap(positionOf(cut, bounds.min[k]))), pos = positionOf(snapped, bounds.min[k]), length = lengthOf(cut, bounds);
  if (pos < min || pos > length - min) return { cuts, added: false, reason: `A cut needs ${min} mm of model on each side. Click further from the end.` };
  const near = cuts.find(o => sameDirection(o, snapped) && Math.abs(positionOf(o, bounds.min[k]) - pos) < min);
  if (near) return { cuts, added: false, reason: `That is only ${r1(Math.abs(positionOf(near, bounds.min[k]) - pos))} mm from another cut in the same direction; segments must be at least ${min} mm long. Drag the existing cut instead.` };
  return { cuts: [...cuts, snapped], added: true, reason: '' };
}

/** Move cut `i` so its plane passes `coord` on its axis, held `min` mm from the ends and from parallel neighbours. */
export function moveCutTo(cuts, i, coord, bounds, min = MIN_SEGMENT) {
  const c = cuts[i], k = axisIndex(c.axis), lo = bounds.min[k], length = lengthOf(c, bounds);
  let low = min, high = length - min;
  for (const [j, o] of cuts.entries()) {
    if (j === i || !sameDirection(o, c)) continue;
    const p = positionOf(o, lo), mine = positionOf(c, lo);
    if (p < mine) low = Math.max(low, p + min); else high = Math.min(high, p - min);
  }
  if (high < low) return cuts.slice();
  const pos = Math.min(high, Math.max(low, snap(coord - lo)));
  return cuts.map((x, j) => (j === i ? setPosition(x, lo + pos) : x));
}

export const removeCutAt = (cuts, i) => cuts.filter((_, k) => k !== i);

/** Set a cut's two tilts (degrees, held within +-MAX_TILT). */
export function tiltCutTo(cuts, i, a, b) {
  const clamp = v => Math.max(-MAX_TILT, Math.min(MAX_TILT, Number.isFinite(v) ? v : 0));
  return cuts.map((c, j) => (j === i ? { ...c, tilt: [clamp(a), clamp(b)] } : c));
}

/** Change a cut's axis: the plane stays through the same point and stands up straight on the new axis (tilts reset). */
export function setCutAxis(cuts, i, axis) {
  return cuts.map((c, j) => (j === i ? { ...c, axis, tilt: [0, 0] } : c));
}

/** Move a cut by `delta` mm along its own normal (for dragging a plane), snapped like the rest. */
export function dragCut(cuts, i, delta, bounds, min = MIN_SEGMENT) {
  const c = cuts[i], k = axisIndex(c.axis), n = normalOf(c.axis, c.tilt), start = c.point[k];
  return moveCutTo(cuts, i, start + delta * n[k], bounds, min);
}
