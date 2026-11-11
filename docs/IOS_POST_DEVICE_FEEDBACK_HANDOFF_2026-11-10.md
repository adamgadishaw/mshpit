# iOS device-feedback handoff — 2026-11-10

Status: a separate signed QA candidate is ready. It is not installed or deployed, and physical acceptance remains pending. Runtime/source commit: `e26c87a04e7d7d02d3f82429f31cf7bb8fd30549`, branch `ios/post-device-feedback`, based on `0f4aa12`. Later edits change only a test fixture and this handoff.

## Requested changes

- Removed large-title animation. Feed, Discover, and You headings now scroll as ordinary page content; Discover no longer depends on the old collapsing-title state.
- Moved the four Feed filters into an expandable, accessible side-menu category. Removed the fixed filter strip, large activity cards, and nested filter swipe handler. Normal post scrolling, automatic pagination, retained panes, and account isolation remain.
- Added compact Messages and Notifications icons with unread badges to the top bar. The whole bar hides after deliberate downward movement and returns after meaningful upward movement, with direction thresholds and stable content geometry. VoiceOver keeps controls visible; Reduce Motion skips the slide.
- Renamed “Your diary” to “Your posts.”
- Reproduced the installed revision's upload defect: Expo File.slice creates a binary Blob rejected by React Native before presign. Native signature inspection now uses a read-only handle, reads at most 96 bytes, and closes it reliably. Local preparation and account/network errors remain distinct and actionable; drafts and existing photos survive failures.
- Main iOS avatar/banner try their stored originals before existing delivery fallbacks, use distinct cache identities, and avoid early thumbnail decoding. The banner spans the profile width; the avatar is 96 points with a neutral border. Existing photos were not replaced. The precise cause of the user's existing banner blur is not established without device/source-image comparison.
- Integrated profile badge selection, confirmed persistence, public/self viewing, and capability gating. Selection never grants an award or changes permissions. The chooser requires the matching backend rollout; older servers expose an unavailable state rather than reporting a false save.

Implementation evidence: `ios-scroll-chrome-device-feedback-2026-11-10.md`, `ios-photo-upload-device-feedback-2026-11-10.md`, `ios-profile-display-quality-2026-11-10.md`, and `web-startup-badge-split-2026-11-10.md`.

## Regression and export evidence

The complete hermetic run exercised **9,285 tests**: **9,262 passed and 23 failed**, all because `editProfileIOSAccessibility.test.mjs` lacked the new status-badge module in its explicit import map. The only follow-up source change replaces that fixture import and map entry; no assertions or runtime code changed. Rerunning the entire affected file passed **25/25**, resolving every recorded failure. The original full run is not labeled a passing run; its log and the successful rerun are retained separately.

Syntax passed for 932 Node files; architecture and whitespace checks passed. Final iOS, Android, and web exports succeeded. All mapped application sources match the frozen source: **814 iOS, 761 Android, and 771 web modules**. Platform-isolation checks passed, including the inert default Feed-selection hook and absence of the iOS chrome domain on Android/web. Final web initial JavaScript is **524,237 / 524,288 gzip bytes**, with 51 bytes headroom and no budget increase.

Evidence is in `.tmp/feedback-validation/`: `full-tests.log`, `editor-fixture-rerun.log`, `final-export.log`, `source-map-verification.json`, `platform-isolation.json`, `final-syntax.log`, `final-architecture.log`, and `outcome.json`. The regression manifest covers 2,624 code/test files; the separate artifact freeze covers all 2,891 tracked files. These counts represent different scopes.

## Signed artifact

Relative to this worktree, `.tmp/native-device-feedback/device-feedback-candidate/` contains:

- `device-feedback.ipa`
- `Payload/MshpitDev.app`
- `receipt.json` and `manifest.json`

This is an **Expo-supported JavaScript-only QA repack**, not a fresh native compilation or an OTA update. It reuses the verified `bcd30cb` native binary. Native inputs and resolved public configuration are unchanged, and old/new iOS fingerprints match: `a40b6a4ab10d8a7a6318dd8398be05804b77e666`. The isolated pinned tool is `@expo/repack-app@0.10.4`; app dependencies and lockfiles were not changed.

Independent verification passed: all 814 module sources match the frozen commit/export; packaged Hermes bytes match the repack tool's paired bundle/map outputs; every IPA file matches the signed app. Strict/deep signature verification, certificate, entitlements, provisioning, configuration, and native executable payload checks pass. All 18 framework files are byte-identical. Signing changed only the outer signature and its precisely validated Mach-O size bookkeeping, in addition to the new JavaScript bundle.

All four previous candidates (`296ce4b`, `6417309`, `b1c9514`, `bcd30cb`), previous native inputs/dependencies, and previous source were preserved. The existing development identity and `com.mshpit.app.dev` remain unchanged. Provisioning expires **November 14, 2026, at 23:50:01 UTC**.

IPA SHA-256: `e52ea97b4839a584e3acddb9e76f559d51374a21b0f62f98a48094d1e222a9e4`.

Independent evidence: `.tmp/native-device-feedback/evidence/independent-final-review.json` and `independent-post-build-test-repair-review.json`. The latter confirms the post-build fixture repair is the only changed tracked file before this handoff; the artifact's source commit remains `e26c87a`.

## Backend and remaining acceptance

The separate backend/website candidate is `/Users/adamgadishaw/Documents/Codex/2026-11-10/task-2/backend-profile-badges`, final documentation head `cc3d00c5205101d8c43d4238bdc1b9c81b204383`, runtime `bd276d4e3c7d42a8a0bfcca46aa2b9f771f7be81`. It preserves the prepared profile website chain atop notification release `9c9a4eb`. Its 75 focused tests, syntax, architecture, and web export pass; all 706 exported project modules match source. Initial JavaScript is 516,736 / 524,288 gzip bytes. See its `docs/PROFILE_BADGE_BACKEND_HANDOFF_2026-11-10.md`. Nothing was pushed or deployed; its remote CI/release steps remain with the release owner. Deploying only the native app does not enable badge choices on the older backend.

Actual native gesture, retained UIKit offset, photo picker/upload, and image-sharpness acceptance remains unverified. Simulator testing stopped before launch because the Mac was locked and first initialization exhausted available disk. The task-created simulator was deleted, its local servers stopped, and the existing simulator and physical phone were untouched. Disk space recovered; only a regenerable task-owned Xcode module cache was removed. No live profile or production data was modified.
