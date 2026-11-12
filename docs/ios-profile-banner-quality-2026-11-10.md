# iOS profile banner quality and crop

## Evidence and scope

The old iOS banner picker disabled editing because Expo 57 only offers a square system crop on iOS. Android passes `aspect: [3, 1]` and offers a native wide crop. iOS then uploaded a centered crop without a preview.

The old iOS path used picker quality 0.85, saved an orientation-normalized intermediate JPEG at 0.92, saved the resized crop at 0.86, and sent it through the required server JPEG sanitizer at 90. This unnecessarily discarded detail before the 1800 x 600 public rendition was created. The server sanitizer and output contract remain unchanged.

The profile banner already uses the original stored URL, not a small thumbnail. Its primary image has no blur effect. A legacy HEIC URL or failed primary request may still use the existing image proxy fallback. No production account or original camera file was inspected, so these findings identify avoidable quality loss rather than proving the exact cause of every existing blurry image. Previously uploaded detail cannot be reconstructed; reselecting the original is necessary to benefit from the new upload path.

## Local implementation

- iOS banner picker requests maximum quality and opens a 3:1 crop preview after selection. Android/web pickers stay unchanged.
- Drag/pinch reposition and zoom; labelled 44-point buttons provide zoom, reset and directional adjustments. A low-detail crop shows a warning rather than promising sharper pixels.
- Preview uses an orientation-corrected native ImageRef. The approved normalized crop is applied to those same native pixels, without an intermediate JPEG.
- iOS normalizer writes one 96% JPEG after crop/resize. Server-owned sanitization, ownership checks and durable URL finalization stay unchanged. Android/web normalizers remain unchanged.
- VoiceOver isolation covers the whole modal, accessibility escape cancels, and modal motion follows Reduce Motion.
- Cancel aborts the account-scoped operation; late callbacks cannot replace the old banner. Failed uploads keep the crop for retry. Hidden/retained editors cannot resurrect a canceled modal or read a disposed native preview. The profile is unchanged until Save.
- Profile banner artwork has an in-flow 3:1 layout so image measurement does not start from an absolute-only child. Its existing 44-point minimum hit target remains.
- Artist and personal editor previews match 3:1 on iOS. The personal preview style was extracted separately for the clean integration; badge client/server changes are excluded.

## Verification

- 39 focused tests pass: crop geometry (portrait, landscape, extreme panorama), single encoding, source ownership, cancellation during decode/render/save, repeated requests, late callbacks, upload retry, accessible controls, and Metro platform resolution.
- 103 existing profile media/presentation/editor submission/accessibility tests pass.
- Syntax check passed across 928 Node files. Architecture check passed.
- Expo SDK 57 docs and installed native ImageManipulator implementation were checked: native SharedRef input is supported and orientation is corrected before crop.

Not yet verified: actual iPhone appearance, native Photos/HEIC/color-space behavior, pinch smoothness, or upload/network behavior against a real account. The user's phone was not accessed. No deployment, app installation, or production writes occurred. Final combined native build and device review belong to the integration task.
