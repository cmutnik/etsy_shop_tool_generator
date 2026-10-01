<!-- Copyright (c) 2025 cmutnik -->
# QR Code Keychain

Live. Port of `invite2svg/pages/3_*QR_Code_Keychain.py` (+ `build_qr_plate_mesh`, `build_keychain_loop_mesh`).

- `geometry.js` - `buildKeychain(params)` -> `THREE.Group` + info. DOM-free, tested in `tests/qr-keychain.test.mjs`.
- `keychain.js` / `index.html` - the page. Includes an in-page **scan check**: the generated geometry is rasterised top-down and decoded with jsQR.
- QR encoding and plate boxes live in `shared/js/qr-plate.js` so the QR stand can reuse them.

Design notes
- The plate is built from overlapping axis-aligned boxes (dark modules merged along rows, then stacked), not merged polygons - the same idea as the Python version, which avoided a triangulator crash on dense QR regions.
- Colours follow layers: **raised** = one filament change at the plate top; **engraved** = dark below, light on the top `depth` mm. The colour 3MF tags triangles with `basematerials` colours; slicers that ignore them still print fine.
- Text is encoded as UTF-8 (the encoder library's default would corrupt non-ASCII).

Differences from the Python page: no Plotly preview (Three.js instead), a live scan check, and the filament-change height is shown.
