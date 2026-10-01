<!-- Copyright (c) 2025 cmutnik -->
# QR Code Keychain (planned)

Port of `invite2svg/pages/3_🔑_QR_Code_Keychain.py`. Same QR plate as the stand (`build_qr_plate_mesh`), plus a
loop with a through-hole fused on as **one** printable piece (`build_keychain_loop_mesh`).

Parameters: error correction, module size, margin, plate thickness, emboss depth, loop outer diameter,
hole diameter, neck width, neck height.

Shares its QR plate builder with `tools/qr-stand/` - build that once in `shared/js/qr-plate.js`.
See [docs/ROADMAP.md](../../docs/ROADMAP.md#porting-the-qr-tools-from-invite2svg).
