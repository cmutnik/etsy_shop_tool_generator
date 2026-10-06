<!-- Copyright (c) 2025 cmutnik -->
# STL / 3MF Modifier

Open an existing STL or 3MF, change its size and orientation, add a hanging tab or raised text, and download it again as STL or 3MF. Everything runs in the browser.

## Files

| File | Purpose |
|---|---|
| `index.html`, `modifier.js` | The page and its wiring (no geometry in here) |
| `geometry.js` | `transformParts()` (units, rotate, mirror, scale, centre, drop to bed), `partStats()` (triangles, volume, open edges), `buildGroup()` (preview / export group) |
| `attach.js` | `buildTab()` and `buildLabel()`, built in the model's final coordinates |
| `project.js` | `patchProjectSettings()`, `describeProject()`: carrying a slicer project's print settings into the saved 3MF (experimental) |
| `history.js` | `createHistory()`: undo / redo of recorded states (pure) |
| `repair.js` | `repairPart()` and `describeRepair()`: weld, clean, orient, fill holes |
| `boolean3d.js` | `cutHole()`, `cutText()`, `splitModel()` with manifold-3d, loaded on first use |
| `../../shared/js/mesh-import.js` | STL and 3MF readers (shared, no dependencies) |

## How it works

- **Parts, not one lump.** The importer returns `{ name, color, positions, indices }` parts. A 3MF object, or each component of an assembly, is one part; a mesh with several triangle colours is split into one part per colour. The group built for export names each mesh `p0`, `p1`... so `export3MF()` writes one 3MF part per mesh, with its colour and a filament slot in order.
- **Added on vs cut.** The tab and raised text are separate parts that overlap the model (the tab by "sinks into model", the text by 0.3 mm), so the slicer fuses them; they need no 3D boolean. Hole, engraved text and the split are real booleans in `boolean3d.js`, run through manifold-3d, which is only downloaded when one is switched on. Order in the page: size / rotate -> hole -> engraving -> split -> tab and raised text.
- **Split.** `splitModel()` cuts every part at one height, drops the upper half so its cut face is on the bed, and sets it beside the lower half. Pegs are placed by insetting the cut face (`offset`) by the peg radius plus 1.5 mm, then choosing the two grid points furthest apart (one on a small face, none if there is no room); the lower half gets a separate "Alignment pegs" part sunk 0.5 mm into it, the upper half gets sockets with the chosen clearance.
- **Finding the edge for the tab.** `reach()` clips every triangle to a strip across the model (and to the tab's height above the bed) and takes the furthest point, so a flat side with no vertex in the strip is still found, and a round model gets its tab on the real surface. The ring is placed so its inner edge sinks `overlap` into the model, and the hole is only allowed if its wall is at least 0.8 mm more than the overlap, so it can never cut into the model.
- **Text height.** `surfaceHeights()` samples the model under the text; the label sits on the highest sample and warns when the samples differ by more than 0.3 mm or some miss the model.

- **Lay flat.** `layFlatRotation()` groups triangles by direction (about 1 degree), takes the group with the most area and rotates its normal to point down. `layFlatAngles()` turns that into the page's X / Y / Z angle fields, allowing for the current rotation and mirror, so the fields stay the single source of truth.
- **Inside-out parts.** A part with negative volume is flipped on load (`flipPart()`), and the page says so.

- **Repair.** `repairPart()` runs weld (vertices within 1e-5 of the model's diagonal, on a grid, so it works whether the file is in millimetres or normalised to one unit; a fixed distance would melt a model that is one unit across), drop degenerate / duplicate triangles, orient (breadth-first over shared edges so neighbours walk each edge in opposite directions, then each connected piece turned outward by its volume), then pull apart pinches (`splitPinches()`: where an edge is shared by three or more triangles, the triangles around each end vertex are grouped into fans connected through ordinary edges, and every fan after the first gets its own copy of the vertex, moved 3e-4 of the model's diagonal inward so the sheets stop touching; only vertices on such edges are touched), then fill boundary loops of up to 200 edges by ear clipping in the loop's best-fit plane (a fan if the outline is degenerate), then orient again. Everything uses typed arrays and numeric hashes, so a 1.9M-triangle scan or AI model repairs in a few seconds. It returns a copy, a report, and `closed`, which is only true with no open edges *and* a real volume (a flat double skin does not count). The page keeps a repair only if it reduced the open edges, and keeps the originals for undo.

- **Filament slots.** `assignSlots()` gives each part its explicit slot, or a shared one per colour. The importer reads `Metadata/model_settings.config` in the layout `export3MF()` writes (part id = component object id, or an object-level extruder); a mesh painted in several colours keeps separate slots. Bambu's own volume-range layout is not read.

- **Hole direction.** `cutHole()` takes `{ axis: 'z' | 'x' | 'y', from: 1 | -1, a, b, diameter, depth }`: the cylinder is built along +z, turned onto the axis (`rotate([0, 90, 0])` for x, `rotate([-90, 0, 0])` for y) and placed so it starts 1 mm outside the model, or `depth` mm in from the chosen end. `a, b` are the position across the axis: z -> (x, y), x -> (y, z), y -> (x, z). Vertical holes still accept `x, y`.
- **Engraving infill.** With "Fill the engraving" on, `buildInfill()` extrudes the same outlines `cutText()` removed, from the pocket floor to the surface, as a separate part. It touches the body only on the pocket walls and floor (no overlap, which would put two filaments in one place), so body + infill is exactly the original solid; the test checks that by volume. Use the 3MF: an STL merges the two shells.
- **Undo / redo.** The page records a snapshot of every field (except the derived size boxes), the scale, which parts are included, their colours and slots, and which version of the parts is loaded (repair). `record()` runs 500 ms after the last change, so typing is one step; a snapshot is only added if its key differs from the current one. Restoring puts the fields back and rebuilds. Snapshots hold references to the (never mutated) part arrays, so they are cheap. An uploaded font file is not part of history.

- **Compressed 3MF.** The page downloads `export3MFCompressed()` (deflate through `CompressionStream`); entries under 1 KB stay stored. Same package, any slicer opens it; `unzip -t` is part of the test.

- **Slicer project 3MFs.** Tested against a real Bambu Studio 2.3.5 file: objects stored one per file under `3D/Objects/` and reached through `p:path` components, build items with scale + rotation, an object-level `extruder` (0 means default), names only in `Metadata/model_settings.config` (read by `readSlots()` into `names`), painted colours as `paint_color` strings, and the filament palette in `project_settings.config`. The synthetic test in `tests/mesh-modifier.test.mjs` reproduces that layout.

- **Keeping print settings (experimental).** The importer returns `parts.project = { application, version, files }` for the `Metadata/project_settings.config` and `*_settings_N.config` files of a Bambu / Orca project. On saving, `export3MFCompressed()` takes `extraFiles` (copied byte for byte, except `filament_colour` in `project_settings.config`, which `patchProjectSettings()` updates so slot n has the colour the parts in slot n have in the page) and, for the second level, `application` / `extraMetadata` so the model says it was written by the slicer (`BambuStudio-2.3.5`), which some slicers need before they treat a file as their own project. Verified: the files are in the package, byte-identical apart from the colours, and the package passes `unzip -t`. **Not verified:** that any slicer loads the profile from the result.

## Limits

- 3,000,000 triangles (the page warns and refuses above that).
- Not read from a 3MF: slicer print profiles and plate layout (`project_settings.config` is only read for its filament colours), textures, per-vertex colour gradients, beam lattices, the slice extension.
- Repair is basic: it does not untangle self-intersections or edges shared by three or more triangles, and it will not invent large missing areas. A part with open edges cannot be cut.

## Tests

`tests/mesh-history.test.mjs` covers the undo / redo stack. `tests/mesh-modifier.test.mjs` covers the cuts (volumes checked against the geometry: hole, pocket, split with pegs and sockets) the repair (missing face, seam, flipped and inside-out triangles, degenerate and duplicate triangles, a concave hole, a patch on a sphere, holes that are too large, a repaired model then cut) and also covers the zip reader, both STL forms, 3MF units / transforms / components / colour splits, the round trip through `export3MF()`, every tab shape and side, and the label checks.
