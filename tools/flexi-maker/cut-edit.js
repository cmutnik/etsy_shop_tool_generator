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
