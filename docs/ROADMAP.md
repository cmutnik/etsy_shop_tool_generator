<!-- Copyright (c) 2025 cmutnik -->
# Roadmap

## Done
- **3D Stamp Generator** (`tools/stamp/`): text, SVG/PNG/JPG logo, border, STL + 3MF export.

## Porting the QR tools from `invite2svg/`

The Python/Streamlit tools in `invite2svg/` need a server, so they can't live on GitHub Pages. They are being
re-implemented in JavaScript here, using the same geometry strategy (build everything as 2D polygons, then
extrude - no 3D boolean library). `invite2svg/` stays untouched, and its hosted Streamlit app keeps working,
until each tool has a working equivalent here.

| Python (`invite2svg/`) | Purpose | JS target | Notes |
|---|---|---|---|
| `qr_stand_utils.generate_qr_polygons` | QR modules -> rectangles | `shared/js/qr-plate.js` | Use a JS QR encoder that exposes the module matrix (e.g. `qrcode-generator` via CDN). Keep the "one rectangle per module/run, no merging" approach. |
| `qr_stand_utils.build_qr_plate_mesh` | Plate with embossed/engraved QR | `shared/js/qr-plate.js` | Rectangles -> `extrudeShapes()`; engrave = base plate with the modules as holes, extrude. Already hole-free in the Python version, so no CSG needed. |
| `qr_stand_utils.icon_polygons`, `icons.py` | Banner icons | `shared/js/icons.js` | Port the SVG path data; render with `svg-import.js`. |
| `qr_stand_utils.text_to_polygons` (potrace) | Banner title text | `shared/js/text-layout.js` (exists) | opentype outlines replace the potrace round trip. |
| `qr_stand_utils.build_banner_*`, `stack_plate_pieces` | Banner above/below QR | `shared/js/qr-plate.js` | Same region-splitting idea as `splitRegions()` in `tools/stamp/geometry.js` - lift it into `shared/` when the second tool needs it. |
| `qr_stand_utils.build_stand_base_mesh` | Base with angled slot | `tools/qr-stand/` | Slot is a 2D boolean (shapely) before extrusion. Needs a polygon boolean lib: `polygon-clipping` or `clipper-lib` (both small, CDN-able). If a true 3D boolean is ever needed: `manifold-3d` (WASM). |
| `qr_stand_utils.build_keychain_loop_mesh` | Loop with hole | `tools/qr-keychain/` | Union of circle + neck rectangle minus hole, in 2D, then extrude. |
| `pages/2_*`, `pages/3_*` | Streamlit UIs | `tools/qr-stand/index.html`, `tools/qr-keychain/index.html` | Copy `tools/stamp/index.html` structure. Slider ranges are listed in each tool's README. |
| `card_utils.py`, `extract_*.py`, `photo_to_svg.py` | Invite photo -> layers/SVG | `tools/wedding-invite-3d/` | Deskew + border detection used OpenCV; options are opencv.js (large, WASM) or a simpler manual-corners UI. `shared/js/image-trace.js` already covers the vectorising. |
| `card3d_utils.py` | Layered extrusion | `tools/wedding-invite-3d/` | Same "cap + base + raised pegs" idea as the stamp. |

Suggested order: QR keychain (smallest, shares the plate with the stand) -> QR stand -> wedding invite.
Remove each `invite2svg/` page once its replacement ships.

## Ideas
- STL / 3MF modifier: load a mesh (Three.js `STLLoader` / `3MFLoader`), scale, add a text label or hanging hole, re-export.
- Stamp: curved/circular text for round seals, multiple-colour 3MF (separate relief/base objects), saved presets.
- Shop-owner extras: batch export (one STL per line of a CSV, zipped - `zipStore()` in `shared/js/export.js` is reusable).
