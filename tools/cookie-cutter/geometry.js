// Copyright (c) 2025 cmutnik
// Cookie / clay cutter: a thin wall that follows a shape's outline, with a sharp edge on one side and a flange on the other.
//
// Orientation, as printed: the flange lies on the bed (z = 0), the wall stands up from it, and the thin cutting edge is at the top.
// Flip it over to use it (flange up, edge down). The inside of the wall is exactly the shape, at the size you ask for; the wall
// grows outwards, so the cookie is the size you typed.
import * as THREE from 'three';
import { centerGroups, mapGroups, groupsToShapes, extrudeShapes } from '../../shared/js/geometry2d.js';
import { multiPolygonToGroups, circleRing, roundedRectRing } from '../../shared/js/boolean2d.js';
import { outerBand, fillHoles } from '../../shared/js/offset2d.js';
import { signedArea } from '../../shared/js/geometry-pure.js';

const area = groups => groups.reduce((a, g) => a + Math.abs(signedArea(g.outer)) - g.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0), 0);
const ringLength = r => r.reduce((q, pt, i) => q + Math.hypot(pt[0] - r[(i + 1) % r.length][0], pt[1] - r[(i + 1) % r.length][1]), 0);

/** Built-in outlines, as rings in arbitrary units (scaled to the requested size later). */
export const SHAPES = [
  { id: 'circle', label: 'Circle', groups: () => [{ outer: circleRing(0, 0, 50, 96), holes: [] }] },
  { id: 'square', label: 'Rounded square', groups: () => [{ outer: roundedRectRing(-50, -50, 50, 50, [12, 12, 12, 12], 10), holes: [] }] },
  { id: 'heart', label: 'Heart', groups: () => [{ outer: Array.from({ length: 120 }, (_, i) => { const t = (i / 120) * Math.PI * 2; return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]; }), holes: [] }] },
  { id: 'star', label: 'Star', groups: () => [{ outer: Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 22 : 50; return [r * Math.cos(a), r * Math.sin(a)]; }), holes: [] }] },
  { id: 'flower', label: 'Flower', groups: () => [{ outer: Array.from({ length: 180 }, (_, i) => { const t = (i / 180) * Math.PI * 2, r = 36 + 14 * Math.cos(6 * t); return [r * Math.cos(t), r * Math.sin(t)]; }), holes: [] }] },
  { id: 'hexagon', label: 'Hexagon', groups: () => [{ outer: Array.from({ length: 6 }, (_, i) => [50 * Math.cos((i * Math.PI) / 3), 50 * Math.sin((i * Math.PI) / 3)]), holes: [] }] },
];
export const shape = id => SHAPES.find(s => s.id === id);

/** Scale groups so the longest side is `size` mm, centred on the origin. */
export function fitToSize(groups, size) {
  const c = centerGroups(groups), s = size / Math.max(c.width, c.height);
  return { groups: mapGroups(c.groups, (x, y) => [x * s, y * s]), width: c.width * s, height: c.height * s };
}

/**
 * @param {object} o
 *  groups     the shape (y up, any units); scaled so its longest side is `size`
 *  size       cookie size, longest side, mm (the inside of the cutter)
 *  fillHoles  ignore holes in the shape (a solid silhouette)
 *  wall       wall thickness, mm; edge: thickness of the cutting edge at the top, mm; edgeHeight: how tall that sharp part is
 *  height     total height, flange to edge, mm
 *  flange     how far the flange sticks out past the wall, mm; flangeThickness: how thick it is, mm
 * @returns {{ group: THREE.Group, info: object }}
 */
export function buildCookieCutter(o) {
  const wall = o.wall ?? 1.2, edge = o.edge ?? 0.6, edgeHeight = o.edgeHeight ?? 2, height = o.height ?? 12;
  const flange = o.flange ?? 4, flangeThickness = o.flangeThickness ?? 2;
  if (!o.groups || !o.groups.length) throw new Error('There is no shape to cut. Choose a built-in shape or a picture with a clear outline.');
  if (!(o.size >= 15)) throw new Error('The cutter must be at least 15 mm across.');
  if (!(edge >= 0.4)) throw new Error('The cutting edge must be at least 0.4 mm thick (one nozzle width).');
  if (!(wall >= edge)) throw new Error('The wall must be at least as thick as the cutting edge.');
  if (!(flange >= 0)) throw new Error('The flange cannot be negative.');
  if (!(flangeThickness >= 0.8)) throw new Error('The flange must be at least 0.8 mm thick.');
  if (!(height >= flangeThickness + edgeHeight + 2)) throw new Error('The cutter is too short: it needs room for the flange, a straight wall and the sharp edge. Increase the height.');

  const fit = fitToSize(o.fillHoles ? fillHoles(o.groups) : o.groups, o.size);
  const warnings = [];
  const shapeArea = area(fit.groups);

  const region = r => multiPolygonToGroups(outerBand(fit.groups, r));
  const wallRegion = region(wall), edgeRegion = region(edge), flangeRegion = flange > 0 ? region(wall + flange) : wallRegion;
  if (!wallRegion.length) throw new Error('Could not build a wall for this shape. Try a simpler picture or more smoothing.');

  // flange (bed) / straight wall / sharp edge (top): stacked, the inside surface flush all the way up
  const layers = [
    { name: 'flange', groups: flangeRegion, z0: 0, z1: flangeThickness },
    { name: 'wall', groups: wallRegion, z0: flangeThickness, z1: height - edgeHeight },
    { name: 'edge', groups: edgeRegion, z0: height - edgeHeight, z1: height },
  ];
  const group = new THREE.Group();
  for (const l of layers) {
    const mesh = new THREE.Mesh(extrudeShapes(groupsToShapes(l.groups), l.z1 - l.z0, l.z0), new THREE.MeshStandardMaterial({ color: o.color || '#d9a441', roughness: 0.6 }));
    mesh.name = l.name;
    group.add(mesh);
  }

  // how thick the cookie is, on average: its area over half its outline length
  const perimeter = fit.groups.reduce((p, g) => p + [g.outer, ...g.holes].reduce((s, r) => s + ringLength(r), 0), 0);
  const meanWidth = (2 * shapeArea) / perimeter;
  if (meanWidth < 4) warnings.push(`This shape is only about ${meanWidth.toFixed(1)} mm wide on average, so the dough will be thin and hard to push out. Make the cutter bigger or the shape simpler.`);
  if (fit.groups.length > 1) warnings.push(`The shape has ${fit.groups.length} separate pieces, so this prints as ${fit.groups.length} separate cutters.`);
  if (o.size < 30) warnings.push('Under 30 mm, fine details close up. Use a bigger size or fewer details.');
  const holes = fit.groups.reduce((n, g) => n + g.holes.length, 0);
  if (holes) warnings.push(`${holes} hole${holes > 1 ? 's' : ''} in the shape get their own wall, so the dough inside stays in the cutter. Tick "Ignore holes" for a solid silhouette.`);

  const bb = new THREE.Box3().setFromObject(group), sz = bb.getSize(new THREE.Vector3());
  return {
    group,
    info: { cookieWidth: fit.width, cookieHeight: fit.height, width: sz.x, depth: sz.y, height: sz.z, area: shapeArea, pieces: fit.groups.length, warnings, layers: layers.map(l => ({ name: l.name, z0: l.z0, z1: l.z1 })) },
  };
}
