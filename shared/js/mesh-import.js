// Copyright (c) 2025 cmutnik
// Read STL and 3MF files into plain parts: { name, color, positions: Float32Array, indices: Uint32Array }, in millimetres.
// No dependencies (3MF needs a DOMParser: the browser's, or jsdom's in tests).
//
// A 3MF keeps its structure: every mesh object (and every component of an assembly) becomes its own part, with its name
// and colour, placed by the build item's transform. A mesh whose triangles carry different colours is split into one part
// per colour, so nothing is merged into one lump. STL has no colour or parts and becomes a single part.
import { unzip } from './zip.js';
import { quantizeColors } from './palette.js';

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

/**
 * The painted state of one triangle from a slicer's `paint_color` / `mmu_segmentation` string: the filament number painted on it, 0 for
 * "not painted" (the part's own filament). The string is a subdivision tree the slicer wrote while painting (hex digits, read from the
 * end; two bits say how many sides were split, two the state, state 3 continues in the next digit). The state covering most of the
 * triangle wins, so colour borders follow the model's own triangles. Returns 0 for anything it cannot read.
 */
const paintCache = new Map();
export function paintState(str) {
  if (!str) return 0;
  const hit = paintCache.get(str);
  if (hit !== undefined) return hit;
  let state = 0;
  try {
    let pos = str.length - 1;
    const next = () => { const v = parseInt(str[pos--], 16); if (Number.isNaN(v)) throw new Error('bad digit'); return v; }, area = new Map();
    const node = frac => {
      const code = next(), sides = code & 3;
      if (sides === 0) { let st = (code >> 2) & 3; if (st === 3) st = next() + 3; area.set(st, (area.get(st) || 0) + frac); return; }
      for (let i = 0; i <= sides; i++) node(frac / (sides + 1));
    };
    node(1);
    if (pos !== -1) throw new Error('trailing digits');
    let best = 0, top = -1;
    for (const [st, a] of area) if (a > top + 1e-12) { top = a; best = st; }
    state = best;
  } catch { state = 0; }
  paintCache.set(str, state);
  return state;
}

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
      const verts = new Float32Array(vs.length * 3), tris = new Uint32Array(ts.length * 3), tpid = new Array(ts.length), tp1 = new Array(ts.length), tpaint = new Array(ts.length);
      vs.forEach((v, i) => { verts[i * 3] = +v.getAttribute('x'); verts[i * 3 + 1] = +v.getAttribute('y'); verts[i * 3 + 2] = +v.getAttribute('z'); });
      ts.forEach((t, i) => { tris[i * 3] = +t.getAttribute('v1'); tris[i * 3 + 1] = +t.getAttribute('v2'); tris[i * 3 + 2] = +t.getAttribute('v3'); tpid[i] = t.getAttribute('pid'); tp1[i] = t.getAttribute('p1'); tpaint[i] = t.getAttribute('paint_color') || attr(t, 'mmu_segmentation'); });
      obj.mesh = { verts, tris, tpid, tp1, tpaint };
    }
    const comps = kid(o, 'components');
    if (comps) obj.components = kids(comps, 'component').map(c => ({ id: c.getAttribute('objectid'), path: attr(c, 'path'), matrix: parseMatrix(c.getAttribute('transform')) }));
    out.objects.set(obj.id, obj);
  }
  const build = kid(root, 'build');
  if (build) out.build = kids(build, 'item').map(i => ({ id: i.getAttribute('objectid'), path: attr(i, 'path'), matrix: parseMatrix(i.getAttribute('transform')) }));
  return out;
}

/**
 * Filament slots from Metadata/model_settings.config (the layout export3MF writes, which Orca / Bambu / Prusa-family slicers use), and the
 * filament colours from the project settings: { byPart, byObject: Map(id -> slot), palette: ['#RRGGBB', ...] (index = slot - 1) }.
 * Slicers keep colour there, not in the model: an object only says "extruder 2", the project says what extruder 2 is loaded with.
 * Missing or unreadable config just means no slots or no palette.
 */
async function readSlots(zip, dec) {
  const out = { byPart: new Map(), byObject: new Map(), palette: [] };
  const name = 'Metadata/model_settings.config';
  if (zip.has(name)) {
    try {
      const root = parseXml(dec.decode(await zip.read(name)));
      const slot = el => { const m = kids(el, 'metadata').find(k => k.getAttribute('key') === 'extruder'); const n = m ? parseInt(m.getAttribute('value'), 10) : NaN; return n >= 1 ? n : null; };
      for (const o of kids(root, 'object')) {
        const s = slot(o);
        if (s) out.byObject.set(o.getAttribute('id'), s);
        for (const p of kids(o, 'part')) { const ps = slot(p); if (ps) out.byPart.set(p.getAttribute('id'), ps); }
      }
    } catch { /* an unreadable config only loses the slots */ }
  }
  try {
    if (zip.has('Metadata/project_settings.config')) {                           // Bambu Studio / OrcaSlicer: JSON
      const list = JSON.parse(dec.decode(await zip.read('Metadata/project_settings.config'))).filament_colour;
      if (Array.isArray(list)) out.palette = list.map(c => hexColor(String(c)));
    } else if (zip.has('Metadata/Slic3r_PE.config')) {                           // PrusaSlicer: "; filament_colour = #RRGGBB;#RRGGBB"
      const m = dec.decode(await zip.read('Metadata/Slic3r_PE.config')).match(/filament_colour\s*=\s*([^\r\n]+)/);
      if (m) out.palette = m[1].split(';').map(c => hexColor(c.trim().replace(/"/g, '')));
    }
  } catch { /* no palette: parts keep their slot numbers but no colour */ }
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
  const slots = await readSlots(zip, dec);
  const rootModel = await model(rootPath), parts = [];
  let triangles = 0;

  async function instantiate(file, id, matrix, inheritedName, depth, parentId = null) {
    if (depth > 16) throw new Error('This 3MF nests its objects too deeply.');
    const m = await model(file), obj = m.objects.get(id);
    if (!obj) throw new Error(`This 3MF refers to a missing object (${id}).`);
    if (obj.type === 'support' || obj.type === 'solidsupport') return;
    const name = obj.name || inheritedName || `Object ${id}`;
    if (obj.mesh) {
      const { verts, tris, tpid, tp1, tpaint } = obj.mesh;
      triangles += tris.length / 3;
      if (triangles > MAX_TRIANGLES) throw new Error(`This model has more than ${MAX_TRIANGLES.toLocaleString()} triangles, which is too much for the browser.`);
      const colorOf = t => {
        const pid = tpid[t] ?? obj.pid, p = tpid[t] != null ? tp1[t] : (obj.pindex ?? tp1[t]);
        return pid != null && p != null ? (m.colors.get(pid)?.[+p] ?? null) : null;
      };
      // a slicer's colour: the filament painted on the triangle, else the part's own filament (slot), looked up in the project's palette
      const ownSlot = slots.byPart.get(id) ?? slots.byObject.get(parentId) ?? slots.byObject.get(id) ?? null;
      const painted = tpaint.some(Boolean), slicerColours = painted || slots.palette.length > 0;
      const byColor = new Map();
      for (let t = 0; t < tris.length / 3; t++) {
        let key = colorOf(t);
        if (key == null && slicerColours) key = '@' + ((painted && paintState(tpaint[t])) || ownSlot || 1);
        if (!byColor.has(key)) byColor.set(key, []);
        byColor.get(key).push(t);
      }
      const flip = det3(matrix) < 0, x = new Float32Array(verts.length);
      for (let i = 0; i < verts.length; i += 3) {
        const a = verts[i], b = verts[i + 1], c = verts[i + 2];
        x[i] = a * matrix[0] + b * matrix[3] + c * matrix[6] + matrix[9];
        x[i + 1] = a * matrix[1] + b * matrix[4] + c * matrix[7] + matrix[10];
        x[i + 2] = a * matrix[2] + b * matrix[5] + c * matrix[8] + matrix[11];
      }
      const groupKey = `${file}#${id}#${parts.length}`;                           // the colour patches of one mesh share this, so they can be put back together
      for (const [key, list] of byColor) {
        const idx = new Uint32Array(list.length * 3);
        list.forEach((t, k) => { idx[k * 3] = tris[t * 3]; idx[k * 3 + 1] = tris[t * 3 + (flip ? 2 : 1)]; idx[k * 3 + 2] = tris[t * 3 + (flip ? 1 : 2)]; });
        const fromSlot = typeof key === 'string' && key[0] === '@' ? +key.slice(1) : null;
        const color = fromSlot ? slots.palette[fromSlot - 1] ?? null : key;
        const slot = fromSlot || (byColor.size === 1 ? ownSlot : null);        // colour-split pieces keep separate slots
        const label = color || (fromSlot ? `filament ${fromSlot}` : null);
        parts.push({ name: byColor.size > 1 && label ? `${name} (${label})` : name, color, positions: x, indices: idx, ...(slot ? { slot } : {}), group: groupKey });
      }
    }
    for (const c of obj.components) await instantiate(c.path || file, c.id, compose(c.matrix, matrix), obj.components.length === 1 ? name : '', depth + 1, id);
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
// ---------- OBJ ----------

const hex2 = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0').toUpperCase();
const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

/** An .mtl file -> Map(material name -> { color: '#RRGGBB' | null, texture: bool }). Only the diffuse colour (Kd) is used. */
export function parseMTL(text) {
  const materials = new Map();
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/), key = t[0].toLowerCase();
    if (key === 'newmtl') { cur = { color: null, texture: false }; materials.set(t.slice(1).join(' '), cur); }
    else if (!cur) continue;
    else if (key === 'kd' && t.length >= 4 && !t.slice(1, 4).some(v => Number.isNaN(+v))) cur.color = rgbHex(+t[1], +t[2], +t[3]);
    else if (key === 'map_kd') cur.texture = true;
  }
  return materials;
}

const MAX_OBJ_GROUPS = 32;
/**
 * Wavefront OBJ -> parts. One part per material, coloured from the .mtl text `mtl`. With no materials: one per group / object (up to 32),
 * else, for vertex colours (`v x y z r g b`, as AI-generated and scanned models have), the shades are reduced to `colors` colours and the
 * model is split by them (the pieces share a `group`, so they can be put back together), else a single part. Polygons are split into
 * triangles; negative indices work. The returned array has a `notes` list for the user (a missing .mtl, textures, a Y-up file), and
 * `painted: { colors }` when the colour was painted on the surface.
 */
export function parseOBJ(buffer, { mtl = null, name = 'Model', colors = 6 } = {}) {
  const text = new TextDecoder().decode(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  const pos = [], vcol = [], tris = [], mats = [], grps = [];                  // per triangle: corner ids (3 each), material, group
  let material = '', group = '', sawMaterial = false, hasColors = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.charCodeAt(0) === 35) continue;                           // blank, or a comment
    const t = line.split(/\s+/), key = t[0];
    if (key === 'v') {
      pos.push(+t[1], +t[2], +t[3]);
      if (t.length >= 7) { hasColors = true; vcol.push(+t[4], +t[5], +t[6]); } else vcol.push(NaN, NaN, NaN);
    } else if (key === 'usemtl') { material = t.slice(1).join(' '); sawMaterial = true; }
    else if (key === 'g' || key === 'o') group = t.slice(1).join(' ');
    else if (key === 'f' && t.length >= 4) {
      const n = pos.length / 3, ids = [];
      for (let i = 1; i < t.length; i++) { const v = parseInt(t[i], 10); ids.push(v < 0 ? n + v : v - 1); }
      if (ids.some(i => !(i >= 0 && i < n))) throw new Error('This OBJ has a face that points at a missing vertex.');
      for (let i = 1; i < ids.length - 1; i++) {                                // a polygon becomes a fan of triangles
        tris.push(ids[0], ids[i], ids[i + 1]); mats.push(material); grps.push(group);
        if (mats.length > MAX_TRIANGLES) throw new Error(`This model has more than ${MAX_TRIANGLES.toLocaleString()} triangles, the limit.`);
      }
    }
  }
  if (!mats.length || pos.some(Number.isNaN)) throw new Error('Could not read any triangles from this OBJ.');

  // what separates the parts: material, else group, else vertex colour, else nothing
  let top = 0;
  for (const v of vcol) if (v > top) top = v;
  const scale = hasColors && top > 1 ? 255 : 1;
  const cornerColor = id => (Number.isNaN(vcol[id * 3]) ? [1, 1, 1] : [vcol[id * 3] / scale, vcol[id * 3 + 1] / scale, vcol[id * 3 + 2] / scale]);
  const distinctGroups = new Set(grps).size;
  const mode = sawMaterial ? 'material' : distinctGroups > 1 && distinctGroups <= MAX_OBJ_GROUPS ? 'group' : hasColors ? 'color' : 'none';
  let painted = null;                                                           // { labels, palette } when colour is painted on the surface
  if (mode === 'color') {
    const rgb = new Float32Array(mats.length * 3);
    for (let t = 0; t < mats.length; t++) {                                     // each triangle's colour: the average of its corners
      const c = [0, 1, 2].map(k => cornerColor(tris[t * 3 + k]));
      for (let ch = 0; ch < 3; ch++) rgb[t * 3 + ch] = (c[0][ch] + c[1][ch] + c[2][ch]) / 3;
    }
    painted = quantizeColors(rgb, colors);
  }
  const labelOf = t => (mode === 'material' ? mats[t] : mode === 'group' ? grps[t] : mode === 'color' ? painted.palette[painted.labels[t]] : '');
  const groups = new Map();
  for (let t = 0; t < mats.length; t++) {
    const label = labelOf(t);
    let g = groups.get(label);
    if (!g) groups.set(label, g = []);
    for (let k = 0; k < 3; k++) { const id = tris[t * 3 + k]; g.push(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]); }
  }
  const materials = mtl ? parseMTL(mtl) : new Map(), notes = [], parts = [];
  for (const [label, soup] of groups) {
    const part = weldSoup(Float32Array.from(soup), mode === 'color' ? `Colour ${label}` : label || name);
    if (!part.indices.length) continue;
    part.color = mode === 'color' ? label : mode === 'material' ? materials.get(label)?.color || null : null;
    if (mode === 'color') part.group = 'obj-colours';                           // the colours are patches of one surface
    parts.push(part);
  }
  if (mode === 'color') {
    parts.painted = { colors: parts.length };
    notes.push(`This OBJ is coloured point by point, like a painted texture. Its shades are reduced to ${parts.length} colour${parts.length === 1 ? '' : 's'}, each its own part; together the parts make the whole model. Change "Colours to keep" to use more or fewer.`);
  }
  if (!parts.length) throw new Error('This OBJ has no usable triangles.');
  if (mode === 'material') {
    if (!mtl) notes.push('This OBJ uses materials, but their colours are in a separate .mtl file. Choose the .obj and the .mtl together to keep the colours.');
    else if ([...groups.keys()].some(m => m && !materials.has(m))) notes.push('Some materials in this OBJ are not described in the .mtl file you chose, so those parts have no colour.');
    if ([...groups.keys()].some(m => materials.get(m)?.texture)) notes.push('Some materials use image textures, which cannot be printed. Their plain colour is used; recolour those parts in the list.');
  }
  let ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) { ymin = Math.min(ymin, p.positions[i + 1]); ymax = Math.max(ymax, p.positions[i + 1]); zmin = Math.min(zmin, p.positions[i + 2]); zmax = Math.max(zmax, p.positions[i + 2]); }
  if (ymax - ymin > 1.2 * (zmax - zmin)) notes.push('OBJ files are often saved with Y up. If this model lies on its back or side, use the rotate buttons (X +90).');
  parts.notes = notes;
  return parts;
}

/** Choose the model file from a drop or picker (an .obj may come with its .mtl) and read it. Returns { file, parts, notes }. */
export async function readModelFiles(files, { colors = 6 } = {}) {
  const list = [...files], main = list.find(f => /\.(stl|3mf|obj)$/i.test(f.name));
  if (!main) throw new Error('Choose an .stl, .3mf or .obj file.');
  let mtl = null;
  if (/\.obj$/i.test(main.name)) {
    const mtls = list.filter(f => /\.mtl$/i.test(f.name));
    if (mtls.length) {
      const head = new TextDecoder().decode(new Uint8Array(await main.slice(0, 65536).arrayBuffer()));
      const wanted = (head.match(/^\s*mtllib\s+(.+?)\s*$/m) || [])[1]?.split(/[\\/]/).pop().toLowerCase();
      const pick = mtls.find(f => f.name.toLowerCase() === wanted) || mtls[0];
      mtl = await pick.text();
    }
  }
  const parts = await parseMesh(main.name, await main.arrayBuffer(), { mtl, colors });
  return { file: main, parts, notes: parts.notes || [], painted: parts.painted || null };
}

export async function parseMesh(filename, buffer, { mtl = null, colors = 6 } = {}) {
  const lower = filename.toLowerCase(), name = filename.replace(/\.[^.]+$/, '');
  if (lower.endsWith('.stl')) return [parseSTL(buffer, name)];
  if (lower.endsWith('.3mf')) return parse3MF(buffer);
  if (lower.endsWith('.obj')) return parseOBJ(buffer, { mtl, name, colors });
  throw new Error('Choose an .stl, .3mf or .obj file.');
}
