// Copyright (c) 2025 cmutnik
import test from 'node:test';
import assert from 'node:assert/strict';
import { frameBox, project, direction, VIEWS, SIZES, size, view } from '../shared/js/photo-framing.js';

const box = { min: [-30, -20, 0], max: [30, 20, 40] };

test('direction is a unit vector pointing from the model to the camera: front is -y, right is +x, elevation lifts it', () => {
  const n = v => Math.hypot(...v);
  for (const [az, el] of [[0, 0], [35, 22], [90, 8], [180, 12], [-28, 78]]) assert.ok(Math.abs(n(direction(az, el)) - 1) < 1e-12);
  const f = direction(0, 0), r = direction(90, 0), t = direction(0, 90);
  assert.ok(f[1] < -0.99 && r[0] > 0.99 && t[2] > 0.99);
});

test('the framed box fills the frame to the margin, whatever the view, shape and aspect', () => {
  for (const v of VIEWS) for (const aspect of [4 / 3, 1, 3 / 4, 16 / 9]) for (const b of [box, { min: [0, 0, 0], max: [100, 10, 10] }, { min: [-5, -5, 0], max: [5, 5, 80] }]) {
    const o = { azimuth: v.azimuth, elevation: v.elevation, aspect, margin: 1.15, zoom: v.zoom };
    const cam = frameBox(b, o), p = project(b, cam, { aspect });
    const fill = Math.max(p.x, p.y);
    assert.ok(Math.abs(fill - 1 / 1.15 * v.zoom) < 0.02, `${v.id} aspect ${aspect}: fills ${fill.toFixed(3)} of the frame, wanted ${(v.zoom / 1.15).toFixed(3)}`);
    assert.ok(cam.distance > 0);
  }
});

test('nothing leaves the frame when the margin is above 1, and the camera looks at the middle of the box', () => {
  const cam = frameBox(box, { azimuth: 35, elevation: 22, aspect: 4 / 3, margin: 1.1 });
  const p = project(box, cam);
  assert.ok(p.x <= 1 && p.y <= 1);
  assert.deepEqual(cam.target, [0, 0, 20]);
  const above = frameBox(box, { azimuth: 0, elevation: 30 });
  assert.ok(above.position[2] > above.target[2] && above.position[1] < 0);
});

test('a wider frame needs a smaller distance for a wide model, a taller frame for a tall one', () => {
  const wide = { min: [-50, -5, 0], max: [50, 5, 10] }, tall = { min: [-15, -15, 0], max: [15, 15, 100] };
  assert.ok(frameBox(wide, { aspect: 2 }).distance < frameBox(wide, { aspect: 1 }).distance);
  assert.ok(frameBox(tall, { aspect: 2 }).distance <= frameBox(tall, { aspect: 0.3 }).distance + 1e-9);
  assert.ok(frameBox(tall, { aspect: 0.3 }).distance > frameBox(tall, { aspect: 2 }).distance, 'a narrow frame must back off for a tall model');
});

test('zoom crops in, and presets and sizes are well formed', () => {
  const fill = zoom => { const cam = frameBox(box, { zoom, margin: 1.2 }); const p = project(box, cam); return Math.max(p.x, p.y); };
  assert.ok(Math.abs(fill(2) - 2 * fill(1)) < 0.02 && fill(1) < 1 && fill(2) > 1, 'zoom 2 fills twice as much, cropping the edges');
  assert.ok(view('closeup').zoom > 1 && view('hero'));
  for (const s of SIZES) { assert.ok(s.width >= 1500 && s.height >= 1500 && size(s.id) === s); }
  assert.equal(new Set(VIEWS.map(v => v.id)).size, VIEWS.length);
});
