// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { svgToGroups } = await import('../shared/js/svg-import.js');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#ffffff"/>
  <path fill="#222" fill-rule="evenodd" d="M10 10H60V60H10Z M25 25H45V45H25Z"/>
  <circle cx="80" cy="80" r="10" fill="black"/>
  <rect x="0" y="0" width="5" height="5" fill="none" stroke="red"/>
</svg>`;

test('svg: ignores white background and unfilled shapes, keeps holes', () => {
  const { groups, width, height } = svgToGroups(svg);
  assert.equal(groups.length, 2);
  assert.equal(groups.filter(g => g.holes.length === 1).length, 1);
  assert.ok(Math.abs(width - 80) < 1 && Math.abs(height - 80) < 1, `${width}x${height}`);
});

test('svg: white background kept when ignoreWhite is off', () => {
  const { width } = svgToGroups(svg, { ignoreWhite: false });
  assert.ok(Math.abs(width - 100) < 1);
});

test('svg: y axis is flipped (SVG down -> model up)', () => {
  const { groups } = svgToGroups(svg);
  const circle = groups.find(g => g.holes.length === 0);
  const cy = circle.outer.reduce((s, p) => s + p[1], 0) / circle.outer.length;
  assert.ok(cy < 0, 'circle is at the bottom of the SVG so should have negative y'); // 80 > 50 in SVG space
});

test('svg frame: layers keep their positions relative to the picture, not to their own ink', () => {
  const layer = (x, y) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" width="100" height="60"><path fill="#000" d="M${x} ${y}h10v10h-10z"/></svg>`;
  const left = svgToGroups(layer(10, 40), { frame: true }), right = svgToGroups(layer(80, 5), { frame: true });
  for (const r of [left, right]) { assert.equal(r.width, 100); assert.equal(r.height, 60); assert.equal(r.framed, true); }
  const centre = g => { const o = g.groups[0].outer; return [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length]; };
  const [lx, ly] = centre(left), [rx, ry] = centre(right);
  assert.ok(Math.abs(rx - lx - 70) < 1e-6, `horizontal offset ${rx - lx} should be 70`);
  assert.ok(Math.abs((ry - ly) - 35) < 1e-6, `vertical: ${ry - ly}`);                  // the left dot is 35 lower on the page, so 35 lower once y points up
  assert.ok(Math.abs(lx - (15 - 50)) < 1e-6 && Math.abs(ly - (-(45) + 30)) < 1e-6, `left dot centre ${lx},${ly}`);
  // without frame both dots are centred on the origin and the offset is lost
  const a = svgToGroups(layer(10, 40)), b = svgToGroups(layer(80, 5));
  assert.ok(Math.abs(centre(a)[0]) < 1e-6 && Math.abs(centre(b)[0]) < 1e-6);
  assert.equal(a.framed, false);
});

test('svg frame: falls back to the ink box when the SVG has no frame', () => {
  const r = svgToGroups('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M5 5h10v10h-10z"/></svg>', { frame: true });
  assert.equal(r.framed, false);
  assert.ok(Math.abs(r.width - 10) < 1e-6);
});
