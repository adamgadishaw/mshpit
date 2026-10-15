# Native image recovery and City/Artist navigation — 2026-10-15

Continues from `ea7b5db` in the isolated Android development checkout. The owner session/theme and production write guard were preserved. No real authentication submission, content mutation, push, deployment, native dependency change or paid service was used.

## A working fallback could be discarded by an old native error

The failure was reproduced on Android with the actual `SmartImage` component, `useImageAttempt` hook and Expo Image transport. The primary local image returned HTTP 404. The fallback returned HTTP 200, but a second queued source-less primary error arrived through the reused native image view's current fallback callback. The hook therefore treated the fallback as failed and displayed “PHOTO UNAVAILABLE.” This was intermittent, rather than a universal failure of fallback images.

The SDK's installed `expo-image/android/.../events/GlideRequestListener.kt` emits `ImageErrorEvent(errorMessage)` without a source identity. A JavaScript scope/index fence cannot identify the old request if native delivery calls the latest callback on the same view.

Commit **`3d328c2`** gives SmartImage each rendition's own React/native instance key. Avatar has the equivalent cache-key identity. Stable sources retain their view and memory/disk cache across unrelated renders; changing source, rendition or avatar version replaces the view, keeping queued old errors attached to the old callback. No image proxy provider, production URL or persisted cache policy changed.

Six tests execute the actual components and hook with queued source-less native-event routing. Both negative controls reproduce the failure if one native view is deliberately reused. The existing seven image-attempt policy tests also passed. Avatar's equivalent failure was demonstrated by that component/hook fixture; a separate live Avatar HTTP-failure check is not claimed.

Actual Android transport checks after the SmartImage correction:

| Case | Result |
| --- | --- |
| Three independent 404-primary / 200-fallback cases | Each displayed its working fallback. No queued primary error exhausted it. |
| Reopen the same image | Zero additional image-server requests on the warm-cache reopen. |
| Both distinct sources return 404 | Exactly two observed failures, explicit unavailable state, no continued attempt loop during the idle check. |
| Image response delayed four seconds | No early fallback/error; the original image displayed after the delayed response. |
| Switch away from a delayed photo | The old HTTP connection closed without completing its response; the selected image displayed and remained selected after the old delay elapsed. |

These checks used a loopback-only GET/HEAD server and the existing 4,140-byte app icon, not newly downloaded images or production uploads. Only local test URLs used a temporary local fallback route; real URLs kept their existing policy. Temporary source observation and routing were restored exactly before final regression checks. The screenshots are actual app renders with a clearly documented local image fixture, not Toronto/artist photography.

Evidence: `.tmp/overnight/artist-image-review/image-404-before-fix.json`, `image-fallback-three-fixed.json`, `image-{cache,404-both,slow,rapid}.json` and per-case archives. Before/after screenshots are in `.tmp/deliverables/mshpit-native-image-*.png`.

The first attempted image observer had not loaded into the running bundle. Those attempts were discarded. Subsequent tests explicitly reloaded the bundle and verified its local routing before collecting results. Source changes are not assumed to be live solely because a file was saved.

## Hosted City images had no error or retry path

Hosted `/images/cities/...` assets intentionally bypass external proxies. Their separate CityImage branch previously rendered a native Image with no error handler. An actual local hosted-path 404 left an empty tile, even while the City guide remained readable. There was no image-specific retry action.

The hosted branch now renders an accessible “Retry photo” state after a failed read. An explicit retry creates a fresh source instance for the same direct URL. Successful images still use memory/disk caching, and unrelated renders do not retry failed assets. Non-hosted photos retain the existing SmartImage policy and size hints. A failed image's retry action takes priority over opening its gallery.

On the actual City screen, the test first observed HTTP 404 and a retry state. After the local server made the **same URL** available, “Retry photo” fetched HTTP 200; the actual native display callback marked the image ready. Guide content remained visible throughout. No production City content was edited: the ephemeral GET fixture substituted one existing photo URL in the local response only.

Four additional component/hook tests cover direct delivery/cache identity, explicit same-URL retry, late-error rejection after changing city, and unchanged non-hosted delegation. Evidence: `city-hosted-{before,after}.json`; screenshots `mshpit-city-hosted-image-before.png`, `mshpit-city-hosted-image-after.png`, `mshpit-city-hosted-image-recovered.png`.

## Bounded navigation measurements

| Navigation | Debug-emulator result |
| --- | --- |
| Radiohead, Radiohead, Coldplay, Radiohead | Confirmed Artist page in 1,942 / 1,684 / 1,813 / 1,616 ms. Observed Artist-related reads settled at 10 / 10 / 11 / 10. No additional reads during each 2.5-second idle check. |
| Three Toronto visits | Populated City guide in 1,933 / 1,525 / 1,652 ms. Each made one guide read and one wording read; no additional requests during the idle check. |
| Rapid Radiohead → Coldplay | The initial delayed Radiohead reads aborted before forwarding. Coldplay remained current after the old delay elapsed. Hardware Back restored Radiohead and loaded its own confirmed data. |

These are warm development-bundle, bounded read-only observations. They do not establish universal network latency, release-frame performance or that every owner-reported loop is resolved. Artist revalidation on a deliberate new visit is distinct from an idle request loop. The observer counted the relevant Artist/City API families, not all HTTP traffic. Private headers, cookies and response bodies were not logged.

Evidence: `repeat.json`, `rapid.json`, `city-repeat.json` under `.tmp/overnight/artist-image-review/`.

Foreground and native pull-to-refresh validation is recorded in the final gate below. Directly invoking the internal refresh action twice intentionally aborts the predecessor; that exploratory probe bypassed the native control's existing busy guard and is not classified as an app request-loop defect.

## Startup limits

The previous normal 6.15-second populated-Feed observation starts at a JavaScript entry observer and excludes preceding module evaluation, native startup and Metro compilation. During this phase one explicit development reload logged **10,407 ms for Metro's Android bundle**, 2,227 modules. These measurements have different origins and cannot be added into a precise process-start metric. No production startup optimization or release timing is claimed; identity validation was not bypassed.

## Final regression gate

The full suite passed: **6,345 total, 6,344 passed, zero failed, one skipped**, 87.046 seconds (`.tmp/overnight/image-recovery-full-tests.log`). Syntax passed for 854 Node files and architecture passed at the unchanged 144/144 Store-hook ceiling. Android, iOS and web exports all passed with external maps. No TypeScript project check or native iOS compilation is claimed. The guarded local development server was restored after export.

Android evidence does not establish native iOS behavior, Apple simulator compilation, signed-device/TestFlight readiness or store certification. The production web checkout and separate font/CSP checkout remain outside these changes.

The real 17-second Artist background/return retained the confirmed page and caused zero additional Artist-family reads. A physical Android pull-to-refresh made exactly one read each for profile, photos and live summary. Reinvoking the current native RefreshControl callback while its refreshing guard was active caused no duplicate read. That gesture check used a deliberate 1.2-second local delay to make the busy state observable; it is not a latency benchmark. Evidence: `artist-foreground-ui-refresh.json`. Both News hardware Back entry points were also rerun successfully after the explicit current-source reload.
