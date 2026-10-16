// Copyright (c) 2025 cmutnik
// Layered colour art: a picture reduced to a few filament colours and printed as stacked flat steps, one colour per height,
// so a single print needs only a filament change at each step (or an AMS / MMU does it). The top surface shows each pixel's colour.
//
// Colour k stands on a base: band 0 covers the whole picture; band k (k >= 1) covers only the pixels whose colour is at rank k
// or higher in the stack, one step thick, sitting on band k-1. Transparent pixels belong to no band, so a cut-out picture
// becomes a cut-out print. Every band is traced from the same pixel grid, so the layers line up exactly.
import * as THREE from 'three';
import { traceMask } from './image-trace.js';
import { signedArea, contoursToGroups, simplifyRing, mapGroups } from './geometry-pure.js';
import { groupsToShapes, extrudeShapes } from './geometry2d.js';
import { smoothLabels } from './image-color.js';

export const NONE = 255;                                   // label of a transparent pixel (same as image-color.js)
export const rgbToHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const luminance = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Label every pixel with the index of the nearest palette colour (transparent pixels get NONE). */
export function assignLabels(img, palette) {
  const { data, width: w, height: h } = img, labels = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (data[p * 4 + 3] < 128) { labels[p] = NONE; continue; }
    let best = 0, bd = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const d = (data[p * 4] - palette[c][0]) ** 2 + (data[p * 4 + 1] - palette[c][1]) ** 2 + (data[p * 4 + 2] - palette[c][2]) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    labels[p] = best;
  }
  return labels;
}

/** The order the colours stack in, bottom first: 'dark-bottom' | 'light-bottom' | 'as-listed'. Returns palette indices. */
export function stackOrder(palette, order = 'dark-bottom') {
  const idx = palette.map((_, i) => i);
  if (order === 'dark-bottom') idx.sort((a, b) => luminance(palette[a]) - luminance(palette[b]));
  else if (order === 'light-bottom') idx.sort((a, b) => luminance(palette[b]) - luminance(palette[a]));
  return idx;
}

/** Remove colours that cover (almost) nothing, so they do not become empty layers. Returns the used palette indices, in `order`. */
export function usedOrder(labels, order, minPixels = 1) {
  const count = new Map();
  for (const l of labels) if (l !== NONE) count.set(l, (count.get(l) || 0) + 1);
  return order.filter(i => (count.get(i) || 0) >= minPixels);
}

/**
 * @param {object} o
 *  labels, width, height   pixel grid (label = palette index, NONE = no material)
 *  palette                 [[r,g,b], ...]
 *  order                   palette indices, bottom of the stack first (see stackOrder / usedOrder)
 *  widthMm                 width of the finished picture
 *  baseThickness           thickness of the first (bottom) colour, over the whole picture
 *  stepHeight              thickness of each colour after it
 *  tolerance, minArea      outline simplification (px; above about 0.35 square corners get clipped) and smallest island kept (px^2)
 * @returns {{ group: THREE.Group, info: object }}
 */
export function buildLayeredArt({ labels, width: w, height: h, palette, order, widthMm = 80, baseThickness = 0.8, stepHeight = 0.2, tolerance = 0.3, minArea = 4 }) {
  if (!order.length) throw new Error('The picture has no opaque pixels to print.');
  if (!(baseThickness >= 0.2)) throw new Error('The base must be at least 0.2 mm thick.');
  if (!(stepHeight >= 0.04)) throw new Error('Each colour step must be at least 0.04 mm thick.');
  const px = widthMm / w;                                  // mm per pixel
  const rank = new Int16Array(256).fill(-1);
  order.forEach((pi, r) => { rank[pi] = r; });
  const group = new THREE.Group(), bands = [];
  let tris = 0, z = 0;
  for (let k = 0; k < order.length; k++) {
    const mask = new Uint8Array(w * h);
    let area = 0;
    for (let p = 0; p < w * h; p++) if (labels[p] !== NONE && rank[labels[p]] >= k) { mask[p] = 1; area++; }
    const depth = k === 0 ? baseThickness : stepHeight;
    const rings = traceMask(mask, w, h).filter(r => Math.abs(signedArea(r)) >= minArea)
      .map(r => simplifyRing(r, tolerance).map(([x, y]) => [x, -y]));                  // y up
    // pixel-centre units -> mm about the picture's centre; every band uses the same frame, so they register
    const groups = mapGroups(contoursToGroups(rings), (x, y) => [(x - (w - 1) / 2) * px, (y + (h - 1) / 2) * px]);
    if (groups.length) {
      const geo = extrudeShapes(groupsToShapes(groups), depth, z);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: rgbToHex(palette[order[k]]), roughness: 0.6 }));
      mesh.name = 'layer' + k;
      group.add(mesh);
      tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    }
    bands.push({ name: 'layer' + k, color: rgbToHex(palette[order[k]]), z0: z, z1: z + depth, coverage: area / (w * h) });
    z += depth;
  }
  const warnings = [];
  const thin = bands.slice(1).filter(b => b.coverage > 0 && b.coverage < 0.002);
  if (thin.length) warnings.push(`${thin.length} colour${thin.length > 1 ? 's cover' : ' covers'} under 0.2% of the picture and will print as tiny specks. Use fewer colours or more smoothing.`);
  if (stepHeight < 0.12) warnings.push('Steps thinner than 0.12 mm let the colour below show through. Fine for blending effects, but for solid colour use 0.16-0.2 mm.');
  return {
    group,
    info: {
      width: widthMm, depth: h * px, height: z, bands, triangles: tris,
      filamentChangeZs: bands.slice(1).map(b => b.z0),
      pixelMm: px, warnings,
    },
  };
}

export { smoothLabels };
