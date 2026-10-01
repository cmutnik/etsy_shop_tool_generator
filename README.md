<!-- Copyright (c) 2025 cmutnik -->
# Etsy Shop Tool Generator

This repo will be a UI that helps etsy shop owners. It will contain various tools like QR code generators, stamp creators, STL/3mf modifiers, etc.

----
**ideas**
- rip the QR code components from `./invite2svg/`, so they can be relocated here and removed from the 
- stamp generator
  - shop name
  - logo

----
**Running the static tools** (no build step)
```
python3 -m http.server 8000   # then open http://localhost:8000/
npm install && npm test       # optional: geometry/export tests
```
Deploy by enabling GitHub Pages on the repo root (Settings > Pages > Deploy from branch `main` / root).

**Layout** - see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

| Path | What |
|---|---|
| `tools/stamp/` | 3D stamp generator (live): text / SVG / PNG / JPG logo, STL + 3MF export |
| `tools/qr-stand/`, `tools/qr-keychain/`, `tools/wedding-invite-3d/` | planned ports of the tools in `invite2svg/` |
| `shared/js/` | geometry, import, viewer and export code shared by tools |
| `invite2svg/` | existing Python/Streamlit app; to be ported, then removed |
