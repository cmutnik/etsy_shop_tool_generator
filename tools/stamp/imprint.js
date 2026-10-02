// Copyright (c) 2025 cmutnik
// Flat 2D preview of what the stamp leaves on paper, with too-thin details highlighted.
import { outlineShape } from '../../shared/js/geometry2d.js';
import { thinFeatures, MIN_FEATURE_MM } from '../../shared/js/raster-tools.js';

export { MIN_FEATURE_MM };

function groupPath(groups, toPx) {
  const path = new Path2D();
  for (const g of groups) {
    for (const ring of [g.outer, ...g.holes]) {
      ring.forEach(([x, y], i) => { const [px, py] = toPx(x, y); i ? path.lineTo(px, py) : path.moveTo(px, py); });
      path.closePath();
    }
  }
  return path;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ imprint: object[] }} info  from buildStamp
 * @param {{ shape: string, width: number, height: number, cornerRadius: number }} p
 * @returns {{ thinFraction: number, thinMm2: number }}
 */
export function renderImprint(canvas, info, p) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const cssW = Math.min(canvas.parentElement.clientWidth || 600, 700);
  const s = Math.min(cssW / p.width, 320 / p.height) * dpr; // px per mm
  const w = Math.ceil(p.width * s), h = Math.ceil(p.height * s);
  canvas.width = w; canvas.height = h;
  canvas.style.width = w / dpr + 'px'; canvas.style.height = h / dpr + 'px';
  const toPx = (x, y) => [w / 2 + x * s, h / 2 - y * s];
  const ctx = canvas.getContext('2d');

  // paper + stamp outline
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c9c3bb'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.stroke(groupPath([{ outer: outlineShape(p.shape, p.width, p.height, p.cornerRadius).getPoints(64).map(v => [v.x, v.y]), holes: [] }], toPx));
  ctx.setLineDash([]);

  // ink
  const ink = info.imprint.map(g => groupPath([g], toPx));
  ctx.fillStyle = '#1d3a5f';
  for (const path of ink) ctx.fill(path, 'evenodd');

  // thin-feature check on a 1 bit rasterisation, capped so big stamps stay fast
  const scale = Math.min(1, 900 / Math.max(w, h));
  const mw = Math.max(1, Math.round(w * scale)), mh = Math.max(1, Math.round(h * scale));
  const off = document.createElement('canvas');
  off.width = mw; off.height = mh;
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.scale(scale, scale);
  octx.fillStyle = '#000';
  for (const path of ink) octx.fill(path, 'evenodd');
  const px = octx.getImageData(0, 0, mw, mh).data;
  const mask = new Uint8Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  const mmPerPx = 1 / (s * scale);
  const { thin, inkPixels, thinPixels } = thinFeatures(mask, mw, mh, MIN_FEATURE_MM / 2 / mmPerPx);

  if (thinPixels) {
    const ov = new ImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) if (thin[i]) ov.data.set([225, 29, 72, 255], i * 4);
    const oc = document.createElement('canvas');
    oc.width = mw; oc.height = mh;
    oc.getContext('2d').putImageData(ov, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(oc, 0, 0, w, h);
  }
  return { thinFraction: inkPixels ? thinPixels / inkPixels : 0, thinMm2: thinPixels * mmPerPx * mmPerPx };
}
