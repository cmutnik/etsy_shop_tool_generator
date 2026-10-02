// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { thin, pruneSpurs, skeletonPaths, simplifyPolyline, pathsToStrokeSvg, centerline } from '../shared/js/skeleton.js';
import { dilateMask, maskToSvg } from '../shared/js/image-ops.js';

const sum = a => a.reduce((s, v) => s + v, 0);
const blank = (w, h) => new Uint8Array(w * h);
const fill = (m, w, x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1; };
const disc = (m, w, cx, cy, r0, r1) => { for (let i = 0; i < m.length; i++) { const x = i % w, y = (i / w) | 0, d = Math.hypot(x - cx, y - cy); if (d >= r0 && d <= r1) m[i] = 1; } };

test('thin: a thick bar becomes a one pixel line down its middle', () => {
  const w = 60, h = 30, m = blank(w, h);
  fill(m, w, 5, 10, 55, 19);                                  // 9 px thick
  const s = thin(m, w, h);
  // the free ends retract by about half the thickness (4-5 px each), so a 50 px bar leaves roughly 41 px of centre line
  assert.ok(sum(s) >= 38 && sum(s) <= 52, `skeleton pixels ${sum(s)}`);
  for (let x = 14; x < 46; x++) { let c = 0, yy = 0; for (let y = 0; y < h; y++) if (s[y * w + x]) { c++; yy = y; } assert.equal(c, 1, `column ${x} has ${c} pixels`); assert.ok(Math.abs(yy - 14) <= 1, `column ${x} at y=${yy}`); }
  assert.equal(sum(thin(blank(10, 10), 10, 10)), 0);
  const dot = blank(9, 9); fill(dot, 9, 3, 3, 6, 6);
  assert.ok(sum(thin(dot, 9, 9)) >= 1 && sum(thin(dot, 9, 9)) <= 3, 'a blob thins to a point');
});

test('skeletonPaths: a plus sign is four arms meeting at one junction; a ring is one closed loop; a line is one path', () => {
  const w = 50, h = 50, plus = blank(w, h);
  fill(plus, w, 22, 5, 27, 45); fill(plus, w, 5, 22, 45, 27);
  const p = centerline(plus, w, h, { prune: 0 });
  assert.equal(p.paths.length, 4, `plus: ${p.paths.length} paths`);
  assert.ok(p.paths.every(x => !x.closed));
  const ends = p.paths.flatMap(x => [x.points[0], x.points[x.points.length - 1]]);
  const junction = ends.filter(e => Math.hypot(e[0] - 24, e[1] - 24) < 3);
  assert.equal(junction.length, 4, 'all four arms meet in the middle');
  const ring = blank(w, h); disc(ring, w, 25, 25, 14, 19);
  const r = centerline(ring, w, h, { prune: 0 });
  assert.equal(r.paths.length, 1); assert.equal(r.paths[0].closed, true);
  const radius = r.paths[0].points.map(([x, y]) => Math.hypot(x - 25, y - 25));
  assert.ok(radius.every(v => Math.abs(v - 16.5) < 1.6), 'loop follows the middle of the ring');
  const line = blank(w, h); fill(line, w, 5, 20, 45, 24);
  const l = centerline(line, w, h, { prune: 0 });
  assert.equal(l.paths.length, 1); assert.equal(l.paths[0].closed, false);
});

test('pruneSpurs removes short side branches but keeps the real line at full length', () => {
  const w = 80, h = 40, m = blank(w, h);
  fill(m, w, 5, 18, 75, 22);                                   // main line, 70 px
  for (const x of [25, 40, 55]) fill(m, w, x, 12, x + 1, 18);  // three 6 px spurs (1 px wide: they survive thinning)
  const raw = thin(m, w, h);
  const rawPaths = skeletonPaths(raw, w, h);
  assert.ok(rawPaths.length > 1, 'spurs create extra paths');
  const pruned = pruneSpurs(raw, w, h, 9);
  const p = skeletonPaths(pruned, w, h);
  assert.equal(p.length, 1, `after pruning: ${p.length} paths`);
  const xs = pruned.reduce((a, v, i) => (v ? [Math.min(a[0], i % w), Math.max(a[1], i % w)] : a), [w, 0]);
  assert.ok(xs[0] <= 8 && xs[1] >= 71, `main line still spans ${xs}`);
  assert.equal(sum(pruneSpurs(raw, w, h, 0)), sum(raw), 'length 0 is a no-op');
  // a ring has no ends, so nothing is pruned
  const ring = blank(50, 50); disc(ring, 50, 25, 25, 14, 19);
  const s = thin(ring, 50, 50);
  assert.equal(sum(pruneSpurs(s, 50, 50, 8)), sum(s));
});

test('simplifyPolyline keeps corners and drops collinear points', () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3]];
  const s = simplifyPolyline(pts, 0.3);
  assert.deepEqual(s, [[0, 0], [4, 0], [4, 3]]);
  assert.equal(simplifyPolyline([[0, 0], [1, 1]], 1).length, 2);
});

test('pathsToStrokeSvg: uniform round strokes, smooth option, short paths dropped', () => {
  const w = 60, h = 30, m = blank(w, h); fill(m, w, 5, 10, 55, 15); fill(m, w, 30, 2, 31, 4);
  const { paths } = centerline(m, w, h, { prune: 0 });
  const a = pathsToStrokeSvg(paths, w, h, { width: 4, color: '#ff0000' });
  assert.match(a.svg, /stroke="#ff0000" stroke-width="4" stroke-linecap="round"/);
  assert.match(a.svg, /viewBox="0 0 60 30"/);
  assert.equal(a.svg.includes('fill="none"'), true);
  const b = pathsToStrokeSvg(paths, w, h, { minLength: 8 });
  assert.ok(b.paths < a.paths, 'short stub dropped');
  const curved = blank(60, 60); disc(curved, 60, 30, 30, 15, 19);
  const cp = centerline(curved, 60, 60, { prune: 0 }).paths;
  assert.ok(pathsToStrokeSvg(cp, 60, 60, { smooth: true }).svg.includes('C'));
  assert.ok(!pathsToStrokeSvg(cp, 60, 60, { smooth: false }).svg.includes('C'));
});

test('centre-line then re-thicken gives strokes of uniform thickness, whatever the original varied between', () => {
  const w = 120, h = 40, m = blank(w, h);
  // a stroke whose thickness grows from 3 px to 11 px
  for (let x = 5; x < 115; x++) { const t = 3 + Math.round(((x - 5) / 110) * 8); fill(m, w, x, 20 - (t >> 1), x + 1, 20 - (t >> 1) + t); }
  const { skeleton } = centerline(m, w, h, { prune: 4 });
  const fat = dilateMask(skeleton, w, h, 2);                   // line width ~5
  const thickness = x => { let c = 0; for (let y = 0; y < h; y++) c += fat[y * w + x]; return c; };
  const ts = []; for (let x = 15; x < 105; x += 5) ts.push(thickness(x));
  assert.ok(Math.max(...ts) - Math.min(...ts) <= 2, `thickness varies ${Math.min(...ts)}..${Math.max(...ts)}`);
  assert.ok(Math.min(...ts) >= 4 && Math.max(...ts) <= 7, `about 5: ${ts}`);
  // and it turns into a valid filled SVG
  const { svg, shapes } = maskToSvg(fat, w, h, {});
  assert.ok(shapes >= 1 && svg.includes('<path'));
});
