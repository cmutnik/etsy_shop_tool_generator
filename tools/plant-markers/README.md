<!-- Copyright (c) 2025 cmutnik -->
# Plant Markers

Live.

- `geometry.js` - `parseNames()`, `buildMarkers(params)` -> `THREE.Group` (one sub-group per marker, each with `base` and `text` meshes) + marker positions + info. DOM-free, tested in `tests/plant-markers.test.mjs` (needs the Roboto font; skipped offline).
- `plant-markers.js` / `index.html` - the page: a names box, fonts, live preview, one STL / 3MF of the set, or a ZIP with one STL per marker (`zipStore()`).

Design notes
- Each marker is built centred on x = 0, head top at y = 0, spike pointing to -y, so it can be exported on its own; `buildMarkers()` then places them in rows that wrap at the bed width (a row is as deep as its deepest marker) and centres the set.
- The head is a rounded rectangle sized to the letters plus the margin (at least 30 mm wide, or all as wide as the widest); the spike is a tapered quad merged with the head by a 2D union, 0.2 mm into it, so the stake is one clean outline.
- Letters start at the stake's top surface (no overlap), so the filament change is a single layer height for the whole bed.
- Meshes are named `base` and `text` across all markers, so the 3MF has two parts (all stakes, all letters).
