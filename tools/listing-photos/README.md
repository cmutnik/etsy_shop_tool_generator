<!-- Copyright (c) 2025 cmutnik -->
# Listing Photos

Live.

- `shared/js/photo-framing.js` - pure and tested (`tests/photo-framing.test.mjs`): `VIEWS` (hero, front, side, back, from above, close-up), `SIZES` (Etsy-friendly 4:3, square, 5:4, portrait), `BACKGROUNDS`, `FINISHES`, `frameBox()` (camera position that fits the box to a margin for any view and aspect; zoom is a tighter margin) and `project()` (used by the tests to check it).
- `listing-photos.js` / `index.html` - the page: Three.js with a room environment for reflections, a soft shadow on a shadow-catcher floor, ACES tone mapping, creased normals (40 degrees) for smooth curves with crisp edges up to 400k triangles. Opens STL / 3MF / OBJ with the shared importer.

Design notes
- The preview canvas has the output's aspect ratio. A download re-renders at the full size (2000-3000 px), then restores the preview; transparent backdrops give an alpha PNG with the shadow kept.
- The set download renders six angles in a row, then puts the camera back and zips the PNGs with `zipStore()`.
- Rendering itself is checked by eye (headless Chrome screenshot); the maths that decides where the camera goes is what the tests cover.
