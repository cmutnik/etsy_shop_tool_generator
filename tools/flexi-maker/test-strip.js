// Copyright (c) 2025 cmutnik
// A joint test strip: three small articulated bars, identical but for the joint clearance, printed in a few minutes, so a seller can find the
// clearance their printer and filament need before committing hours to a whole model. Uses the page's own joint settings, so the strip
// tests the joint the model will get.
import { makeFlexi } from './flexi.js';
import { transformParts, boundsOfParts } from '../mesh-modifier/geometry.js';

/** An axis-aligned box as a part (12 triangles). */
export function boxPart(x0, y0, z0, x1, y1, z1, name = 'Bar', color = null) {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return { name, color, positions: Float32Array.from(p.flat()), indices: Uint32Array.from(f.flat()) };
}

/** Three clearances around the chosen one, never below the 0.1 mm the joints need, each distinct. */
export function stripClearances(clearance, step = 0.1) {
  const r = v => Math.round(v * 100) / 100;
  let list = [clearance - step, clearance, clearance + step].map(r);
  if (list[0] < 0.1) list = [clearance, clearance + step, clearance + 2 * step].map(r);
  return list;
}

/**
 * @param {object} o  the joint settings of the page: joint ('hook' | 'ball'), ball, bar, bend, clearance; plus
 *  step (mm between the three clearances, 0.1), section (the bar's width and depth, 24 mm), length (64 mm), gap (6 mm between bars), onSide (lay the bars down as the page does)
 * @returns {{ parts, clearances, strips: { clearance, parts }[], size: number[] }}  parts are named "0.30 mm - Segment 1" and carry `seg`; each strip also has a marker part of 1, 2 or 3 bumps so the bars can be told apart
 */
export async function makeTestStrip({ joint = 'hook', ball = 0, bar = 0, bend = 20, clearance = 0.4, step = 0.1, section = 24, length = 64, gap = 6, onSide = true } = {}) {
  const clearances = stripClearances(clearance, step), strips = [];
  const pitch = section + gap, total = (clearances.length - 1) * pitch;
  for (const [i, c] of clearances.entries()) {
    const flexi = await makeFlexi([boxPart(-section / 2, -section / 2, 0, section / 2, section / 2, length, 'Bar')], { axis: 'z', count: 2, joint, ball, bar, bend, clearance: c });
    if (!flexi.joints.length) throw new Error('The test bar was too small for this joint. Lower the bar or ball size, or set it to automatic.');
    let parts = flexi.parts;
    if (onSide) parts = transformParts(parts, { rotate: [0, 90, 0], center: true, onBed: true }).parts;
    else parts = transformParts(parts, { center: true, onBed: true }).parts;
    // bumps on the first segment's end so the strips can be told apart once printed: one for the first (tightest) clearance, two for the next, three...
    const b = boundsOfParts(parts), bump = 3, nb = i + 1, xEnd = b.min[0] + bump;
    const marks = Array.from({ length: nb }, (_, k) => boxPart(xEnd + k * (bump + 2), -bump / 2, b.max[2] - 0.2, xEnd + k * (bump + 2) + bump, bump / 2, b.max[2] + 1.2, `${nb} bump${nb > 1 ? 's' : ''}`));
    const label = `${c.toFixed(2)} mm`;
    const mine = [
      ...parts.map(p => ({ ...p, name: `${label} - ${p.name}` })),
      ...marks.map((m, k) => ({ ...m, name: `${label} - marker ${k + 1}`, seg: 0, marker: true })),
    ];
    const y = -total / 2 + i * pitch;
    for (const p of mine) for (let v = 1; v < p.positions.length; v += 3) p.positions[v] += y;
    strips.push({ clearance: c, parts: mine });
  }
  const parts = strips.flatMap(s => s.parts), size = boundsOfParts(parts).size;
  return { parts, clearances, strips, size };
}
