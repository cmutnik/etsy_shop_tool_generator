// Copyright (c) 2025 cmutnik
// Text -> groups using an opentype.js font. y-up, centred on the origin.
import { contoursToGroups, centerGroups, mapGroups, boundsOf } from './geometry2d.js';

const CURVE_STEPS = 10;

function flattenCommands(commands) {
  const contours = [];
  let cur = null;
  let px = 0, py = 0;
  const close = () => { if (cur && cur.length > 2) contours.push(cur); cur = null; };
  for (const c of commands) {
    switch (c.type) {
      case 'M': close(); cur = [[c.x, c.y]]; px = c.x; py = c.y; break;
      case 'L': cur.push([c.x, c.y]); px = c.x; py = c.y; break;
      case 'Q':
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS, u = 1 - t;
          cur.push([u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y]);
        }
        px = c.x; py = c.y; break;
      case 'C':
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS, u = 1 - t;
          cur.push([
            u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          ]);
        }
        px = c.x; py = c.y; break;
      case 'Z': close(); break;
    }
  }
  close();
  for (const k of contours) {
    const a = k[0], b = k[k.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) k.pop();
  }
  return contours;
}

/**
 * Lay out (possibly multi-line) text, each line centred. Returns { groups, width, height }
 * in mm, centred on the origin, before any fitting.
 */
export function layoutText(font, text, fontSize, lineSpacing) {
  const all = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const path = font.getPath(line, 0, 0, fontSize);
    // opentype is y-down; flip to y-up and place on this line's baseline
    const contours = flattenCommands(path.commands).map(k => k.map(([x, y]) => [x, -y]));
    const groups = contoursToGroups(contours);
    if (!groups.length) return;
    const b = boundsOf(groups);
    const dx = -(b.minX + b.maxX) / 2, dy = -i * fontSize * lineSpacing;
    all.push(...mapGroups(groups, (x, y) => [x + dx, y + dy]));
  });
  return centerGroups(all);
}
