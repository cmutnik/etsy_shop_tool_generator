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
