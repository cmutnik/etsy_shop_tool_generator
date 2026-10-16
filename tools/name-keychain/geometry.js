// Copyright (c) 2025 cmutnik
// Name keychain: a name (or any short text) as raised letters on a backing plate, with a keyring loop.
//
// Orientation: plate bottom on the bed (z = 0), letters on top. The backing is either an outline that follows the letters
// (a "sticker" shape), a rounded rectangle, or none (the letters themselves are the keychain, so they must touch each other
// or the loop). The loop is built like the QR keychain's, by loops.js, then attached on the left or the top.
import * as THREE from 'three';
import { layoutText } from '../../shared/js/text-layout.js';
import { boundsOf, groupsToShapes, extrudeShapes } from '../../shared/js/geometry2d.js';
import { multiPolygonToGroups, roundedRectRing } from '../../shared/js/boolean2d.js';
import { dilate, fillHoles } from '../../shared/js/offset2d.js';
import { attachLoop, ATTACH_LOOPS } from '../qr-keychain/attach.js';

export const BACKINGS = [
  { id: 'outline', label: 'Follows the letters (outline)' },
  { id: 'rectangle', label: 'Rounded rectangle' },
  { id: 'none', label: 'Letters only (no plate)' },
];
export const NAME_LOOPS = ATTACH_LOOPS;

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

  let body = backing, loopInfo = null;
  const pos = o.loopPosition || 'left';
  if (pos !== 'none') {
    const r = attachLoop(backing, { position: pos, style: o.loopStyle || 'round', size: o.loopSize, holeDiameter: o.holeDiameter });
    body = r.body;
    loopInfo = { holeCentre: r.holeCentre, reach: r.reach };
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
