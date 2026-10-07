// Copyright (c) 2025 cmutnik
// Plant markers / garden labels: a name on a head plate with a spike to push into the soil, many to a bed.
//
// Orientation: printed flat (z = 0 on the bed), head up the page (+y), spike pointing down (-y), letters raised on top.
// Each marker is built centred on the origin by buildMarker(); layoutMarkers() places them in rows on one print bed.
import * as THREE from 'three';
import { layoutText } from '../../shared/js/text-layout.js';
import { boundsOf, mapGroups, groupsToShapes, extrudeShapes } from '../../shared/js/geometry2d.js';
import { union, roundedRectRing, multiPolygonToGroups } from '../../shared/js/boolean2d.js';

export const MAX_MARKERS = 60;

/** Split a pasted list into names: one per line, blank lines dropped; "\n" inside a name is written as " / ". */
export function parseNames(text) {
  return text.split('\n').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s*\/\s*/).join('\n'));
}

/** The text of every marker laid out once, so all markers can share the widest head (`sameSize`). */
function measure(o, names) {
  return names.map(name => {
    const lay = layoutText(o.font, name, o.fontSize, o.lineSpacing || 1.2);
    if (!lay.groups.length) throw new Error(`"${name.replace(/\n/g, ' / ')}" has no printable letters in this font.`);
    return { name, lay };
  });
}

function checkParams(o) {
  if (!o.font) throw new Error('Choose a font first.');
  if (!(o.fontSize >= 4)) throw new Error('Letters must be at least 4 mm tall.');
  if (!(o.thickness >= 1.2) || !(o.raise >= 0.4)) throw new Error('The marker must be at least 1.2 mm thick and the letters at least 0.4 mm tall.');
  if (!(o.spikeLength >= 20)) throw new Error('The spike must be at least 20 mm long to hold in soil.');
  if (!(o.spikeWidth >= 6)) throw new Error('The spike must be at least 6 mm wide at the top.');
  if (!(o.tipWidth >= 1)) throw new Error('The spike tip must be at least 1 mm wide.');
}

/** One marker, centred on x = 0 with its head's top edge at y = 0 and the spike pointing to -y. */
function buildOne(o, item, headWidth, headHeight) {
  const { lay } = item, b = boundsOf(lay.groups);
  const r = Math.min(o.cornerRadius ?? 3, headHeight / 2, headWidth / 2);
  const head = [roundedRectRing(-headWidth / 2, -headHeight, headWidth / 2, 0, [r, r, r, r])];
  const sw = Math.min(o.spikeWidth, headWidth);
  const spike = [[-sw / 2, -headHeight + 0.2], [sw / 2, -headHeight + 0.2], [o.tipWidth / 2, -headHeight - o.spikeLength], [-o.tipWidth / 2, -headHeight - o.spikeLength]];
  const body = multiPolygonToGroups(union(head, spike));
  const cx = -(b.minX + b.maxX) / 2, cy = -headHeight / 2 - (b.minY + b.maxY) / 2;
  const letters = mapGroups(lay.groups, (x, y) => [x + cx, y + cy]);
  const group = new THREE.Group();
  const base = new THREE.Mesh(extrudeShapes(groupsToShapes(body), o.thickness), new THREE.MeshStandardMaterial({ color: o.baseColor || '#f4f1ea', roughness: 0.6 }));
  base.name = 'base';
  const text = new THREE.Mesh(extrudeShapes(groupsToShapes(letters), o.raise, o.thickness), new THREE.MeshStandardMaterial({ color: o.textColor || '#2e6b34', roughness: 0.6 }));
  text.name = 'text';
  group.add(base, text);
  return { group, width: headWidth, depth: headHeight + o.spikeLength, headHeight };
}

/**
 * @param {object} o
 *  font, names (array, see parseNames), fontSize, lineSpacing, margin (mm round the letters), minWidth (mm), sameSize (all heads as wide as the widest)
 *  cornerRadius, thickness, raise, spikeLength, spikeWidth, tipWidth, baseColor, textColor
 *  bedWidth (mm; markers wrap to a new row beyond this), gap (mm between markers)
 * @returns {{ group: THREE.Group, markers: {name, width, depth, x, y}[], info: object }}
 */
export function buildMarkers(o) {
  checkParams(o);
  const names = o.names || [];
  if (!names.length) throw new Error('Type at least one plant name.');
  if (names.length > MAX_MARKERS) throw new Error(`That is ${names.length} markers; the limit is ${MAX_MARKERS} at a time.`);
  const margin = o.margin ?? 3, gap = o.gap ?? 4, bed = o.bedWidth ?? 220, minW = o.minWidth ?? 30;
  const items = measure(o, names);
  const widths = items.map(it => Math.max(minW, boundsOf(it.lay.groups).width + 2 * margin));
  const widest = Math.max(...widths), headHeight = Math.max(...items.map(it => boundsOf(it.lay.groups).height)) + 2 * margin;
  const warnings = [];
  const markers = items.map((it, i) => ({ ...buildOne(o, it, o.sameSize ? widest : widths[i], headHeight), name: it.name }));
  if (widest > bed) throw new Error(`The widest marker (${widest.toFixed(0)} mm) does not fit the ${bed} mm bed. Use a smaller letter height or a wider bed.`);

  // rows, left to right; a row is as deep as its deepest marker
  const group = new THREE.Group();
  let x = 0, y = 0, rowDepth = 0, rows = 1;
  markers.forEach(m => {
    if (x > 0 && x + m.width > bed) { x = 0; y -= rowDepth + gap; rowDepth = 0; rows++; }
    m.x = x + m.width / 2; m.y = y;
    m.group.position.set(m.x, m.y, 0);
    group.add(m.group);
    x += m.width + gap; rowDepth = Math.max(rowDepth, m.depth);
  });
  group.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(group), size = bb.getSize(new THREE.Vector3());
  // shift so the whole set is centred on the origin
  const dx = -(bb.min.x + bb.max.x) / 2, dy = -(bb.min.y + bb.max.y) / 2;
  group.position.set(dx, dy, 0);
  group.updateMatrixWorld(true);

  if (o.fontSize < 8) warnings.push('Letters under 8 mm tall are hard to read from a standing height and have thin strokes. Raise the letter height if you can.');
  if (o.thickness < 2) warnings.push('A marker thinner than 2 mm can snap when pushed into hard soil.');
  const tooWide = markers.filter(m => m.width > 90);
  if (tooWide.length) warnings.push(`${tooWide.length} marker${tooWide.length > 1 ? 's are' : ' is'} over 90 mm wide: long names get very large. Shorten them, use a smaller letter height, or put the name on two lines (write "Sweet / Basil").`);
  return {
    group, markers,
    info: { count: markers.length, width: size.x, depth: size.y, height: size.z, rows, headHeight, filamentChangeZ: o.thickness, warnings },
  };
}
