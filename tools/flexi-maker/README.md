<!-- Copyright (c) 2025 cmutnik -->
# Flexi Maker

Turn an STL or 3MF into an articulated, print-in-place model. Everything runs in the browser.

| File | Purpose |
|---|---|
| `index.html`, `flexi-maker.js` | The page: load, orient, preview the cut planes, make, download |
| `flexi.js` | `makeFlexi(parts, opts)`: cuts, notches, sockets and balls with manifold-3d. Parts in, parts out; keeps each part's colour and slot |
| `prepare.js` | `simplifyParts()`: bring a heavy model down with manifold's simplify, within a tolerance; the page's Repair button reuses `tools/mesh-modifier/repair.js` |
| `test-strip.js` | `makeTestStrip()`: three small bars with the page's joint settings at three clearances, with 1 / 2 / 3 bump markers, laid out in a row; `stripClearances()`; `boxPart()` |
| `joints.js` | Pure maths: cut positions, the pole of inaccessibility (where a joint fits), joint dimensions |

Reuses the loader and parts helpers from `tools/mesh-modifier/` (`geometry.js`, `boolean3d.js`).

## How a joint is built

**Hook and loop (default).** `hookDims()` sizes two rectangular loops of bar thickness `d`: one stands on the lower segment in the x-z plane, one hangs from the upper segment in the y-z plane, each passing through the other's opening with `clearance`. The faces end up `G` apart (about three bars). The tests check the pieces never touch at rest or when tilted 80 % of the reported bend about either axis, and that the upper segment cannot be lifted away.

**Ball and socket.** Built like an articulated figure's joint: the lower segment carries a ball on a short neck, the upper one a cup (a shell outside the segment) that wraps over it. `ballDims()` cuts the cup off below the ball's centre so its mouth is narrower than the ball (it cannot pull out) but wider than the neck (it can tilt), and keeps the two faces far enough apart for both. The tests check the same things as for hook and loop: closed pieces, no contact at rest or tilted 80 % of the reported bend, and the upper segment cannot be lifted away.

## Joint test strip

`makeTestStrip({ joint, ball, bar, bend, clearance, step = 0.1, section = 24, length = 64, gap = 6, onSide })` builds a 24 x 24 x 64 mm bar, runs `makeFlexi()` on it with one cut (two segments) at each of three clearances (`stripClearances()`: the chosen one and 0.1 mm either side, never under 0.1 mm), lays each on its side like the page does, and places the three in a row 6 mm apart, centred on the bed. Each bar carries 1, 2 or 3 small bumps on the end of its first segment so they can be told apart after printing; parts are named `0.30 mm - Segment 1` and the 3MF keeps one part per piece. The tests check every piece is closed, the bars do not touch, the bump counts, and that the material falls as the clearance grows. The page's button reuses the same download buttons as a finished model.
