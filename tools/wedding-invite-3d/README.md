<!-- Copyright (c) 2025 cmutnik -->
# 3D Wedding Invite (planned)

Port of `invite2svg/pages/1_🧊_3D_Wedding_Invite.py` (+ `card3d_utils.py`, `card_utils.py`, `photo_to_svg.py`).
Much of the vectorising is already covered by `shared/js/image-trace.js` and `shared/js/svg-import.js`;
what's missing is card deskew/border detection (OpenCV in the Python version) and the layered extrusion.
