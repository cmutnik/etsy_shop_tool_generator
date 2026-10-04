// Copyright (c) 2025 cmutnik
// Read STL and 3MF files into plain parts: { name, color, positions: Float32Array, indices: Uint32Array }, in millimetres.
// No dependencies (3MF needs a DOMParser: the browser's, or jsdom's in tests).
//
// A 3MF keeps its structure: every mesh object (and every component of an assembly) becomes its own part, with its name
// and colour, placed by the build item's transform. A mesh whose triangles carry different colours is split into one part
// per colour, so nothing is merged into one lump. STL has no colour or parts and becomes a single part.
import { unzip } from './zip.js';

const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 };
export const MAX_TRIANGLES = 3_000_000;

/** Turn a triangle soup (flat x,y,z per corner) into an indexed part, welding corners that coincide to 1e-4 mm and dropping degenerate triangles. */
export function weldSoup(soup, name = 'Model') {
  const ids = new Map(), verts = [], idx = [];
  const corner = i => {
    const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2];
    const key = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
    let id = ids.get(key);
    if (id === undefined) { id = verts.length / 3; ids.set(key, id); verts.push(x, y, z); }
    return id;
  };
  for (let t = 0; t < soup.length / 9; t++) {
    const a = corner(t * 3), b = corner(t * 3 + 1), c = corner(t * 3 + 2);
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { name, color: null, positions: Float32Array.from(verts), indices: Uint32Array.from(idx) };
}

/** Binary or ASCII STL -> one part. */
export function parseSTL(buffer, name = 'Model') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let soup;
  const n = bytes.length >= 84 ? dv.getUint32(80, true) : -1;
  if (n >= 0 && 84 + n * 50 === bytes.length) {                                // binary: 80-byte header, count, 50 bytes per facet
    if (n > MAX_TRIANGLES) throw new Error(`This model has ${n.toLocaleString()} triangles; the limit is ${MAX_TRIANGLES.toLocaleString()}.`);
    soup = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) soup[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
  } else {
    const text = new TextDecoder().decode(bytes), out = [];
    if (!/^\s*solid/i.test(text)) throw new Error('This does not look like an STL file.');
    for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) out.push(+m[1], +m[2], +m[3]);
    if (!out.length || out.length % 9 || out.some(Number.isNaN)) throw new Error('Could not read the triangles in this ASCII STL.');
    soup = Float32Array.from(out);
  }
  const part = weldSoup(soup, name);
  if (!part.indices.length) throw new Error('This STL has no triangles.');
  return part;
}

// ---------- 3MF ----------

const kids = (el, name) => Array.from(el.children).filter(c => c.localName === name);
const kid = (el, name) => kids(el, name)[0] || null;
function attr(el, name) {                                                       // by local name, so "p:path" and "path" both match
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}
function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The 3MF model file is not valid XML.');
  return doc.documentElement;
}
const hexColor = s => (s && /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s) ? '#' + s.replace('#', '').slice(0, 6).toUpperCase() : null);

// 3MF matrices are 12 numbers, row-vector convention: [x y z 1] * M
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseMatrix = s => { const m = s ? s.trim().split(/\s+/).map(Number) : null; return m && m.length === 12 && !m.some(Number.isNaN) ? m : IDENTITY; };
function compose(a, b) {                                                        // apply a, then b
  const r = new Array(12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = (i < 3 ? a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j] : a[9] * b[j] + a[10] * b[3 + j] + a[11] * b[6 + j] + b[9 + j]);
  }
  return r;
}
const det3 = m => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

function readModel(text) {
  const root = parseXml(text), res = kid(root, 'resources');
  const out = { unit: UNIT_MM[root.getAttribute('unit') || 'millimeter'] ?? 1, objects: new Map(), colors: new Map(), build: [] };
  if (!res) return out;
  for (const g of [...kids(res, 'basematerials'), ...kids(res, 'colorgroup')]) {
    const list = kids(g, g.localName === 'basematerials' ? 'base' : 'color').map(c => hexColor(c.getAttribute('displaycolor') || c.getAttribute('color')));
    out.colors.set(g.getAttribute('id'), list);
  }
  for (const o of kids(res, 'object')) {
    const obj = { id: o.getAttribute('id'), name: o.getAttribute('name') || '', type: o.getAttribute('type') || 'model', pid: o.getAttribute('pid'), pindex: o.getAttribute('pindex'), mesh: null, components: [] };
    const mesh = kid(o, 'mesh');
    if (mesh) {
      const vs = kids(kid(mesh, 'vertices') || mesh, 'vertex'), ts = kids(kid(mesh, 'triangles') || mesh, 'triangle');
      const verts = new Float32Array(vs.length * 3), tris = new Uint32Array(ts.length * 3), tpid = new Array(ts.length), tp1 = new Array(ts.length);
      vs.forEach((v, i) => { verts[i * 3] = +v.getAttribute('x'); verts[i * 3 + 1] = +v.getAttribute('y'); verts[i * 3 + 2] = +v.getAttribute('z'); });
      ts.forEach((t, i) => { tris[i * 3] = +t.getAttribute('v1'); tris[i * 3 + 1] = +t.getAttribute('v2'); tris[i * 3 + 2] = +t.getAttribute('v3'); tpid[i] = t.getAttribute('pid'); tp1[i] = t.getAttribute('p1'); });
      obj.mesh = { verts, tris, tpid, tp1 };
    }
    const comps = kid(o, 'components');
    if (comps) obj.components = kids(comps, 'component').map(c => ({ id: c.getAttribute('objectid'), path: attr(c, 'path'), matrix: parseMatrix(c.getAttribute('transform')) }));
    out.objects.set(obj.id, obj);
  }
  const build = kid(root, 'build');
  if (build) out.build = kids(build, 'item').map(i => ({ id: i.getAttribute('objectid'), path: attr(i, 'path'), matrix: parseMatrix(i.getAttribute('transform')) }));
  return out;
}

/** 3MF -> parts (async: the package is deflated). */
export async function parse3MF(buffer) {
  const zip = unzip(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)), dec = new TextDecoder();
  let rootPath = '3D/3dmodel.model';
  if (zip.has('_rels/.rels')) {
    const m = dec.decode(await zip.read('_rels/.rels')).match(/Target="([^"]+)"[^>]*Type="[^"]*3dmodel"|Type="[^"]*3dmodel"[^>]*Target="([^"]+)"/);
    if (m) rootPath = (m[1] || m[2]).replace(/^\//, '');
  }
  if (!zip.has(rootPath)) throw new Error('This 3MF has no model file.');

  const models = new Map();
  const model = async path => {
    path = path.replace(/^\//, '');
    if (!models.has(path)) {
      if (!zip.has(path)) throw new Error(`This 3MF refers to a missing file: ${path}.`);
      models.set(path, readModel(dec.decode(await zip.read(path))));
    }
    return models.get(path);
  };
  const rootModel = await model(rootPath), parts = [];
  let triangles = 0;

  async function instantiate(file, id, matrix, inheritedName, depth) {
    if (depth > 16) throw new Error('This 3MF nests its objects too deeply.');
    const m = await model(file), obj = m.objects.get(id);
    if (!obj) throw new Error(`This 3MF refers to a missing object (${id}).`);
    if (obj.type === 'support' || obj.type === 'solidsupport') return;
    const name = obj.name || inheritedName || `Object ${id}`;
    if (obj.mesh) {
      const { verts, tris, tpid, tp1 } = obj.mesh;
      triangles += tris.length / 3;
      if (triangles > MAX_TRIANGLES) throw new Error(`This model has more than ${MAX_TRIANGLES.toLocaleString()} triangles, which is too much for the browser.`);
      const colorOf = t => {
        const pid = tpid[t] ?? obj.pid, p = tpid[t] != null ? tp1[t] : (obj.pindex ?? tp1[t]);
        return pid != null && p != null ? (m.colors.get(pid)?.[+p] ?? null) : null;
      };
      const byColor = new Map();
      for (let t = 0; t < tris.length / 3; t++) {
        const c = colorOf(t);
        if (!byColor.has(c)) byColor.set(c, []);
        byColor.get(c).push(t);
      }
      const flip = det3(matrix) < 0, x = new Float32Array(verts.length);
      for (let i = 0; i < verts.length; i += 3) {
        const a = verts[i], b = verts[i + 1], c = verts[i + 2];
        x[i] = a * matrix[0] + b * matrix[3] + c * matrix[6] + matrix[9];
        x[i + 1] = a * matrix[1] + b * matrix[4] + c * matrix[7] + matrix[10];
        x[i + 2] = a * matrix[2] + b * matrix[5] + c * matrix[8] + matrix[11];
      }
      for (const [color, list] of byColor) {
        const idx = new Uint32Array(list.length * 3);
        list.forEach((t, k) => { idx[k * 3] = tris[t * 3]; idx[k * 3 + 1] = tris[t * 3 + (flip ? 2 : 1)]; idx[k * 3 + 2] = tris[t * 3 + (flip ? 1 : 2)]; });
        parts.push({ name: byColor.size > 1 && color ? `${name} (${color})` : name, color, positions: x, indices: idx });
      }
    }
    for (const c of obj.components) await instantiate(c.path || file, c.id, compose(c.matrix, matrix), obj.components.length === 1 ? name : '', depth + 1);
  }

  const items = rootModel.build.length ? rootModel.build : [...rootModel.objects.values()].map(o => ({ id: o.id, path: null, matrix: IDENTITY }));
  for (const it of items) await instantiate(it.path || rootPath, it.id, it.matrix, '', 0);
  if (!parts.length) throw new Error('This 3MF contains no printable mesh.');

  const k = rootModel.unit;                                                     // to millimetres
  const seen = new Set();
  for (const p of parts) {
    if (!seen.has(p.positions)) { seen.add(p.positions); if (k !== 1) for (let i = 0; i < p.positions.length; i++) p.positions[i] *= k; }
    p.positions = compactVertices(p);
  }
  return parts;
}

/** Keep only the vertices a part's triangles use (colour splits share their object's vertex list), renumbering the indices. */
function compactVertices(part) {
  const map = new Map(), pos = [];
  const idx = part.indices.map(v => {
    let n = map.get(v);
    if (n === undefined) { n = map.size; map.set(v, n); pos.push(part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]); }
    return n;
  });
  part.indices = idx;
  return Float32Array.from(pos);
}

/** Pick the reader from the file name. Returns parts. */
export async function parseMesh(filename, buffer) {
  const lower = filename.toLowerCase(), name = filename.replace(/\.[^.]+$/, '');
  if (lower.endsWith('.stl')) return [parseSTL(buffer, name)];
  if (lower.endsWith('.3mf')) return parse3MF(buffer);
  throw new Error('Choose an .stl or .3mf file.');
}
