<!-- Copyright (c) 2025 cmutnik -->
# QR Code Stand

Live.

Two printable parts, both modelled flat on the bed:

- **Plate:** the QR code (raised or engraved) with an optional banner (a brand icon and/or a title) above or below it, and a blank
  tab at the bottom so the slot never covers artwork. 3MF has the plate and the artwork as two parts (filament slots 1 and 2).
- **Base:** a block with a slot cut at the lean-back angle. The slot is a 2D polygon boolean (`shared/js/boolean2d.js`), then the
  cross-section is extruded along the plate width.
- **Assembled:** a preview that seats the plate in the slot, to check the fit and the reading direction.

Code
- `geometry.js` - `buildStand(params)`: plate (stacking, spacer, banner strips), base, assembled preview, info and warnings.
- `banner.js` - icon and title layout (icon only = right-aligned, title only = centred, both = centred together; shrinks to fit).
- `base.js` - the base cross-section, the base mesh and the matrix that seats the plate in the slot.
- `stand.js` / `index.html` - the page, with a scan check on the plate's code.
- Shared: `shared/js/qr-plate.js` (QR plate), `shared/js/icons.js` (6 CC0 Simple Icons marks), `shared/js/text-layout.js` (title text).

Where this differs from the Python version
- **The assembled preview centres the plate's thickness in the slot.** The Python preview puts the plate's back face on the slot's
  centre line, so the plate sits half a thickness off. A test checks every corner of the plate's buried edge lies within half the
  thickness of the slot's centre line, i.e. with the clearance on both sides.
- **Titles use opentype outlines** instead of a raster-then-potrace round trip, so there is no `potrace` dependency.
- **Slots that do not fit are refused** with a message (too close to the base's front or bottom edge, or cutting the base in two);
  the Python version silently kept the largest piece.
- The insertion tab is exactly `slot depth + 2 mm - existing blank space` long, as before, and is tested for every banner position.

Notes
- Banner artwork is simplified to 0.02 mm and merged (polygon union) before extruding: an icon's sub-shapes can share an edge, and
  distressed fonts have micro-edges that a printer cannot make and that break the mesh. See `mergeArtwork()`.
- All extrusions go through `extrudeShapes()`, which cleans the outline and repairs triangulation cracks
  (`repairCapJunctions()` in `shared/js/geometry2d.js`). `tests/qr-stand.test.mjs` runs titles in four very different fonts, in both
  modes, and checks every mesh is watertight and the code still scans.
