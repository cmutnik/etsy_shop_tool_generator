// Copyright (c) 2025 cmutnik
// Attach a keyring loop (see loops.js) to the left or top of a flat outline. Shared by the name keychain and the magnet / ornament maker.
import { boundsOf, mapGroups } from '../../shared/js/geometry2d.js';
import { union, intersection, multiPolygonToGroups } from '../../shared/js/boolean2d.js';
import { loopFootprint, loopWall, MIN_WALL } from './loops.js';

export const ATTACH_LOOPS = ['round', 'rounded-square', 'hexagon', 'teardrop', 'lanyard-slot'];
const toMulti = groups => groups.map(g => [g.outer, ...g.holes]);
const rotate = (groups, quarterTurns) => {                       // +1 = counter-clockwise 90 degrees
  const f = [(x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x]][((quarterTurns % 4) + 4) % 4];
  return mapGroups(groups, f);
};

/**
 * @param {{outer, holes}[]} plate  the outline, y up
 * @param {{ position: 'left'|'top', style, size (mm), holeDiameter (mm) }} o
 * @returns {{ body: {outer, holes}[], holeCentre: number[], reach: number }}
 * The loop is built above the plate, so the plate is turned to put the chosen side on top, joined, and turned back. It is sunk to
 * where the plate's edge really is inside the neck's strip, so a ragged outline still joins it.
 */
export function attachLoop(plate, { position = 'left', style = 'round', size, holeDiameter }) {
  if (!ATTACH_LOOPS.includes(style)) throw new Error(`Unknown loop style: ${style}`);
  const wall = loopWall({ style, size, holeDiameter });
  if (wall < MIN_WALL) throw new Error(`Loop size must leave at least ${MIN_WALL} mm of wall around the hole (now ${wall.toFixed(1)} mm).`);
  const turns = position === 'left' ? -1 : 0;                    // left -> top is a clockwise quarter turn
  const turned = rotate(plate, turns), pb = boundsOf(turned);
  const neckWidth = Math.max(3, Math.min(size * 0.5, 0.8 * pb.width));
  const cx = (pb.minX + pb.maxX) / 2;
  const strip = [[cx - neckWidth / 2, pb.minY], [cx + neckWidth / 2, pb.minY], [cx + neckWidth / 2, pb.maxY + 1], [cx - neckWidth / 2, pb.maxY + 1]];
  const hit = multiPolygonToGroups(intersection(strip, toMulti(turned)));
  if (!hit.length) throw new Error('The loop cannot reach the shape: use a plate (outline or rectangle), or a different loop position.');
  const topAt = boundsOf(hit).maxY;
  const fp = loopFootprint({ style, size, holeDiameter, slotLength: size, neckWidth, neckHeight: 1, sign: 1 });
  const placed = mapGroups(fp.groups, (x, y) => [x + cx, y + topAt]);
  const merged = multiPolygonToGroups(union(toMulti([...turned, ...placed])));
  return { body: rotate(merged, -turns), holeCentre: fp.holeCentre, reach: fp.height };
}
