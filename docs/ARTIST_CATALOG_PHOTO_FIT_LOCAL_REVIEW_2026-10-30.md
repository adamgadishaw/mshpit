# Artist catalog fallback photo fit — local review, 2026-10-30

## Scope and isolation

Repository: adamgadishaw/mshpit. Local task-owned independent clone:
C:\Users\Adam Gadishaw\Documents\Codex\2026-10-30\task-3\mshpit-xg

Base: 91cef8b9eabe2a97d3e7daf255dad67ec406e809, verified against GitHub master through the GitHub connector on 2026-10-30. Detached HEAD; uncommitted local patch. Clone uses --no-hardlinks from the existing local repository, with its own Git database and dependency copy. No pre-existing worktree was created, switched, edited, staged or reset. The duplicate-event checkout remains clean on fix/provider-event-duplicates at ff044aaf3f4b3eca5a60af11c586cff08bb6007d (rechecked after verification).

No push, PR, commit, merge, deployment, production-data operation or credential change.

## Diagnosis and narrow behavior

The supplied XG report describes a square group photo cropped by cover in a wide compact hero. ArtistLegacyPresentation uses catalog.photo as bannerUri when no intentional banner exists. ArtistCinematicCarousel unconditionally requests SmartImage cover. Thus fallback identity photography is treated as composed banner artwork.

The presentation now exposes bannerContain only when its banner is the catalog-photo fallback. ArtistScreen passes this provenance to ArtistCinematicCarousel, which enables existing SmartImage contain only for that banner slide. Explicit owner/staff banners retain cover, including when their URL equals the catalog photo. Fan/gallery/profile slides retain their prior behavior. Legacy staff provenance is preserved.

No theme, styles, frame dimensions, scrims, labels, animation, controls, preview widths, source ordering, deduplication, viewer callback or video policy changed. Existing contain styling supplies the side background. Existing scrims and controls still overlay the image and can obscure portions; this fix prevents geometric image cropping and does not remove overlays.

## Verification

PASS: 29 focused tests through the hermetic npm test runner: artistLegacyPresentation, artistGalleryMedia, artistGalleryUi, legacyFanClubUi, productUxCleanup. Includes new ordinary/legacy fallback-fit regression, blank banners, missing images, explicit same-URL banners, existing visibility/video filtering, gallery bounds, Spotify-specific handling, JSX parsing and theme-contract assertions.

PASS: npm run build:web (Expo SDK 57 production web export and bundle budget, initial JavaScript 506.3 KiB / 512 KiB gzip). An initial attempt ran before dependency copying completed and failed with missing terminal-link; the completed isolated dependency copy resolved it and the subsequent build passed.

PASS: npm run check:syntax (919 Node files).
PASS: npm run check:architecture.
PASS: git diff --check.

PASS: six loopback-only browser scenarios against the actual production export, each with fresh synthetic member context and reduced motion: 390/1280/1440 pixels, catalog fallback and explicit banner. The fixture is a synthetic 1400 x 1400 image with seven numbered subjects. Catalog fit is contain; explicit banner fit is cover; fan-slide fit is cover; next/previous carousel navigation works; Enter opens the full-size viewer with contain; Close restores the hero. Zero captured page errors or missing fixture responses in the final run. Video descriptors are supplied in the gallery fixture and excluded from the hero, as covered by the domain tests. No live production network or account session used by the browser harness.

Desktop hero outer dimensions measured 493.15625 x 250; mobile 358 x 160. These are fixture page dimensions, not a claim to have reproduced the supplied live 567 x 248 inner frame. Desktop and mobile screenshots visually inspected; seven subject positions fit within the source image bounds, with existing controls/scrims retained.

Final evidence is in the parent task directory: ../visual/results.json, ../visual-run.log, ../verify-xg.mjs, ../focused-tests.log, ../build.log, ../syntax.log, ../architecture.log. Browser screenshots: ../visual/{390,1280,1440}-{catalog,banner}.png and corresponding -viewer.png. (These paths are relative to the repository root.)

## Extended verification requested by owner

PASS: public XG page and public resolve/profile endpoints retrieved read-only after network escalation. Resolve returned created:false; profile:null and legacyProfile:false. Artist photo source is Deezer, URL https://cdn-images.dzcdn.net/images/artist/e3f6255e8fab30cc371a4ba2bb9cea99/1000x1000-000000-80-0-0.jpg . Its current downloaded rendition is 1000 x 1000, not the 1400 x 1400 rendition in the initial report. SHA-256: 82C689181A4B105C03608A5873212143FB0A35B5886096C93F377FC4F94447D9. The seven-member group photo was visually inspected. Applying the presentation function to the captured live payload confirms bannerContain:true with that catalog photo.

PASS: actual downloaded XG image served into the exported local app's synthetic artist fixture at 390/1280/1440 widths (three cases). All use contain, decode at natural 1000 x 1000 dimensions, retain carousel controls and keyboard/full-size viewer behavior. Actual-image desktop/mobile screenshots visually inspected: image bounds retain all seven members; unchanged scrims dim the lower faces and controls overlap portions. These are the real XG image bytes in a synthetic local page, not an end-to-end production-data page or production deployment. Evidence: ../xg-profile.json, ../xg-resolve.json, ../xg-provenance-check.json, ../xg-photo.jpg, ../verify-xg-actual.mjs, ../actual-xg.log, ../visual-xg/results.json and screenshots.

PASS: image-failure browser regressions at 390/1280 (four cases). Failed preview recovers through the original source with contain; exhaustion of both sources shows PHOTO UNAVAILABLE, then navigation to a valid fan slide recovers with cover. Final run has zero captured page errors. One initial harness run attempted decode before the fallback source replaced the failed preview; waiting for the original source before decode corrected the harness. Evidence: ../verify-xg-failure.mjs, ../image-failure.log, ../visual-failure/results.json and screenshots.

PASS: existing verify-player-browser.mjs at 375/1280 (two cases): real encoded synthetic WebM frames decode; native controls and no autoplay; rejected play recovers; playback speed works; background visibility pauses without resuming automatically; decoder error retry remounts and recovers; close pauses. No unhandled errors, analytics or external network. Evidence: ../video-browser.log and .tmp/player-browser screenshots. This tests decoded synthetic video playback, not member production video or physical iOS/Android.

FULL SUITE FAILED: npm test completed 7,073 tests: 7,070 passed, 2 failed, 1 skipped, 0 cancelled (111.5 seconds). Both failures are pre-existing and reproduced on a second task-owned clean master snapshot at ../baseline-check (base 91cef8b9): server/features/festivals/festivals.test.mjs:151 expects initial lineup timestamp null; :234 expects structured-data subevent count 4 but receives 3. Separate targeted patched and baseline runs each have 9 passed, 2 failed. No festival code changed. Evidence: ../full-suite.log, ../baseline-festivals.log, ../patched-festivals.log. The baseline is another independent --no-hardlinks clone under this task, with a node_modules junction targeting only this task's dependency copy. It remains clean.

INDEPENDENT REVIEW PASS: separate read-only reviewer found no actionable defects and independently passed 20 presentation/gallery/UI tests. Evidence: ../independent-review.md. The reviewer checked provenance scope, same-URL explicit banners, JSX wiring and preservation of styles/interactions.

UNTESTED: physical iOS/Android rendering, animated images, production end-to-end page after a deployment, production member video, full npm run check dependency audit. No baseline pixel-diff claim. No remaining permission blocker; the full suite is not green due to reproduced baseline festival failures.

## Review/release

No migration or production-data change. Review the actual XG production-data page and native targets before deciding to release. Actual-image verification above uses the production image bytes with synthetic local page data. Revert the four runtime/test files to remove the behavior; STATUS.md and this note are handoff documentation. All publication and deployment remain outside this task.

## 2026-10-31 Approved draft publication

The owner subsequently approved committing this reviewed change, pushing a feature branch and opening a draft PR for checks. That approval supersedes the earlier local-only publication restriction, without authorizing merge, auto-merge, deployment or production-data/content changes. No other checkout or unrelated patch is included.

GitHub master was rechecked through both the connected GitHub API and Git remote refs: 91cef8b9eabe2a97d3e7daf255dad67ec406e809. Open PR inventory and an all-state XG PR search found no equivalent PR. The dedicated publication remote targets https://github.com/adamgadishaw/mshpit.git; the original local-source remote remains untouched. Branch: fix/artist-catalog-photo-fit. Runtime/test code remains identical to the independently reviewed and browser-verified candidate.

PR 81 contains a separate Ontario-fixture isolation cleanup for the two known festival failures. That change is deliberately excluded; no assertion, test skip, workflow, dependency, lockfile, server code or security setting changes are part of this photo fix. The draft PR must record the actual CI outcome rather than treating the baseline failures as a passing gate.

Fresh publication-check evidence is stored one directory above the repository: publication-check.log, publication-audit.log, publication-syntax.log, publication-architecture.log and publication-build.log. The fresh production dependency audit passed with zero vulnerabilities. Exact-head remote checks will be reported in the draft PR and task handoff after publication; no future CI success is asserted here.

Fresh pre-publication npm run check failed at its test stage: 7,073 tests, 7,061 passed, 11 failed, 1 skipped. Besides the two known festival failures, seven follow-authorization worker-readiness cases, one persistence HTTP-fixture readiness case and one venue-map timer assertion failed during the concurrent local run. A focused rerun of those three additional files passed all 29 tests (publication-timing-recheck.log). A full follow-up with the supported --test-concurrency=2 runner argument is underway to reduce local contention without removing tests or relaxing assertions; its final result belongs in the PR/task handoff. No passing full-suite claim is made here.

Separately rerun checks passed: production dependency audit (zero vulnerabilities), syntax (919 files), architecture, Expo web export and unchanged 506.3/512 KiB gzip budget, and whitespace. Fresh actual-XG-image browser scenarios passed 3/3 and image-failure scenarios passed 4/4 against the fresh export (publication-xg-browser.log and publication-image-failure.log). The existing two decoded-video browser cases remain passing from the prior verification. Only publication documentation changed after the independent review; runtime code and regression tests were re-inspected and remain identical.
