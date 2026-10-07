// Copyright (c) 2025 cmutnik
// Lithophane: a picture as a thin plate whose thickness follows the picture's darkness, so it glows when lit from behind.
// Pure geometry (no DOM): the page hands in RGBA pixels, this returns a watertight mesh.
//
// Orientation: the plate stands upright, the way it prints best. X is the picture's width (centred on 0), Z is its height
// (the bottom edge on the bed, z = 0), Y is thickness. The smooth face is on the viewer's side (y = 0, facing -y); the relief
// grows towards +y, away from the viewer, where the light goes. A curved plate bends round a centre at +y, so the light
// source sits on the inside of the curve.
import * as THREE from 'three';
import { boxBlur } from './image-trace.js';

export const MAX_TRIANGLES = 1_600_000;

/** Brightness 0 (black) - 1 (white) from RGBA pixels; transparent pixels count as white (thin). */
export function brightness(img) {
  const { data, width: w, height: h } = img, out = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const a = data[p * 4 + 3] / 255;
    out[p] = ((0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2]) * a + 255 * (1 - a)) / 255;
  }
  return out;
}

/** Area-average resample of a w*h grid to nw*nh (good for shrinking a photo to the print grid). */
export function resample(src, w, h, nw, nh) {
  if (nw === w && nh === h) return src;
  const out = new Float32Array(nw * nh);
  for (let j = 0; j < nh; j++) {
    const y0 = (j * h) / nh, y1 = ((j + 1) * h) / nh;
    for (let i = 0; i < nw; i++) {
      const x0 = (i * w) / nw, x1 = ((i + 1) * w) / nw;
      let acc = 0, wt = 0;
      for (let y = Math.floor(y0); y < Math.min(h, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(w, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0), k = wx * wy;
          acc += src[y * w + x] * k; wt += k;
        }
      }
      out[j * nw + i] = wt ? acc / wt : 0;
    }
  }
  return out;
}

/**
 * Thickness grid. Row 0 is the TOP of the picture. The frame is added round the picture at full thickness.
 * @param {object} o
 *  widthMm      width of the picture itself (the frame comes on top of this)
 *  pixelMm      size of one grid cell (0.2-0.5 mm suits a 0.4 mm nozzle)
 *  minThickness thinnest (brightest) point, maxThickness thickest (darkest) point
 *  gamma        >1 darkens the mid-tones (thicker), <1 lightens them
 *  invert       negative: bright = thick (for pictures that are light on dark)
 *  smooth       box-blur radius in cells (softens grain and jagged steps)
 *  frameMm      width of the full-thickness border (0 = none)
 * @returns {{ nx, nz, t: Float32Array, pixelMm, picNx, picNz, frameCells }}
 */
export function thicknessGrid(img, { widthMm = 100, pixelMm = 0.3, minThickness = 0.8, maxThickness = 3.2, gamma = 1, invert = false, smooth = 0, frameMm = 0 } = {}) {
  if (!(maxThickness > minThickness)) throw new Error('The thickest point must be thicker than the thinnest.');
  if (!(minThickness >= 0.4)) throw new Error('The thinnest point must be at least 0.4 mm, or light areas will have holes.');
  if (!(pixelMm > 0) || !(widthMm > 0)) throw new Error('Width and cell size must be positive.');
  const picNx = Math.max(2, Math.round(widthMm / pixelMm) + 1);
  const picNz = Math.max(2, Math.round(((picNx - 1) * img.height) / img.width) + 1);
  let b = resample(brightness(img), img.width, img.height, picNx, picNz);
  if (smooth > 0) b = boxBlur(b, picNx, picNz, Math.round(smooth));
  const f = Math.max(0, Math.round(frameMm / pixelMm));
  const nx = picNx + 2 * f, nz = picNz + 2 * f, t = new Float32Array(nx * nz).fill(maxThickness);
  for (let j = 0; j < picNz; j++) for (let i = 0; i < picNx; i++) {
    let v = Math.min(1, Math.max(0, b[j * picNx + i]));
    if (invert) v = 1 - v;
    v = Math.pow(v, gamma);
    t[(j + f) * nx + i + f] = maxThickness - v * (maxThickness - minThickness);   // dark -> thick
  }
  return { nx, nz, t, pixelMm, picNx, picNz, frameCells: f };
}

/**
 * The plate as a watertight mesh.
 * @param {object} o  as thicknessGrid, plus
 *  curve  how far the plate bends, in degrees (0 = flat; up to 270)
 * @returns {{ group: THREE.Group, info: object }}
 */
export function buildLithophane(img, o = {}) {
  const g = thicknessGrid(img, o);
  const { nx, nz, t, pixelMm: px } = g, curve = o.curve || 0;
  const minT = o.minThickness ?? 0.8, maxT = o.maxThickness ?? 3.2;
  if (curve < 0 || curve > 270) throw new Error('Curve must be between 0 and 270 degrees.');
  const tris = 4 * (nx - 1) * (nz - 1) + 4 * (nx + nz - 2);
  if (tris > MAX_TRIANGLES) throw new Error(`That is ${Math.round(tris).toLocaleString()} triangles, too many for the browser. Use a larger cell size or a smaller picture.`);

  const width = (nx - 1) * px, height = (nz - 1) * px, arc = (curve * Math.PI) / 180;
  const R = arc > 0 ? width / arc : Infinity;
  if (arc > 0 && R <= maxT * 1.5) throw new Error('The curve is too tight for this thickness: reduce the curve or make the plate wider.');

  // vertex layout: smooth face S(i,j) = j*nx+i, relief face T(i,j) = N + j*nx+i; j counts up from the bottom edge
  const N = nx * nz, pos = new Float32Array(N * 2 * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const s = j * nx + i, tt = t[(nz - 1 - j) * nx + i];          // grid row 0 is the top of the picture
    const z = j * px, along = i * px - width / 2;
    let sx, sy, rx, ry;
    if (arc > 0) {
      const th = along / R, sn = Math.sin(th), cs = Math.cos(th);
      sx = R * sn; sy = R * (1 - cs); rx = (R - tt) * sn; ry = R - (R - tt) * cs;
    } else { sx = rx = along; sy = 0; ry = tt; }
    pos.set([sx, sy, z], s * 3);
    pos.set([rx, ry, z], (N + s) * 3);
  }
  const idx = [];
  const S = (i, j) => j * nx + i, T = (i, j) => N + j * nx + i;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = S(i, j), b = S(i + 1, j), c = S(i + 1, j + 1), d = S(i, j + 1);
    idx.push(a, b, c, a, c, d);                                   // smooth face, normal -y
    idx.push(T(i, j), T(i + 1, j + 1), T(i + 1, j), T(i, j), T(i, j + 1), T(i + 1, j + 1));   // relief face, normal +y
  }
  for (let i = 0; i < nx - 1; i++) {
    idx.push(S(i, 0), T(i + 1, 0), S(i + 1, 0), S(i, 0), T(i, 0), T(i + 1, 0));                                       // bottom edge, -z
    idx.push(S(i, nz - 1), S(i + 1, nz - 1), T(i + 1, nz - 1), S(i, nz - 1), T(i + 1, nz - 1), T(i, nz - 1));         // top edge, +z
  }
  for (let j = 0; j < nz - 1; j++) {
    idx.push(S(0, j), T(0, j + 1), T(0, j), S(0, j), S(0, j + 1), T(0, j + 1));                                       // left edge
    idx.push(S(nx - 1, j), T(nx - 1, j), T(nx - 1, j + 1), S(nx - 1, j), T(nx - 1, j + 1), S(nx - 1, j + 1));         // right edge
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(N * 2 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: o.color || '#f3efe6', roughness: 0.9 }));
  mesh.name = 'lithophane';
  const group = new THREE.Group();
  group.add(mesh);

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const warnings = [];
  if (px < 0.2) warnings.push('Cells under 0.2 mm are finer than a 0.4 mm nozzle can print; the extra detail is lost and the file is just bigger.');
  if (maxT - minT < 1.2) warnings.push('Less than 1.2 mm between thinnest and thickest gives a flat, washed-out image. 2 mm or more shows more shading.');
  if (maxT > 4.5) warnings.push('Thicker than about 4.5 mm blocks most light, so dark areas turn black. Use a bright lamp or a thinner plate.');
  return {
    group,
    info: {
      width: bb.max.x - bb.min.x, depth: bb.max.y - bb.min.y, height, plateWidth: width,
      cols: nx, rows: nz, pictureCols: g.picNx, pictureRows: g.picNz, triangles: idx.length / 3,
      radius: arc > 0 ? R : null, minThickness: minT, maxThickness: maxT, warnings,
    },
    grid: g,
  };
}

/**
 * What the plate looks like with a lamp behind it: light falls off exponentially with thickness.
 * @returns {ImageData-like} { data, width, height } 0..255 RGBA, row 0 on top, ready for putImageData
 */
export function backlitPreview(grid, { minThickness, maxThickness, tint = [255, 244, 224] } = {}) {
  const { nx, nz, t } = grid, data = new Uint8ClampedArray(nx * nz * 4);
  const mu = Math.log(14) / (maxThickness - minThickness);          // the thickest part passes about 7 % of the light
  for (let p = 0; p < nx * nz; p++) {
    const k = Math.exp(-(t[p] - minThickness) * mu);
    data[p * 4] = tint[0] * k; data[p * 4 + 1] = tint[1] * k; data[p * 4 + 2] = tint[2] * k; data[p * 4 + 3] = 255;
  }
  return { data, width: nx, height: nz };
}
