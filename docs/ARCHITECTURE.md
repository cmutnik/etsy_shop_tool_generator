<!-- Copyright (c) 2025 cmutnik -->
# Architecture

A **static site**: plain HTML + ES modules, no build step, hostable on GitHub Pages. Third-party libraries load from
jsDelivr through an import map in each page (`three`, `three/addons/`, `opentype.js`, `qrcode-generator`, `jsqr` - each page lists only what it uses). Everything runs in the
browser - nothing is uploaded.

```
index.html                  hub page; renders cards from tools/registry.json
assets/style.css            site-wide look & feel (light/dark)
assets/tool.css             layout + controls shared by tool pages
shared/js/                  code used by more than one tool
  geometry2d.js             "groups" ({outer, holes}) -> THREE.Shape, outline shapes, extrude, simplify
  text-layout.js            opentype.js font + text -> groups
  svg-import.js             SVG text -> groups
  image-trace.js            raster -> groups: source (alpha/brightness), Otsu auto threshold, smoothing, marching squares
  raster-tools.js           distance transform + thin-feature detection (printability checks)
  qr-plate.js               QR matrix -> plate of boxes (raised/engraved), top-down raster for scan checks
  fonts.js                  font catalogue + loading
  viewer.js                 Three.js preview (z-up, print-bed grid, orbit controls)
  export.js                 binary STL, 3MF, zip writer, download helper
tools/
  registry.json             list of tools (live / planned / idea)
  stamp/                    3D stamp generator (live); imprint.js draws the 2D preview + flags thin details
  qr-keychain/              QR keychain (live)
  qr-stand/ wedding-invite-3d/   planned - README only, see docs/ROADMAP.md
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
- Add the tool to `tools/registry.json`. Anything a second tool needs goes into `shared/js/` (don't import across `tools/`).
- Each page repeats the import map (browsers don't allow external ones) - keep versions identical across pages.

## Tests
`npm install && npm test`. Tests build real models with a Fontsource font (downloaded once into `node_modules/.font-cache`;
the font tests skip when offline), check each part is watertight, check 3MF validity with the system `unzip`, and
exercise SVG/raster import. `package.json` exists only for tests; the site itself has no dependencies to install.
