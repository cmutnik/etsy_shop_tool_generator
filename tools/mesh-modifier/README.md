<!-- Copyright (c) 2025 cmutnik -->
# STL / 3MF Modifier

Open an existing STL or 3MF, change its size and orientation, add a hanging tab or raised text, and download it again as STL or 3MF. Everything runs in the browser.

## Files

| File | Purpose |
|---|---|
| `index.html`, `modifier.js` | The page and its wiring (no geometry in here) |
| `geometry.js` | `transformParts()` (units, rotate, mirror, scale, centre, drop to bed), `partStats()` (triangles, volume, open edges), `buildGroup()` (preview / export group) |
| `attach.js` | `buildTab()` and `buildLabel()`, built in the model's final coordinates |
| `../../shared/js/mesh-import.js` | STL and 3MF readers (shared, no dependencies) |

## How it works

- **Parts, not one lump.** The importer returns `{ name, color, positions, indices }` parts. A 3MF object, or each component of an assembly, is one part; a mesh with several triangle colours is split into one part per colour. The group built for export names each mesh `p0`, `p1`... so `export3MF()` writes one 3MF part per mesh, with its colour and a filament slot in order.
- **No 3D booleans.** The tab and the text are separate parts that overlap the model (the tab by "sinks into model", the text by 0.3 mm), so the slicer fuses them. That keeps the page free of a CSG library; cutting a hole *through* the model and splitting are the next step (see `docs/ROADMAP.md`).
- **Finding the edge for the tab.** `reach()` clips every triangle to a strip across the model (and to the tab's height above the bed) and takes the furthest point, so a flat side with no vertex in the strip is still found, and a round model gets its tab on the real surface. The ring is placed so its inner edge sinks `overlap` into the model, and the hole is only allowed if its wall is at least 0.8 mm more than the overlap, so it can never cut into the model.
- **Text height.** `surfaceHeights()` samples the model under the text; the label sits on the highest sample and warns when the samples differ by more than 0.3 mm or some miss the model.

## Limits

- 3,000,000 triangles (the page warns and refuses above that).
- Not read from a 3MF: slicer project settings, textures, per-vertex colour gradients, beam lattices, the slice extension.
- No mesh repair. Open edges are reported, not fixed.

## Tests

`tests/mesh-modifier.test.mjs` covers the zip reader, both STL forms, 3MF units / transforms / components / colour splits, the round trip through `export3MF()`, every tab shape and side, and the label checks.
