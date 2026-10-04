<!-- Copyright (c) 2025 cmutnik -->
# Architecture

A **static site**: plain HTML + ES modules, no build step, hostable on GitHub Pages. Third-party libraries load from
jsDelivr through an import map in each page (`three`, `three/addons/`, `opentype.js`, `qrcode-generator`, `jsqr`, `polygon-clipping` - each page lists only what it uses). **Use jsDelivr's `+esm` URL for any npm package**: the raw `dist` file often imports bare package names (e.g. `polygon-clipping` imports `splaytree`) that a browser cannot resolve, and Node tests will not catch it. Everything runs in the
browser - nothing is uploaded.

```
index.html                  hub page; renders cards from tools/registry.json
assets/style.css            site-wide look & feel (light/dark)
assets/tool.css             layout + controls shared by tool pages
shared/js/                  code used by more than one tool
  geometry-pure.js          dependency-free 2D helpers: groups, polygon area / point-in-polygon, contour nesting, simplification
  geometry2d.js             "groups" ({outer, holes}) -> THREE.Shape, outline shapes, extrude, simplify
  rings.js                  dependency-free ring helpers: circle / rounded-rectangle rings, corner fillets, collinear-point cleanup
  boolean2d.js              2D polygon union/difference (polygon-clipping); re-exports rings.js. Import rings.js directly if you do not need booleans, so the page does not have to load polygon-clipping
  text-layout.js            opentype.js font + text -> groups
  svg-import.js             SVG text -> groups
  image-ops.js              picture -> black & white masks (threshold / adaptive / dither / edges), cleanup, mask -> SVG
  image-color.js            background removal, colour posterize (k-means) and per-layer SVGs that share one frame
  segmentation.js           seeded segmentation (random walker): subject mask from a few user-painted marks
  curves.js                 cubic Bezier fitting (Schneider) with corner detection, for smooth SVG output
  skeleton.js               centre-line tracing: thinning, spur pruning, skeleton -> paths -> stroke SVG
  zip.js                    minimal zip writer and reader (stored / deflate via DecompressionStream; no dependencies); the writer is re-exported by export.js
  mesh-import.js            STL (binary / ASCII) and 3MF (parts, colours, units, transforms, components) -> plain parts; no dependencies (3MF needs a DOMParser)
  image-trace.js            raster -> groups: source (alpha/brightness), Otsu auto threshold, smoothing, marching squares
  raster-tools.js           distance transform + thin-feature detection (printability checks)
  icons.js                  brand icon paths (Simple Icons, CC0) for the QR stand's banner
  qr-plate.js               QR matrix -> plate of boxes (raised/engraved), top-down raster for scan checks
  fonts.js                  font catalogue + loading
  viewer.js                 Three.js preview (z-up, print-bed grid, orbit controls)
  nav.js                    header navigation: lists every live tool from tools/registry.json, marks the current page (no dependencies)
  download.js               saveBlob-as-download helper (no dependencies)
  export.js                 binary STL, 3MF, zip writer, download helper
tools/
  registry.json             list of tools (live / planned / idea)
  stamp/                    3D stamp generator (live); imprint.js draws the 2D preview + flags thin details
  image-prep/               picture -> black & white / SVG line art (live, no external libraries)
  qr-keychain/ qr-stand/    QR keychain and QR stand (live)
  mesh-modifier/            STL / 3MF modifier (live): geometry.js transforms parts, attach.js builds the tab and label; no 3D booleans
  wedding-invite-3d/        planned - README only, see docs/ROADMAP.md
tests/                      node --test; geometry, import, export (npm test)
docs/                       this file + roadmap
invite2svg/                 legacy Python/Streamlit app, being ported (see roadmap); untouched
```

## Conventions for a tool
- One folder `tools/<id>/` with `index.html`, `<id>.js` (UI wiring), `geometry.js` (pure model building), a CSS file if needed.
- `geometry.js` takes plain parameters and returns a `THREE.Group` + info. It must not touch the DOM so it can be tested in Node.
- Model units are **mm**, **z up**, built so the object can be exported as-is: the printed surface that must be flat is at z = 0.
- Keep parts watertight individually; overlap touching parts slightly (see `OVERLAP` in the stamp) instead of leaving coplanar faces.
- Every source file starts with `Copyright (c) 2025 cmutnik` as a comment in that file's syntax (`//`, `/* */`, `<!-- -->`, `#`). JSON files and `LICENSE` are exempt.
- Every page starts with the shared header: `<header class="site"><a class="brand" href="../../">Etsy Shop Tools</a><nav id="toolnav" aria-label="Tools"></nav></header>` and ends with `<script type="module" src="../../shared/js/nav.js"></script>`. The links come from the registry, so a new tool shows up on every page by itself (`tests/nav.test.mjs` checks the pages and the registry).
- Add the tool to `tools/registry.json`. Anything a second tool needs goes into `shared/js/` (don't import across `tools/`).
- Each page repeats the import map (browsers don't allow external ones) - keep versions identical across pages.

## Meshes that slice cleanly
Every extrusion should go through `extrudeShapes()` in `shared/js/geometry2d.js`, never `new THREE.ExtrudeGeometry` directly. It
cleans the outline (three.js arcs leave ~1e-15 mm micro-segments) and repairs the caps: the triangulator can draw a long diagonal
past a vertex that sits exactly on it (typical when many letter bottoms share a baseline), leaving a crack with a single triangle on
an edge. The repair splits interior cap edges at such vertices, never outline edges (those are shared with the side walls). Artwork
from fonts and icons should also pass through a polygon union and a ~0.02 mm simplification first (`mergeArtwork()` in the stand).
`tests/helpers.mjs` has `assertWatertight()` (closed, consistent winding, positive volume).

## Keep pages light
A page only needs an import map entry for what its own module graph imports, so keep non-3D code free of Three.js:
`geometry-pure.js`, `rings.js`, `download.js`, `zip.js`, `image-*.js`, `segmentation.js`, `curves.js`, `skeleton.js` and `raster-tools.js` have no dependencies, while `geometry2d.js`,
`export.js`, `svg-import.js` and `qr-plate.js` import Three.js. `tests/page-deps.test.mjs` walks each tool page's imports and fails
if one is missing from (or unused in) that page's import map, which is the failure Node tests otherwise cannot see.

## Tests
`npm install && npm test`. Tests build real models with a Fontsource font (downloaded once into `node_modules/.font-cache`;
the font tests skip when offline), check each part is watertight, check 3MF validity with the system `unzip`, and
exercise SVG/raster import. `package.json` exists only for tests; the site itself has no dependencies to install.
