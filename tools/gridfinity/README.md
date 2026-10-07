<!-- Copyright (c) 2025 cmutnik -->
# Gridfinity Bins and Baseplates

Live.

- `geometry.js` - `buildBaseplate(params)` and `buildBin(params)` -> `THREE.Group` (every mesh named `bin`) + info (size, compartments, cavity depth, volume, grams); `footInset()`, `lipProfile()`, `lipInset()`, `ringAt()`. DOM-free, tested in `tests/gridfinity.test.mjs`.
- `loft.js` - `Mesh3`: build watertight solids from rings with equal vertex counts (bands, annuli, earcut caps with holes).
- `gridfinity.js` / `index.html` - the page.

Design notes
- Standard dimensions: pitch 42, bin 41.5 (0.25 mm clearance a side), height unit 7, outer radius 3.75, foot 4.75 mm tall (0.8 chamfer, 1.8 straight, 2.15 chamfer). A ring at inset s has corner radius 3.75 - s, so every ring is an offset of the same rounded rectangle and lofting between them is exact.
- A bin is: one lofted foot per cell, with magnet holes cut in the bottom cap (hole wall + ceiling are part of the same mesh); a floor slab; walls extruded with the compartments as holes; the lip as a lofted hollow band on top; a scoop per compartment (an extruded quarter-round, overlapping the wall by 0.2 mm). Parts touch or overlap; slicers union them.
- The lip: a bin sitting LIP_PENETRATION (3.5 mm) deep in it has its foot's inset at each depth; the lip's inner face is that profile minus 0.25 mm. Below it a 45 degree underside returns to the wall face. The test sweeps the whole profile and checks at least 0.25 mm of clearance for several wall thicknesses.
- Baseplates: one watertight mesh built with `Mesh3`: the plate's outer wall and bottom, a top cap with one hole per cell, then for each cell a lofted pocket (the lip's first four profile points, so the pocket is the foot plus 0.25 mm), a pocket floor cap with magnet holes cut in it, and each hole's wall and bottom. Plate height = 3.5 mm pocket + floor (1.2 by default, 3.2 minimum with magnets). The test sweeps every pocket height against the foot profile and checks 0.25 mm of clearance, and that the ridge between pockets is 2.5 mm.
- Not covered: screw holes, connector clips, labels. The lip is derived, not copied from the official files, so print a pair and check they stack.
