<!-- Copyright (c) 2025 cmutnik -->
# Layered Colour Art

Live.

- `shared/js/layered-art.js` - `assignLabels()` (nearest palette colour per pixel), `stackOrder()` / `usedOrder()`, `buildLayeredArt()` -> `THREE.Group` (one mesh per colour, named `layer0`...) + info (heights to change filament at, coverage). DOM-free, tested in `tests/layered-art.test.mjs`.
- `layered-art.js` / `index.html` - the page. Colours start from `quantize()` (k-means, shared with Image Prep) and are editable.

Design notes
- Band k covers the pixels whose colour has rank >= k in the stack and is one step thick, standing on band k-1 (band 0 is the base over the whole picture). The top surface therefore shows each pixel's own colour, and bands only touch, never overlap.
- Each band is traced with marching squares from the same pixel grid and positioned by the whole picture's frame, so they register exactly. Outline simplification must stay under about 0.35 px, or square corners are clipped.
- 3MF uses the shared multi-part layout (one part per colour, filament slot = position from the bottom). Transparent pixels belong to no band, so cut-outs work.
