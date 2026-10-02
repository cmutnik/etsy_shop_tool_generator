// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fitCurve, fitOpen, fitClosed, findCorners, findCornersOpen, bezierAt, closedChainToPath, sampleChain } from '../shared/js/curves.js';
import { traceMask } from '../shared/js/image-trace.js';
import { maskToSvg } from '../shared/js/image-ops.js';
import { signedArea } from '../shared/js/geometry-pure.js';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { svgToGroups } = await import('../shared/js/svg-import.js');

const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const square = (x, y, s, per) => { const out = []; for (let i = 0; i < per; i++) out.push([x + (s * i) / per, y]); for (let i = 0; i < per; i++) out.push([x + s, y + (s * i) / per]); for (let i = 0; i < per; i++) out.push([x + s - (s * i) / per, y + s]); for (let i = 0; i < per; i++) out.push([x, y + s - (s * i) / per]); return out; };
const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
/** Largest distance from any data point to the curve, and from any curve sample to the data's polyline (not just its vertices). */
function deviation(pts, chain, closed = false) {
  const s = sampleChain(chain, 0.1), near = (p, set) => Math.min(...set.map(q => Math.hypot(p[0] - q[0], p[1] - q[1])));
  const poly = pts.length - (closed ? 0 : 1);
  const toPoly = p => { let m = Infinity; for (let i = 0; i < poly; i++) m = Math.min(m, segDist(p, pts[i], pts[(i + 1) % pts.length])); return m; };
  return Math.max(Math.max(...pts.map(p => near(p, s))), Math.max(...s.map(toPoly)));
}
const chainArea = chain => Math.abs(signedArea(sampleChain(chain, 0.2)));

test('fitCurve: a smooth arc becomes one curve, and the fit stays within the tolerance', () => {
  const arc = Array.from({ length: 60 }, (_, i) => { const a = (i / 59) * Math.PI * 0.8; return [30 * Math.cos(a), 30 * Math.sin(a)]; });
  const fit = fitCurve(arc, 0.5);
  assert.equal(fit.length, 1);
  assert.ok(deviation(arc, fit) < 0.6, `deviation ${deviation(arc, fit)}`);
  assert.deepEqual(fit[0][0], arc[0]); assert.deepEqual(fit[0][3], arc[59]);
  // a noisy line is still one near-straight curve
  let seed = 4; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noisy = Array.from({ length: 80 }, (_, i) => [i, 10 + (r() - 0.5) * 0.6]);
  assert.equal(fitCurve(noisy, 0.6).length, 1);
  assert.deepEqual(fitCurve([[0, 0]], 1), []);
  assert.equal(fitCurve([[0, 0], [5, 5]], 1).length, 1);
});

test('fitClosed: a dense circle needs only a handful of curves, within tolerance, with no corners', () => {
  const ring = circle(50, 50, 40, 300);
  assert.deepEqual(findCorners(ring), []);
  const chain = fitClosed(ring, 0.5);
  assert.ok(chain.length >= 2 && chain.length <= 8, `${chain.length} curves for 300 points`);
  assert.ok(deviation(ring, chain, true) < 0.6, `deviation ${deviation(ring, chain, true)}`);
  assert.ok(Math.abs(chainArea(chain) - Math.PI * 1600) / (Math.PI * 1600) < 0.01);
  // closed: each curve starts where the previous one ended, and the last returns to the first
  for (let i = 0; i < chain.length; i++) assert.deepEqual(chain[i][3], chain[(i + 1) % chain.length][0]);
});

test('fitClosed: a square keeps its four corners sharp and its sides straight', () => {
  const ring = square(10, 10, 60, 60);
  const corners = findCorners(ring);
  assert.equal(corners.length, 4, `corners ${corners}`);
  const chain = fitClosed(ring, 0.4);
  assert.ok(chain.length <= 8, `${chain.length} curves`);
  assert.ok(deviation(ring, chain, true) < 0.5, `deviation ${deviation(ring, chain, true)}`);
  assert.ok(Math.abs(chainArea(chain) - 3600) / 3600 < 0.01);
  // the four corners are anchors of the curve (the path touches them exactly)
  for (const c of [[10, 10], [70, 10], [70, 70], [10, 70]]) assert.ok(chain.some(b => Math.hypot(b[0][0] - c[0], b[0][1] - c[1]) < 1.5), `corner ${c}`);
});

test('fitClosed: a bitmap outline (1 px staircase) becomes a smooth, much shorter path with the same area', () => {
  const w = 120, h = 120, m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) { const x = i % w, y = (i / w) | 0; if (Math.hypot(x - 60, y - 60) < 45) m[i] = 1; }
  const ring = traceMask(m, w, h)[0];
  const chain = fitClosed(ring, 0.8);
  assert.ok(chain.length <= 10, `${chain.length} curves for ${ring.length} outline points`);
  assert.ok(Math.abs(chainArea(chain) - Math.abs(signedArea(ring))) / Math.abs(signedArea(ring)) < 0.01);
  assert.ok(deviation(ring, chain, true) < 1.2, `deviation ${deviation(ring, chain, true)}`);
});

test('maskToSvg with smooth curves uses fitted Beziers: smaller than an equally smooth polygon, same area, imports into the stamp tool', () => {
  const w = 140, h = 100, m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) { const x = i % w, y = (i / w) | 0; if (Math.hypot(x - 45, y - 50) < 32 && Math.hypot(x - 45, y - 50) > 14) m[i] = 1; if (x > 95 && x < 130 && y > 25 && y < 75) m[i] = 1; }
  const poly = maskToSvg(m, w, h, { tolerance: 0.5 }), curved = maskToSvg(m, w, h, { tolerance: 0.8, smooth: true });
  assert.ok(!poly.d.includes('C') && curved.d.includes('C'));
  // a polygon needs a fine tolerance to look as smooth as the curves do, and is then much bigger
  const finePoly = maskToSvg(m, w, h, { tolerance: 0.2 });
  assert.ok(curved.svg.length < finePoly.svg.length, `${curved.svg.length} bytes of curves vs ${finePoly.svg.length} bytes of polygon at equal smoothness`);
  assert.equal(curved.shapes, poly.shapes);
  const area = svg => { const g = svgToGroups(svg, { ignoreWhite: false }).groups; return g.reduce((s, x) => s + Math.abs(signedArea(x.outer)) - x.holes.reduce((a, hh) => a + Math.abs(signedArea(hh)), 0), 0); };
  const a1 = area(poly.svg), a2 = area(curved.svg), px = m.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(a1 - px) / px < 0.03 && Math.abs(a2 - px) / px < 0.03, `areas ${a1} ${a2} vs ${px} px`);
  const groups = svgToGroups(curved.svg, { ignoreWhite: false }).groups;
  assert.equal(groups.length, 2);
  assert.equal(groups.filter(g => g.holes.length === 1).length, 1, 'the ring keeps its hole');
  assert.match(curved.svg, /fill-rule="evenodd"/);
});

test('closedChainToPath writes a closed C path', () => {
  const d = closedChainToPath(fitClosed(circle(10, 10, 5, 80), 0.3));
  assert.match(d, /^M[\d. -]+(C[\d. -]+)+Z$/);
  assert.equal(closedChainToPath([]), '');
  assert.ok(bezierAt([[0, 0], [0, 10], [10, 10], [10, 0]], 0.5)[1] > 5);
});

test('fitOpen keeps the corner of an L-shaped stroke and fits each arm as one near-straight curve', () => {
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push([i, 0]);
  for (let i = 1; i <= 40; i++) pts.push([40, i]);
  const corners = findCornersOpen(pts);
  assert.equal(corners.length, 1);
  assert.ok(Math.abs(corners[0] - 40) <= 1);
  const chain = fitOpen(pts, 0.4);
  assert.ok(chain.length >= 2 && chain.length <= 4, `${chain.length} curves`);
  assert.ok(chain.some(b => Math.hypot(b[3][0] - 40, b[3][1] - 0) < 1.5), 'a curve ends at the corner');
  assert.ok(deviation(pts, chain) < 0.5, `deviation ${deviation(pts, chain)}`);
  // a smooth arc stays one curve
  const arc = Array.from({ length: 80 }, (_, i) => { const a = (i / 79) * Math.PI; return [30 * Math.cos(a), 30 * Math.sin(a)]; });
  assert.equal(fitOpen(arc, 0.5).length, 1);
  assert.deepEqual(fitOpen([[0, 0]], 1), []);
});
