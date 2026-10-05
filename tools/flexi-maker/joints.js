// Copyright (c) 2025 cmutnik
// Pure maths for the flexi maker: where to cut, where a joint fits inside a cross-section, and how big its parts are. No DOM, no 3D library.

/** Cut positions along an axis between `lo` and `hi`: the `custom` list when it has any usable values, else `count` evenly sized segments. */
export function cutPositions(lo, hi, count, custom = null) {
  const span = hi - lo;
  if (custom && custom.length) return [...new Set(custom.filter(c => Number.isFinite(c) && c > lo + 1 && c < hi - 1))].sort((a, b) => a - b);
  const n = Math.max(1, Math.floor(count) || 1);
  return Array.from({ length: n - 1 }, (_, k) => lo + (span * (k + 1)) / n);
}

const inside = (pt, rings) => {
  let n = 0;
  for (const ring of rings) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    if (c) n++;
  }
  return n % 2 === 1;                                                          // even-odd: a ring inside a ring is a hole
};
function edgeDistance(pt, rings) {
  let best = Infinity;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], ay = ring[j][1], bx = ring[i][0], by = ring[i][1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(pt[0] - ax - t * dx, pt[1] - ay - t * dy));
  }
  return best;
}

/**
 * The point inside a shape (outer ring plus holes, as rings of [x, y]) that is furthest from every edge, and that distance:
 * the centre of the biggest circle that fits. A joint goes there. Coarse grid, then refined around the best point.
 */
export function poleOfInaccessibility(rings) {
  const xs = rings.flatMap(r => r.map(p => p[0])), ys = rings.flatMap(r => r.map(p => p[1]));
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), best = null;
  for (let pass = 0; pass < 5; pass++) {
    const N = pass === 0 ? 40 : 8;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const pt = [x0 + ((x1 - x0) * i) / N, y0 + ((y1 - y0) * j) / N];
      if (!inside(pt, rings)) continue;
      const d = edgeDistance(pt, rings);
      if (!best || d > best.r) best = { x: pt[0], y: pt[1], r: d };
    }
    if (!best) return null;
    const w = Math.max(x1 - x0, y1 - y0) / (pass === 0 ? 20 : 4);              // narrow the window to about two cells around the best point
    x0 = best.x - w; x1 = best.x + w; y0 = best.y - w; y1 = best.y + w;
  }
  return best;
}

/**
 * Sizes of one ball-and-socket joint, built like an articulated figure's: the lower segment carries a ball (radius R) on a short neck, the
 * upper one a cup that wraps over the ball. The cup is a shell outside the segment (inner sphere R + clearance, wall `wall` thick) cut off
 * `lip` below the ball's centre, so its mouth is narrower than the ball (it cannot pull out) but wider than the neck (it can tilt).
 *  a  ball centre above the lower segment's face   b  ball centre below the upper segment's face (the cavity bites 1 mm into it)
 *  G  distance between the two faces               half  G / 2
 * Returns null when no mouth works.
 */
export function ballDims(R, clearance) {
  const neck = Math.max(1.2, 0.4 * R), Rc = R + clearance, wall = 1.4, Ro = Rc + wall;
  const lo = Math.sqrt(Math.max(Rc * Rc - (0.92 * R) ** 2, 0)), hi = Math.sqrt(Math.max(Rc * Rc - (neck + 0.8) ** 2, 0));   // mouth <= 0.92 R, mouth >= neck + 0.8
  const lip = Math.max(0.45 * R, lo);
  if (lip > hi) return null;
  const a = 1.3 * R, b = Rc - 1, G = a + b, mouth = Math.sqrt(Rc * Rc - lip * lip);
  const neckTilt = (Math.atan((mouth - neck) / lip) * 180) / Math.PI;                                  // where the neck meets the mouth
  const rimTilt = (Math.asin(Math.min(1, (a - lip) / Math.sqrt(Ro * Ro - lip * lip))) * 180) / Math.PI;     // where the lower face meets the cup's rim
  return { R, Rc, Ro, neck, lip, a, b, G, half: G / 2, mouth, tilt: Math.min(neckTilt, rimTilt) };
}

/**
 * Sizes of one hook-and-loop (chain link) joint. The lower segment carries a loop standing in the x-z plane, the upper one a loop hanging
 * in the y-z plane, so each passes through the other's opening like two links of a chain. `d` is the bar thickness (and the link's width),
 * `wi` the opening, `W` the link's outer width, `G` the distance between the two segments' faces: just enough that each link's far bar
 * clears the other with `clearance`, with `slack` of play either way. Returns null when no useful link fits.
 *  room       radius of the biggest circle in the cross-section (the link's feet must stand on the face)
 *  thickness  the thinner of the two segments the joint joins
 *  pref       bar thickness asked for, 0 = automatic
 */
export function hookDims(room, thickness, clearance, pref = 0) {
  const open = 2.4, slackK = 0.5;                                               // opening = 2.4 bars; play = half a bar
  const G = d => 3 * clearance + (2 * slackK + 2) * d;
  let d = pref > 0 ? pref : Math.min(4.5, Math.max(2.4, room / 4));
  d = Math.min(d, (room - 0.5) / ((open + 2) / 2), (thickness - 8 - 3 * clearance) / (2 * slackK + 2));
  if (!(d >= 2)) return null;
  const wi = open * d, W = wi + 2 * d, slack = slackK * d;
  const tilt = (Math.atan(((wi - d) / 2 - clearance) / (G(d) / 2 + d)) * 180) / Math.PI;   // where a bar meets the side of the other link's opening
  return { d, wi, W, G: G(d), half: G(d) / 2, slack, tilt };
}
