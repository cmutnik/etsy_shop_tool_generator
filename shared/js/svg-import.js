// Copyright (c) 2025 cmutnik
// SVG text -> groups (y-up, centred). Only filled shapes are used; stroke-only art is ignored.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { centerGroups } from './geometry2d.js';

function isWhitish(fill) {
  try {
    const c = new THREE.Color();
    c.setStyle(fill);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.92;
  } catch { return false; }
}

/**
 * @param {string} svgText
 * @param {{ ignoreWhite?: boolean }} opts  ignoreWhite drops white fills (typical logo backgrounds)
 */
export function svgToGroups(svgText, { ignoreWhite = true } = {}) {
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
  return centerGroups(groups);
}
