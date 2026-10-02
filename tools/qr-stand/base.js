// Copyright (c) 2025 cmutnik
// The stand base: a block with a slot cut into its top, tilted back so the plate leans. Port of build_stand_base_mesh
// and assemble_stand_preview. The slot is cut in 2D (polygon boolean) and the cross-section extruded along the width.
import * as THREE from 'three';
import { difference, multiPolygonToGroups } from '../../shared/js/boolean2d.js';
import { groupsToShapes, extrudeShapes } from '../../shared/js/geometry2d.js';

const OVERSHOOT = 2;        // the slot is cut past the top face so it opens cleanly
const MIN_WALL = 1.5;       // material that must remain in front of and under the slot
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Rotate a ring by `deg` (counter-clockwise, y up) about `origin`. */
function rotateRing(ring, deg, origin) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ring.map(([x, y]) => [origin[0] + (x - origin[0]) * c - (y - origin[1]) * s, origin[1] + (x - origin[0]) * s + (y - origin[1]) * c]);
}

/**
 * The base's cross-section: x = depth (front to back on the table), y = height.
 * @returns {{ groups, slot: number[][], entryDepth: number, slotWidth: number }}
 * @throws {Error} with a user-facing message when the slot does not fit the block
 */
export function baseCrossSection({ depth, height, thickness, tilt = 15, clearance = 0.3, slotDepth = 12, entryFrac = 0.35 }) {
  if (slotDepth >= height) throw new Error('Slot depth must be less than the base height.');
  const entry = depth * entryFrac, slotWidth = thickness + 2 * clearance;
  // the slot's mouth is on the top face; rotating by -tilt swings its buried end toward the front, which leans the plate back
  const slot = rotateRing(rect(entry - slotWidth / 2, height - slotDepth, entry + slotWidth / 2, height + OVERSHOOT), -tilt, [entry, height]);
  const minX = Math.min(...slot.map(p => p[0])), minY = Math.min(...slot.map(p => p[1]));
  if (minX < MIN_WALL || minY < MIN_WALL) {
    throw new Error(`The slot comes too close to the base's ${minX < MIN_WALL ? 'front' : 'bottom'} edge. Use a smaller slot depth or lean angle, or a deeper/taller base.`);
  }
  const pieces = multiPolygonToGroups(difference(rect(0, 0, depth, height), slot));
  if (pieces.length !== 1) throw new Error('The slot cuts the base in two. Use a smaller slot depth or lean angle, or a deeper base.');
  return { groups: pieces, slot, entryDepth: entry, slotWidth };
}

/**
 * The base as a mesh sitting flat on the bed: x = width, y = depth, z = height.
 * The 2D section lies in XY and is extruded along Z; the axes are then cycled (x,y,z) -> (z,x,y), a rotation, so winding is kept.
 */
export function buildBase(o, material) {
  const sec = baseCrossSection(o);
  const geo = extrudeShapes(groupsToShapes(sec.groups), o.width, 0);
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'stand';
  return { mesh, section: sec };
}

/**
 * The transform that seats the plate (flat, y up, face up) in the base's slot: its y = 0 edge goes to the slot's buried tip,
 * its face points toward the front. Based on assemble_stand_preview, but with the plate's thickness centred in the slot
 * (the Python version puts the plate's back face on the slot's centre line, half a thickness off).
 * Returns a Matrix4 (plate local -> base coordinates).
 */
export function seatMatrix({ depth, height, tilt, slotDepth, thickness = 0, entryFrac = 0.35 }) {
  const t = (tilt * Math.PI) / 180, entry = depth * entryFrac;
  const a = new THREE.Vector3(1, 0, 0), b = new THREE.Vector3(0, Math.sin(t), Math.cos(t)), c = new THREE.Vector3().crossVectors(a, b);
  const tip = new THREE.Vector3(0, entry - slotDepth * Math.sin(t), height - slotDepth * Math.cos(t)).addScaledVector(c, -thickness / 2);
  return new THREE.Matrix4().makeBasis(a, b, c).setPosition(tip);
}
