# iOS scrolling and session integration — 2026-11-10

## Candidate

Runtime commit: `bcd30cbf1df64b7f5b725fd80196d62c2dc50543`, branch `ios/scroll-titles-endless-feed`.

Isolated worktree: `/Users/adamgadishaw/Documents/Codex/2026-11-10/task-2/scroll-titles-feed`.

The starting point is profile candidate `b1c9514`, which already contains the native notification integration (`6417309`). The installed navigation checkout and previous signed artifacts were not changed.

- `79e3c10`: large-title animations and automatic iOS Feed pagination.
- `4ee6288`: clean cherry-pick of session response fix `84923bb`.
- `a29e796`: clean cherry-pick of durable native sign-in fix `5cff18f`.
- `74e7d87`: renew a scheduled page request when presentation ownership changes.
- `bcd30cb`: preserve automatic access to cached rows during background head refresh and update six existing runtime fixtures for the new components.

The session commits merged without conflicts. Independent review verified their runtime files against the source commits; the remaining Store differences are the reviewed pagination changes. The session work remains documented in `IOS_SESSION_PERSISTENCE_2026-11-10.md`.

## Scrolling behavior

Feed, Discover, Search, You, and Menu share large-title scroll behavior. Feed and Discover headings collapse above their fixed controls; Search and Menu animate their existing in-flow headings; You keeps its action row available. See `IOS_SCROLL_TITLES_2026-11-10.md` for accessibility, retained-pane, geometry, and gesture details.

Following, Local, For You, and News load automatically near the end of the list. There is no normal Show more / Load older button on iOS. Already loaded rows are revealed before another request, and the authoritative server cursor controls exhaustion. Exhausted results display “You're caught up”; content is not repeated to manufacture an endless list.

One admitted viewport owns each request. Pagination preserves existing rows and positions, rejects malformed/repeated/cyclic cursors, deduplicates overlapping pages, and keeps refresh/account/privacy/preview lifetimes fenced. Sparse Local or duplicate-only pages continue automatically with a delay rising from 250 ms to at most four seconds. A failure pauses automatic work and presents a retry for the failed head or append operation. Continuous scroll events do not postpone a valid scheduled request indefinitely.

Previously cached rows beyond the first page remain revealable even while the primary feed head is unverified or undergoing background refresh. Older-page transport remains blocked until the head is admitted. Explicit pull-to-refresh pauses automatic pagination for the refresh lifetime.

The default platform hook is inert; Android and web retain their manual Feed controls. The separate session commits include their existing native-platform storage fix.

## Verification

The exact Expo SDK 57 documentation was read before implementation. All-platform exports for the combined source passed. Every exported application source was compared with the final worktree: 809 iOS modules, 757 Android modules, and 767 web modules, with no mismatches. iOS-only title/endless-feed implementations are absent from Android/web bundles.

All **9,240 tests passed**, with zero failures, cancellations, skips, or TODOs, in the final hermetic full-suite run (316.1 seconds, Node 24.22.2, concurrency 2). Syntax validation passed for 931 Node files. Architecture and whitespace checks passed. The combined web export passes the unchanged 524,288-byte initial JavaScript budget at 524,209 gzip bytes (79 bytes remaining). This is an actual small remaining budget, not an increased limit.

Focused checks include real React Feed integration, Reanimated worklet compilation, gesture attachment, native-scroll callback/ref preservation, retained filter offsets, Dynamic Type, live Reduce Motion/VoiceOver, short-list geometry, automatic paging in all four filters, sparse-page backoff, repeated cursors, stale timers, refresh/account changes, failed-head/page retries, and session persistence. Independent review has no outstanding correctness finding.

Earlier full-suite attempts were superseded: sandbox restrictions prevented localhost fixture servers; after session integration, six older runtime fixtures needed the new title/pagination imports, and their restored checks exposed the cached-row regression fixed in `bcd30cb`. Those earlier runs are not passing release receipts. The final combined suite uses the repository's hermetic runner with loopback access and throwaway data, and all existing assertions remain in force.

Evidence is in `.tmp/scroll-feed-validation/`: `final-full-tests.log`, `final-export.log`, `final-source-map-verification.log`, `final-isolation.json`, `final-architecture.log`, `integrated-syntax.log`, `final-web-budget.log`, `final-manifest.json`, `final-source-freeze.json`, and `outcome.json`. Final platform exports are in `.tmp/scroll-feed-integrated-export/`. The final code/config/test snapshot covers 2,595 files.

## Remaining acceptance

No phone access, installation, deployment, push, signing changes, or replacement signed native build occurred. A signed build and device acceptance remain for the release owner when the phone is available. Native animation appearance/frame timing, VoiceOver navigation, and physical gesture feel are not certified by the deterministic harness.

Short content keeps fixed titles expanded to prevent offset/layout oscillation. You preserves its action-row height. The pre-existing fresh-mount Feed snapshot remains capped at 64 items; mounted filter/detail returns retain their actual list state.
