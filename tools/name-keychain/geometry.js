// Copyright (c) 2025 cmutnik
// Name keychain: a name (or any short text) as raised letters on a backing plate, with a keyring loop.
//
// Orientation: plate bottom on the bed (z = 0), letters on top. The backing is either an outline that follows the letters
// (a "sticker" shape), a rounded rectangle, or none (the letters themselves are the keychain, so they must touch each other
// or the loop). The loop is built like the QR keychain's, by loops.js, then attached on the left or the top.
import * as THREE from 'three';
import { layoutText } from '../../shared/js/text-layout.js';
import { boundsOf, mapGroups, groupsToShapes, extrudeShapes } from '../../shared/js/geometry2d.js';
import { union, intersection, multiPolygonToGroups, roundedRectRing } from '../../shared/js/boolean2d.js';
import { dilate, fillHoles } from '../../shared/js/offset2d.js';
import { loopFootprint, loopWall, MIN_WALL } from '../qr-keychain/loops.js';

export const BACKINGS = [
  { id: 'outline', label: 'Follows the letters (outline)' },
  { id: 'rectangle', label: 'Rounded rectangle' },
  { id: 'none', label: 'Letters only (no plate)' },
];
export const NAME_LOOPS = ['round', 'rounded-square', 'hexagon', 'teardrop', 'lanyard-slot'];

const rotate = (groups, quarterTurns) => {                       // quarterTurns: +1 = counter-clockwise 90 degrees
  const f = [(x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x]][((quarterTurns % 4) + 4) % 4];
  return mapGroups(groups, f);
};
const toMulti = groups => groups.map(g => [g.outer, ...g.holes]);

/**
 * @param {object} o
 *  font (opentype font), text (lines with \n), fontSize (mm), lineSpacing
 *  backing ('outline'|'rectangle'|'none'), margin (mm of plate round the letters), cornerRadius (rectangle only)
 *  thickness (plate, mm), raise (letters above the plate, mm; with backing 'none' the letters are thickness + raise tall)
 *  loopStyle (NAME_LOOPS), loopPosition ('left'|'top'|'none'), loopSize, holeDiameter, textColor, baseColor
 * @returns {{ group: THREE.Group, info: object }}
 */
export function buildNameKeychain(o) {
  if (!o.font) throw new Error('Choose a font first.');
  if (!o.text || !o.text.trim()) throw new Error('Type a name.');
  if (!(o.fontSize >= 3)) throw new Error('Letters must be at least 3 mm tall.');
  if (!(o.thickness >= 1) || !(o.raise >= 0.4)) throw new Error('The plate must be at least 1 mm thick and the letters at least 0.4 mm tall.');
  const warnings = [];
  const lay = layoutText(o.font, o.text, o.fontSize, o.lineSpacing || 1.2);
  if (!lay.groups.length) throw new Error('That text has no printable letters in this font.');
  const letters = lay.groups;
  const b = boundsOf(letters);

  // backing, centred like the letters
  let backing;
  const margin = o.margin ?? 2.5;
  if (o.backing === 'rectangle') {
    const r = Math.max(0, Math.min(o.cornerRadius ?? 3, (b.height + 2 * margin) / 2, (b.width + 2 * margin) / 2));
    backing = [{ outer: roundedRectRing(b.minX - margin, b.minY - margin, b.maxX + margin, b.maxY + margin, [r, r, r, r]), holes: [] }];
  } else if (o.backing === 'outline') {
    backing = fillHoles(multiPolygonToGroups(dilate(letters, margin)));
  } else backing = letters;

  // loop: built "above" the plate, so rotate the plate to put the chosen side on top, attach, and rotate back
  let body = backing, loopInfo = null;
  const pos = o.loopPosition || 'left';
  if (pos !== 'none') {
    const style = o.loopStyle || 'round';
    if (!NAME_LOOPS.includes(style)) throw new Error(`Unknown loop style: ${style}`);
    const wall = loopWall({ style, size: o.loopSize, holeDiameter: o.holeDiameter });
    if (wall < MIN_WALL) throw new Error(`Loop size must leave at least ${MIN_WALL} mm of wall around the hole (now ${wall.toFixed(1)} mm).`);
    const turns = pos === 'left' ? -1 : 0;                      // left -> top is a clockwise quarter turn
    const plate = rotate(backing, turns);
    const pb = boundsOf(plate);
    const neckWidth = Math.max(3, Math.min(o.loopSize * 0.5, 0.8 * pb.width));
    const cx = (pb.minX + pb.maxX) / 2;
    // where the plate's top edge really is in the loop's strip: an outline plate is ragged, so sink the loop down to it
    const strip = [[cx - neckWidth / 2, pb.minY], [cx + neckWidth / 2, pb.minY], [cx + neckWidth / 2, pb.maxY + 1], [cx - neckWidth / 2, pb.maxY + 1]];
    const hit = multiPolygonToGroups(intersection(strip, toMulti(plate)));
    if (!hit.length) throw new Error('The loop cannot reach the letters: use a plate (outline or rectangle), or a different loop position.');
    const topAt = boundsOf(hit).maxY;
    const fp = loopFootprint({ style, size: o.loopSize, holeDiameter: o.holeDiameter, slotLength: o.loopSize, neckWidth, neckHeight: 1, sign: 1 });
    const placed = mapGroups(fp.groups, (x, y) => [x + cx, y + topAt]);
    const merged = multiPolygonToGroups(union(toMulti([...plate, ...placed])));
    body = rotate(merged, -turns);
    loopInfo = { holeCentre: fp.holeCentre, reach: fp.height };
  }
  if (!body.length) throw new Error('Nothing to print.');

  const group = new THREE.Group();
  const T = o.thickness, R = o.raise;
  const base = new THREE.Mesh(extrudeShapes(groupsToShapes(body), o.backing === 'none' ? T + R : T), new THREE.MeshStandardMaterial({ color: o.baseColor || '#ffffff', roughness: 0.6 }));
  base.name = 'base';
  group.add(base);
  if (o.backing !== 'none') {
    const text = new THREE.Mesh(extrudeShapes(groupsToShapes(letters), R, T), new THREE.MeshStandardMaterial({ color: o.textColor || '#c0392b', roughness: 0.6 }));
    text.name = 'text';
    group.add(text);
  } else if (body.length > 1) warnings.push('The letters are separate pieces. With no plate they will print loose; use a joined script font, or choose a plate.');

  if (o.fontSize < 8) warnings.push('Letters under 8 mm tall have thin strokes that may not print cleanly with a 0.4 mm nozzle.');
  const bb = new THREE.Box3().setFromObject(group), size = bb.getSize(new THREE.Vector3());
  // the object's own footprint is centred on the letters; move it so the bounding box is centred on the origin
  group.position.set(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, 0);
  group.updateMatrixWorld(true);
  return {
    group,
    info: { width: size.x, depth: size.y, height: size.z, plateHeight: T, filamentChangeZ: T, loop: loopInfo, warnings, letterWidth: b.width, letterHeight: b.height },
  };
}
