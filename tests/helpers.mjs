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
