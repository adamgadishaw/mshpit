# Native News Back and session-restoration review — 2026-10-15

This phase follows `ddab982` on the isolated Android development branch. The owner account remained signed in; no login, logout, credential change, content mutation, push or deployment was performed.

## Confirmed Android Back issue and correction

With an actual News story's GET delayed by four seconds, hardware Back popped the News screen, or left the app when the story was opened from the Feed root. The pending “Opening story…” action did not receive first priority. The source's explicit Cancel already rejected late responses correctly.

The Android listener now reads the current story-notice cancellation callback through a ref, cancels that notice and consumes the first Back. A subsequent Back follows the existing stack/composer behavior. The web and iOS listener policy is unchanged. No URL support was broadened: native incoming links still accept the existing owned News routes only.

Actual emulator checks after the correction:

- Back from News while loading preserves News, removes the notice, and rejects the delayed response.
- Back from Feed while loading preserves the foreground app and Feed, removes the notice, and rejects the delayed response.
- Explicit Cancel rejects a delayed response.
- Closing News for a newer Feed navigation rejects a delayed response.
- A second real story selected while the first is delayed remains selected after both reads finish; the slower first response cannot replace it.
- A simulated network failure and a simulated missing post both retain News and show “This story could not be opened.” Each recovers to the correct real story through “Try again.”

The temporary debug fixture intercepted GETs for only two actual story post IDs. Successful requests used the real read-only API; the missing case returned `{post:null}` locally. Fixtures changed no headers or cookies and logged no credentials. Navigation callbacks were invoked through the mounted component props; hardware Back was an actual Android key event. The original fetch was restored afterward.

Evidence: `.tmp/overnight/news-review/` (seven completed cases plus the two before-fix records). Screenshots: `.tmp/deliverables/mshpit-news-offline.png` and `mshpit-news-missing.png`.

## Startup and session measurements

Temporary debug-only entry instrumentation observed requests and anonymous readiness flags before root registration. The exact original `index.js` was restored after these measurements. Timings begin at that JavaScript observer, **not** process launch, and are development-emulator observations rather than release performance budgets.

| Case | Confirmed session UI | First populated Feed | Identity read |
| --- | ---: | ---: | --- |
| Normal authenticated restoration | 4.68 s | 6.15 s | 1.24 s response time |
| First identity GET delayed locally by 4 s | 8.43 s | 10.04 s | 4.99 s including deliberate delay |
| First identity GET fails locally once after 1.2 s | 10.72 s | 13.11 s | Retry starts at 7.86 s, succeeds at 8.90 s |

The app deliberately blocks cold-start personalized UI until `/api/me` confirms identity. During the transient failure it showed the real loading screen, retried automatically, and restored the existing owner account and Feed. No guest payload, fake authenticated response, stored credential read or identity-barrier bypass was used. The screenshot `mshpit-session-restoring.png` records the actual loading state.

A separate real 17-second background/resume test failed the next identity GET once. All 85 sampled foreground states retained the same owner Feed without a loading-screen replacement; the automatic retry returned HTTP 200 at 26.85 s from fixture installation. Original fetch was restored. This tests ordinary confirmed-session recovery, not a revoked session or cross-account sign-in.

Evidence: `.tmp/overnight/startup-review/{baseline,slow,offline-once,resume-offline-once}.json`. Two early debug observer connections became stale while the bundle reloaded; successful measurements were recovered from the in-app observer after reconnecting. This was a harness issue, not counted as an app failure. A duplicate observer-finish attempt correctly rejected restoration after the first collector had already restored fetch.

The unchanged login UI sets busy state immediately, aborts pending authentication on navigation, rejects stale completion, clears busy state after recoverable failure and requires a fresh user action to retry. Twenty-four isolated login cancellation/intent tests passed. No real authentication POST was submitted, so server password-validation latency is unmeasured.

## Media follow-up carried forward

Six local-video cycles after the prior fullscreen fix also passed: every player was released; Home paused playback and returning stayed paused. Settled PSS was 753,916 → 749,036 KiB; native heap 460,722 → 466,546 KiB; native views 676 → 676 and activities remained one. These bounded debug observations do not establish leak-free operation. Evidence: `.tmp/overnight/media-resources-after-fullscreen-fix/results.json`.

## Regression gate

The full suite passed: **6,335 total, 6,334 passed, zero failed, one skipped**, 92.667 s (`.tmp/overnight/news-back-full-tests.log`). Syntax passed for 854 Node files; architecture passed at the unchanged 144/144 Store-hook ceiling. Android, iOS and web exports all passed with external maps (`.tmp/overnight/export-results.json`). No TypeScript project check or native iOS compile/runtime result is claimed. The three new tests execute the actual registered App Android Back listener, including pending root/nested behavior, later current callbacks, normal stack behavior, cleanup and the iOS/web exclusion. Twenty-seven focused News/navigation/session tests passed before the final gate.

No native dependency, permission, signing credential, production web checkout or deployment changed. Native iOS compilation/device certification remains outside these Android results.
