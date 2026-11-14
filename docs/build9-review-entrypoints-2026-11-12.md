# Build 9 review entry points

Base: `646e482a4da448f512768f30398e3b5c9210b598` (installed Build 9 source).
Branch: `review-entrypoints-build9-20261112`.
Worktree: `task-7/review-entrypoints-build9`.

The exact Expo 57 reference, https://docs.expo.dev/versions/v57.0.0/, was read before editing. Development and verification were PC-only. The frozen Build 9 checkout, the previous review-overlay increment, and other integration worktrees were not edited.

## Findings and changes

- Top Rated Shows produced ranking identities such as `show:artist:provider%3A...:date`. The ordinary show adapter treated these as archive identities, but the reviews endpoint accepts `show.<encoded-parts>` keys. The actual exported baseline displayed “Couldn't load reviews. Try again.” The native component harness likewise showed the rendered row dispatching the ranking key immediately.
- Top Take text on both artist implementations had only inline expansion. It had no full-review opener, although the separate Read fan post control worked. The text now links to the saved post through the existing guarded opener. Inline expansion and intentional media-viewer/author controls remain available.
- Top Rated selections now resolve the stored artist identity and read that artist's authoritative archive before opening the uniquely matching venue/date. A saved venue key must match exactly; ambiguous or missing nights show an honest unavailable/retry message. Canonical archive scores replace ranking payload scores. No ranking/provider key is encoded into a pretend archive key.
- Explicit event links on Top Take and tour reviews resolve an event entity rather than handing an author review to the general show opener. When a tour review projection lacks its event key, the link reads the saved post before resolving the event; it does not guess from loaded shows with matching names.
- The new lazy screen-local navigation controller cancels or ignores obsolete reads after a later selection, cover, account/privacy change, unmount, or browser history change. Existing full-review hydration, profile navigation, modal retention, text, gallery, ratings and post identity remain owned by the existing implementations.
- A real archive-service test exposed a related legacy server defect: archive summaries group keyless posts under the resolved catalogue key, but review-page filtering discarded those posts by comparing the display name directly with that key. The narrow service fix accepts keyless rows only when their name matches the already-resolved canonical name. A different non-null artist key or another name is still rejected. The repository's account, block, removal and media privacy filtering is unchanged. Both exact-show and named-tour cases are covered.

App.js, ShowScreen and ShowScreen.ios.jsx were not edited. Feed/profile TicketStub paths and ordinary ShowScreen review buttons already used the saved-post opener. Venue-only ratings are separate records and were not redirected into post overlays.

## Evidence

- Baseline exported web: four expected reproductions, artist and ranked-show paths at 390 and 1280 pixels.
- Baseline native host harness: both new component regressions fail against the read-only exact Build 9 source. The artist body has no opener; the actual Top Rated row dispatches the ranking key without a canonical read.
- Separate baseline legacy archive-service check returns an empty review page for a canonical archive containing a keyless post.
- Final focused Node suite: 85 passed, zero failures. This includes actual iOS-selected Artist components, actual TopRatedScreen and TourArchiveScreen reconciled with synthetic native hosts, production hooks/helpers and mocked transport. It covers canonical request construction, unique matching, latest-selection races, retry, cover/account/privacy retirement, legacy lookup, tour fallback denial/cancellation, and real temporary-SQLite archive route privacy checks.
- Final exported-web fixture matrix: artist, ranked, legacy-keyless, unavailable/private, explicit artist event, and tour flows at 390 and 1280 pixels. It checks complete 31k+ review text, saved-post URL, author 4.7 versus event aggregate 4.3, X dismissal and retained originating DOM/scroll. Selected flows additionally check featured-media order, a locally generated video with advancing playback time, gallery Escape, event navigation and browser Back, and direct `/post/:id` entry. All APIs and media are intercepted synthetic fixtures; unknown external requests are blocked.
- Syntax: 1022 Node files passed. Architecture passed without changing any baseline allowance. `git diff --check` passed.
- Final web startup: **524,283 / 524,288 gzip bytes (5 bytes headroom)**. The cap is unchanged. Recheck the combined integration export; there is effectively no margin for additional startup code. Final entry is `index-2c2189fb643cdb5e44a08e0552c18b31.js`.

## Commands

```powershell
# Expected failing native reproductions, reading only the frozen Build 9 tree:
$env:PIT_REVIEW_COMPONENT_ROOT='C:\Users\Adam Gadishaw\Documents\Codex\2026-10-31\task-6\ratings-native-copy-integration-20261112'
node --test --test-name-pattern='Top Take review body|actual native Top Rated row resolves' src/screens/artistDetailRetentionIOS.test.mjs
Remove-Item Env:PIT_REVIEW_COMPONENT_ROOT

# Focused final suite:
node --test --test-concurrency=2 src/domain/topRatedShows.test.mjs src/screens/artistDetailRetentionIOS.test.mjs server/features/artistArchive/artistArchiveService.test.mjs server/features/artistArchive/artistArchiveRegistration.test.mjs src/features/artistEvents/artistEventRequest.test.mjs
node scripts/check-syntax.mjs
node scripts/check-architecture.mjs

$env:CI='1'
node node_modules/expo/bin/cli export -p web --source-maps external --max-workers 2
node scripts/check-web-bundle-budget.mjs
$env:PIT_PLAYWRIGHT_MODULE='C:\Users\Adam Gadishaw\AppData\Local\Temp\mshpit-review-verification\node_modules\playwright'
node scripts/verify-review-entrypoints-browser.mjs

# Baseline browser reproduction, using the retained pre-edit export:
$env:PIT_NAVIGATION_BROWSER_DIST='.tmp/dist-before'
$env:PIT_EXPECT_BASELINE='1'
node scripts/verify-review-entrypoints-browser.mjs
```

No broad full suite, dependency audit, lint or type-check run is claimed. Native evidence is a component/hook harness with mocked hosts, not a device, simulator, UIKit rendering or installed-app QA session. No deployment, remote publication, phone/Mac work, production mutations or test posts occurred.

The keyless-post service correction must be integrated with the client changes for full legacy coverage; it has not been deployed here. The archive endpoint is bounded to 2,000 candidate reviews. A ranked night outside the returned archive stays unavailable with a retry affordance rather than opening an unrelated event.
