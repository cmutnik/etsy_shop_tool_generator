// Copyright (c) 2025 cmutnik
// Mesh export: binary STL and 3MF (a zip of XML). Meshes are exported in the object's own coordinates,
// so a tool's model should already be oriented the way it should print (z up, on the bed at z = 0).
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { downloadBlob } from './download.js';
import { zipStore, crc32 } from './zip.js';

export { downloadBlob, zipStore, crc32 }; // re-exported so existing imports keep working

export function exportSTL(object) {
  const data = new STLExporter().parse(object, { binary: true });
  return new Blob([data], { type: 'model/stl' });
}

/** Collect every mesh under `object` into one indexed triangle list (vertices welded at 1e-4 mm). */
export function collectMesh(object) {
  object.updateMatrixWorld(true);
  const verts = [], tris = [], triMat = [], triName = [], palette = [], index = new Map();
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
      if (a !== b && b !== c && a !== c) { tris.push(a, b, c); triMat.push(mi); triName.push(m.name); } // drop degenerate triangles
    }
  });
  return { verts, tris, triMat, triName, palette };
}

const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"';
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

/**
 * @param {object} opts
 *  title
 *  parts  optional multi-colour split: [{ name, label, names? }] in filament-slot order (first = slot 1). Meshes are
 *         grouped by `mesh.name` (or any of `names`, to merge several meshes into one part); each group becomes its
 *         own 3MF part, coloured from the material of its first mesh.
 *
 * Multi-colour is written the way Bambu Studio / OrcaSlicer / PrusaSlicer-family slicers need it: one parent
 * object made of one mesh object per part, plus Metadata/model_settings.config assigning each part to a
 * filament slot. These slicers ignore per-triangle colours, so standard basematerials/colorgroup tags are
 * written only as hints for other viewers. The actual colour that prints is whatever filament is loaded in
 * that slot. (Same layout as invite2svg's mesh_to_3mf_bytes, which is verified in Orca.)
 */
export function export3MF(object, { title = 'model', parts = null } = {}) {
  const { verts, tris, triMat, triName, palette } = collectMesh(object);
  const vertexXml = ids => ids.map(i => `<vertex x="${verts[i * 3]}" y="${verts[i * 3 + 1]}" z="${verts[i * 3 + 2]}"/>`).join('');
  const files = [['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', RELS]];
  let model;

  if (!parts) {
    const triangles = [];
    for (let i = 0; i < tris.length; i += 3) triangles.push(`<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`);
    const all = Array.from({ length: verts.length / 3 }, (_, i) => i);
    model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">Etsy Shop Tools</metadata>
<resources><object id="1" name="${esc(title)}" type="model"><mesh><vertices>${vertexXml(all)}</vertices><triangles>${triangles.join('')}</triangles></mesh></object></resources>
<build><item objectid="1"/></build>
</model>`;
  } else {
    const namesOf = part => part.names || [part.name];
    const colorOf = part => {
      const t = triName.findIndex(n => namesOf(part).includes(n));
      return t < 0 ? '#808080' : palette[triMat[t]] || '#808080';
    };
    const k = parts.length;
    const BASE_ID = 1, COLOR_ID = 2, firstPart = 3, parentId = firstPart + k;
    const hex = c => c.toUpperCase() + 'FF';
    let objects = '', settings = '';
    parts.forEach((part, pi) => {
      // this part's triangles, with vertices re-indexed to a compact local list
      const local = new Map(), ids = [], tri = [];
      for (let t = 0; t < tris.length / 3; t++) {
        if (!namesOf(part).includes(triName[t])) continue;
        const idx = [0, 1, 2].map(j => {
          const g = tris[t * 3 + j];
          if (!local.has(g)) { local.set(g, ids.length); ids.push(g); }
          return local.get(g);
        });
        tri.push(`<triangle v1="${idx[0]}" v2="${idx[1]}" v3="${idx[2]}" pid="${COLOR_ID}" p1="${pi}"/>`);
      }
      objects += `<object id="${firstPart + pi}" name="${esc(part.label || part.name)}" type="model" pid="${BASE_ID}" pindex="${pi}"><mesh><vertices>${vertexXml(ids)}</vertices><triangles>${tri.join('')}</triangles></mesh></object>\n`;
      settings += `    <part id="${firstPart + pi}" subtype="normal_part">\n      <metadata key="name" value="${esc(part.label || part.name)}"/>\n      <metadata key="extruder" value="${pi + 1}"/>\n    </part>\n`;
    });
    const colors = parts.map(colorOf);
    model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS} xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">Etsy Shop Tools</metadata>
<resources>
<basematerials id="${BASE_ID}">${parts.map((p, i) => `<base name="${esc(p.label || p.name)}" displaycolor="${hex(colors[i])}"/>`).join('')}</basematerials>
<m:colorgroup id="${COLOR_ID}">${colors.map(c => `<m:color color="${hex(c)}"/>`).join('')}</m:colorgroup>
${objects}<object id="${parentId}" name="${esc(title)}" type="model"><components>${parts.map((_, i) => `<component objectid="${firstPart + i}"/>`).join('')}</components></object>
</resources>
<build><item objectid="${parentId}"/></build>
</model>`;
    files.push(['Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="${parentId}">\n${settings}  </object>\n</config>`]);
  }
  files.push(['3D/3dmodel.model', model]);
  return new Blob([zipStore(files)], { type: 'model/3mf' });
}
