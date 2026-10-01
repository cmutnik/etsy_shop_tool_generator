// Copyright (c) 2025 cmutnik
// Font catalogue + loader shared by tools that render text. Fonts come from Fontsource via jsDelivr
// (Latin subset, WOFF - opentype.js cannot read WOFF2).
import opentype from 'opentype.js';

const cdn = (id, weight) => `https://cdn.jsdelivr.net/npm/@fontsource/${id}/files/${id}-latin-${weight}-normal.woff`;

export const FONTS = [
  { name: 'Roboto Bold', url: cdn('roboto', 700) },
  { name: 'Oswald Bold', url: cdn('oswald', 700) },
  { name: 'Bebas Neue', url: cdn('bebas-neue', 400) },
  { name: 'Playfair Display Bold', url: cdn('playfair-display', 700) },
  { name: 'Abril Fatface', url: cdn('abril-fatface', 400) },
  { name: 'Special Elite (typewriter)', url: cdn('special-elite', 400) },
  { name: 'Courier Prime Bold', url: cdn('courier-prime', 700) },
  { name: 'Pacifico (script)', url: cdn('pacifico', 400) },
  { name: 'Lobster (script)', url: cdn('lobster', 400) },
  { name: 'Dancing Script Bold', url: cdn('dancing-script', 700) },
  { name: 'Permanent Marker', url: cdn('permanent-marker', 400) },
];

const cache = new Map();
export async function loadFont(url) {
  if (!cache.has(url)) cache.set(url, opentype.parse(await (await fetch(url)).arrayBuffer()));
  return cache.get(url);
}
export const parseFont = buffer => opentype.parse(buffer);

/** Fill a <select> with FONTS (option value = index). */
export function populateFontSelect(select) {
  FONTS.forEach((f, i) => select.appendChild(Object.assign(document.createElement('option'), { value: String(i), textContent: f.name })));
}
