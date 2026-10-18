# Profile layout and crop controls — local review, 2026-10-18

This candidate is local on `codex/profile-integrated-crop-web-20261018`, based on PR62 merge `700c39697883617ca551736e5497864ae191f963`. Nothing is pushed, merged or deployed.

## Layout scope

Variant A restores the exact web gradient, avatar border/size and text styling from pre-tile commit `e9c04a059b4ecb6e8604d57d1b1a81c333ac2280`. The enclosing panel is removed on web and the identity sits higher inside the compact, naturally growing banner. Native styles and the held native candidate are preserved.

The owner requested a matched A/B comparison. B is the selected earlier soft fade on the same rendered layout. The comparison uses identical synthetic content, artwork, Stage theme, 390 x 844 viewport and measured geometry; only the gradient differs. The owner explicitly selected B (Sentinel_14fecf4ac33c8191a71865c251b250ee); the reviewed fade-only patch is applied without other visual changes.

## Photo controls

Personal and artist profile editors offer drag, touch/pinch, a 1–4x zoom slider, keyboard nudging, Reset and Cancel before upload. Avatar previews are circular; banner crops retain the existing 3:1 contract. Banners remain responsive, so the UI advises keeping the subject near the center.

The browser preview loads only after photo selection. It passes a crop rectangle to the existing profile image normalizer: the existing 1024-square / 1800x600 JPEG output, encoder quality, private presign, create-only PUT, finalization, account binding and durable URL fields remain. A selected crop fails visibly rather than silently uploading a different center crop. Unsupported browser previews can use the original through the existing validation path.

The selected File is read without mutation. Other media's immutable-original flow is untouched. Crop coordinates are temporary; the saved profile image contains the crop, so a later re-crop requires selecting the original again. No backend route, schema, service, converter, native dependency or package change is introduced.

## Validation for selected B

- 48 layout cases passed: desktop/phone, Stage/Daylight, busy/light/dark/absent banners, long expanded biographies and simulated 200% text.
- 8 crop scenarios passed: personal/artist, phone/desktop, photo/banner, saved pixels matching preview, Save and new-document reopen, Cancel, repeat selection, touch dragging/pinch/slider, upload errors and retry, and unreadable-original rejection.
- Two additional small-phone cases passed at 320x640 and 390x844.
- Active-upload Cancel passed: request aborted; no finalization/profile save; old image preserved; preview URL released; editor unlocked; repeat selection and Escape work.
- 82 focused geometry, image-policy and account/upload-lifecycle/security tests passed.
- Final export passed at 511.8 KiB gzip against the unchanged 512 KiB budget.
- Required full project check passed: 6,694 tests passed, zero failed, one existing Windows symlink skip; production audit reports zero vulnerabilities; syntax, architecture and export pass.

Browser tests use the actual exported app, actual client normalization and byte transfer with isolated synthetic API/storage fixtures. They verify client persistence across server-fixture reload and saved image pixels; they do not certify live object storage, Safari on an iPhone, or native behavior. Production writes are prohibited in this review.

## Release gates

B is selected; separate release authorization remains pending. Preserve all held recovery/admin/native candidates and owner Metro 8084. No release action is included in this task.

The first full run exposed a callback-test seam still bound to the old picker/upload flow; it was updated to execute the actual wrapper and given bounded test timeouts. The architecture gate also required locating the dialog coordinator in the UI layer. Both were corrected before the final successful full check.

Selected-B verification passed on the exact combined runtime: 6,694 tests passed with zero failures and one existing Windows skip, the 48-case layout matrix passed, both crop smoke checks passed, and the actual B phone screenshot is pixel-identical to the delivered B preview. Source hashes and the local candidate identity are recorded in the selected-B review evidence. This design selection does not authorize release.
