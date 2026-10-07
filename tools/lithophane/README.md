<!-- Copyright (c) 2025 cmutnik -->
# Lithophane Maker

Live.

- `shared/js/lithophane.js` - `thicknessGrid()` (picture -> thickness per cell, with frame), `buildLithophane()` -> `THREE.Group` + info, `backlitPreview()`. DOM-free, tested in `tests/lithophane.test.mjs`.
- `lithophane.js` / `index.html` - the page: file picker, sample picture, backlit canvas and 3D view, STL download.

Design notes
- One indexed mesh of two grids (smooth face and relief face) joined by edge walls, so it is watertight by construction at any size (checked flat, framed, smoothed, curved and negative).
- Upright orientation (X width, Y thickness, Z height, bottom edge on the bed). A curved plate bends round a centre on the relief side; the radius is width / angle, and a curve that would be tighter than 1.5x the thickest point is refused.
- The picture is area-averaged down to the cell grid (default 0.4 mm), then optionally box-blurred. Triangle count is 4 per cell; over 1.6 million is refused with a message.
- Light model for the preview: transmission = exp(-k * (t - thinnest)), with k chosen so the thickest point passes about 7%. It is a guide, not a physical simulation.
