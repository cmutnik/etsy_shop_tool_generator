// Copyright (c) 2025 cmutnik
// Gridfinity storage bins (the open modular system by Zack Freedman): a bin of u x v grid units, h height units, with the standard
// stepped foot (so it drops into any baseplate), optional magnet holes, compartments, a scoop, and a stacking lip.
//
// Standard dimensions (mm): grid pitch 42, bin footprint 41.5 (0.25 clearance a side), height unit 7, outer corner radius 3.75, foot 4.75 tall:
// a 0.8 mm 45-degree chamfer, 1.8 mm straight, then a 2.15 mm 45-degree chamfer out to the full footprint. Magnet holes 6.5 x 2.4 mm, 8 mm from
// each cell's edge. Printed as exported (foot on the bed, open top up).
//
// The stacking lip is derived from the foot rather than copied: its inner surface follows the foot profile with 0.25 mm clearance, with a 45-degree
// underside so it prints without supports. The test suite checks a bin's foot against the lip numerically. Print one and check it against a real baseplate.
import * as THREE from 'three';
import { roundedRectRing } from '../../shared/js/boolean2d.js';
import { groupsToShapes, extrudeShapes } from '../../shared/js/geometry2d.js';
import { Mesh3 } from './loft.js';

export const GRID = 42, FOOTPRINT = 41.5, HEIGHT_UNIT = 7, R_OUT = 3.75, BASE_H = 4.75;
export const MAGNET = { diameter: 6.5, depth: 2.4, offset: 13 };            // hole centres at +-13 mm from a cell's centre (8 mm from its edge)
export const LIP_CLEARANCE = 0.25, LIP_PENETRATION = 3.5;
const SEG = 8;                                                              // arc segments per corner: every ring has 4 x (SEG + 1) points

/** Foot profile, bottom to top: [height above the bottom, inset from the cell's 41.5 mm footprint]. */
export const FOOT = [[0, 2.95], [0.8, 2.15], [2.6, 2.15], [BASE_H, 0]];
/** Foot inset at a height above its bottom (0 .. 4.75). */
export function footInset(h) {
  for (let i = 1; i < FOOT.length; i++) if (h <= FOOT[i][0] + 1e-9) { const [h0, s0] = FOOT[i - 1], [h1, s1] = FOOT[i]; return s0 + ((s1 - s0) * (h - h0)) / (h1 - h0); }
  return 0;
}
/** The lip's inner inset at a depth `d` below the top of the bin (0 .. lipHeight), for a wall of `wall` mm. */
export function lipInset(d, wall) {
  const pts = lipProfile(wall);
  for (let i = 1; i < pts.length; i++) if (d <= pts[i][0] + 1e-9) { const [d0, s0] = pts[i - 1], [d1, s1] = pts[i]; return s0 + ((s1 - s0) * (d - d0)) / (d1 - d0); }
  return wall;
}
/** Lip corner points [depth below the top, inset from the outer face], top to bottom, ending on the wall's inner face. */
export function lipProfile(wall) {
  const inset = h => footInset(h) - LIP_CLEARANCE;                           // the foot of a bin sitting LIP_PENETRATION mm down in the lip
  const h0 = LIP_PENETRATION, top = inset(h0), s1 = inset(2.6), s2 = inset(0);
  const d1 = h0 - 2.6, d2 = h0 - 0.8, d3 = h0;                               // end of the top chamfer, of the straight part, of the foot's bottom chamfer
  return [[0, top], [d1, s1], [d2, s1], [d3, s2], [d3 + (s2 - wall), wall]];  // then a 45 degree underside back to the wall
}
export const lipHeight = wall => lipProfile(wall)[4][0];

/** A rounded-rectangle ring of half-sizes (hw, hh) pulled in by `inset`, with the Gridfinity corner radius for that inset (R - inset, at least 0.4). */
export function ringAt(hw, hh, inset, radii = null) {
  const r = Math.max(R_OUT - inset, 0.4);
  const rs = radii || [r, r, r, r];
  return roundedRectRing(-(hw - inset), -(hh - inset), hw - inset, hh - inset, rs, SEG);
}

/** One foot at (cx, cy): the lofted profile, with magnet holes in its bottom if asked. Returns a Mesh3. */
function foot(cx, cy, magnets) {
  const m = new Mesh3(), hw = FOOTPRINT / 2, levels = FOOT.map(([z, s]) => ({ z, ring: ringAt(hw, hw, s) }));
  const ids = levels.map(l => m.ring(l.ring, l.z, cx, cy));
  for (let i = 0; i + 1 < ids.length; i++) m.band(ids[i], ids[i + 1]);
  m.cap(levels[3].ring, BASE_H, true, [], cx, cy);
  const holes = [];
  if (magnets) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const c = [sx * MAGNET.offset, sy * MAGNET.offset], pts = Array.from({ length: 32 }, (_, i) => [c[0] + (MAGNET.diameter / 2) * Math.cos((i / 32) * 2 * Math.PI), c[1] + (MAGNET.diameter / 2) * Math.sin((i / 32) * 2 * Math.PI)]);
      holes.push(pts);
      const lo = m.ring(pts, 0, cx, cy), hi = m.ring(pts, MAGNET.depth, cx, cy);
      m.band(lo, hi, true);                                                  // the hole's wall faces into the hole
      m.cap(pts, MAGNET.depth, false, [], cx, cy);                           // its ceiling faces down
    }
  }
  m.cap(levels[0].ring, 0, false, holes, cx, cy);                            // the bottom, with the holes cut out
  return m;
}

/** The stacking lip: a hollow band on top of the walls, its inner face following lipProfile(). */
function lipBand(hw, hh, wall, zTop) {
  const m = new Mesh3(), prof = lipProfile(wall), outer = ringAt(hw, hh, 0);
  const zs = prof.map(([d]) => zTop - d), inner = prof.map(([, s]) => ringAt(hw, hh, s));
  const o = zs.map(z => m.ring(outer, z)), n = inner.map((r, i) => m.ring(r, zs[i]));
  const last = prof.length - 1;
  for (let i = last; i > 0; i--) { m.band(o[i], o[i - 1]); m.band(n[i], n[i - 1], true); }   // zs falls with i, so the lower ring is index i
  m.annulus(o[0], n[0], true);                                               // the top rim
  m.annulus(o[last], n[last], false);                                        // the bottom, which sits on the wall
  return m;
}

/** A solid scoop along a compartment's front wall: the quarter-round fillet of radius r over the floor. Extruded along x. */
function scoop(x0, x1, yFront, zFloor, r) {
  const shape = new THREE.Shape(), steps = 16;
  shape.moveTo(0, -0.2);                                                      // 0.2 mm into the wall so the solids overlap
  shape.lineTo(r, -0.2);
  shape.lineTo(r, 0);
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * (Math.PI / 2); shape.lineTo(r - r * Math.sin(a), r - r * Math.cos(a)); }
  shape.lineTo(0, 0);
  // x: across the compartment. The profile is (distance from the front wall, height above the floor): rotate it into world axes.
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 1 });
  // extrusion runs along +z; make z -> world +x, shape x -> world +y, shape y -> world +z
  const mtx = new THREE.Matrix4().set(0, 0, 1, x0, 1, 0, 0, yFront, 0, 1, 0, zFloor, 0, 0, 0, 1);
  g.applyMatrix4(mtx);
  g.computeVertexNormals();
  return g;
}

/**
 * @param {object} o
 *  units: [x, y] grid units; height: height units (7 mm each, including the lip); wall (mm); floor (mm of solid above the foot); divider (mm)
 *  compartments: [nx, ny]; lip (bool); scoop (mm radius, 0 = none); magnets (bool); color
 * @returns {{ group: THREE.Group, info: object }}
 */
export function buildBin(o) {
  const [ux, uy] = o.units, [nx, ny] = o.compartments || [1, 1], wall = o.wall ?? 1.2, floor = o.floor ?? 1.2, divider = o.divider ?? 1.2, lip = o.lip ?? true, scoopR = o.scoop ?? 0;
  if (![ux, uy].every(v => Number.isInteger(v) && v >= 1 && v <= 8)) throw new Error('A bin is 1 to 8 grid units each way.');
  if (!(Number.isInteger(o.height) && o.height >= 2 && o.height <= 12)) throw new Error('Height must be 2 to 12 units of 7 mm.');
  if (![nx, ny].every(v => Number.isInteger(v) && v >= 1 && v <= 8)) throw new Error('Compartments are 1 to 8 each way.');
  if (!(wall >= 0.8 && wall <= 3)) throw new Error('The wall must be 0.8 to 3 mm. 1.2 mm is the Gridfinity standard (three nozzle lines).');
  if (!(floor >= 0.6 && floor <= 6)) throw new Error('The floor must be 0.6 to 6 mm thick.');
  if (!(divider >= 0.8)) throw new Error('Dividers must be at least 0.8 mm thick.');
  const W = ux * GRID - (GRID - FOOTPRINT), D = uy * GRID - (GRID - FOOTPRINT), H = o.height * HEIGHT_UNIT, hw = W / 2, hh = D / 2;
  const zFloor = BASE_H + floor, zWallTop = lip ? H - lipHeight(wall) : H;
  if (zWallTop < zFloor + 1.5) throw new Error('This bin is too short for a lip and a floor. Make it taller, thin the floor, or turn the lip off.');
  const innerW = W - 2 * wall, innerD = D - 2 * wall, cw = (innerW - (nx - 1) * divider) / nx, cd = (innerD - (ny - 1) * divider) / ny;
  if (cw < 8 || cd < 8) throw new Error(`Compartments would be only ${Math.min(cw, cd).toFixed(1)} mm wide. Use fewer compartments or a bigger bin.`);
  if (scoopR && (scoopR > cd - 2 || scoopR > zWallTop - zFloor - 1)) throw new Error('The scoop is too big for the compartment. Use a smaller radius.');
  const color = o.color || '#3a6ea5', group = new THREE.Group(), warnings = [];

  // feet, one per grid cell
  for (let i = 0; i < ux; i++) for (let j = 0; j < uy; j++) group.add(foot((i - (ux - 1) / 2) * GRID, (j - (uy - 1) / 2) * GRID, !!o.magnets).mesh(color, 'bin'));

  // body: a solid slab (the floor), then walls with the compartments cut out
  const outline = ringAt(hw, hh, 0);
  const slab = new THREE.Mesh(extrudeShapes(groupsToShapes([{ outer: outline, holes: [] }]), floor, BASE_H), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  slab.name = 'bin'; group.add(slab);
  const pockets = [], xs = [], ys = [];
  for (let i = 0; i < nx; i++) xs.push(-innerW / 2 + i * (cw + divider));
  for (let j = 0; j < ny; j++) ys.push(-innerD / 2 + j * (cd + divider));
  const rIn = Math.max(R_OUT - wall, 0.4), rSmall = 0.8;
  xs.forEach((x, i) => ys.forEach((y, j) => {
    const left = i === 0, right = i === nx - 1, bottom = j === 0, top = j === ny - 1;
    pockets.push({ x0: x, x1: x + cw, y0: y, y1: y + cd, ring: roundedRectRing(x, y, x + cw, y + cd, [left && bottom ? rIn : rSmall, right && bottom ? rIn : rSmall, right && top ? rIn : rSmall, left && top ? rIn : rSmall], SEG) });
  }));
  const walls = new THREE.Mesh(extrudeShapes(groupsToShapes([{ outer: outline, holes: pockets.map(p => p.ring) }]), zWallTop - zFloor, zFloor), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  walls.name = 'bin'; group.add(walls);
  if (lip) { const l = lipBand(hw, hh, wall, H).mesh(color, 'bin'); group.add(l); }
  if (scoopR) for (const p of pockets) { const g = scoop(p.x0 + 0.8, p.x1 - 0.8, p.y0, zFloor, scoopR); const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.55 })); mesh.name = 'bin'; group.add(mesh); }

  // size, volume and weight
  let volume = 0;
  group.traverse(m => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position, ix = m.geometry.index, at = i => (ix ? ix.getX(i) : i), n = ix ? ix.count : p.count;
    for (let t = 0; t < n; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      volume += (p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) - p.getY(a) * (p.getX(b) * p.getZ(c) - p.getZ(b) * p.getX(c)) + p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c))) / 6;
    }
  });
  if (wall < 1.2) warnings.push('Walls under 1.2 mm print as one or two thin lines. 1.2 mm is the Gridfinity standard.');
  if (o.magnets) warnings.push(`Magnet holes are ${MAGNET.diameter} mm wide and ${MAGNET.depth} mm deep, four to a grid cell, in the bottom of each foot. They print as bridged pockets: press 6 x 2 mm magnets in and glue them, all the same way round.`);
  if (!lip) warnings.push('Without the stacking lip, bins will not nest into each other when stacked.');
  return {
    group,
    info: {
      width: W, depth: D, height: H, units: [ux, uy], heightUnits: o.height, feet: ux * uy, compartments: pockets.length,
      compartmentSize: [cw, cd], cavityDepth: zWallTop - zFloor, volume, grams: (volume / 1000) * 1.24, zFloor, zWallTop, lipHeight: lip ? lipHeight(wall) : 0, warnings,
    },
  };
}

/**
 * A baseplate: a plate of u x v cells (42 mm each), every cell a pocket that a bin's foot drops into.
 * A pocket is the stacking lip's inner profile (a foot with 0.25 mm of clearance), so a bin's foot fits a baseplate by the same numbers it fits the lip of the bin below.
 * @param {object} o  units: [x, y]; floor (mm of plate under the pockets); magnets (bool: 6.5 x 2.4 mm holes, four a cell, in the pocket floor); color
 * @returns {{ group: THREE.Group, info: object }}
 */
export function buildBaseplate(o) {
  const [ux, uy] = o.units;
  if (![ux, uy].every(v => Number.isInteger(v) && v >= 1 && v <= 12)) throw new Error('A baseplate is 1 to 12 cells each way.');
  const depth = LIP_PENETRATION, magnets = !!o.magnets, floorMin = magnets ? MAGNET.depth + 0.8 : 0.6;
  let floor = o.floor ?? 1.2;
  const warnings = [];
  if (!(floor >= 0.6 && floor <= 8)) throw new Error('The floor must be 0.6 to 8 mm thick.');
  if (magnets && floor < floorMin) { floor = floorMin; warnings.push(`With magnet holes the plate under the pockets is at least ${floorMin.toFixed(1)} mm (the holes are ${MAGNET.depth} mm deep and 0.8 mm must stay under them), so the floor was raised to that.`); }
  const W = ux * GRID, D = uy * GRID, H = depth + floor, hw = W / 2, hh = D / 2, cell = GRID / 2;
  const outline = roundedRectRing(-hw, -hh, hw, hh, [R_OUT + 0.25, R_OUT + 0.25, R_OUT + 0.25, R_OUT + 0.25], SEG);
  const prof = lipProfile(1.2).slice(0, 4);                                  // the pocket: down from the top, ending on the pocket floor
  const m = new Mesh3(), centres = [];
  for (let i = 0; i < ux; i++) for (let j = 0; j < uy; j++) centres.push([(i - (ux - 1) / 2) * GRID, (j - (uy - 1) / 2) * GRID]);

  m.band(m.ring(outline, 0), m.ring(outline, H));
  m.cap(outline, 0, false);
  const pocketTops = centres.map(([cx, cy]) => ringAt(cell - 0.25 + 0.25 * 0, cell - 0.25 + 0.25 * 0, prof[0][1]).map(p => [p[0] + cx, p[1] + cy]));
  m.cap(outline, H, true, pocketTops);
  for (const [cx, cy] of centres) {
    const levels = prof.map(([d, s]) => ({ z: H - d, ring: ringAt(FOOTPRINT / 2, FOOTPRINT / 2, s) }));
    const ids = levels.map(l => m.ring(l.ring, l.z, cx, cy));
    for (let k = 0; k + 1 < ids.length; k++) m.band(ids[k + 1], ids[k], true);   // pocket walls face into the pocket
    const holes = [];
    if (magnets) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const c = [sx * MAGNET.offset, sy * MAGNET.offset], pts = Array.from({ length: 32 }, (_, i) => [c[0] + (MAGNET.diameter / 2) * Math.cos((i / 32) * 2 * Math.PI), c[1] + (MAGNET.diameter / 2) * Math.sin((i / 32) * 2 * Math.PI)]);
        holes.push(pts);
        m.band(m.ring(pts, floor - MAGNET.depth, cx, cy), m.ring(pts, floor, cx, cy), true);
        m.cap(pts, floor - MAGNET.depth, true, [], cx, cy);
      }
    }
    m.cap(levels[levels.length - 1].ring, floor, true, holes, cx, cy);
  }
  const mesh = m.mesh(o.color || '#8a8f98', 'baseplate'), group = new THREE.Group();
  group.add(mesh);
  const p = mesh.geometry.attributes.position, ix = mesh.geometry.index;
  let volume = 0;
  for (let t = 0; t < ix.count; t += 3) {
    const a = ix.getX(t), b = ix.getX(t + 1), c = ix.getX(t + 2);
    volume += (p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) - p.getY(a) * (p.getX(b) * p.getZ(c) - p.getZ(b) * p.getX(c)) + p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c))) / 6;
  }
  if (magnets) warnings.push(`Magnet holes are ${MAGNET.diameter} x ${MAGNET.depth} mm, four to a cell, in the pocket floor. Press 6 x 2 mm magnets in and glue them, all the same way round (and opposite to the ones in your bins, so they attract).`);
  return { group, info: { width: W, depth: D, height: H, units: [ux, uy], cells: ux * uy, floor, volume, grams: (volume / 1000) * 1.24, pocketDepth: depth, warnings } };
}
