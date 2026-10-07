<!-- Copyright (c) 2025 cmutnik -->
# Roadmap

## Done
- **Image Prep** (`tools/image-prep/`): presets, a print-width thin-detail check, zoom, mark-based background removal for busy photos, Bezier-fitted SVG curves, black & white (threshold / adaptive / dither), SVG line art (trace / edges / centre line), background removal and cut-out, colour posterize into registered layers for multi-colour stamps, hand-off to the stamp generator (with a "keep the picture's frame" option).
- **3D Stamp Generator** (`tools/stamp/`): text, SVG/PNG/JPG logo, border, STL + 3MF export.
- **QR Code Stand** (`tools/qr-stand/`): plate with icon/title banner and insertion tab, slotted base, assembled preview, STL and colour 3MF. Ported from [invite2svg](https://invite2svg.streamlit.app/); the Python page can be removed once you are happy with it.
- **QR Code Keychain** (`tools/qr-keychain/`): QR plate + loop, raised/engraved, scan check, STL + colour 3MF. Ported from [invite2svg](https://invite2svg.streamlit.app/); the Python page can be removed once you are happy with it.

- **Lithophane Maker** (`tools/lithophane/`): photo to a watertight thickness-mapped plate, flat or curved up to 270 degrees, frame, contrast curve, smoothing, backlit preview. Ideas: a full 360-degree lamp cylinder (wrap the seam), a stand or foot, a moon / sphere mode, engraved text under the picture.
- **Layered Colour Art** (`tools/layered-art/`): k-means colours editable to the user's filaments, stacked one-colour steps, 3MF with a filament slot per layer. Ideas: true HueForge-style blending (per-pixel thickness from a transmission model and filament TD values), a border / frame, a magnet or hanging hole, a brightness curve per colour.
- **Name Keychain** (`tools/name-keychain/`): text on an outline / rectangle plate (or letters only) with a left or top loop, STL and two-part 3MF. Built on `shared/js/offset2d.js` (capsule-union dilation, with a snap-and-retry around polygon-clipping's sweep-line errors). Ideas: letter spacing, curved text, a baseline bar to join block letters, a second line in another colour, bulk names from a CSV.
- **Cookie Cutter Maker** (`tools/cookie-cutter/`): built-in shapes or a traced picture, flange / wall / cutting edge, holes kept or ignored. Ideas: a built-in text cutter, an embossed inner stamp, a handle, more shapes, a matching cutter + stamp set.
- **STL / 3MF Modifier** (`tools/mesh-modifier/`): STL, 3MF and OBJ import (own readers; parts and colours kept, OBJ colours from its .mtl, or vertex colours reduced to a palette; slicer 3MFs read the filament palette, extruders and painted triangles), size / rotate / mirror / bed placement, hanging tab, raised text, lay flat on largest face, 3D cuts with manifold-3d (hole, engraved text, split with pegs), mesh repair (weld, clean, orient, fill holes, with undo), filament slots (read from 3MF, shared by colour, overridable), undo / redo, holes in six directions, engraved text with a second-colour infill part, per-part colour / include, inside-out fix, STL and multi-part 3MF export.
- **Flexi Maker** (`tools/flexi-maker/`): cut a model across and join the segments with print-in-place hook-and-loop (chain link) or ball-and-socket joints (manifold-3d), one joint per separate piece of each cross-section, notch for bend, colours / slots kept per part, laid on its side for printing. Ideas: test-print and tune default clearance, pick joint positions in the preview, other joint types (pin hinge), a thin-piece bridge instead of leaving it solid.

## Porting the QR tools from `invite2svg/`

The Python/Streamlit tools in `invite2svg/` (hosted at https://invite2svg.streamlit.app/) need a server, so they can't live on GitHub Pages. They are being
re-implemented in JavaScript here, using the same geometry strategy (build everything as 2D polygons, then
extrude - no 3D boolean library). `invite2svg/` stays untouched, and its hosted Streamlit app keeps working,
until each tool has a working equivalent here.

| Python (`invite2svg/`) | Purpose | JS target | Notes |
|---|---|---|---|
| `qr_stand_utils.generate_qr_polygons` | QR modules -> rectangles | `shared/js/qr-plate.js` **(done)** | `qrcode-generator` encodes; `gridRects()` merges runs into boxes. |
| `qr_stand_utils.build_qr_plate_mesh` | Plate with embossed/engraved QR | `shared/js/qr-plate.js` **(done)** | `buildQrPlate()`: overlapping boxes, named `qr` / `base` so layer colours match the preview. |
| `qr_stand_utils.icon_polygons`, `icons.py` | Banner icons | `shared/js/icons.js` **(done)** | Same path data; rendered with `svg-import.js`. |
| `qr_stand_utils.text_to_polygons` (potrace) | Banner title text | `shared/js/text-layout.js` (exists) | opentype outlines replace the potrace round trip. |
| `qr_stand_utils.build_banner_*`, `stack_plate_pieces` | Banner above/below QR | `shared/js/qr-plate.js` | Same region-splitting idea as `splitRegions()` in `tools/stamp/geometry.js` - lift it into `shared/` when the second tool needs it. |
| `qr_stand_utils.build_stand_base_mesh` | Base with angled slot | `tools/qr-stand/` | Slot is a 2D boolean (shapely) before extrusion; `difference()` in `shared/js/boolean2d.js` is the JS equivalent. Use `shared/js/boolean2d.js` (`polygon-clipping`, already in the repo) for the 2D cut. If a true 3D boolean is ever needed: `manifold-3d` (WASM). |
| `qr_stand_utils.build_keychain_loop_mesh` | Loop with hole | `tools/qr-keychain/geometry.js` **(done)** | `loops.js`: six styles built with 2D polygon booleans (`shared/js/boolean2d.js`). |
| `pages/3_*` | Keychain UI | `tools/qr-keychain/` **(done)** | |
| `pages/2_*` | Stand UI | `tools/qr-stand/` **(done)** | |
| `card_utils.py`, `extract_*.py`, `photo_to_svg.py` | Invite photo -> layers/SVG | the hosted [invite2svg app](https://invite2svg.streamlit.app/) (linked from the home page; no JS port planned) | Deskew + border detection used OpenCV; options are opencv.js (large, WASM) or a simpler manual-corners UI. `shared/js/image-trace.js` already covers the vectorising. |
| `card3d_utils.py` | Layered extrusion | the hosted [invite2svg app](https://invite2svg.streamlit.app/) | Same "cap + base + raised pegs" idea as the stamp. |

Suggested order: ~~QR keychain~~ -> ~~QR stand~~ -> ~~wedding invite~~ (stays on the hosted app).
Remove each `invite2svg/` page once its replacement ships.

## Ideas
- Image Prep: registration marks / alignment keys on the layers and the matching stamp bases, a hand-off to the QR keychain/stand banners, undo for mark strokes, batch processing of several pictures, and moving the heavy work into a Web Worker for very large images.
- Stamp: print all colour layers as one multi-part 3MF with an alignment frame.
- STL / 3MF modifier, next steps: tougher repair (self-intersections, very large holes); Bambu's one-mesh-many-volumes layout (a real project with one object holding several parts is needed to test it); settle the experimental "keep the slicer's print settings" option once it has been tried in Bambu Studio / Orca (one level may turn out to be enough, or neither).
- Stamp: curved/circular text for round seals, multiple-colour 3MF (separate relief/base objects), saved presets.
- Shop-owner extras: batch export (one STL per line of a CSV, zipped - `zipStore()` in `shared/js/export.js` is reusable).
