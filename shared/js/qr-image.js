// Copyright (c) 2025 cmutnik
// Flat QR code images: SVG text (pure) and PNG blob (browser only).

/** SVG markup for a QR matrix. `quiet` is the quiet zone in modules (the QR spec asks for 4). */
export function qrSvg(matrix, { dark = '#000000', light = '#ffffff', quiet = 4 } = {}) {
  const n = matrix.length, size = n + 2 * quiet;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      let end = c;
      while (end + 1 < n && matrix[r][end + 1]) end++;
      d += `M${c + quiet} ${r + quiet}h${end - c + 1}v1h${-(end - c + 1)}z`;
      c = end;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

export const qrSvgBlob = (matrix, opts) => new Blob([qrSvg(matrix, opts)], { type: 'image/svg+xml' });

/** PNG blob with whole-pixel modules (`scale` px per module, no smoothing). */
export function qrPngBlob(matrix, { dark = '#000000', light = '#ffffff', quiet = 4, scale = 12 } = {}) {
  const n = matrix.length, size = (n + 2 * quiet) * scale;
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (matrix[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
}
