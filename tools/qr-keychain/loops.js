// Copyright (c) 2025 cmutnik
// Keyring loop shapes for the QR keychain, built in 2D (neck + loop shape - hole), then extruded by the caller.
// Local frame: x centred on 0, the neck's bottom edge at y = -OVERLAP (it sinks into the plate), growing +y.
import { circleRing, roundedRectRing, union, difference, multiPolygonToGroups, flipYGroups } from '../../shared/js/boolean2d.js';

export const OVERLAP = 0.2;
export const MIN_WALL = 2.5; // mm of material around the hole, as in the Python version

/** value / label / what "size" means, for the UI. */
export const LOOP_STYLES = [
  { id: 'round', label: 'Round ring', size: 'diameter' },
  { id: 'rounded-square', label: 'Rounded square', size: 'side' },
  { id: 'hexagon', label: 'Hexagon', size: 'width across corners' },
  { id: 'teardrop', label: 'Teardrop', size: 'diameter of the round part' },
  { id: 'lanyard-slot', label: 'Lanyard slot', size: 'height' },
  { id: 'header', label: 'Full-width header', size: 'height' },
];
export const loopStyle = id => LOOP_STYLES.find(s => s.id === id);

const HEX_H = Math.sqrt(3) / 2;

/** Distance from the hole's edge to the nearest outer edge. */
export function loopWall({ style, size, holeDiameter }) {
  const half = style === 'hexagon' ? HEX_H * (size / 2) : size / 2; // hexagon is flat top/bottom
  return half - holeDiameter / 2;
}

/**
 * @param {object} o
 *  style, size (mm, see LOOP_STYLES), holeDiameter, slotLength (lanyard-slot only), neckWidth, neckHeight,
 *  plateWidth (header only), sign (+1 loop above the plate, -1 below)
 * @returns {{ groups: {outer, holes}[], holeCentre: [number, number], height: number }}
 *  `height` is how far the loop reaches beyond the plate edge (mm, excluding the sunk-in overlap).
 */
export function loopFootprint(o) {
  const { style, size: D, holeDiameter: d, neckWidth: nw, neckHeight: nh, sign = 1 } = o;
  const R = D / 2, y0 = -OVERLAP;
  let outer, hole, cy, height, below, neck = true; // below = distance from the hole's centre to the loop's lowest edge

  switch (style) {
    case 'round':
      cy = nh + R; below = R; outer = circleRing(0, cy, R); hole = circleRing(0, cy, d / 2); height = nh + D; break;
    case 'rounded-square':
      cy = nh + R; below = R; outer = roundedRectRing(-R, cy - R, R, cy + R, [0.3 * D, 0.3 * D, 0.3 * D, 0.3 * D]);
      hole = circleRing(0, cy, d / 2); height = nh + D; break;
    case 'hexagon': {
      const hh = HEX_H * R;
      cy = nh + hh; below = hh;
      outer = Array.from({ length: 6 }, (_, i) => [R * Math.cos((i * Math.PI) / 3), cy + R * Math.sin((i * Math.PI) / 3)]);
      hole = circleRing(0, cy, d / 2); height = nh + 2 * hh; break;
    }
    case 'teardrop': {
      cy = nh + R; below = R;
      const k = 2, alpha = Math.acos(1 / k);           // apex at k*R from the centre; tangent points at +-alpha from "up"
      const a0 = Math.PI / 2 - alpha, a1 = Math.PI / 2 + alpha - 2 * Math.PI, steps = 64;
      outer = [[0, cy + k * R]];
      for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * (i / steps); outer.push([R * Math.cos(a), cy + R * Math.sin(a)]); }
      hole = circleRing(0, cy, d / 2); height = nh + R + k * R; break;
    }
    case 'lanyard-slot': {
      const slot = Math.max(o.slotLength, d);
      const W = slot + (D - d);                         // same wall all round
      cy = nh + R; below = R; outer = roundedRectRing(-W / 2, cy - R, W / 2, cy + R, [R, R, R, R]);
      hole = roundedRectRing(-slot / 2, cy - d / 2, slot / 2, cy + d / 2, [d / 2, d / 2, d / 2, d / 2]); height = nh + D; break;
    }
    case 'header': {
      neck = false;
      const r = Math.min(4, R);
      cy = D / 2; outer = roundedRectRing(-o.plateWidth / 2, y0, o.plateWidth / 2, D, [0, 0, r, r]);
      hole = circleRing(0, cy, d / 2); height = D; break;
    }
    default: throw new Error(`Unknown loop style: ${style}`);
  }

  // The neck stops halfway through the wall below the hole, not at the loop's centre line. It is still inside
  // the loop (so a narrow neck merges invisibly), and it keeps clear of the hole. Stopping at y = cy put a
  // vertex of the neck on the same line as the hole's and the loop's extreme points; the cap triangulator
  // then bridged the hole through a collinear vertex and left an edge with a single triangle on it.
  const neckTop = cy - (below + d / 2) / 2;
  const body = neck ? union(outer, [[-nw / 2, y0], [nw / 2, y0], [nw / 2, neckTop], [-nw / 2, neckTop]]) : union(outer);
  let groups = multiPolygonToGroups(difference(body, hole));
  if (groups.length !== 1 || groups[0].holes.length !== 1) throw new Error('Could not build that loop shape - try a different size or neck width.');
  let holeCentre = [0, cy];
  if (sign < 0) { groups = flipYGroups(groups); holeCentre = [0, -cy]; }
  return { groups, holeCentre, height };
}
