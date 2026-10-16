<!-- Copyright (c) 2025 cmutnik -->
# Mesh Checker

Live.

- `shared/js/mesh-check.js` - `checkMesh(parts, { bed, overhangAngle, minWall, nozzle })` -> `{ findings, verdict, stats, flags }`; `analysePart()` (welded topology, volume, shells), `wallThickness()` (ray casts). DOM-free, tested in `tests/mesh-check.test.mjs`.
- `mesh-checker.js` / `index.html` - the page: opens STL / 3MF / OBJ with the shared importer, shows findings in plain language, colours overhangs (red) and thin-wall samples (orange) in the preview, and repairs with the modifier's `repairParts()` before offering an STL download.

Design notes
- Each finding is `{ level: ok | info | warn | bad, id, title, detail, fix }`; the verdict is the worst level. Bad = open edges, non-manifold edges, inside-out, wall under the nozzle, too big for the bed.
- Overhang = a downward-facing triangle steeper than the angle (normal z < -cos angle), apart from faces within 0.1 mm of the bed. Bed contact area is reported separately.
- Wall thickness: about 3000 area-weighted, evenly spread sample faces; a ray goes inward from each face centre and the nearest hit within max(3 x min wall, 2 mm) is the thickness. A uniform grid with a 3D DDA keeps an 80,000-triangle model well under a second. It needs a closed, outward-facing part, so it is skipped (with a note) on a broken one. It is a sample, so a thin fin can be missed; the page says so.
- Shells come from union-find on welded vertices; a shell under 1 mm across in a multi-piece model counts as a speck.
