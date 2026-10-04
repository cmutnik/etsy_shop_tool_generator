// Copyright (c) 2025 cmutnik
// Parts added to a model: a hanging tab (a ring with a hole, joined to the model's edge) and a raised text label.
// Everything is built in the model's final coordinates (centred, on the bed at z = 0). The added parts overlap the model
// slightly instead of touching it face to face, so slicers merge them cleanly (same idea as OVERLAP in the stamp).
import * as THREE from 'three';
import { extrudeShapes, groupsToShapes, outlineShape } from '../../shared/js/geometry2d.js';
import { simplifyRing, signedArea } from '../../shared/js/geometry-pure.js';
import { union, multiPolygonToGroups } from '../../shared/js/boolean2d.js';
import { layoutText } from '../../shared/js/text-layout.js';

export const TAB_STYLES = [
  { id: 'round', label: 'Round ring' },
  { id: 'rounded-square', label: 'Rounded square' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'slot', label: 'Lanyard slot' },
];
/** Which edge the tab hangs from: the unit vector pointing away from the model, seen from above. */
export const TAB_SIDES = [
  { id: 'top', label: 'Top edge (+Y, back)', dir: [0, 1] },
  { id: 'bottom', label: 'Bottom edge (-Y, front)', dir: [0, -1] },
  { id: 'right', label: 'Right edge (+X)', dir: [1, 0] },
  { id: 'left', label: 'Left edge (-X)', dir: [-1, 0] },
];
export const MIN_WALL = 2;        // mm of material around the hole
export const MIN_GAP = 0.8;       // mm of tab wall that must stay outside the model, between the hole and the model

/**
 * How far the model reaches along `dir` inside a strip: lateral coordinate in [lo, hi], z <= zMax. Triangles are clipped to the
 * strip, so a flat side with no vertex in the strip still counts. Returns null if the strip is empty.
 * (lateral = dir.y * x - dir.x * y: positive goes clockwise round the model when seen from above.)
 */
export function reach(parts, dir, lo, hi, zMax) {
  let best = -Infinity;
  const [dx, dy] = dir;
  const planes = [p => dy * p[0] - dx * p[1] - lo, p => hi - (dy * p[0] - dx * p[1]), p => zMax - p[2]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (const part of parts) {
    const pos = part.positions, idx = part.indices;
    for (let t = 0; t < idx.length; t += 3) {
      let poly = [0, 1, 2].map(k => [pos[idx[t + k] * 3], pos[idx[t + k] * 3 + 1], pos[idx[t + k] * 3 + 2]]);
      // quick reject on the strip before clipping
      if (Math.min(poly[0][2], poly[1][2], poly[2][2]) > zMax) continue;
      const lat = poly.map(p => dy * p[0] - dx * p[1]);
      if (Math.max(...lat) < lo || Math.min(...lat) > hi) continue;
      for (const f of planes) {
        const next = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
          if (fa >= 0) next.push(a);
          if ((fa >= 0) !== (fb >= 0)) next.push(lerp(a, b, fa / (fa - fb)));
        }
        poly = next;
        if (!poly.length) break;
      }
      for (const p of poly) best = Math.max(best, dx * p[0] + dy * p[1]);
    }
  }
  return best === -Infinity ? null : best;
}

function ringShapes(style, hole, wall, slotLength) {
  if (style === 'slot') {
    const L = Math.max(slotLength, hole);
    const outer = outlineShape('rect', L + 2 * wall, hole + 2 * wall, (hole + 2 * wall) / 2);
    outer.holes.push(outlineShape('rect', L, hole, hole / 2));
    return { shape: outer, half: (hole + 2 * wall) / 2, lateral: L / 2 + wall };
  }
  let outer, half;
  if (style === 'round') { half = hole / 2 + wall; outer = outlineShape('ellipse', 2 * half, 2 * half); }
  else if (style === 'rounded-square') { half = hole / 2 + wall; outer = outlineShape('rect', 2 * half, 2 * half, half * 0.35); }
  else if (style === 'hexagon') {
    half = hole / 2 + wall;                                                     // apothem: flat at the top and bottom
    const R = half / Math.cos(Math.PI / 6);
    outer = new THREE.Shape(Array.from({ length: 6 }, (_, k) => new THREE.Vector2(R * Math.cos((k * Math.PI) / 3), R * Math.sin((k * Math.PI) / 3))));
  } else throw new Error(`Unknown tab style: ${style}`);
  outer.holes.push(outlineShape('ellipse', hole, hole));
  return { shape: outer, half, lateral: style === 'hexagon' ? half / Math.cos(Math.PI / 6) : half };
}

/**
 * The hanging tab. opts: { style, side, hole, wall, slotLength, thickness, overlap, shift }
 * Returns { geometry, warnings, info } or throws a message the user can act on.
 */
export function buildTab(parts, size, opts) {
  const { style, side, hole, wall, slotLength = 12, thickness, overlap, shift = 0 } = opts;
  const dir = TAB_SIDES.find(s => s.id === side)?.dir;
  if (!dir) throw new Error('Choose which edge the tab hangs from.');
  if (!(hole >= 2)) throw new Error('The tab hole must be at least 2 mm.');
  if (!(wall >= MIN_WALL)) throw new Error(`The tab wall must be at least ${MIN_WALL} mm so it does not snap.`);
  if (!(thickness >= 1)) throw new Error('The tab must be at least 1 mm thick.');
  if (!(overlap >= 0.3)) throw new Error('The tab must sink at least 0.3 mm into the model so it fuses to it.');
  if (wall - overlap < MIN_GAP) throw new Error(`The hole would cut into the model: the wall (${wall} mm) must be at least ${MIN_GAP} mm more than the overlap (${overlap} mm). Increase the wall or reduce the overlap.`);

  const { shape, half, lateral: lateralHalf } = ringShapes(style, hole, wall, slotLength);
  const along = reach(parts, dir, shift - lateralHalf, shift + lateralHalf, thickness);
  if (along === null) throw new Error('Nothing of the model is within reach of the tab at that spot. Move the tab along the edge, or lower its thickness.');

  const geometry = extrudeShapes([shape], thickness, 0);
  // the ring is built centred on the origin with "outward" = +y: turn +y onto dir, then move it so its inner edge sinks `overlap` into the model
  geometry.rotateZ(Math.atan2(-dir[0], dir[1]));
  const dist = along + half - overlap;
  const cx = dir[0] * dist + dir[1] * shift, cy = dir[1] * dist - dir[0] * shift;   // shift runs along (dir.y, -dir.x): clockwise seen from above
  geometry.translate(cx, cy, 0);

  const warnings = [];
  if (thickness > size[2] + 1e-6) warnings.push(`The tab (${thickness} mm) is thicker than the model is tall (${size[2].toFixed(1)} mm).`);
  return { geometry, warnings, info: { center: [cx, cy], outer: half * 2 } };
}

const DETAIL = 0.02, MIN_PIECE = 0.02;

/** Merge overlapping glyph outlines and drop sub-printable specks, as the QR stand does for its title. */
function mergeArtwork(groups) {
  const clean = groups.map(g => ({ outer: simplifyRing(g.outer, DETAIL), holes: g.holes.map(h => simplifyRing(h, DETAIL)) }))
    .filter(g => g.outer.length >= 3 && Math.abs(signedArea(g.outer)) > MIN_PIECE);
  if (!clean.length) return [];
  return multiPolygonToGroups(union(...clean.map(g => [[g.outer, ...g.holes]])));
}

/** Highest surface height of the model under each (x, y) sample, or null where there is no model. */
export function surfaceHeights(parts, samples) {
  const best = samples.map(() => null);
  for (const part of parts) {
    const pos = part.positions, idx = part.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], bx = pos[b], by = pos[b + 1], cx = pos[c], cy = pos[c + 1];
      const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-12) continue;                                        // edge-on in plan view
      for (let s = 0; s < samples.length; s++) {
        const [x, y] = samples[s];
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w = 1 - u - v;
        if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
        const z = u * pos[a + 2] + v * pos[b + 2] + w * pos[c + 2];
        if (best[s] === null || z > best[s]) best[s] = z;
      }
    }
  }
  return best;
}

/**
 * Where text goes on the model's top surface. opts: { font, text, height, raise, x, y, rotate }
 * `height` is the text's ink height in mm; `raise` is how far the text stands up (or, for engraving, how deep it cuts);
 * (x, y) is the centre of the text relative to the model's centre.
 * Returns { groups, top, warnings } (the merged outlines, the surface height they sit on) or throws.
 */
export function placeLabel(parts, { font, text, height, raise, x, y, rotate = 0 }) {
  if (!font) throw new Error('The label font is not loaded yet.');
  if (!text || !text.trim()) throw new Error('Enter the label text.');
  if (!(height >= 3)) throw new Error('Label text must be at least 3 mm tall to print.');
  if (!(raise >= 0.4)) throw new Error('Raise the label by at least 0.4 mm.');
  const lay = layoutText(font, text, 100, 1.25);
  if (!lay.groups.length || !(lay.height > 0)) throw new Error('Could not draw any text - try a different font or text.');
  const k = height / lay.height, c = Math.cos((rotate * Math.PI) / 180), s = Math.sin((rotate * Math.PI) / 180);
  const place = ([px, py]) => { const u = px * k, v = py * k; return [x + u * c - v * s, y + u * s + v * c]; };
  const groups = mergeArtwork(lay.groups.map(g => ({ outer: g.outer.map(place), holes: g.holes.map(h => h.map(place)) })));
  if (!groups.length) throw new Error('The text is too fine to print at this size.');

  // sample the surface across the text box
  const xs = groups.flatMap(g => g.outer.map(p => p[0])), ys = groups.flatMap(g => g.outer.map(p => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), N = 6, samples = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) samples.push([x0 + ((x1 - x0) * i) / (N - 1), y0 + ((y1 - y0) * j) / (N - 1)]);
  const heights = surfaceHeights(parts, samples), hit = heights.filter(h => h !== null);
  if (!hit.length) throw new Error('There is no model under the text. Move the label onto the model.');
  const top = Math.max(...hit), low = Math.min(...hit), warnings = [];
  if (hit.length < samples.length) warnings.push('Part of the text hangs past the edge of the model.');
  if (top - low > 0.3) warnings.push(`The surface under the text is not flat (it varies by ${(top - low).toFixed(1)} mm), so the text may float or sink in places. Place it on a flat area.`);
  return { groups, top, warnings };
}

/** Raised text: the outlines from placeLabel() extruded up from 0.3 mm inside the surface. Returns { geometry, warnings, top } or throws. */
export function buildLabel(parts, opts) {
  const { groups, top, warnings } = placeLabel(parts, opts), SINK = 0.3;
  return { geometry: extrudeShapes(groupsToShapes(groups), opts.raise + SINK, top - SINK), warnings, top };
}
