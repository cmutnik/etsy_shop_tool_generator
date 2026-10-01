// Copyright (c) 2025 cmutnik
// QR code -> plate geometry, shared by the QR tools. Units are mm; z up, plate bottom on the bed (z = 0),
// QR readable from +z (above). Port of qr_stand_utils.generate_qr_polygons / build_qr_plate_mesh.
//
// Like the Python original, the plate is built from simple axis-aligned boxes (no merged, multiply-holed
// polygons): dark modules are merged along rows, then identical runs in consecutive rows are merged
// vertically. Boxes are inflated by EPS in x/y and sunk OVERLAP into the layer below so touching boxes
// truly overlap and slicers union them instead of seeing coplanar faces.
import * as THREE from 'three';
import qrcode from 'qrcode-generator';

const EPS = 0.005;
const OVERLAP = 0.2;

// the library's default byte encoder keeps only the low 8 bits of each character; use UTF-8 so
// accented letters, emoji and non-latin URLs scan correctly
qrcode.stringToBytes = s => Array.from(new TextEncoder().encode(s));

/** @returns {boolean[][]} matrix[row][col] = dark. Row 0 is the top of the code. */
export function qrMatrix(data, errorCorrection = 'M') {
  if (!data) throw new Error('Enter some text or a URL to encode.');
  const qr = qrcode(0, errorCorrection);
  qr.addData(data);
  try { qr.make(); } catch { throw new Error('That text is too long to fit in a QR code at this error-correction level. Shorten it or lower the level.'); }
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * Merge cells where `pick(cell)` is true into rectangles in grid units: { x0, x1, y0, y1 } (x1/y1 exclusive).
 * Horizontal runs per row first, then identical runs in consecutive rows are stacked.
 */
export function gridRects(matrix, pick) {
  const open = new Map(); // "x0,x1" -> rect still growing downward
  const done = [];
  matrix.forEach((line, row) => {
    const seen = new Set();
    let col = 0;
    while (col < line.length) {
      if (pick(line[col])) {
        let end = col;
        while (end < line.length && pick(line[end])) end++;
        const key = col + ',' + end;
        seen.add(key);
        const r = open.get(key);
        if (r) r.y1 = row + 1; else open.set(key, { x0: col, x1: end, y0: row, y1: row + 1 });
        col = end;
      } else col++;
    }
    for (const [key, r] of open) if (!seen.has(key)) { done.push(r); open.delete(key); }
  });
  done.push(...open.values());
  return done;
}

function box(x0, y0, x1, y1, z0, z1, name, mat) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const m = new THREE.Mesh(g, mat[name]);
  m.name = name;
  return m;
}

/**
 * Build the QR plate.
 * @param {object} o
 *  matrix, module (mm per module), margin (mm quiet zone), thickness (plate, mm), depth (emboss/engrave, mm),
 *  mode 'raised'|'indented', materials { base, qr }
 * @returns {{ meshes: THREE.Mesh[], size: number, filamentChangeZ: number }}
 *  Meshes are named 'qr' (the dark colour) or 'base' (the light colour), so a layer-based colour change
 *  at filamentChangeZ reproduces the preview. Plate occupies [0,size]^2.
 */
export function buildQrPlate({ matrix, module: m, margin, thickness: T, depth: d, mode, materials }) {
  const n = matrix.length;
  const P = n * m + 2 * margin;
  const cell = rect => [margin + rect.x0 * m, P - margin - rect.y1 * m, margin + rect.x1 * m, P - margin - rect.y0 * m];
  const meshes = [];
  if (mode === 'raised') {
    meshes.push(box(0, 0, P, P, 0, T, 'base', materials));
    for (const r of gridRects(matrix, v => v)) {
      const [x0, y0, x1, y1] = cell(r);
      meshes.push(box(x0 - EPS, y0 - EPS, x1 + EPS, y1 + EPS, T - OVERLAP, T + d, 'qr', materials));
    }
    return { meshes, size: P, filamentChangeZ: T };
  }
  // indented: dark lower slab, light top layer of thickness d with the modules left open
  meshes.push(box(0, 0, P, P, 0, T - d + OVERLAP, 'qr', materials));
  const zLo = T - d;
  const top = (x0, y0, x1, y1) => meshes.push(box(x0 - EPS, y0 - EPS, x1 + EPS, y1 + EPS, zLo, T, 'base', materials));
  if (margin > 0) {
    top(0, 0, P, margin); top(0, P - margin, P, P);
    top(0, margin, margin, P - margin); top(P - margin, margin, P, P - margin);
  }
  for (const r of gridRects(matrix, v => !v)) top(...cell(r));
  return { meshes, size: P, filamentChangeZ: zLo };
}

/**
 * Rasterise the plate top-down the way a camera would see it, using the meshes' bounding boxes
 * (so it checks the real geometry, not the matrix). Returns RGBA ImageData-like { data, width, height }.
 */
export function rasterizeTopDown(meshes, mode, size, pxPerMm = 10) {
  const w = Math.ceil(size * pxPerMm), h = w;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const boxes = meshes.filter(m => m.name === (mode === 'raised' ? 'qr' : 'base')).map(m => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox;
  });
  const covered = new Uint8Array(w * h);
  for (const b of boxes) {
    const x0 = Math.max(0, Math.round(b.min.x * pxPerMm)), x1 = Math.min(w, Math.round(b.max.x * pxPerMm));
    const y0 = Math.max(0, Math.round((size - b.max.y) * pxPerMm)), y1 = Math.min(h, Math.round((size - b.min.y) * pxPerMm));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) covered[y * w + x] = 1;
  }
  for (let i = 0; i < w * h; i++) {
    const dark = mode === 'raised' ? covered[i] : !covered[i];
    if (dark) data.fill(0, i * 4, i * 4 + 3);
  }
  return { data, width: w, height: h };
}
