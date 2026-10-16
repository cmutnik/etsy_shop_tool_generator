<!-- Copyright (c) 2025 cmutnik -->
# Plate Nester

Live.

- `shared/js/nest.js` - `nest(items, { bed, spacing, edge, cell, angles })` -> plates of placements `{ item, copy, angle, tx, ty }`, `applyPlacement()`, `makeMask()`. Pure, tested in `tests/nest.test.mjs`.
- `plate-nester.js` / `index.html` - the page: several STL / 3MF / OBJ files, copies per file, bed presets, plate switcher, one 3MF or STL per plate, or a ZIP of all plates.

How the nesting works
- Each model's footprint (its triangles projected onto the bed, turned by each allowed angle) is painted into a bit grid of `cell` mm (2 by default). A cell counts if it is within 0.71 cell of a triangle (conservative), so a thin vertical wall with no projected area is still seen. The mask is then grown by half the spacing, so two masks that do not overlap are at least `spacing` apart.
- A plate is a bit grid of the usable bed. A mask is tested at a position by ANDing its rows (pre-shifted 0-31 bits, cached) with the plate's rows, so a test is a few word operations and stops at the first clash. The first free spot, lowest row first, is taken; among the allowed rotations the one that ends lowest wins.
- Biggest footprints go first. Each model goes on the earliest plate with room; a new plate is started only when none fits, and a model that does not fit an empty bed is reported as too big. "Copies = 0" fills what is left of plate 1 with copies of that model.
- A placement is a turn about z then a move. The page applies it to models that were first placed on the bed (z = 0) and centred, and centres the plate on the origin so a slicer opens it in the middle.
- 3MF export: one part per model part, named by file, copy and part, with its colour; filament slots by colour (`assignSlots()`), so equal colours share a slot across the whole plate.

Limits: footprints are cautious by up to one cell per side, so a perfect grid needs about 10% slack; models are only turned about z (they are never tipped over unless "largest flat face first" is on); a tall piece and a short piece on one plate print at the tallest piece's time.
