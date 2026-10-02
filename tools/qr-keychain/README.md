<!-- Copyright (c) 2025 cmutnik -->
# QR Code Keychain

Live. Port of `invite2svg/pages/3_*QR_Code_Keychain.py` (+ `build_qr_plate_mesh`, `build_keychain_loop_mesh`).

- `geometry.js` - `buildKeychain(params)` -> `THREE.Group` + info. DOM-free, tested in `tests/qr-keychain.test.mjs`.
- `loops.js` - the six loop styles (`LOOP_STYLES`, `loopFootprint()`): each is a 2D shape plus a neck, minus a hole, built with polygon booleans from `shared/js/boolean2d.js` and then extruded.
- `keychain.js` / `index.html` - the page. Includes an in-page **scan check**: the generated geometry is rasterised top-down and decoded with jsQR.
- QR encoding and plate boxes live in `shared/js/qr-plate.js` so the QR stand can reuse them.

Design notes
- The plate is built from overlapping axis-aligned boxes (dark modules merged along rows, then stacked), not merged polygons - the same idea as the Python version, which avoided a triangulator crash on dense QR regions.
- Colours follow layers: **raised** = one filament change at the plate top; **engraved** = dark below, light on the top `depth` mm. The 3MF is written in the Bambu/Orca/PrusaSlicer layout: the plate and QR are separate mesh parts under one parent object, and `Metadata/model_settings.config` assigns them to filament slots 1 and 2. (These slicers ignore per-triangle colours, so a plain colour-tagged mesh imports as one colour.) `basematerials`/`colorgroup` are also written as hints for other viewers.
- **Back engraving** (`backDepth`): a mirrored copy of the code is cut into the underside (the bed side) and coloured in: looking into a pocket you see the QR colour. A light bottom layer of boxes surrounds the pockets, so their ceilings are bridged. *Engraved front*: the dark slab above is the pocket floor, so plain height swaps work (`filamentChangeZs`). *Raised front*: a 0.4 mm dark floor sits under each pocket in the same layers as the light plate, which needs the 3MF's two filament slots. Validation keeps >= 0.8 mm of plate between the back pockets and the front features. Mirroring is checked module-by-module in `tests/qr-keychain.test.mjs` (decoders like jsQR also read mirrored codes, so decoding alone would not catch a wrong flip).
- **Loop shapes** are combined in 2D (union of neck and loop, minus the hole), not in 3D. The neck stops halfway through the wall below the hole instead of at the loop's centre line: a neck ending exactly on the centre line put vertices of the neck, the loop and the hole on one line, the cap triangulator bridged the hole through a collinear vertex, and the mesh got an edge with a single triangle. The tests cover every style at neck widths 4-28 mm, above and below, in both modes. A neck wider than the loop therefore becomes a base under the loop, not a bar through its middle.
- Text is encoded as UTF-8 (the encoder library's default would corrupt non-ASCII).

Differences from the Python page: no Plotly preview (Three.js instead), a live scan check, and the filament-change height is shown.
