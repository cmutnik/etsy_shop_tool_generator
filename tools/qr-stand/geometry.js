// Copyright (c) 2025 cmutnik
// QR stand: a plate (QR code + optional icon/title banner + a blank insertion tab) and a separate slotted base.
// Port of invite2svg's QR Code Stand page. Units mm; both parts are modelled flat on the print bed (z up).
//   plate: x = width, y = along the plate (y = 0 is the edge that slides into the slot), z up, artwork on top.
//   base:  x = width, y = depth (front to back), z = height.
import * as THREE from 'three';
import { qrMatrix, buildQrPlate } from '../../shared/js/qr-plate.js';
import { extrudeShapes, groupsToShapes } from '../../shared/js/geometry2d.js';
import { union, difference, multiPolygonToGroups } from '../../shared/js/boolean2d.js';
import { simplifyRing, signedArea } from '../../shared/js/geometry-pure.js';
import { iconGroups, titleGroups, layoutBanner } from './banner.js';
import { buildBase, seatMatrix } from './base.js';

const EPS = 0.005;
const OVERLAP = 0.2;
const SEAM = 0.01;             // pieces of the plate overlap by this much where they meet, so slicers fuse them
const INSERTION_BUFFER = 2.0;  // blank plate always left beyond the slot depth, so the slot never reaches artwork

function box(x0, y0, x1, y1, z0, z1, name, mat) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const m = new THREE.Mesh(g, mat[name]);
  m.name = name;
  return m;
}
const meshFrom = (geo, name, mat) => { const m = new THREE.Mesh(geo, mat[name]); m.name = name; return m; };

const DETAIL = 0.02;     // mm: outline detail finer than this is dropped (a printer cannot make it, and it only invites degenerate geometry)
const MIN_PIECE = 0.01;  // mm^2: shapes smaller than this are dropped

/**
 * Prepare banner artwork for extrusion: simplify outlines to the printer's resolution, then merge overlapping / touching shapes
 * into non-overlapping ones (an icon's sub-shapes can share an edge, which would extrude to edges with four triangles).
 * Distressed fonts have contours with edges a few microns long that nearly touch; simplifying removes them at the source.
 */
export function mergeArtwork(groups) {
  if (!groups.length) return [];
  const clean = groups.map(g => ({ outer: simplifyRing(g.outer, DETAIL), holes: g.holes.map(h => simplifyRing(h, DETAIL)) }))
    .filter(g => g.outer.length >= 3 && Math.abs(signedArea(g.outer)) > MIN_PIECE);
  if (!clean.length) return [];
  return multiPolygonToGroups(union(...clean.map(g => [[g.outer, ...g.holes]])));
}

/**
 * A flat strip (banner or blank spacer) in plate colours: raised artwork on a light slab, or dark slab with a light top layer
 * that has the artwork cut out. `groups` are in strip-local coordinates ((0,0) = bottom-left); an empty list gives a blank strip.
 */
export function buildStrip({ groups, width, height, thickness: T, depth: d, mode, materials }) {
  const meshes = [];
  const art = mergeArtwork(groups);
  if (mode === 'raised') {
    meshes.push(box(0, 0, width, height, 0, T, 'base', materials));
    if (art.length) meshes.push(meshFrom(extrudeShapes(groupsToShapes(art), d + OVERLAP, T - OVERLAP), 'qr', materials));
    return meshes;
  }
  meshes.push(box(0, 0, width, height, 0, T - d + OVERLAP, 'qr', materials));
  const zLo = T - d, plate = [[0, 0], [width, 0], [width, height], [0, height]];
  let top;
  if (art.length) top = multiPolygonToGroups(difference(plate, art.map(g => [g.outer, ...g.holes])));
  else top = [{ outer: plate, holes: [] }];
  if (top.length) meshes.push(meshFrom(extrudeShapes(groupsToShapes(top), d, zLo), 'base', materials));
  return meshes;
}

/**
 * @param {object} o
 *  data, errorCorrection, module, margin, mode ('raised'|'indented'), thickness, depth, baseColor, qrColor
 *  iconName (null | key of ICON_PATHS), iconSize, title (string), titleHeight, font (opentype font, needed for a title),
 *  bannerPosition ('above'|'below')
 *  baseDepth, baseHeight, tilt (deg), slotDepth, slotClearance
 * @returns {{ plate: THREE.Group, base: THREE.Mesh, assembled: THREE.Group, qrMeshes: THREE.Mesh[], info: object }}
 *  plate / assembled are not centred (plate starts at the origin); use `centered()` to display them.
 * @throws {Error} with a user-facing message for invalid input
 */
export function buildStand(o) {
  const warnings = [];
  const materials = {
    base: new THREE.MeshStandardMaterial({ color: new THREE.Color(o.baseColor), roughness: 0.6 }),
    qr: new THREE.MeshStandardMaterial({ color: new THREE.Color(o.qrColor), roughness: 0.6 }),
    stand: new THREE.MeshStandardMaterial({ color: new THREE.Color(o.baseColor), roughness: 0.7 }),
  };
  if (o.mode === 'indented' && o.depth >= o.thickness - 0.4) throw new Error('Engrave depth must be at least 0.4 mm less than the plate thickness.');

  // 1. QR plate
  const matrix = qrMatrix(o.data, o.errorCorrection);
  const qr = buildQrPlate({ matrix, module: o.module, margin: o.margin, thickness: o.thickness, depth: o.depth, mode: o.mode, materials });
  const W = qr.size;

  // 2. optional banner
  let banner = null;
  const hasTitle = !!(o.title && o.title.trim()), hasIcon = !!o.iconName;
  if (hasTitle || hasIcon) {
    if (hasTitle && !o.font) throw new Error('The font for the title has not loaded yet.');
    const icon = hasIcon ? iconGroups(o.iconName, o.iconSize) : null;
    const title = hasTitle ? titleGroups(o.font, o.title, o.titleHeight) : null;
    const lay = layoutBanner({ plateWidth: W, icon, iconSize: o.iconSize, title });
    banner = { ...lay, meshes: buildStrip({ groups: lay.groups, width: W, height: lay.height, thickness: o.thickness, depth: o.depth, mode: o.mode, materials }) };
    if (!hasTitle && o.bannerPosition === 'below') warnings.push('An icon alone is meant for the top of the plate (upper-right corner); below the code it will sit at the lower right.');
  }

  // 3. stack the pieces along y (bottom to top), then add a blank tab if the slot would reach artwork
  const order = !banner ? ['qr'] : o.bannerPosition === 'below' ? ['banner', 'qr'] : ['qr', 'banner'];
  const heights = { qr: W, banner: banner ? banner.height : 0 };
  const offsets = {};
  let y = 0;
  for (const key of order) { offsets[key] = key === order[0] ? 0 : y - SEAM; y = offsets[key] + heights[key]; }
  const artMinY = [offsets.qr + o.margin];                                    // the code's bottom row of modules
  if (banner && banner.groups.length) artMinY.push(offsets.banner + Math.min(...banner.groups.map(g => Math.min(...g.outer.map(p => p[1])))));
  const gap = Math.min(...artMinY), needed = o.slotDepth + INSERTION_BUFFER, shortfall = Math.max(0, needed - gap);
  const plate = new THREE.Group();
  plate.name = 'plate';
  const place = (meshes, yy) => { const g = new THREE.Group(); g.position.y = yy; g.add(...meshes); plate.add(g); };
  let shift = 0;
  if (shortfall > 1e-6) {
    place(buildStrip({ groups: [], width: W, height: shortfall + SEAM, thickness: o.thickness, depth: o.depth, mode: o.mode, materials }), 0);   // + SEAM: it overlaps the piece above
    shift = shortfall;
  }
  place(qr.meshes, offsets.qr + shift);
  if (banner) place(banner.meshes, offsets.banner + shift);
  const plateHeight = y + shift;

  // 4. base and the assembled preview
  const { mesh: baseMesh } = buildBase({ width: W, depth: o.baseDepth, height: o.baseHeight, thickness: o.thickness, tilt: o.tilt, clearance: o.slotClearance, slotDepth: o.slotDepth }, materials.stand);
  const seat = seatMatrix({ depth: o.baseDepth, height: o.baseHeight, tilt: o.tilt, slotDepth: o.slotDepth, thickness: o.thickness });
  const assembled = new THREE.Group();
  const seated = plate.clone(true);
  seated.matrixAutoUpdate = false;
  seated.matrix.copy(seat);
  assembled.add(baseMesh.clone(), seated);
  assembled.updateMatrixWorld(true);

  // 5. warnings
  const exposed = plateHeight - o.slotDepth;
  if (exposed < W * 0.6) warnings.push(`Only ${exposed.toFixed(0)} mm of the plate stands above the slot. A shorter slot or a bigger plate gives it more presence.`);
  if (o.module < 1.2) warnings.push(`Module size ${o.module} mm is small for a stand; modules of 2 mm or more scan from further away.`);
  if (o.margin < 2 * o.module) warnings.push('Quiet zone is under 2 modules wide - many scanners need about 4 modules of blank border.');
  if (o.tilt > 25) warnings.push('A lean of more than about 25 degrees makes the stand prone to tipping forward; widen or deepen the base.');
  if (o.data === 'https://example.com') warnings.push('This is the sample link - replace it with your own before printing.');

  const countTris = obj => { let n = 0; obj.traverse(c => { if (c.isMesh) n += c.geometry.index ? c.geometry.index.count / 3 : c.geometry.attributes.position.count / 3; }); return n; };
  plate.updateMatrixWorld(true);
  const pb = new THREE.Box3().setFromObject(plate), bb = new THREE.Box3().setFromObject(baseMesh);
  return {
    plate, base: baseMesh, assembled, qrMeshes: qr.meshes, materials,
    info: {
      modules: matrix.length, plateWidth: W, plateHeight: pb.max.y - pb.min.y, plateThickness: pb.max.z - pb.min.z,
      baseSize: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
      insertionGap: gap + shift, shortfall, bannerHeight: banner ? banner.height : 0,
      filamentChangeZ: qr.filamentChangeZ, triangles: countTris(plate) + countTris(baseMesh), warnings,
    },
  };
}

/** Wrap an object so its bounding box is centred on the origin in x/y with its lowest point at z = 0 (for display). */
export function centered(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj), wrap = new THREE.Group();
  wrap.add(obj.clone(true));
  wrap.position.set(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
  wrap.updateMatrixWorld(true);
  return wrap;
}
