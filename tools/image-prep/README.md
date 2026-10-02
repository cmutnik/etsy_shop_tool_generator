<!-- Copyright (c) 2025 cmutnik -->
# Image Prep

Live. Turns a picture into something the other tools (and a 3D printer) can use. Runs entirely in the browser with **no
external libraries** (the page needs no import map and works offline).

Four outputs:

- **Black & white (PNG):** threshold (auto / manual), adaptive (uneven light) or dither (halftone dots). Options: read from
  brightness or transparency, auto contrast, smoothing, invert, remove specks, fill tiny holes, trim margins, ink colour,
  transparent background.
- **Line art (SVG):** three styles.
  - *Trace shapes* (logos, silhouettes): black/white, then marching-squares outlines.
  - *Outline edges* (photos): Canny-style edge detection, thickened to a printable line.
  - *Centre line* (pen strokes, handwriting): thin each stroke to a 1 px skeleton (Zhang-Suen), prune short branches, redraw at
    one uniform thickness. Output as filled shapes (what the stamp generator can import) or editable strokes.
- **Colours:** posterize to 2-8 colours (k-means), pick which one is the paper, and get one layer per ink colour. **All layers
  share one frame** (same size and canvas, one common crop), so stamps made from them line up. Download each layer as SVG,
  everything as a ZIP, a combined SVG, or send a layer to the stamp generator.
- **Cut-out:** remove the background and download a colour PNG with a transparent background. Three ways to choose the background: automatic colour (plain or gradient backgrounds), a colour you click, or **marking** a few strokes on the subject and the background (busy photos).

Background removal is also a first step for every other output ("Remove the background first").

Also on the page:
- **Presets** ("Start from a preset"): one-click starting points for a logo, a photo line drawing, handwriting, a phone photo of a page, a product cut-out, a busy-photo cut-out and multi-colour stamp layers. They only set controls; tuning anything afterwards switches the menu back to Custom.
- **Print width (mm) and the thin-detail check:** enter the width of the finished print and black details narrower than 0.6 mm (`MIN_FEATURE_MM`, shared with the stamp generator) are shown in red on the result, with the percentage. The overlay is a separate layer, so downloads are never altered.
- **Zoom** (Fit, 100%, 200%, 400%) with the two pictures scrolling together, to inspect fine detail.

**Use in the 3D stamp generator** hands the result to `tools/stamp` as its logo through `sessionStorage`
(`etsytools.handoff` = `{ name, type, dataUrl, frame }`, read once on load by `stamp.js`). Colour layers are sent with
`frame: true`, which ticks "Keep the picture's frame" there: each layer is then positioned and scaled by the picture's frame
instead of by its own artwork, which is what keeps the stamps registered.

Code: the processing is in `shared/js/image-ops.js` (masks, cleanup, SVG), `image-color.js` (background removal, posterize), `segmentation.js` (marks),
`curves.js` (Bezier fitting) and `skeleton.js` (centre line): pure functions on typed arrays, tested in `tests/image-*.test.mjs` and `tests/skeleton.test.mjs`.
`prep.js` is only UI wiring.

Notes
- **Marking the subject** uses a random walker (Grady 2006): every unmarked pixel gets the probability that a random walk from it reaches
  a subject mark before a background mark, with walks biased against crossing image edges, so the boundary settles on the real outline.
  It is solved with preconditioned conjugate gradients on a grid of at most 480 px (about half a second), then upsampled; the marks
  themselves are always honoured. The edge weights use an absolute colour scale (not relative to the picture's average edge), which keeps
  ordinary noise cheap to cross however many strong edges there are. "Include more of the edge" moves the 50% cut-off.
- **Smooth curves** fit cubic Beziers (Schneider's algorithm) to the traced outline: corners are found first and kept sharp, tangents come
  from a least-squares quadratic over about 25% of each run (a chord or a one-sided difference is too noisy on pixel staircases). The
  result is genuinely smooth, but a curve costs six numbers where a polygon vertex costs two, so the file is **not** smaller than a
  coarse polygon; "Path accuracy" trades fidelity against simplicity.
- **Background removal** measures colour distance from the background colour (auto = the most common colour along the border).
  "Only connected to the edge" keeps same-coloured areas inside the subject (a white eye stays). "Follow gradients" also spreads
  to pixels only slightly different from a neighbouring background pixel, so gradients, vignettes and soft shadows are removed
  while a sharp outline stops it; very soft or low-contrast subject edges can leak, in which case lower the tolerance or turn it
  off. It is a colour method, not a segmentation model, so it works best on plain or evenly lit backgrounds.
- **Posterize** uses a fixed random seed, so the same picture always gives the same colours. Click a palette swatch to change
  which colour is the paper; click the paper swatch again for none.
- **Centre line:** free ends retract by about half the original stroke width (inherent to thinning), and a stroke's thickness is
  replaced by the thickness you choose.
- Auto threshold is Otsu's method, which assumes two tones. On a continuous-tone photo it gives a mostly black or white result;
  the page says so and suggests Adaptive, Dither or Outline edges.
- Edge sensitivity chooses its thresholds from the picture's own edge strengths (a percentile of the thinned ridges), with an
  absolute floor of about 2 grey levels per pixel so a flat, noisy picture does not fill with edges.
- The SVG is one even-odd path of filled shapes. `shared/js/svg-import.js` (the stamp's importer) reads it, which tests check.
