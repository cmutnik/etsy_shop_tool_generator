// Copyright (c) 2025 cmutnik
// Mesh export: binary STL and 3MF (a zip of XML). Meshes are exported in the object's own coordinates,
// so a tool's model should already be oriented the way it should print (z up, on the bed at z = 0).
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

export function exportSTL(object) {
  const data = new STLExporter().parse(object, { binary: true });
  return new Blob([data], { type: 'model/stl' });
}

/** Collect every mesh under `object` into one indexed triangle list (vertices welded at 1e-4 mm). */
export function collectMesh(object) {
  object.updateMatrixWorld(true);
  const verts = [], tris = [], triMat = [], palette = [], index = new Map();
  const v = { x: 0, y: 0, z: 0 };
  object.traverse(m => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position;
    const ids = new Array(pos.count);
    const e = m.matrixWorld.elements;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      v.x = e[0] * x + e[4] * y + e[8] * z + e[12];
      v.y = e[1] * x + e[5] * y + e[9] * z + e[13];
      v.z = e[2] * x + e[6] * y + e[10] * z + e[14];
      const key = v.x.toFixed(4) + ',' + v.y.toFixed(4) + ',' + v.z.toFixed(4);
      let id = index.get(key);
      if (id === undefined) { id = verts.length / 3; verts.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)); index.set(key, id); }
      ids[i] = id;
    }
    const hex = m.material && m.material.color ? '#' + m.material.color.getHexString().toUpperCase() : null;
    let mi = palette.indexOf(hex);
    if (mi < 0) { palette.push(hex); mi = palette.length - 1; }
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const a = ids[idx ? idx.getX(i) : i], b = ids[idx ? idx.getX(i + 1) : i + 1], c = ids[idx ? idx.getX(i + 2) : i + 2];
      if (a !== b && b !== c && a !== c) { tris.push(a, b, c); triMat.push(mi); } // drop degenerate triangles
    }
  });
  return { verts, tris, triMat, palette };
}

/**
 * @param {{ title?: string, colors?: boolean }} opts  colors: tag each triangle with its mesh material's colour
 *  (3MF core "basematerials"). Slicers that read it show the parts in colour; others ignore it.
 */
export function export3MF(object, { title = 'model', colors = false } = {}) {
  const { verts, tris, triMat, palette } = collectMesh(object);
  const useColors = colors && palette.every(Boolean);
  const parts = [];
  for (let i = 0; i < verts.length; i += 3) parts.push(`<vertex x="${verts[i]}" y="${verts[i + 1]}" z="${verts[i + 2]}"/>`);
  const vertexXml = parts.join('');
  const triParts = [];
  for (let i = 0; i < tris.length; i += 3) {
    triParts.push(`<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"${useColors ? ` pid="2" p1="${triMat[i / 3]}"` : ''}/>`);
  }
  const materialsXml = useColors
    ? `<basematerials id="2">${palette.map((c, i) => `<base name="Color ${i + 1}" displaycolor="${c}FF"/>`).join('')}</basematerials>`
    : '';
  const esc = s => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">Etsy Shop Tools</metadata>
<resources>${materialsXml}<object id="1" name="${esc(title)}" type="model"${useColors ? ' pid="2" pindex="0"' : ''}><mesh><vertices>${vertexXml}</vertices><triangles>${triParts.join('')}</triangles></mesh></object></resources>
<build><item objectid="1"/></build>
</model>`;
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
    ['3D/3dmodel.model', model],
  ];
  return new Blob([zipStore(files)], { type: 'model/3mf' });
}

// ---- minimal zip writer (stored, no compression) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {[string, string | Uint8Array][]} files */
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameB = enc.encode(name), data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); // stored, 1980-01-01
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameB, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameB.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

export function downloadBlob(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
