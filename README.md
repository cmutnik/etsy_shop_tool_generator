<!-- Copyright (c) 2025 cmutnik -->
# Etsy Shop Tool Generator

Free, in-browser tools that help Etsy shop owners make products: QR code generators, stamp creators, STL/3MF modifiers and more.
Everything runs client-side as a static site, so it can be hosted for free (GitHub Pages) and **nothing you upload leaves your browser**.

## Tools

| Tool | Status | What it does |
|---|---|---|
| [3D Stamp Generator](tools/stamp/) | live | Text, logo and border stamps as FDM-ready STL / 3MF |
| [QR Code Keychain](tools/qr-keychain/) | live | QR plate with a split-ring loop, one printable piece (STL or colour 3MF) |
| [QR Code Stand](tools/qr-stand/) | planned | Embossed QR plate plus a slotted base, optional icon/title banner |
| [3D Wedding Invite](tools/wedding-invite-3d/) | planned | Invitation photo or SVG to a layered 3D print |
| STL / 3MF modifier | idea | Scale, split, add text or hanging holes to an existing model |

The list shown on the home page comes from [tools/registry.json](tools/registry.json).

### QR Code Keychain

- Link or text to QR (error correction L/M/Q/H, module size, quiet zone), raised or engraved, with a split-ring loop above or below.
- **Scan check:** the model's own geometry is decoded in the page, so you know the code is readable before printing.
- **Back engraving (optional):** the same QR cut, mirrored, into the underside so it reads correctly when you flip the keychain over, with the pockets coloured in the QR colour (bridged pockets; see the tool's tips for the filament changes).
- Two-colour output: the page shows the height for a single filament change; the 3MF carries plate and QR colours.

### 3D Stamp Generator

- **Artwork:** text (11 stamp-friendly fonts, or upload your own `.ttf` / `.otf` / `.woff`), an SVG / PNG / JPG logo, or both (logo above or beside text), plus an optional raised border.
- **Shapes:** rectangle with corner radius, or circle/oval. Optional round knob or grip bar handle, and an "up" arrow on the base.
- **Logo cleanup (PNG/JPG):** read from transparency or brightness, auto threshold, smoothing, speck removal, invert. SVG white backgrounds are dropped automatically.
- **Previews:** a 3D view (print orientation or stamp face) and a flat imprint preview of what it leaves on paper, with details thinner than 0.6 mm highlighted in red.
- **Print-ready output:** downloads as STL or 3MF, in millimetres. The stamp face is at z = 0, so it prints **face-down on the bed with no supports**, and the artwork is mirrored on the face so it stamps the right way round. Parts overlap slightly so slicers merge them cleanly.
- **Suggested print settings:** 0.4 mm nozzle, 0.12-0.16 mm layers, 3+ walls, 20%+ infill, PLA or PETG, smooth PEI sheet, ironing off. Use standard water- or pigment-based stamp ink.

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

Create `tools/<id>/`, keep model-building code free of DOM access so it can be tested in Node, put anything a second tool needs into `shared/js/`, and add an entry to `tools/registry.json`. Conventions (units, orientation, copyright header) are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

See [LICENSE](LICENSE).
