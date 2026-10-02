<!-- Copyright (c) 2025 cmutnik -->
# Roadmap

## Done
- **Image Prep** (`tools/image-prep/`): black & white (threshold / adaptive / dither), SVG line art (trace / edges), hand-off to the stamp generator.
- **3D Stamp Generator** (`tools/stamp/`): text, SVG/PNG/JPG logo, border, STL + 3MF export.
- **QR Code Keychain** (`tools/qr-keychain/`): QR plate + loop, raised/engraved, scan check, STL + colour 3MF. Ported from `invite2svg/`; the Python page can be removed once you are happy with it.

## Porting the QR tools from `invite2svg/`

The Python/Streamlit tools in `invite2svg/` need a server, so they can't live on GitHub Pages. They are being
re-implemented in JavaScript here, using the same geometry strategy (build everything as 2D polygons, then
extrude - no 3D boolean library). `invite2svg/` stays untouched, and its hosted Streamlit app keeps working,
until each tool has a working equivalent here.

| Python (`invite2svg/`) | Purpose | JS target | Notes |
|---|---|---|---|
| `qr_stand_utils.generate_qr_polygons` | QR modules -> rectangles | `shared/js/qr-plate.js` **(done)** | `qrcode-generator` encodes; `gridRects()` merges runs into boxes. |
| `qr_stand_utils.build_qr_plate_mesh` | Plate with embossed/engraved QR | `shared/js/qr-plate.js` **(done)** | `buildQrPlate()`: overlapping boxes, named `qr` / `base` so layer colours match the preview. |
| `qr_stand_utils.icon_polygons`, `icons.py` | Banner icons | `shared/js/icons.js` | Port the SVG path data; render with `svg-import.js`. |
| `qr_stand_utils.text_to_polygons` (potrace) | Banner title text | `shared/js/text-layout.js` (exists) | opentype outlines replace the potrace round trip. |
| `qr_stand_utils.build_banner_*`, `stack_plate_pieces` | Banner above/below QR | `shared/js/qr-plate.js` | Same region-splitting idea as `splitRegions()` in `tools/stamp/geometry.js` - lift it into `shared/` when the second tool needs it. |
| `qr_stand_utils.build_stand_base_mesh` | Base with angled slot | `tools/qr-stand/` | Slot is a 2D boolean (shapely) before extrusion; `difference()` in `shared/js/boolean2d.js` is the JS equivalent. Use `shared/js/boolean2d.js` (`polygon-clipping`, already in the repo) for the 2D cut. If a true 3D boolean is ever needed: `manifold-3d` (WASM). |
| `qr_stand_utils.build_keychain_loop_mesh` | Loop with hole | `tools/qr-keychain/geometry.js` **(done)** | `loops.js`: six styles built with 2D polygon booleans (`shared/js/boolean2d.js`). |
| `pages/3_*` | Keychain UI | `tools/qr-keychain/` **(done)** | |
| `pages/2_*` | Stand UI | `tools/qr-stand/index.html` | Copy `tools/qr-keychain/` (same QR controls). Shared page CSS is `assets/tool.css`. |
| `card_utils.py`, `extract_*.py`, `photo_to_svg.py` | Invite photo -> layers/SVG | `tools/wedding-invite-3d/` | Deskew + border detection used OpenCV; options are opencv.js (large, WASM) or a simpler manual-corners UI. `shared/js/image-trace.js` already covers the vectorising. |
| `card3d_utils.py` | Layered extrusion | `tools/wedding-invite-3d/` | Same "cap + base + raised pegs" idea as the stamp. |

Suggested order: ~~QR keychain~~ -> QR stand (reuse `qr-plate.js`; add banner via `text-layout.js` + `splitRegions`, and the slotted base, which needs a 2D polygon boolean) -> wedding invite.
Remove each `invite2svg/` page once its replacement ships.

## Ideas
- Image Prep: background removal, colour-count posterize (for multi-colour stamps), centre-line tracing for pen-like strokes, presets ("logo", "photo", "handwriting"), and a hand-off to the QR keychain/stand banners.
- STL / 3MF modifier: load a mesh (Three.js `STLLoader` / `3MFLoader`), scale, add a text label or hanging hole, re-export.
- Stamp: curved/circular text for round seals, multiple-colour 3MF (separate relief/base objects), saved presets.
- Shop-owner extras: batch export (one STL per line of a CSV, zipped - `zipStore()` in `shared/js/export.js` is reusable).
