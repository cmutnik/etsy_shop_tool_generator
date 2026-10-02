// Copyright (c) 2025 cmutnik
// QR keychain: a QR plate with a split-ring loop on one end, one printable piece.
// Port of invite2svg's build_keychain_loop_mesh + stack_plate_pieces.
//
// Orientation: plate bottom on the bed (z = 0), QR on top and readable from above.
// Colours follow layers, so a single filament change at `filamentChangeZ` reproduces the preview.
import * as THREE from 'three';
import { qrMatrix, buildQrPlate } from '../../shared/js/qr-plate.js';
import { extrudeShapes, signedArea } from '../../shared/js/geometry2d.js';

const OVERLAP = 0.2;
const MIN_WALL = 2.5; // mm of material around the hole, as in the Python version

/**
 * Outline of neck + loop in local coords: neck bottom edge at y = -OVERLAP (sinks into the plate),
 * loop centre at y = cy. `sign` = +1 loop above the plate, -1 below (mirrored).
 */
export function loopOutline({ loopDiameter, neckWidth, neckHeight, sign = 1 }) {
  const R = loopDiameter / 2, hw = neckWidth / 2, cy = neckHeight + R, y0 = -OVERLAP;
  const pts = [];
  const arc = (a0, a1, steps = 64) => { for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * i / steps; pts.push([R * Math.cos(a), cy + R * Math.sin(a)]); } };
  // arc() includes both end points, so the neck/loop junction points are never pushed twice
  // (duplicate points make zero-length edges and degenerate triangles)
  if (hw < R) {
    // neck side walls meet the circle below its centre
    const s = Math.sqrt(R * R - hw * hw), aL = Math.atan2(-s, -hw) + 2 * Math.PI, aR = Math.atan2(-s, hw);
    pts.push([-hw, y0]);
    arc(aL, aR);              // clockwise over the top: left point -> right point
    pts.push([hw, y0]);
  } else {
    const wide = hw > R + 1e-9; // neck wider than the loop: it runs level with the loop's centre
    pts.push([-hw, y0]);
    if (wide) pts.push([-hw, cy]);
    arc(Math.PI, 0);
    if (wide) pts.push([hw, cy]);
    pts.push([hw, y0]);
  }
  const out = pts.map(([x, y]) => [x, y * sign]);
  // counter-clockwise, so ExtrudeGeometry normalises the hole's winding (see groupsToShapes)
  return { pts: signedArea(out) < 0 ? out.reverse() : out, cx: 0, cy: cy * sign, R };
}

/**
 * @param {object} o
 *  data, errorCorrection ('L'|'M'|'Q'|'H'), module, margin, mode ('raised'|'indented'), thickness, depth,
 *  backDepth (mm, 0 = off): also engrave the code, mirrored, into the underside
 *  loopPosition ('above'|'below'), loopDiameter, holeDiameter, neckWidth, neckHeight, baseColor, qrColor
 * @returns {{ group: THREE.Group, info: object }}
 * @throws {Error} with a user-facing message for invalid input
 */
export function buildKeychain(o) {
  const warnings = [];
  const wall = (o.loopDiameter - o.holeDiameter) / 2;
  if (wall < MIN_WALL) throw new Error(`Loop diameter must leave at least ${MIN_WALL} mm of wall around the hole to stay sturdy (now ${wall.toFixed(1)} mm).`);
  if (o.mode === 'indented' && o.depth >= o.thickness - 0.4) throw new Error('Engrave depth must be at least 0.4 mm less than the plate thickness.');

  const back = o.backDepth || 0;
  if (back) {
    if (back < 0.4) throw new Error('Back engraving must be at least 0.4 mm deep (2+ layers) to be visible.');
    // keep at least 0.8 mm of solid plate between the back pockets and the front features
    // raised: back pockets + a 0.4 mm dark floor; indented: back pockets + front engraving
    const front = o.mode === 'indented' ? o.depth : 0.4;
    if (back + front > o.thickness - 0.8) throw new Error(`Back engraving is too deep for this plate: depth ${back} mm${o.mode === 'indented' ? ` + front engraving ${front} mm` : ' + 0.4 mm dark floor'} must leave at least 0.8 mm of plate (thickness ${o.thickness} mm). Make the plate thicker or the engraving shallower.`);
  }
  const matrix = qrMatrix(o.data, o.errorCorrection);
  const materials = {
    base: new THREE.MeshStandardMaterial({ color: new THREE.Color(o.baseColor), roughness: 0.6 }),
    qr: new THREE.MeshStandardMaterial({ color: new THREE.Color(o.qrColor), roughness: 0.6 }),
  };
  const plate = buildQrPlate({ matrix, module: o.module, margin: o.margin, thickness: o.thickness, depth: o.depth, mode: o.mode, materials, backDepth: back });
  const P = plate.size, T = o.thickness;

  // loop, split at the colour-change height in indented mode so the preview matches the print
  const sign = o.loopPosition === 'below' ? -1 : 1;
  const outline = loopOutline({ loopDiameter: o.loopDiameter, neckWidth: o.neckWidth, neckHeight: o.neckHeight, sign });
  const shape = new THREE.Shape(outline.pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const hole = new THREE.Path();
  hole.absarc(outline.cx, outline.cy, o.holeDiameter / 2, 0, Math.PI * 2, false);
  shape.holes.push(hole);
  const place = g => { g.translate(P / 2, sign > 0 ? P : 0, 0); return g; };
  const loopParts = [];
  if (o.mode === 'raised') loopParts.push(['base', place(extrudeShapes([shape], T, 0))]);
  else {
    const zc = plate.filamentChangeZ;
    // same layering as the plate: [light on the bed if the back is engraved], dark, light top
    if (back) {
      loopParts.push(['base', place(extrudeShapes([shape], back, 0))]);
      loopParts.push(['qr', place(extrudeShapes([shape], zc + OVERLAP - back, back))]);
    } else loopParts.push(['qr', place(extrudeShapes([shape], zc + OVERLAP, 0))]);
    loopParts.push(['base', place(extrudeShapes([shape], T - zc, zc))]);
  }
  for (const [name, geo] of loopParts) {
    const m = new THREE.Mesh(geo, materials[name]);
    m.name = name;
    plate.meshes.push(m);
  }

  const group = new THREE.Group();
  group.add(...plate.meshes);
  // centre on the origin in x/y, keep the bed at z = 0
  const box = new THREE.Box3().setFromObject(group);
  group.position.set(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, 0);
  group.updateMatrixWorld(true);

  // warnings
  if (o.module < 0.8) warnings.push(`Module size ${o.module} mm is below 2 nozzle widths (0.8 mm) - the code may not print cleanly or scan.`);
  if (o.margin < 2 * o.module) warnings.push('Quiet zone is under 2 modules wide - many scanners need about 4 modules of blank border.');
  if (o.depth < 0.4) warnings.push('Emboss/engrave depth under 0.4 mm gives weak contrast; use at least 2 layers.');
  if (back && o.mode === 'raised') warnings.push('The coloured back code shares layers with the light plate, so it needs two filament slots (use the 3MF). A single filament change by height cannot make it.');
  if (back && back > 1.2) warnings.push('Back engraving deeper than ~1.2 mm means longer bridges over the pockets; if the ceilings sag, reduce the depth or raise the module size.');
  if (o.holeDiameter < 5) warnings.push('Hole is under 5 mm - a standard split ring may not thread through.');
  if (o.data === 'https://example.com') warnings.push('This is the sample link - replace it with your own before printing.');

  let tris = 0;
  group.traverse(c => { if (c.isMesh) tris += c.geometry.index ? c.geometry.index.count / 3 : c.geometry.attributes.position.count / 3; });
  const finalBox = new THREE.Box3().setFromObject(group);
  return {
    group,
    meshes: plate.meshes,
    info: {
      width: finalBox.max.x - finalBox.min.x,
      depth: finalBox.max.y - finalBox.min.y,
      height: finalBox.max.z,
      modules: matrix.length,
      plateSize: P,
      triangles: tris,
      filamentChangeZ: plate.filamentChangeZ,
      filamentChangeZs: plate.filamentChangeZs,
      backDepth: back,
      warnings,
    },
  };
}
