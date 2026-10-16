// Copyright (c) 2025 cmutnik
// Fridge magnet / ornament: any outline as a flat plate, with optional raised artwork (text or a picture) and rim, a pocket on the
// back for a disc magnet, and a hanging loop for a string.
//
// Orientation: the back is on the bed (z = 0), the artwork on top. The magnet pocket opens onto the bed, so its ceiling is bridged
// (a few mm across, which prints fine) and the magnet is pressed and glued in after printing. Plate, rim and artwork are two parts:
// the plate (slot 1) and everything raised (slot 2).
import * as THREE from 'three';
import { layoutText } from '../../shared/js/text-layout.js';
import { pointInPoly } from '../../shared/js/geometry-pure.js';
import { boundsOf, mapGroups, groupsToShapes, extrudeShapes } from '../../shared/js/geometry2d.js';
import { multiPolygonToGroups, intersection, difference, circleRing } from '../../shared/js/boolean2d.js';
import { inset, fillHoles, multiArea } from '../../shared/js/offset2d.js';
import { attachLoop } from '../qr-keychain/attach.js';
import { fitToSize } from '../cookie-cutter/geometry.js';
import { poleOfInaccessibility } from '../flexi-maker/joints.js';

const toMulti = groups => groups.map(g => [g.outer, ...g.holes]);
const WALL = 1.2;                                              // plastic kept round a magnet pocket

/**
 * @param {object} o
 *  groups (the outline, y up, any units), size (longest side, mm), thickness (plate, mm), raise (art / rim height, mm)
 *  rim (width of a raised border, mm; 0 = none)
 *  art: 'none' | 'text' | 'picture';  text + font + lines; pictureGroups (traced, y up);  artSize (% of the room inside the rim)
 *  magnet: { count: 0|1|2, diameter, thickness, clearance }   (count 0 = no pocket)
 *  loop: { position: 'none'|'top', style, size, holeDiameter }
 *  baseColor, artColor
 * @returns {{ group: THREE.Group, info: object }}
 */
export function buildMagnet(o) {
  const T = o.thickness ?? 4, R = o.raise ?? 0.8, rim = o.rim ?? 0, mag = o.magnet || { count: 0 }, loop = o.loop || { position: 'none' };
  if (!o.groups || !o.groups.length) throw new Error('There is no shape. Choose a built-in shape or a picture with a clear outline.');
  if (!(o.size >= 25)) throw new Error('The piece must be at least 25 mm across.');
  if (!(R >= 0.4)) throw new Error('Raised parts must be at least 0.4 mm tall.');
  if (!(rim >= 0 && (rim === 0 || rim >= 0.8))) throw new Error('The rim must be 0 (none) or at least 0.8 mm wide.');
  const warnings = [];

  const outline = fitToSize(fillHoles(o.groups), o.size).groups;
  let magnetDepth = 0, centres = [], pockets = [];
  if (mag.count > 0) {
    const d = mag.diameter ?? 10, th = mag.thickness ?? 3, cl = mag.clearance ?? 0.15;
    if (!(d >= 4 && d <= 40)) throw new Error('Magnet diameter must be between 4 and 40 mm.');
    magnetDepth = th + 0.2;
    if (T < magnetDepth + 1.2) throw new Error(`The plate is too thin for a ${th} mm magnet. It needs at least ${(magnetDepth + 1.2).toFixed(1)} mm so 1.2 mm of plate stays over the magnet.`);
    const pr = d / 2 + cl;
    const room = multiPolygonToGroups(inset(outline, WALL + pr));    // where a pocket's centre may go and still keep a wall
    if (!room.length) throw new Error('The magnet does not fit in this shape. Use a smaller magnet, a bigger piece or a chunkier shape.');
    const rings = room.flatMap(g => [g.outer, ...g.holes]), pole = poleOfInaccessibility(rings);
    if (!pole) throw new Error('The magnet does not fit in this shape. Use a smaller magnet, a bigger piece or a chunkier shape.');
    if (mag.count === 1) centres = [[pole.x, pole.y]];
    else {
      // two pockets side by side along the longer side: as far apart as both still sit in the room, down to a magnet-width apart
      const b = boundsOf(outline), horizontal = b.width >= b.height, long = horizontal ? b.width : b.height;
      const at = (s) => [-1, 1].map(k => (horizontal ? [pole.x + k * s, pole.y] : [pole.x, pole.y + k * s]));
      const inRoom = c => room.some(g => pointInPoly(c, g.outer) && !g.holes.some(h => pointInPoly(c, h)));
      const spans = [0.3, 0.25, 0.2, 0.15].map(f => f * long).filter(s => s >= pr + 0.5);
      const fit = spans.find(s => at(s).every(inRoom));
      if (!fit) throw new Error('Two magnets do not fit side by side in this shape. Use one, or a smaller magnet.');
      centres = at(fit);
    }
    pockets = centres.map(c => circleRing(c[0], c[1], pr, 64, Math.PI / 64));
  }

  // plate, with the loop if asked
  let body = outline, loopInfo = null;
  if (loop.position === 'top') {
    const r = attachLoop(outline, { position: 'top', style: loop.style || 'round', size: loop.size, holeDiameter: loop.holeDiameter });
    body = r.body; loopInfo = { holeCentre: r.holeCentre, reach: r.reach };
  }

  // raised parts live inside the rim-wide margin of the outline
  const margin = rim > 0 ? rim + 0.8 : 1.5;
  const inner = multiPolygonToGroups(inset(outline, margin));
  const art = [];
  if (rim > 0) art.push(...multiPolygonToGroups(difference(toMulti(outline), toMulti(multiPolygonToGroups(inset(outline, rim))))));
  if (o.art === 'text' || o.art === 'picture') {
    let source = [];
    if (o.art === 'text') {
      if (!o.font) throw new Error('Choose a font first.');
      if (!o.text || !o.text.trim()) throw new Error('Type some text, or turn the artwork off.');
      source = layoutText(o.font, o.text, 10, 1.2).groups;
    } else {
      if (!o.pictureGroups || !o.pictureGroups.length) throw new Error('Choose a picture for the artwork.');
      source = o.pictureGroups;
    }
    if (!source.length) throw new Error(o.art === 'text' ? 'That text has no printable letters in this font.' : 'Could not find any shape in that picture.');
    if (!inner.length) throw new Error('The rim leaves no room for artwork. Use a thinner rim or a bigger piece.');
    const ib = boundsOf(inner), ab = boundsOf(source), pct = (o.artSize ?? 70) / 100;
    const s = Math.min((ib.width * pct) / ab.width, (ib.height * pct) / ab.height);
    const cx = (ab.minX + ab.maxX) / 2, cy = (ab.minY + ab.maxY) / 2, tx = (ib.minX + ib.maxX) / 2, ty = (ib.minY + ib.maxY) / 2;
    const placed = mapGroups(source, (x, y) => [(x - cx) * s + tx, (y - cy) * s + ty]);
    const clipped = multiPolygonToGroups(intersection(toMulti(placed), toMulti(inner)));      // never past the rim, so it cannot overhang the edge
    if (!clipped.length) throw new Error('The artwork falls outside the shape.');
    art.push(...clipped);
    if (o.art === 'text' && 10 * s < 6) warnings.push(`The text works out ${(10 * s).toFixed(1)} mm tall, which is hard to read and print. Use fewer words, a bigger piece, or put the text on two lines.`);
  }

  const group = new THREE.Group(), mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
  const add = (name, groups, depth, z0, color) => {
    const mesh = new THREE.Mesh(extrudeShapes(groupsToShapes(groups), depth, z0), mat(color));
    mesh.name = name;
    group.add(mesh);
  };
  if (mag.count > 0) {
    // the pocket layer: the plate with the pocket circles cut out as holes, then the solid layer over it
    const withPockets = multiPolygonToGroups(difference(toMulti(body), ...pockets.map(p => [p])));
    add('base', withPockets, magnetDepth, 0, o.baseColor || '#f1ece1');
    add('base', body, T - magnetDepth, magnetDepth, o.baseColor || '#f1ece1');
  } else add('base', body, T, 0, o.baseColor || '#f1ece1');
  if (art.length) add('art', art, R, T, o.artColor || '#2f6f8f');
  else if (o.art !== 'none') warnings.push('There is no artwork to raise.');

  const bb = new THREE.Box3().setFromObject(group), sz = bb.getSize(new THREE.Vector3());
  group.position.set(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, 0);
  group.updateMatrixWorld(true);
  if (T < 3 && !mag.count) warnings.push('Under 3 mm thick, a piece flexes and can snap when it is hung or handled.');
  if (mag.count > 0) warnings.push(`Print with the back on the bed. The pocket (${(mag.diameter ?? 10) + 0.3} mm wide, ${magnetDepth.toFixed(1)} mm deep) opens at the bed; press the magnet in after printing and glue it. Check the polarity first so every magnet faces the same way.`);
  return {
    group,
    info: { width: sz.x, depth: sz.y, height: sz.z, plateHeight: T, magnetDepth, pockets: centres, area: multiArea(toMulti(body)), loop: loopInfo, warnings },
  };
}
