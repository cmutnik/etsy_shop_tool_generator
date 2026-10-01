// Copyright (c) 2025 cmutnik
// Stamp geometry. Units are millimetres.
//
// Coordinate system (matches the print orientation):
//   z = 0            stamp FACE (the surface that touches the ink pad / paper) -> sits on the print bed
//   z = 0..relief    raised artwork / border
//   z = relief..+base  base plate
//   above the base   handle
// X/Y are authored so the artwork reads correctly when viewed from +z. The face is
// viewed from -z, so it appears mirrored on the stamp and reads correctly when stamped.
import * as THREE from 'three';
import { outlineShape, extrudeShapes, groupsToShapes, mapGroups } from '../../shared/js/geometry2d.js';
import { layoutText } from '../../shared/js/text-layout.js';

const OVERLAP = 0.2; // parts interpenetrate by this much so slicers union them instead of leaving coplanar faces
const GAP = 1.5;     // space between logo and text in combined layouts

/** Split the available area into logo/text regions. Each region: { cx, cy, w, h }. */
export function splitRegions(mode, w, h, share) {
  const whole = { cx: 0, cy: 0, w, h };
  if (mode === 'text') return { text: whole };
  if (mode === 'logo') return { logo: whole };
  if (mode === 'logo-left') {
    const lw = Math.max(w * share - GAP / 2, 1), tw = Math.max(w * (1 - share) - GAP / 2, 1);
    return { logo: { cx: -w / 2 + lw / 2, cy: 0, w: lw, h }, text: { cx: w / 2 - tw / 2, cy: 0, w: tw, h } };
  }
  const lh = Math.max(h * share - GAP / 2, 1), th = Math.max(h * (1 - share) - GAP / 2, 1); // logo-above
  return { logo: { cx: 0, cy: h / 2 - lh / 2, w, h: lh }, text: { cx: 0, cy: -h / 2 + th / 2, w, h: th } };
}

/** Scale (uniformly, only if fit) and move a centred layout into a region. */
function place(layout, region, fit) {
  const scale = fit ? Math.min(region.w / layout.width, region.h / layout.height) : 1;
  return {
    groups: mapGroups(layout.groups, (x, y) => [x * scale + region.cx, y * scale + region.cy]),
    scale,
    overflow: Math.min(region.w / layout.width, region.h / layout.height) < 1,
  };
}

/**
 * @param {object} o
 *  artMode ('text'|'logo'|'logo-above'|'logo-left'), logo ({groups,width,height}|null), logoShare (0-1)
 *  font, text, fontSize, lineSpacing, autoFit, textPadding
 *  shape ('rect'|'ellipse'), width, height, cornerRadius
 *  border (bool), borderWidth, margin (gap between outer edge and relief)
 *  relief, baseThickness
 *  handle ('none'|'knob'|'bar'), handleSize, handleHeight, marker (bool)
 * @returns {{ group: THREE.Group, info: object }}
 */
export function buildStamp(o) {
  const group = new THREE.Group();
  const relief = o.relief, base = o.baseThickness;
  const warnings = [];
  const parts = { relief: [], base: [], handle: [] };

  // base plate: sits on top of the relief
  parts.base.push(extrudeShapes([outlineShape(o.shape, o.width, o.height, o.cornerRadius)], base + OVERLAP, relief - OVERLAP));

  // border ring
  const inset = o.margin;
  let bw = 0;
  if (o.border) {
    bw = o.borderWidth;
    const outer = outlineShape(o.shape, o.width - 2 * inset, o.height - 2 * inset, o.cornerRadius - inset);
    const inner = outlineShape(o.shape, o.width - 2 * (inset + bw), o.height - 2 * (inset + bw), o.cornerRadius - inset - bw);
    outer.holes.push(new THREE.Path(inner.getPoints(48)));
    parts.relief.push(extrudeShapes([outer], relief + OVERLAP));
    if (bw < 0.8) warnings.push(`Border is ${bw.toFixed(2)} mm wide - thinner than 2 nozzle widths (0.8 mm), it may print poorly.`);
  }

  // artwork (text and/or logo)
  const wantText = o.artMode !== 'logo', wantLogo = o.artMode !== 'text';
  const edge = inset + (o.border ? bw : 0) + o.textPadding;
  let availW = o.width - 2 * edge, availH = o.height - 2 * edge;
  if (o.shape === 'ellipse') { availW *= Math.SQRT1_2; availH *= Math.SQRT1_2; }
  else { const s = o.cornerRadius * (1 - Math.SQRT1_2) * 2; availW -= s; availH -= s; }
  availW = Math.max(availW, 1); availH = Math.max(availH, 1);
  const regions = splitRegions(o.artMode, availW, availH, o.logoShare);

  const art = [];
  let textInfo = null;
  if (wantLogo) {
    if (o.logo && o.logo.groups.length) art.push(...place(o.logo, regions.logo, true).groups);
    else warnings.push('Upload a logo (SVG, PNG or JPG) to use this layout.');
  }
  if (wantText && o.font && o.text.trim()) {
    const lay = layoutText(o.font, o.text, o.fontSize, o.lineSpacing);
    if (lay.groups.length) {
      const p = place(lay, regions.text, o.autoFit);
      art.push(...p.groups);
      if (!o.autoFit && p.overflow) warnings.push('Text is larger than its area - reduce the font size or enable Auto-fit.');
      const effSize = o.fontSize * p.scale;
      textInfo = { fontSizeMm: effSize, scale: p.scale };
      if (effSize < 4) warnings.push(`Effective font size is ${effSize.toFixed(1)} mm - fine details may be lost at a 0.4 mm nozzle. Use a bolder font, a larger stamp, or less text.`);
    }
  }
  if (art.length) parts.relief.push(extrudeShapes(groupsToShapes(art), relief + OVERLAP));
  if (!parts.relief.length) warnings.push('Nothing to stamp yet - enter some text, add a logo, or enable the border.');

  // handle
  const top = relief + base;
  if (o.handle !== 'none') {
    const hs = o.handleSize;
    let hShape;
    if (o.handle === 'knob') hShape = outlineShape('ellipse', hs, hs);
    else hShape = outlineShape('rect', Math.max(5, Math.min(o.width * 0.7, o.width - 6)), hs, Math.min(hs / 2, 4));
    parts.handle.push(extrudeShapes([hShape], o.handleHeight + OVERLAP, top - OVERLAP));
    if (o.handle === 'knob' && hs > Math.min(o.width, o.height)) warnings.push('Handle is wider than the stamp base.');
  }

  // orientation marker: small arrow on the top (+y) edge of the base, pointing "up"
  if (o.marker) {
    const edgeY = o.height / 2, m = 2.2;
    const t = new THREE.Shape();
    t.moveTo(-m, edgeY - 2.4 - m * 0.6); t.lineTo(m, edgeY - 2.4 - m * 0.6); t.lineTo(0, edgeY - 2.4 + m * 0.6); t.closePath();
    parts.handle.push(extrudeShapes([t], 0.8 + OVERLAP, top - OVERLAP));
  }

  const mats = {
    relief: new THREE.MeshStandardMaterial({ color: 0xe8743b, roughness: 0.55 }),
    base: new THREE.MeshStandardMaterial({ color: 0xb9c0c9, roughness: 0.7 }),
    handle: new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.7 }),
  };
  for (const [k, geos] of Object.entries(parts)) {
    for (const g of geos) {
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mats[k]);
      m.name = k;
      group.add(m);
    }
  }

  let tris = 0;
  group.traverse(c => { if (c.isMesh) tris += c.geometry.attributes.position.count / 3; });
  const height = top + (o.handle !== 'none' ? o.handleHeight : 0);
  return { group, info: { width: o.width, depth: o.height, height, triangles: tris, warnings, textInfo } };
}
