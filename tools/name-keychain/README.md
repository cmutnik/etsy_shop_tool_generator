<!-- Copyright (c) 2025 cmutnik -->
# Name Keychain

Live.

- `geometry.js` - `buildNameKeychain(params)` -> `THREE.Group` (`base` + `text` meshes) + info. DOM-free, tested in `tests/name-keychain.test.mjs` (needs the Roboto / Pacifico fonts; skipped offline).
- `name-keychain.js` / `index.html` - the page (font picker, upload, live preview, STL and 3MF).
- `shared/js/offset2d.js` - dilation by a union of one capsule per outline edge; the outline backing is the letters dilated by the margin with holes filled.

Design notes
- The loop code is `attachLoop()` in `tools/qr-keychain/attach.js` (shared with the magnet maker). It builds the QR keychain's `loopFootprint()` pointing up, so the plate is rotated to put the chosen side on top, joined, and rotated back. The loop is sunk down to where the plate's edge really is inside the neck's strip (an outline plate is ragged, so the bounding box edge is not enough); if the strip hits nothing the page says the loop cannot reach the letters.
- The neck width is half the loop size, capped at 80% of the plate's side, so a small plate does not end up with a neck wider than itself.
- Plate and letters touch (letters start at the plate's top) instead of overlapping, so a 3MF colour change falls on a clean layer boundary. With no plate the letters are one body, plate + letter height tall.
