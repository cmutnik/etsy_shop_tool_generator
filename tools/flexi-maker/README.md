<!-- Copyright (c) 2025 cmutnik -->
# Flexi Maker

Turn an STL or 3MF into an articulated, print-in-place model. Everything runs in the browser.

| File | Purpose |
|---|---|
| `index.html`, `flexi-maker.js` | The page: load, orient, preview the cut planes, make, download |
| `flexi.js` | `makeFlexi(parts, opts)`: cuts, notches, sockets and balls with manifold-3d. Parts in, parts out; keeps each part's colour and slot |
| `prepare.js` | `simplifyParts()`: bring a heavy model down with manifold's simplify, within a tolerance; the page's Repair button reuses `tools/mesh-modifier/repair.js` |
| `joints.js` | Pure maths: cut positions, the pole of inaccessibility (where a joint fits), joint dimensions |

Reuses the loader and parts helpers from `tools/mesh-modifier/` (`geometry.js`, `boolean3d.js`).

## How a joint is built

**Hook and loop (default).** `hookDims()` sizes two rectangular loops of bar thickness `d`: one stands on the lower segment in the x-z plane, one hangs from the upper segment in the y-z plane, each passing through the other's opening with `clearance`. The faces end up `G` apart (about three bars). The tests check the pieces never touch at rest or when tilted 80 % of the reported bend about either axis, and that the upper segment cannot be lifted away.

**Ball and socket.** Built like an articulated figure's joint: the lower segment carries a ball on a short neck, the upper one a cup (a shell outside the segment) that wraps over it. `ballDims()` cuts the cup off below the ball's centre so its mouth is narrower than the ball (it cannot pull out) but wider than the neck (it can tilt), and keeps the two faces far enough apart for both. The tests check the same things as for hook and loop: closed pieces, no contact at rest or tilted 80 % of the reported bend, and the upper segment cannot be lifted away.
