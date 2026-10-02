// Copyright (c) 2025 cmutnik
// The optional icon + title strip of the QR stand plate. Pure geometry on groups ({ outer, holes }), y up, mm.
// Port of invite2svg's icon_polygons / text_to_polygons / build_banner_polygons.
import { svgToGroups } from '../../shared/js/svg-import.js';
import { mapGroups, boundsOf } from '../../shared/js/geometry-pure.js';
import { layoutText } from '../../shared/js/text-layout.js';
import { ICON_PATHS, ICON_VIEWBOX_SIZE } from '../../shared/js/icons.js';

/** Move groups so their bounding box starts at (0, 0). */
export function toOrigin(groups) {
  if (!groups.length) return groups;
  const b = boundsOf(groups);
  return mapGroups(groups, (x, y) => [x - b.minX, y - b.minY]);
}

/** A brand icon scaled to `sizeMm` (its 24 x 24 box), with its own bottom-left corner at (0, 0). */
export function iconGroups(name, sizeMm) {
  if (!(name in ICON_PATHS)) throw new Error(`Unknown icon: ${name}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_VIEWBOX_SIZE} ${ICON_VIEWBOX_SIZE}"><path d="${ICON_PATHS[name]}"/></svg>`;
  const { groups } = svgToGroups(svg, { ignoreWhite: false });
  if (!groups.length) throw new Error(`Icon ${name} produced no shape.`);
  const k = sizeMm / ICON_VIEWBOX_SIZE;
  return toOrigin(mapGroups(groups, (x, y) => [x * k, y * k]));    // scaled by the icon box, not the glyph's own bounds
}

/** Title text scaled so its ink is `heightMm` tall, with its bottom-left corner at (0, 0). Returns { groups, width, height }. */
export function titleGroups(font, text, heightMm) {
  if (!text || !text.trim()) throw new Error('Enter a title / company name.');
  const lay = layoutText(font, text, 100, 1.25);
  if (!lay.groups.length || !(lay.height > 0)) throw new Error('Could not draw any text for that title - try a different font or title.');
  const k = heightMm / lay.height;
  const groups = toOrigin(mapGroups(lay.groups, (x, y) => [x * k, y * k]));
  return { groups, width: lay.width * k, height: heightMm };
}

/**
 * Lay the icon and title out on the banner strip.
 *  both: icon then title, left to right, centred as one group; title only: centred;
 *  icon only: right-aligned (the upper-right corner when the banner is above the QR code).
 * Everything shrinks together just enough to fit the plate width minus side padding.
 * @returns {{ groups, height }}  banner-local coordinates: (0,0) is the strip's bottom-left, it spans plateWidth
 */
export function layoutBanner({ plateWidth, icon = null, iconSize = 12, title = null, gap = 4, sidePad = 4, vPad = 3 }) {
  let iconG = icon ? icon : [], size = icon ? iconSize : 0;
  let titleG = title ? title.groups : [], tw = title ? title.width : 0, th = title ? title.height : 0;
  if (!iconG.length && !titleG.length) return { groups: [], height: 0 };
  let g = gap;
  const content = size + (iconG.length && titleG.length ? g : 0) + tw;
  const fit = content > 0 ? Math.min(1, Math.max(plateWidth - 2 * sidePad, 1e-6) / content) : 1;
  if (fit < 1) {
    const sc = ([x, y]) => [x * fit, y * fit];
    iconG = iconG.map(gr => ({ outer: gr.outer.map(sc), holes: gr.holes.map(h => h.map(sc)) }));
    titleG = titleG.map(gr => ({ outer: gr.outer.map(sc), holes: gr.holes.map(h => h.map(sc)) }));
    size *= fit; tw *= fit; th *= fit; g *= fit;
  }
  const height = Math.max(size, th) + 2 * vPad;
  const at = (groups, dx, dy) => mapGroups(groups, (x, y) => [x + dx, y + dy]);
  let placed;
  if (iconG.length && titleG.length) {
    const total = size + g + tw, x0 = Math.max((plateWidth - total) / 2, sidePad);
    placed = [...at(iconG, x0, (height - size) / 2), ...at(titleG, x0 + size + g, (height - th) / 2)];
  } else if (titleG.length) {
    placed = at(titleG, Math.max((plateWidth - tw) / 2, sidePad), (height - th) / 2);
  } else {
    placed = at(iconG, plateWidth - size - sidePad, (height - size) / 2);
  }
  return { groups: placed, height };
}
