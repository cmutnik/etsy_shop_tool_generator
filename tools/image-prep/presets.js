// Copyright (c) 2025 cmutnik
// One-click starting points for Image Prep. `out` is the output mode ('png' | 'svg' | 'colors' | 'cutout'); `set` maps a control id to
// its value (a checkbox takes true / false). Controls a preset does not mention keep their current value.
export const PRESETS = [
  { id: 'logo-bw', label: 'Logo or flat art: clean black & white', out: 'png',
    set: { method: 'threshold', autoThreshold: true, blur: 1, stretch: false, invert: false, minInk: 12, fillHoles: 0, crop: true, cropPad: 8, transparent: false, bgRemove: false } },
  { id: 'logo-svg', label: 'Logo: SVG with smooth curves', out: 'svg',
    set: { lineStyle: 'trace', method: 'threshold', autoThreshold: true, blur: 1, invert: false, minInk: 12, smoothCurves: true, tolerance: 0.8, crop: true, cropPad: 8, bgRemove: false } },
  { id: 'photo-lines', label: 'Photo: line drawing', out: 'svg',
    set: { lineStyle: 'edges', edgeSource: 'auto', edgeSigma: 1.8, edgeSens: 50, lineWidth: 3, edgeInvert: false, smoothCurves: true, tolerance: 0.8, minInk: 20, crop: true, cropPad: 8 } },
  { id: 'handwriting', label: 'Handwriting or pen drawing: even lines', out: 'svg',
    set: { lineStyle: 'centerline', method: 'adaptive', adaptiveOffset: 10, blur: 1, stretch: true, invert: false, clWidth: 4, clPrune: 8, clOutput: 'filled', smoothCurves: true, tolerance: 0.8, minInk: 20, crop: true, cropPad: 10, bgRemove: false } },
  { id: 'page-photo', label: 'Phone photo of a page or drawing (uneven light)', out: 'png',
    set: { method: 'adaptive', adaptiveOffset: 10, blur: 1, stretch: true, invert: false, minInk: 20, crop: true, cropPad: 10, bgRemove: false } },
  { id: 'product-cutout', label: 'Product photo: cut out the background', out: 'cutout',
    set: { bgMode: 'auto', bgTolerance: 30, bgContiguous: true, bgGradient: true, bgFeather: 1, bgShrink: 0, minInk: 20, crop: true, cropPad: 6 } },
  { id: 'busy-cutout', label: 'Busy photo: cut out by marking the subject', out: 'cutout',
    set: { bgMode: 'marks', bgFeather: 1, bgShrink: 0, minInk: 20, crop: true, cropPad: 6 } },
  { id: 'stamp-layers', label: 'Multi-colour stamp: one layer per ink', out: 'colors',
    set: { nColors: 4, posterSmooth: 1, minInk: 12, fillHoles: 0, crop: true, cropPad: 6, smoothCurves: true, tolerance: 0.8, bgRemove: false } },
];
