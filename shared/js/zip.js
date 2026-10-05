// Copyright (c) 2025 cmutnik
// Minimal zip writer (stored, no compression). No dependencies, so any tool page can use it.

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

async function inflateRaw(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));   // built into browsers and Node 18+
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a zip (stored or deflated entries; no zip64, no encryption). Returns { names, has(name), read(name) } where
 * read() resolves to the entry's bytes. Entries are only decompressed when read.
 */
export function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a valid zip package.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error('Zip64 packages are not supported.');
  const dec = new TextDecoder(), entries = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The zip directory is damaged.');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.set(name, { flags, method, size, local });
  }
  return {
    names: [...entries.keys()],
    has: name => entries.has(name),
    async read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`"${name}" is not in the package.`);
      if (e.flags & 1) throw new Error('Encrypted packages are not supported.');
      const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
      const raw = bytes.subarray(start, start + e.size);
      if (e.method === 0) return raw;
      if (e.method === 8) return inflateRaw(raw);
      throw new Error(`Unsupported zip compression (method ${e.method}).`);
    },
  };
}
