// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
const { quantizeColors } = await import('../shared/js/palette.js');

const flat = list => Float32Array.from(list.flat());

test('quantizeColors: three clear colours stay three, in order of use', () => {
  const items = [];
  for (let i = 0; i < 50; i++) items.push([1, 0, 0]);
  for (let i = 0; i < 30; i++) items.push([0, 0, 1]);
  for (let i = 0; i < 20; i++) items.push([0, 1, 0]);
  const q = quantizeColors(flat(items), 3);
  assert.deepEqual(q.palette, ['#FF0000', '#0000FF', '#00FF00']);
  assert.deepEqual([...q.labels.slice(0, 3)], [0, 0, 0]);
  assert.equal(q.labels[60], 1);
  assert.equal(q.labels[99], 2);
});

test('quantizeColors: a smooth gradient of 1000 shades reduces to the number asked for', () => {
  const items = [];
  for (let i = 0; i < 1000; i++) items.push([i / 999, 0.2, 1 - i / 999]);
  for (const k of [2, 4, 8]) {
    const q = quantizeColors(flat(items), k);
    assert.equal(q.palette.length, k);
    assert.equal(new Set(q.labels).size, k, 'every palette colour is used');
  }
});

test('quantizeColors: noisy shades of two colours give two colours close to the originals', () => {
  const items = [];
  for (let i = 0; i < 400; i++) { const e = ((i * 37) % 21 - 10) / 400; items.push(i % 2 ? [0.9 + e, 0.1, 0.1] : [0.1, 0.2, 0.8 + e]); }
  const q = quantizeColors(flat(items), 2);
  assert.equal(q.palette.length, 2);
  const [a, b] = q.palette.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const red = a[0] > b[0] ? a : b, blue = a[0] > b[0] ? b : a;
  assert.ok(red[0] > 200 && red[2] < 60, `red ${red}`);
  assert.ok(blue[2] > 180 && blue[0] < 60, `blue ${blue}`);
  assert.equal(q.labels[0] === q.labels[2], true, 'same colour, same label');
  assert.equal(q.labels[0] === q.labels[1], false);
});

test('quantizeColors: asking for more colours than exist, or one, works', () => {
  const q = quantizeColors(flat([[1, 1, 1], [1, 1, 1], [0, 0, 0]]), 9);
  assert.equal(q.palette.length, 2);
  assert.equal(quantizeColors(flat([[1, 0, 0], [0, 0, 1]]), 1).palette.length, 1);
});
