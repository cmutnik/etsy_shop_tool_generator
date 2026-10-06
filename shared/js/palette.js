// Copyright (c) 2025 cmutnik
// Reduce many colours to a small palette. Used for models painted point by point (AI-generated and scanned OBJ files), where a printer
// needs a handful of filaments, not a thousand shades. No dependencies.

const hex2 = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0').toUpperCase();
export const toHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

/**
 * rgb: Float32Array of r, g, b (0..1) for each item (a triangle, say). k: how many colours to keep.
 * Returns { labels: Uint8Array (palette index of each item), palette: ['#RRGGBB'], counts }, palette sorted by how many items use it.
 * Colours are binned to 5 bits per channel, then weighted k-means runs on the bins, so a million items cost no more than the bins.
 */
export function quantizeColors(rgb, k = 6) {
  const n = rgb.length / 3, BITS = 5, L = 1 << BITS, bins = new Float64Array(L * L * L * 4);   // count, sum r, sum g, sum b
  const binOf = i => {
    const q = c => Math.min(L - 1, Math.max(0, Math.floor(c * L)));
    return ((q(rgb[i * 3]) * L + q(rgb[i * 3 + 1])) * L + q(rgb[i * 3 + 2]));
  };
  const itemBin = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const b = (itemBin[i] = binOf(i)); bins[b * 4]++; bins[b * 4 + 1] += rgb[i * 3]; bins[b * 4 + 2] += rgb[i * 3 + 1]; bins[b * 4 + 3] += rgb[i * 3 + 2]; }
  const pts = [];                                                                  // the used bins: mean colour and weight
  const ptOf = new Map();
  for (let b = 0; b < L * L * L; b++) if (bins[b * 4]) { const w = bins[b * 4]; ptOf.set(b, pts.length); pts.push({ r: bins[b * 4 + 1] / w, g: bins[b * 4 + 2] / w, b: bins[b * 4 + 3] / w, w }); }
  k = Math.max(1, Math.min(Math.floor(k) || 1, 255, pts.length));
  const d2 = (p, c) => (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;

  // k-means++ start without randomness: the heaviest point first, then each time the point farthest (weighted) from the centres so far
  const centres = [{ ...pts.reduce((a, p) => (p.w > a.w ? p : a)) }], far = pts.map(p => d2(p, centres[0]));
  while (centres.length < k) {
    let best = -1, top = -1;
    for (let i = 0; i < pts.length; i++) { const s = far[i] * Math.sqrt(pts[i].w); if (s > top) { top = s; best = i; } }
    const c = { ...pts[best] };
    centres.push(c);
    for (let i = 0; i < pts.length; i++) far[i] = Math.min(far[i], d2(pts[i], c));
  }
  const assign = new Uint8Array(pts.length);
  for (let iter = 0; iter < 20; iter++) {
    let moved = 0;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centres.length; c++) { const d = d2(pts[i], centres[c]); if (d < bd) { bd = d; best = c; } }
      if (assign[i] !== best || iter === 0) moved++;
      assign[i] = best;
    }
    const sum = centres.map(() => ({ r: 0, g: 0, b: 0, w: 0 }));
    pts.forEach((p, i) => { const s = sum[assign[i]]; s.r += p.r * p.w; s.g += p.g * p.w; s.b += p.b * p.w; s.w += p.w; });
    sum.forEach((s, c) => { if (s.w) { centres[c].r = s.r / s.w; centres[c].g = s.g / s.w; centres[c].b = s.b / s.w; } });
    if (!moved) break;
  }
  // order by use, drop empty clusters
  const use = new Float64Array(centres.length);
  pts.forEach((p, i) => { use[assign[i]] += p.w; });
  const order = [...centres.keys()].filter(c => use[c] > 0).sort((a, b) => use[b] - use[a]), rank = new Map(order.map((c, i) => [c, i]));
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) labels[i] = rank.get(assign[ptOf.get(itemBin[i])]);
  return { labels, palette: order.map(c => toHex(centres[c].r, centres[c].g, centres[c].b)), counts: order.map(c => use[c]) };
}
