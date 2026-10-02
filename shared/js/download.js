// Copyright (c) 2025 cmutnik
// Save a Blob as a file download (browser only, no dependencies).

export function downloadBlob(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
