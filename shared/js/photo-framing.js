// Copyright (c) 2025 cmutnik
// Camera framing for product photos. Pure maths (no three.js), so it is tested in Node.
// World is z up, the model sits on z = 0. Azimuth 0 looks at the model from the front (from -y); 90 from the right (+x).

export const VIEWS = [
  { id: 'hero', label: 'Hero (3/4 view)', azimuth: 35, elevation: 22, zoom: 1 },
  { id: 'front', label: 'Front', azimuth: 0, elevation: 8, zoom: 1 },
  { id: 'side', label: 'Side', azimuth: 90, elevation: 8, zoom: 1 },
  { id: 'back', label: 'Back', azimuth: 180, elevation: 12, zoom: 1 },
  { id: 'top', label: 'From above', azimuth: 0, elevation: 78, zoom: 1 },
  { id: 'closeup', label: 'Close-up', azimuth: -28, elevation: 18, zoom: 1.7 },
];
export const view = id => VIEWS.find(v => v.id === id);

/** Listing photo sizes. Etsy asks for large photos; 2000 px wide is a safe minimum. */
export const SIZES = [
  { id: '4:3-2000', label: '4:3 landscape, 2000 x 1500', width: 2000, height: 1500 },
  { id: '4:3-3000', label: '4:3 landscape, 3000 x 2250', width: 3000, height: 2250 },
  { id: '1:1-2000', label: 'Square, 2000 x 2000', width: 2000, height: 2000 },
  { id: '5:4-2000', label: '5:4, 2000 x 1600', width: 2000, height: 1600 },
  { id: '3:4-1500', label: '3:4 portrait, 1500 x 2000', width: 1500, height: 2000 },
];
export const size = id => SIZES.find(s => s.id === id);

/** Unit vector from the target towards the camera. */
export function direction(azimuth, elevation) {
  const az = (azimuth * Math.PI) / 180, el = (elevation * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
}

/**
 * Where to put the camera so the model's bounding box fills the frame.
 * @param {{ min: number[], max: number[] }} box
 * @param {{ azimuth, elevation, fov (vertical, degrees), aspect (width / height), margin (1 = touching the edge; 1.1 leaves a little air), zoom (>1 crops in) }} o
 * @returns {{ position: number[], target: number[], distance: number }}
 */
export function frameBox(box, { azimuth = 35, elevation = 22, fov = 30, aspect = 4 / 3, margin = 1.12, zoom = 1 } = {}) {
  const target = box.min.map((v, k) => (v + box.max[k]) / 2);
  const dir = direction(azimuth, elevation);
  const right = [Math.cos((azimuth * Math.PI) / 180), Math.sin((azimuth * Math.PI) / 180), 0];          // camera's right-hand side
  const up = [dir[1] * right[2] - dir[2] * right[1], dir[2] * right[0] - dir[0] * right[2], dir[0] * right[1] - dir[1] * right[0]];
  // dir x right = the camera's up when dir points at the camera: check by sign below
  const upN = up[2] < 0 ? up.map(v => -v) : up;
  const tanV = Math.tan((fov * Math.PI) / 360), tanH = tanV * aspect, m = margin / zoom;     // zoom is just a tighter margin
  let d = 0;
  for (let i = 0; i < 8; i++) {
    const p = [0, 1, 2].map(k => ((i >> k) & 1 ? box.max[k] : box.min[k]) - target[k]);
    const x = Math.abs(p[0] * right[0] + p[1] * right[1] + p[2] * right[2]), y = Math.abs(p[0] * upN[0] + p[1] * upN[1] + p[2] * upN[2]);
    const z = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2];                                              // towards the camera
    d = Math.max(d, z + (x * m) / tanH, z + (y * m) / tanV);
  }
  d = Math.max(d, 1e-3);
  return { position: target.map((v, k) => v + dir[k] * d), target, distance: d };
}

/** The same box projected through the framed camera: the extents as fractions of the half-frame (1 = touching the edge). Used to test framing. */
export function project(box, cam, { fov = 30, aspect = 4 / 3 } = {}) {
  const f = cam.target.map((v, k) => v - cam.position[k]), len = Math.hypot(...f), fwd = f.map(v => v / len);
  const right0 = [fwd[1], -fwd[0], 0], rl = Math.hypot(right0[0], right0[1]) || 1, right = right0.map(v => v / rl);
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const tanV = Math.tan((fov * Math.PI) / 360), tanH = tanV * aspect;
  let mx = 0, my = 0;
  for (let i = 0; i < 8; i++) {
    const p = [0, 1, 2].map(k => ((i >> k) & 1 ? box.max[k] : box.min[k]) - cam.position[k]);
    const depth = p[0] * fwd[0] + p[1] * fwd[1] + p[2] * fwd[2];
    mx = Math.max(mx, Math.abs((p[0] * right[0] + p[1] * right[1] + p[2] * right[2]) / depth) / tanH);
    my = Math.max(my, Math.abs((p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) / depth) / tanV);
  }
  return { x: mx, y: my };
}

/** Backgrounds: a flat colour, or a soft gradient from a lighter top to the colour at the bottom. */
export const BACKGROUNDS = [
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'soft-grey', label: 'Soft grey', color: '#e6e6e6' },
  { id: 'warm', label: 'Warm cream', color: '#f3ead9' },
  { id: 'sage', label: 'Sage', color: '#cfd9c8' },
  { id: 'blush', label: 'Blush', color: '#f1d9d5' },
  { id: 'slate', label: 'Slate (dark)', color: '#2f343b' },
  { id: 'custom', label: 'Custom colour', color: null },
  { id: 'transparent', label: 'Transparent (PNG)', color: null },
];

export const FINISHES = [
  { id: 'matte', label: 'Matte plastic', roughness: 0.68, metalness: 0 },
  { id: 'satin', label: 'Satin plastic', roughness: 0.4, metalness: 0 },
  { id: 'glossy', label: 'Glossy', roughness: 0.16, metalness: 0 },
  { id: 'silk', label: 'Silk / metallic', roughness: 0.3, metalness: 0.75 },
];
