<!-- Copyright (c) 2025 cmutnik -->
# Magnets and Ornaments

Live.

- `geometry.js` - `buildMagnet(params)` -> `THREE.Group` (`base` meshes: pocket layer + solid layer; `art` mesh: rim and artwork) + info (pocket centres, depth, loop). DOM-free, tested in `tests/magnets.test.mjs` (text tests need Pacifico; skipped offline).
- `magnets.js` / `index.html` - the page: built-in shapes (from the cookie cutter) or your own picture's outline, artwork from text or a picture, magnet and loop options.
- `tools/qr-keychain/attach.js` - `attachLoop()`, the loop-on-an-outline code lifted out of the name keychain so both use it.

Design notes
- The back is on the bed. The pocket layer is the plate with circle holes (magnet diameter + clearance, depth = magnet thickness + 0.2 mm) under a solid layer, so the pocket's ceiling is bridged. The plate must be at least pocket depth + 1.2 mm thick or the page says so.
- Pocket centres come from `poleOfInaccessibility()` (the flexi tool's helper) of the outline pulled in by wall + radius, so the pocket is where the shape is widest and always leaves 1.2 mm of wall. Two pockets go along the longer side, as far apart as both still fit; if no spread fits the page says so.
- Raised parts (rim and artwork) are clipped to the outline pulled in by the rim, so nothing overhangs the edge. Text is laid out, then scaled and centred into the room left; a picture is traced the same way as the stamp tool's. The rim is the outline minus its inset.
- The loop goes on top by `attachLoop()`; a heart takes it in its cleft.
