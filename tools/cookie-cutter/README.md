<!-- Copyright (c) 2025 cmutnik -->
# Cookie Cutter Maker

Live.

- `geometry.js` - `buildCookieCutter(params)` -> `THREE.Group` (`flange`, `wall`, `edge` meshes) + info; `SHAPES` the built-in outlines. DOM-free, tested in `tests/cookie-cutter.test.mjs`.
- `cookie-cutter.js` / `index.html` - the page. Pictures go through `imageToGroups()` (raster) or `svgToGroups()`.
- `shared/js/offset2d.js` - `outerBand()` gives the wall: everything within r of the outline, minus the shape itself.

Design notes
- Every layer's inside edge is the shape's outline, so the cavity is exactly the size asked for and the wall grows outwards. Layers are stacked, not overlapped: flange (bed) / wall / edge, each region contained in the one below.
- Holes in the shape get a wall inside the hole (the band is outside the dough everywhere); "Ignore holes" fills them first.
- Printed with the flange on the bed so the sharp edge is the top and nothing overhangs; flip it to use.
- The size warning uses the shape's average width (2 x area / outline length); a heart at 70 mm is about 20 mm, a thin star arm much less.
