<!-- Copyright (c) 2025 cmutnik -->
# QR Code Stand (planned)

Port of `invite2svg/pages/2_🪧_QR_Code_Stand.py` + `invite2svg/qr_stand_utils.py`.
A plate with the QR code embossed/engraved, an optional icon/title banner, and a **separate** slotted base block
(slot cut at a lean-back angle) that the plate slides into.

Parameters to carry over: error correction, module size, quiet-zone margin, plate thickness, emboss/engrave depth,
icon + size, title text + height, base depth/height, tilt angle, slot depth, slot clearance.

See [docs/ROADMAP.md](../../docs/ROADMAP.md#porting-the-qr-tools-from-invite2svg) for the Python -> JS mapping.
Reuse from `shared/js/`: `viewer.js`, `export.js`, `text-layout.js` (title), `fonts.js`, `geometry2d.js`.
