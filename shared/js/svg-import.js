// Copyright (c) 2025 cmutnik
// SVG text -> groups (y-up, centred). Only filled shapes are used; stroke-only art is ignored.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { centerGroups, mapGroups } from './geometry2d.js';

function isWhitish(fill) {
  try {
    const c = new THREE.Color();
    c.setStyle(fill);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.92;
  } catch { return false; }
}

/**
 * @param {string} svgText
 * @param {{ ignoreWhite?: boolean, frame?: boolean }} opts
 *  ignoreWhite drops white fills (typical logo backgrounds).
 *  frame: position and size the artwork by the SVG's own frame (its viewBox, or width/height) instead of by the ink's
 *  bounding box. The layers of a multi-colour picture then keep their exact relative positions, so stamps made from
 *  them line up. Falls back to the bounding box if the SVG has no frame.
 */
export function svgToGroups(svgText, { ignoreWhite = true, frame = false } = {}) {
  const data = new SVGLoader().parse(svgText);
  const groups = [];
  for (const path of data.paths) {
    const st = path.userData && path.userData.style;
    const fill = st && st.fill;
    if (fill === 'none' || (st && (st.fillOpacity === 0 || st.opacity === 0))) continue;
    if (ignoreWhite && fill && isWhitish(fill)) continue;
    for (const shape of SVGLoader.createShapes(path)) {
      const pts = shape.extractPoints(12);
      if (pts.shape.length < 3) continue;
      // SVG is y-down
      const flip = ring => ring.map(v => [v.x, -v.y]);
      groups.push({ outer: flip(pts.shape), holes: pts.holes.filter(h => h.length > 2).map(flip) });
    }
  }
  if (frame) {
    const f = svgFrame(svgText);
    if (f) return { groups: mapGroups(groups, (x, y) => [x - (f.x + f.w / 2), y + (f.y + f.h / 2)]), width: f.w, height: f.h, framed: true };
  }
  return { ...centerGroups(groups), framed: false };
}

/** The SVG's frame in user units: { x, y, w, h } from viewBox, else width/height, else null. */
export function svgFrame(svgText) {
  const vb = svgText.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/);
  if (vb) { const [x, y, w, h] = vb.slice(1).map(Number); if (w > 0 && h > 0) return { x, y, w, h }; }
  const wh = svgText.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)(?:px)?["'][^>]*\sheight\s*=\s*["']([\d.]+)(?:px)?["']/);
  if (wh) { const w = Number(wh[1]), h = Number(wh[2]); if (w > 0 && h > 0) return { x: 0, y: 0, w, h }; }
  return null;
}
