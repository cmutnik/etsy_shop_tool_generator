<!-- Copyright (c) 2025 cmutnik -->
# Image Prep

Live. Turns a picture into something the other tools (and a 3D printer) can use. Runs entirely in the browser with **no
external libraries** (the page needs no import map and works offline).

- **Black & white image (PNG):** threshold (auto / manual), adaptive (uneven light), or dither (halftone dots). Options: read from
  brightness or transparency, auto contrast, smoothing, invert, remove specks, fill tiny holes, trim margins, ink colour,
  transparent background.
- **Line art (SVG):** *Trace shapes* (logos, silhouettes, drawings: black/white, then marching-squares outlines) or *Outline
  edges* (photos: Canny-style edge detection, then thickened to a printable line). Smooth curves and path simplification.
- **Use in the 3D stamp generator:** hands the result to `tools/stamp` as its logo through `sessionStorage`
  (`etsytools.handoff` = `{ name, type, dataUrl }`, read once on load by `stamp.js`).

Code: the processing is in `shared/js/image-ops.js` (pure functions on typed arrays, tested in `tests/image-ops.test.mjs`);
`prep.js` is only UI wiring.

Notes
- Auto threshold is Otsu's method, which assumes two tones. On a continuous-tone photo it gives a mostly black or white
  result; the page says so and suggests Adaptive, Dither or Outline edges.
- Edge sensitivity chooses its thresholds from the picture's own edge strengths (a percentile of the thinned ridges), with an
  absolute floor of about 2 grey levels per pixel so a flat, noisy picture does not fill with edges.
- The SVG is one even-odd path of filled shapes. `shared/js/svg-import.js` (the stamp's importer) reads it, which a test checks.
