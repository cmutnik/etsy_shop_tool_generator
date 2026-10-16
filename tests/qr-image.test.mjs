import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix } from '../shared/js/qr-plate.js';
import { qrSvg } from '../shared/js/qr-image.js';

test('qrSvg sizes the viewBox with the quiet zone and uses the given colours', () => {
  const m = qrMatrix('https://example.com');
  const svg = qrSvg(m, { dark: '#123456', light: '#fedcba', quiet: 4 });
  assert.match(svg, new RegExp(`viewBox="0 0 ${m.length + 8} ${m.length + 8}"`));
  assert.ok(svg.includes('#123456') && svg.includes('#fedcba'));
});

test('qrSvg path covers exactly the dark modules', () => {
  const m = qrMatrix('hello');
  const svg = qrSvg(m, { quiet: 0 });
  const d = svg.match(/ d="([^"]*)"/)[1];
  let area = 0;
  for (const [, w] of d.matchAll(/h(\d+)v1/g)) area += Number(w);
  assert.equal(area, m.flat().filter(Boolean).length);
});
