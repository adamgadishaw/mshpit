# iOS Discover swipe latency correction

Base: `ce319fb` (installed runtime checkpoint `a7a8117`).
Scope: iOS local Feed/Discover pager mechanics; the user identified Discover as the major lag and Feed as minor. No bottom-navigation swipe, backend, dependency, Store, Android/web behavior, or phone changes.

## Reproduced controls, not device performance measurements

- Accepted swipe release waited for the destination's network content readiness, up to 2,500 ms, despite its actual loading screen already being laid out.
- An unchanged outgoing Shows tree rerendered for candidate preparation, layout readiness, and Festival GET completion (2 initial executions grew to 5). It now stays at 2 through those transitions; real parent data updates still rerender it.
- A successful selection whose parent promotion was delayed 30 ms received a premature return-to-source spring from a 0 ms recovery timer.
- Regrabbing a returning page discarded its residual position. A synthetic -60 px return frame followed by a -20 px finger move now yields -80 px, without an old spring callback removing the candidate.
- Reversal A→B→A could use A's old layout credit after A unmounted if the readiness clear had not reached the UI. Each direction now gets a fresh admission token.

## Corrections

- Settlement waits only for actual module-resolved native screen layout, never network completion. Real loading, empty, and error content can settle normally.
- The Festival lazy boundary moved from its inner iOS panel to the existing page boundary, so its lazy spinner cannot impersonate actual incoming screen readiness. Explicit active selection still receives the same loading indicator.
- Memoized page plus stable Discover render adapter skips outgoing renders caused only by candidate/readiness state.
- Local callbacks explicitly report accepted/declined selection. Accepted navigation retains the settled destination through React promotion; declined selection recovers and rearms.
- Regrab cancels the old animation only after horizontal intent wins and includes the residual position. Layout carry is allowed only while a matching unfinished return owns the still-mounted candidate. Completed cancellation and reversal cannot lend obsolete readiness.
- Late JS owner/gesture admission checks remain. No per-frame RN dispatch or broad shared-value redesign was introduced.

## Isolated verification before integration

- 168/168 related tests pass: actual React swipe component suite, legacy native rail, Discover presentation, page geometry/release, programme/lazy-loading, social controls, language, and navigation contracts.
- The swipe suite includes the actual production Discover `renderPanel` callback, not just a direct nonlazy Festival substitute, and tests suspended module vs real resource-loading UI.
- Regressions retain cancellation, reversal, nested native gesture priority, current-route/account/StrictMode fences, Reduce Motion/VoiceOver, same resource instance across promotion, preview read ownership, and no hidden impressions/dwell/persistence/refresh registration.
- Installed Expo SDK57 Babel preset compiles all 7 changed runtime JSX files, including real worklet transformation. Node syntax gate passes 926 files. `git diff --check` passes.
- Shared Discover source before and after its iOS-only return branch is byte-identical to base. Android/web exports and full aggregate gates remain for integration.

## Integrated release checkpoint

The isolated reviewed commit `5aaca8cd673dbfed45f1dc06deda521ccb002feb` was cherry-picked onto clean `ce319fb` as runtime commit `80601219641f7f49bc3df02eb96a834f66480708`. Their trees are identical. At the end of isolated verification, exports, aggregate tests, and a signed build had not run; the following integration results supersede that historical limitation. This document's later documentation-only commit does not change the built runtime source.

- Full configured suite ran serially: **8,567 passed, 0 failed, 0 skipped, 0 cancelled** (491,491 ms).
- Catalog split, production-only dependency audit (0 vulnerabilities), syntax (926 Node files), architecture, and offline Render Blueprint validation passed. Blueprint validation does not imply a live Render sync or secret check.
- Web export and initial JavaScript budget passed: **523,575 / 524,288 bytes gzip**, with **713 bytes** of headroom, unchanged from `a7a8117`.
- iOS and Android exports passed. Source-map isolation passed with 0 issues across Android's 1 map / 2,208 sources and web's 81 maps / 1,179 sources. iOS page modules are absent from Android/web maps; this is source isolation, not native runtime certification.
- Generic-device Release build passed with two jobs, team `VJDCS86G5Z`, and the existing development signing/profile. No package, Pod, provisioning, or `allowProvisioningUpdates` changes were made.
- Preserved checkpoint: `.tmp/ios-phone-checkpoints/flagship-8060121/`. Its `receipt.json` cites runtime `8060121`, and `manifest.json` records every file hash. Both built and copied apps passed strict deep signature verification; all **52 files / 60,450,495 bytes** match the build product. Only the executable, code-signature resource table, and JavaScript bundle differ from `a7a8117`.
- Existing `flagship-a7a8117` app files, manifest, and receipt remain hash-identical to the pre-run baseline. Earlier exports/checkpoints were retained. No installation, launch, phone input, recording, deployment, or push was performed.

Evidence prefix: `/tmp/mshpit-discover-latency-8060121-20261109T014106Z`. The `-release.sh` pipeline exited 0; `-tests.log`, `-checks.log`, `-web.log`, `-ios.log`, `-android.log`, `-isolation.json`, `-page-isolation.json`, and `-build.log` contain the gate evidence. Unique exports are `.tmp/web-8060121-regression`, `.tmp/ios-flagship-8060121`, and `.tmp/android-8060121-regression`.

## Remaining acceptance and dependency limits

The user reported glitchy and laggy Discover swipes on installed `a7a8117`, with minor Feed lag. Its Discover acceptance therefore failed. **New runtime `8060121` is built but uninstalled, and physical native acceptance is still pending.** The user's existing app remains untouched on the live backend and is not mutation-blocked. Device Hub input was already known to fail with `-10005 noWindowsAvailable`; no phone action or retry was attempted in this work.

Initial cold module/native layout still has to exist before finger motion can safely uncover the real incoming screen. There is no speculative neighbor mounting, module preload, or idle resource GET. Tests use synthetic native recognizers, scheduler, and animation frames and do not establish native frame rate, accessibility, or user-perceived smoothness. Discover gesture smoothness, cancellation/reversal, nested rails, and tap alternatives still need physical validation when the user makes the phone available.

The production-only audit does not clear mobile/native dependencies. The existing full-audit record remains **12 findings (3 high, 8 moderate, 1 low)**, and **10 SDK 57 patch compatibility mismatches** remain open. Packages and lockfile are unchanged; no new full audit or compatibility remediation was attempted. The unchanged development profile expires **2026-11-14 at 23:50:01 UTC**. This is an iPhone portrait checkpoint with minimum iOS 16.4, not App Store certification. Server security changes remain source-only, not deployed; no real database was restored, and the separate notification reliability branch is not included.
