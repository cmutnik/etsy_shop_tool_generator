// Copyright (c) 2025 cmutnik
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

const cacheDir = path.join(import.meta.dirname, '..', 'node_modules', '.font-cache');

/** Download (once) and parse a Fontsource WOFF. Returns null if offline and not cached. */
export async function testFont(id = 'roboto', weight = 700) {
  const file = path.join(cacheDir, `${id}-${weight}.woff`);
  if (!fs.existsSync(file)) {
    try {
      const res = await fetch(`https://cdn.jsdelivr.net/npm/@fontsource/${id}/files/${id}-latin-${weight}-normal.woff`);
      if (!res.ok) return null;
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch { return null; }
  }
  const b = fs.readFileSync(file);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export const baseStamp = {
  artMode: 'text', logo: null, logoShare: 0.55,
  text: 'Handmade\nwith love', fontSize: 8, lineSpacing: 1.25, autoFit: true, textPadding: 1,
  shape: 'rect', width: 50, height: 30, cornerRadius: 3, border: true, borderWidth: 1.2, margin: 1.5,
  relief: 1.5, baseThickness: 3, handle: 'knob', handleSize: 18, handleHeight: 12, marker: true,
};

/**
 * Closed and consistently oriented: every undirected edge is shared by exactly two triangles that traverse it
 * in opposite directions, and the signed volume is positive (outward-facing). Handles indexed geometry.
 */
export function assertWatertight(mesh, assert) {
  const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index, ids = new Map(), edges = new Map();
  const id = i => { const k = [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => v.toFixed(4)).join(); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const count = idx ? idx.count : pos.count;
  const at = i => (idx ? idx.getX(i) : i);
  let volume = 0;
  for (let t = 0; t < count; t += 3) {
    const p = [0, 1, 2].map(j => { const i = at(t + j); return [pos.getX(i), pos.getY(i), pos.getZ(i)]; });
    volume += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    const v = [id(at(t)), id(at(t + 1)), id(at(t + 2))];
    if (new Set(v).size < 3) continue;
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a;
      const r = edges.get(k) || { n: 0, dir: 0 };
      r.n++; r.dir += a < b ? 1 : -1;
      edges.set(k, r);
    }
  }
  const open = [...edges.values()].filter(r => r.n !== 2).length;
  const flipped = [...edges.values()].filter(r => r.n === 2 && r.dir !== 0).length;
  assert.equal(open, 0, `${mesh.name}: ${open} non-manifold edges of ${edges.size}`);
  assert.equal(flipped, 0, `${mesh.name}: ${flipped} edges with inconsistent triangle winding`);
  assert.ok(volume > 0, `${mesh.name}: signed volume ${volume} (faces point inward)`);
}
