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
| [Flexi Maker](tools/flexi-maker/) | live | Turn a model into an articulated, print-in-place flexi with chain-link (hook and loop) or ball-and-socket joints; keeps 3MF colours |
| [3D Wedding Invite](https://invite2svg.streamlit.app/) | live (external) | Invitation photo or SVG to a layered 3D print, in the separate invite2svg Streamlit app |
| [STL / 3MF Modifier](tools/mesh-modifier/) | live | Open an existing model, resize / rotate / mirror it, add a hanging tab or raised text; keeps 3MF parts and colours |

The list shown on the home page comes from [tools/registry.json](tools/registry.json).

### STL / 3MF Modifier

- **Open** an `.stl` (binary or ASCII), `.3mf` or `.obj`, by file picker or drag and drop. **Coloured OBJ:** pick the `.obj` and its `.mtl` together; each material becomes a part with its colour (a model with only groups is split by group; one coloured point by point, as AI-generated and scanned models usually are, has its shades reduced to a palette of 6 colours by default, each its own part; change "Colours to keep" for more or fewer). **Slicer 3MF files (Bambu Studio, OrcaSlicer, PrusaSlicer):** colour is read from the project's filament palette and each object's extruder, and painted triangles (`paint_color`) are split by the filament painted on them, so painted details like eyes keep their colour. Image textures cannot be printed, so a textured material gets its plain colour and a note says so; an OBJ saved Y-up gets a hint to rotate it. The file is read in the page and never uploaded.
- **Size and orientation:** type a width, depth or height in mm (or a percentage), with or without keeping proportions; rotate in 90-degree steps or any angle; mirror; centre on the bed and drop the lowest point to Z = 0; inch / cm files converted to mm.
- **Lay flat:** one click turns the model so its largest flat face rests on the bed.
- **Parts and filament slots:** each part of a multi-part model can be left out, recoloured, or given a filament slot (1-16). On auto, parts of the same colour share a slot; slots already in a 3MF are kept, and the 3MF you download carries them. A part that was inside-out is turned the right way round automatically.
- **Hanging tab:** a ring (round, rounded square, hexagon or lanyard slot) fused to the model's edge at bed level, so it prints flat with no supports. The edge is found from the real mesh, so it works on round and irregular models. Wall, overlap and hole clearance are checked with plain messages.
- **Raised or engraved text:** any of the stamp fonts (or your own) set on the model's top surface, either added on top or cut into it (keeping at least 0.8 mm of floor), and optionally filled with a second colour as its own part for a two-colour inlay, with warnings if the surface is uneven or the text hangs past the edge.
- **Drill a hole:** a round hole straight down, straight up from the bottom, or sideways along either horizontal axis from either end (for jump rings and chains), all the way through or to a set depth, at any position and height.
- **Cut in two:** split at a height and keep both halves (laid out side by side, each printing flat on its cut face), or just one. Optional alignment pegs on the lower half and matching sockets, with adjustable clearance, in the upper half. Also works as a flat-bottom cut.
- **3MF fidelity:** every object stays its own part with its name and colour, build transforms and component assemblies are applied, and a mesh painted in several colours becomes one part per colour. Tabs and text export as extra parts for multi-colour printing. Slicer project 3MFs (checked against a real Bambu Studio file with objects in separate files, scaled and rotated placement, painted colours and filament slots) keep their names, placement, filament slots, filament colours and painted colours; the print profile, plate layout and support settings are not carried over.
- The cuts use [manifold-3d](https://github.com/elalish/manifold) (WASM, about 0.5 MB), downloaded only the first time you turn one on, and they need closed (watertight) parts; the page names any part that is not.
- **Compressed 3MF:** the 3MF download is deflated, typically several times smaller (a 1.9M-triangle model: 163 MB down to 23 MB).
- **Keep the slicer's print settings (experimental):** when the opened file is a Bambu Studio / OrcaSlicer project, the page shows its printer and print profile and can copy them into the saved 3MF, with the filament colours following the colours you set. Two levels, because slicers differ in what they accept; check the result opens as you expect.
- **Undo / redo:** every change to the settings, part list, size, repair and tab/text/cut options can be undone and redone (buttons above the preview, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z outside a text box). A burst of typing is one step; opening another file starts a fresh history.
- **Repair:** when a model has open edges, a button merges duplicate points, removes degenerate and duplicate triangles, turns inside-out faces round, fills small holes (including concave ones), and pulls apart surfaces that touch along an edge (common in scanned and AI-generated models, and the usual reason a model that looks closed is refused by the cutting tools). It works at any scale and handles models with millions of triangles in seconds. It only reports a part as fixed when it really is a closed solid afterwards, tells you what it could not fix, and can be undone.
- Reports triangle count, volume and open edges.

### Flexi Maker

- **Open** an STL, 3MF or OBJ (with its .mtl; colours and filament slots are kept), set the size and direction, choose which way to cut across and how many segments, and press **Make it flexi**. The cut planes are shown in the preview first; you can also type exact cut positions.
- **Hook-and-loop (chain link) or ball-and-socket joints that print assembled.** Every cut gets a joint where the biggest circle fits the cross-section; a V-notch is removed around it so the pieces can tilt. Hook and loop (the default) puts a closed loop on each segment and links the two at right angles like a chain, so each pair swings and twists; the segments end up a link-length apart. Ball and socket puts a ball on a short neck on one segment and a cup over it on the next, like an articulated figure. Where a cut crosses several separate pieces (two legs, say) each gets its own joint; pieces too thin for one stay solid, with a warning.
- **Colours are maintained.** Every part keeps its colour in every segment (a painted model is cut whole, then each result triangle takes the colour of the painted surface it came from, so cut faces and joints are coloured to match), and a joint takes the colour of the part it grows out of. Download the 3MF for colours and filament slots (an STL merges everything).
- **Try the bend:** after making it, a slider in the preview tilts the segments about their real joint centres so you can see the joints move. It is only a picture (the download is the straight model).
- **Tuning:** bend per joint (reduced with a message when the pieces are too short), ball size or bar thickness, and joint clearance. The model is laid on its side for printing by default so the joint gaps are vertical.
- **Fix the model:** a box appears when a part is not watertight or the model is heavy. *Repair open edges* closes small gaps and cracks (undoable); parts that are colour patches of one painted surface are repaired together as the one solid they make, and keep their colours. *Reduce triangles* merges tiny edges down to a target count (default 100,000) while never moving the surface more than the distance you set (default 0.2 mm); a 1.9-million-triangle AI model drops to about 80,000 with a change of about 0.1 % of its size. Left empty, the limit is 0.15 % of the model's longest side. It only works on closed parts, and the page names any part it could not close. Models over 150,000 triangles are slow to cut, and over 600,000 are refused until reduced.
- Uses [manifold-3d](https://github.com/elalish/manifold) (downloaded when you press the button) and needs closed (watertight) parts. Tested by tilting the finished pieces and checking they never touch, and that the ball cannot be pulled out of its socket. Not yet test-printed: expect to tune the clearance for your printer.

### Image Prep

- **Black & white:** threshold (auto/manual), adaptive (for shadows and uneven light) or dither (halftone), with auto contrast, smoothing, invert, speck removal, margin trimming and a transparent-background option. Downloads as PNG.
- **Line art (SVG):** trace shapes (logos, drawings), outline edges (turn a photo into a line drawing), or **centre line** (pen strokes and handwriting redrawn at one even thickness, as filled shapes or editable strokes).
- **Colours:** posterize to 2-8 colours and get one layer per ink colour for **multi-colour stamps**. Every layer shares one frame, so the stamps line up; download layers as SVG, all of them as a ZIP, or send one to the stamp generator.
- **Cut-out and background removal:** remove a plain or gradient background (auto colour, or click to pick), or for **busy photos paint a few strokes on the subject and the background** and let the tool find the outline. Same-coloured areas inside the subject are kept; the edge can be softened or shrunk. Download a transparent PNG, or use it as the first step for any other output.
- **Smooth Bezier curves** for SVG output (corners stay sharp), **presets** for common jobs, a **print-width check** that marks details too thin for a 0.4 mm nozzle in red, and zoom with synchronised scrolling.
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

## Contributing a new tool

Create `tools/<id>/`, keep model-building code free of DOM access so it can be tested in Node, put anything a second tool needs into `shared/js/`, and add an entry to `tools/registry.json` (it then appears in the home page and in the navigation bar on every page; copy the header from an existing tool page). Conventions (units, orientation, copyright header) are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

See [LICENSE](LICENSE).
