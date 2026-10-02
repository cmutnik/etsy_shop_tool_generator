<!-- Copyright (c) 2025 cmutnik -->
# Etsy Shop Tool Generator

Free, in-browser tools that help Etsy shop owners make products: QR code generators, stamp creators, STL/3MF modifiers and more.
Everything runs client-side as a static site, so it can be hosted for free (GitHub Pages) and **nothing you upload leaves your browser**.

## Tools

| Tool | Status | What it does |
|---|---|---|
| [3D Stamp Generator](tools/stamp/) | live | Text, logo and border stamps as FDM-ready STL / 3MF |
| [Image Prep](tools/image-prep/) | live | Pictures to black and white, or to SVG line art, ready for the stamp generator |
| [QR Code Keychain](tools/qr-keychain/) | live | QR plate with a split-ring loop, one printable piece (STL or colour 3MF) |
| [QR Code Stand](tools/qr-stand/) | live | QR plate with optional icon and title, plus a slotted base that holds it standing up |
| [3D Wedding Invite](tools/wedding-invite-3d/) | planned | Invitation photo or SVG to a layered 3D print |
| STL / 3MF modifier | idea | Scale, split, add text or hanging holes to an existing model |

The list shown on the home page comes from [tools/registry.json](tools/registry.json).

### Image Prep

- **Black & white:** threshold (auto/manual), adaptive (for shadows and uneven light) or dither (halftone), with auto contrast, smoothing, invert, speck removal, margin trimming and a transparent-background option. Downloads as PNG.
- **Line art (SVG):** trace shapes (logos, drawings), outline edges (turn a photo into a line drawing), or **centre line** (pen strokes and handwriting redrawn at one even thickness, as filled shapes or editable strokes).
- **Colours:** posterize to 2-8 colours and get one layer per ink colour for **multi-colour stamps**. Every layer shares one frame, so the stamps line up; download layers as SVG, all of them as a ZIP, or send one to the stamp generator.
- **Cut-out and background removal:** remove a plain, gradient or evenly lit background (auto colour, or click to pick), keep same-coloured areas inside the subject, soften or shrink the edge. Download a transparent PNG, or use it as the first step for any other output.
- **One click to the stamp generator:** sends the result over as the stamp's logo ("Keep the picture's frame" keeps colour layers registered).
- Runs offline in the browser with no external libraries; the picture never leaves your computer.

### QR Code Stand

- A QR plate (raised or engraved) with an optional **brand icon** (Instagram, Facebook, TikTok, Etsy, Pinterest, X) and/or a **title** in your choice of font, above or below the code, plus a separate **slotted base** that holds the plate standing up at an adjustable lean.
- A blank tab at the bottom of the plate keeps the slot clear of the code and the banner. Slot clearance is adjustable for your printer; slots that do not fit the base are refused with a message.
- Previews of the plate, the base and the **assembled** stand, an in-page scan check, and downloads as plate STL, plate 3MF (plate and artwork as two parts for two colours) and base STL.

### QR Code Keychain

- Link or text to QR (error correction L/M/Q/H, module size, quiet zone), raised or engraved.
- **Six loop styles**, above or below the code: round ring, rounded square, hexagon, teardrop, lanyard slot (a slot hole for a strap), and a full-width header with a hole. Every style keeps at least 2.5 mm of wall around the hole.
- **Full-width header options:** the outline can be a rectangle, a true semicircle, or a triangle leaning left or right (adjustable lean), with adjustable corner rounding, and you can move the hole left/right and up/down. Moving the hole too close to an edge, off the shape, or into the plate gives a clear message instead of a weak or blocked hole.
- **Scan check:** the model's own geometry is decoded in the page, so you know the code is readable before printing.
- **Rounded plate corners (optional):** a checkbox rounds the two plate corners farthest from the loop. The curve is exactly as wide as the quiet zone and centred on the code's corner, so the quiet zone keeps its width there.
- **Back engraving (optional):** the same QR cut, mirrored, into the underside so it reads correctly when you flip the keychain over, with the pockets coloured in the QR colour (bridged pockets; see the tool's tips for the filament changes).
- Two-colour output: the page shows the height for a single filament change; the 3MF carries plate and QR colours.

### 3D Stamp Generator

- **Artwork:** text (11 stamp-friendly fonts, or upload your own `.ttf` / `.otf` / `.woff`), an SVG / PNG / JPG logo, or both (logo above or beside text), plus an optional raised border.
- **Shapes:** rectangle with corner radius, or circle/oval. Optional round knob or grip bar handle, and an "up" arrow on the base.
- **Logo cleanup (PNG/JPG):** read from transparency or brightness, auto threshold, smoothing, speck removal, invert. SVG white backgrounds are dropped automatically.
- **Previews:** a 3D view (print orientation or stamp face) and a flat imprint preview of what it leaves on paper, with details thinner than 0.6 mm highlighted in red.
- **Print-ready output:** downloads as STL, 3MF, or a **2-part 3MF** (artwork face = filament slot 1, base and handle = slot 2) for a multi-material printer, e.g. a flexible TPU face on a rigid PETG/PLA base. All in millimetres. The stamp face is at z = 0, so it prints **face-down on the bed with no supports**, and the artwork is mirrored on the face so it stamps the right way round. Parts overlap slightly so slicers merge them cleanly.
- **Suggested print settings:** 0.4 mm nozzle, 0.12-0.16 mm layers, 3+ walls, 20%+ infill, smooth PEI sheet, ironing off. PLA/PETG are the easy rigid choices; TPU (about 95A) gives a face that conforms to the paper for more even ink transfer, but print it slowly with a direct-drive extruder, and prefer a rigid base and handle over an all-TPU stamp. The page's tips cover materials and ink in more detail.

## Run it locally

No build step:

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
```

Tests (geometry, SVG/image import, export validity) use Node 20+:

```sh
npm install
npm test
```

The tests download one font from jsDelivr on first run and skip the font-dependent tests when offline.
The site itself loads Three.js, opentype.js and the fonts from jsDelivr, so it needs an internet connection.

## Deploy

Enable GitHub Pages on the repo root: Settings > Pages > Deploy from branch `main` / `/ (root)`. All paths are relative, so it also works from a project subpath.

## Repo layout

| Path | What |
|---|---|
| `index.html`, `assets/` | Home page and shared styles |
| `tools/<name>/` | One folder per tool (`index.html`, UI wiring, and a DOM-free `geometry.js`) |
| `shared/js/` | Code shared by tools: 2D geometry, text layout, SVG and image import, raster checks, QR plates, 3D viewer, STL/3MF export |
| `tests/` | `node --test` suites |
| `docs/` | [Architecture](docs/ARCHITECTURE.md) and [roadmap](docs/ROADMAP.md) |
| `invite2svg/` | Existing Python/Streamlit app (QR stand, keychain, wedding invite). Being ported to JavaScript here, then removed. See the [port plan](docs/ROADMAP.md#porting-the-qr-tools-from-invite2svg) |

## Contributing a new tool

Create `tools/<id>/`, keep model-building code free of DOM access so it can be tested in Node, put anything a second tool needs into `shared/js/`, and add an entry to `tools/registry.json` (it then appears in the home page and in the navigation bar on every page; copy the header from an existing tool page). Conventions (units, orientation, copyright header) are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

See [LICENSE](LICENSE).
