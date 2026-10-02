// Copyright (c) 2025 cmutnik
// Keyring loop shapes for the QR keychain, built in 2D (neck + loop shape - hole), then extruded by the caller.
// Local frame: x centred on 0, the loop's bottom edge at y = -OVERLAP (it sinks into the plate), growing +y.
import { circleRing, roundedRectRing, union, difference, multiPolygonToGroups, flipYGroups, dropCollinear, roundCorners } from '../../shared/js/boolean2d.js';
import { pointInPoly } from '../../shared/js/geometry2d.js';

export const OVERLAP = 0.2;
export const MIN_WALL = 2.5;    // mm of material around the hole, as in the Python version
export const HOLE_FLOOR = 0.8;  // header: the hole must stay at least this far above the plate's edge

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

/** Outlines for the full-width header. Triangles lean towards the named side. */
export const HEADER_SHAPES = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'semicircle', label: 'Semicircle' },
  { id: 'triangle-left', label: 'Triangle leaning left' },
  { id: 'triangle-right', label: 'Triangle leaning right' },
];
export const headerShape = id => HEADER_SHAPES.find(s => s.id === id);

const HEX_H = Math.sqrt(3) / 2;

/** Distance from the hole's edge to the nearest outer edge (all styles except the header, which has its own check). */
export function loopWall({ style, size, holeDiameter }) {
  const half = style === 'hexagon' ? HEX_H * (size / 2) : size / 2; // hexagon is flat top/bottom
  return half - holeDiameter / 2;
}

// ---------- full-width header ----------

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * The header's outline above the plate edge (y = 0), plus a strip sunk OVERLAP into the plate.
 * Returns { ring, height, hole } where `hole` is the default hole centre (the middle of the largest comfortable
 * circle: the centre for the rectangle, the incentre for a triangle).
 */
export function headerOutline({ plateWidth: W, size: D, headerShape: shape = 'rectangle', lean = 0.6, rounding = 4 }) {
  const y0 = -OVERLAP, rnd = Math.max(0, rounding);
  if (!headerShape(shape)) throw new Error(`Unknown header shape: ${shape}`);

  if (shape === 'rectangle') {
    return { ring: roundedRectRing(-W / 2, y0, W / 2, D, [0, 0, rnd, rnd]), height: D, hole: [0, D / 2] };
  }
  if (shape === 'semicircle') {
    const R = W / 2, steps = 96, ring = [[-W / 2, y0], [W / 2, y0]];       // a true semicircle: height is half the width
    for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI; ring.push([R * Math.cos(a), R * Math.sin(a)]); }
    return { ring, height: R, hole: [0, R / 2] };
  }
  // triangle: base = the plate edge, apex leaning towards one side (lean 0 = centred, 1 = right-angled, apex above the end)
  const L = Math.max(0, Math.min(1, lean)), dir = shape === 'triangle-left' ? -1 : 1, ax = dir * L * (W / 2);
  const A = [-W / 2, 0], B = [W / 2, 0], C = [ax, D];
  const a = Math.hypot(B[0] - C[0], B[1] - C[1]), b = Math.hypot(C[0] - A[0], C[1] - A[1]), c = W;
  const hole = [(a * A[0] + b * B[0] + c * C[0]) / (a + b + c), (a * A[1] + b * B[1] + c * C[1]) / (a + b + c)];
  // Rounding the apex lowers it, so raise the virtual apex until the finished top is the requested height.
  const build = apexY => {
    const base = dropCollinear([[-W / 2, y0], [W / 2, y0], [W / 2, 0], [ax, apexY], [-W / 2, 0]]);
    return roundCorners(base, p => (Math.abs(p[0] - ax) < 1e-9 && Math.abs(p[1] - apexY) < 1e-9 ? rnd : 0));
  };
  let apexY = D, ring = build(apexY);
  for (let i = 0; i < 60; i++) {
    const top = Math.max(...ring.map(p => p[1]));
    if (Math.abs(top - D) < 1e-7) break;
    apexY += D - top; ring = build(apexY);
  }
  return { ring: dropCollinear(ring), height: D, hole };
}

/** Throws a readable error if the hole is not fully above the plate or has too little material around it. */
function headerCheck(ring, holeC, d) {
  if (holeC[1] - d / 2 < HOLE_FLOOR) throw new Error(`The hole would cut into the plate. Move it up: it must stay at least ${HOLE_FLOOR} mm above the plate edge.`);
  let dist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.max(a[1], b[1]) <= 1e-9) continue;                 // the sunk-in strip is not an outer edge
    dist = Math.min(dist, segDist(holeC, a, b));
  }
  if (!pointInPoly(holeC, ring)) throw new Error('The hole is outside the header shape. Move it back towards the middle.');
  const wall = dist - d / 2;
  if (wall < MIN_WALL) throw new Error(`Loop size must leave at least ${MIN_WALL} mm of wall around the hole to stay sturdy (now ${wall.toFixed(1)} mm). Make the header bigger, the hole smaller, or move the hole towards the middle.`);
  return wall;
}

// ---------- all styles ----------

/**
 * @param {object} o
 *  style, size (mm, see LOOP_STYLES), holeDiameter, slotLength (lanyard-slot only), neckWidth, neckHeight,
 *  sign (+1 loop above the plate, -1 below)
 *  header only: plateWidth, headerShape (see HEADER_SHAPES), lean (0-1, triangles), rounding (mm),
 *  holeOffsetX / holeOffsetY (mm, moves the hole from its default position; +x right, +y away from the plate)
 * @returns {{ groups: {outer, holes}[], holeCentre: [number, number], height: number }}
 *  `height` is how far the loop reaches beyond the plate edge (mm, excluding the sunk-in overlap).
 */
export function loopFootprint(o) {
  const { style, size: D, holeDiameter: d, neckWidth: nw, neckHeight: nh, sign = 1 } = o;
  const R = D / 2, y0 = -OVERLAP;
  let outer, hole, cy, hx = 0, height, below, neck = true; // below = distance from the hole's centre to the loop's lowest edge

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
      const h = headerOutline({ ...o, size: D });
      hx = h.hole[0] + (o.holeOffsetX || 0); cy = h.hole[1] + (o.holeOffsetY || 0);
      headerCheck(h.ring, [hx, cy], d);
      outer = h.ring; height = h.height;
      hole = circleRing(hx, cy, d / 2, 64, Math.PI / 64); // phase: no hole vertex sits on an axis line
      break;
    }
    default: throw new Error(`Unknown loop style: ${style}`);
  }

  // The neck stops halfway through the wall below the hole, not at the loop's centre line. It is still inside
  // the loop (so a narrow neck merges invisibly), and it keeps clear of the hole. Stopping at y = cy put a
  // vertex of the neck on the same line as the hole's and the loop's extreme points; the cap triangulator
  // then bridged the hole through a collinear vertex and left an edge with a single triangle on it.
  const neckTop = neck ? cy - (below + d / 2) / 2 : 0;
  const body = neck ? union(outer, [[-nw / 2, y0], [nw / 2, y0], [nw / 2, neckTop], [-nw / 2, neckTop]]) : union(outer);
  let groups = multiPolygonToGroups(difference(body, hole));
  if (groups.length !== 1 || groups[0].holes.length !== 1) throw new Error('Could not build that loop shape - try a different size, neck width or hole position.');
  let holeCentre = [hx, cy];
  if (sign < 0) { groups = flipYGroups(groups); holeCentre = [hx, -cy]; }
  return { groups, holeCentre, height };
}
