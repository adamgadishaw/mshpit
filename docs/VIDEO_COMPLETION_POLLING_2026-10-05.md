# Visible video completion checks — 2026-10-05

Review branch: `codex/video-completion-polling-20261005`.
Base: `a056e64d13ab6185f4b91965060fc492fb110326`.
The mobile player layout fix remains on its separate branch.

## Problem and scope

The author notice previously waited 15 seconds before its first asset check,
then used a repeating interval. A slow request could overlap its successor,
duplicate cards owned independent loops, and checks/retries did not bind their
requests to the rendered account. The notice could disappear before its feed
refresh succeeded. This patch changes client completion detection and lifecycle
handling; it does not accelerate conversion or relax media verification.

Read-only live evidence identified two recent remux jobs lasting about 5.9 and
7.0 seconds. For the second, worker completion to the following feed response
was about 10.02 seconds. That span includes web publication verification as well
as polling; it is not a measured removable delay. Source upload, worker queue,
conversion, web SHA256/publication checks, CDN buffering and first-frame playback
remain separate stages. No production benchmark was run.

## Behavior

- One module scheduler keys assets by account and asset ID, shares duplicate
  subscriptions, limits asset reads to two in flight, and owns one wake-up timer.
  A check starts immediately, then waits 2 seconds while younger than 30 seconds,
  5 seconds until 2 minutes, and 15 seconds thereafter. Delays start after reads
  settle, so slow reads never overlap for an asset. Read/retry API deadlines are
  10 seconds through the existing API boundary.
- Each notice must intersect the viewport and have an active app and screen.
  The shell also vetoes work behind global menus and verification overlays.
  Route changes unmount old screens; subscriptions and explicit retries cancel
  on hide/unmount/scope change. Render-time ownership guards reject callbacks
  even before effect cleanup. API calls retain `expectedAccountId` fencing.
- Pausing preserves the polling age. Idle entries expire after five minutes,
  with at most 256 retained entries. A fresh processing projection revalidates
  cached terminal state, including a retry completed in another tab.
- Failed clips keep passive subscriptions without reads. A successful explicit
  retry updates duplicate visible cards; a synchronous lock prevents repeated
  taps on the same retry from sending concurrent mutations. Refused retries keep
  the failure notice. Cancellation never queues a mutation replay.
- Ready clips coalesce feed refreshes by account. The notice retires only when
  the existing refresh contract returns `true`; contention (`null`) and failure
  retry with backoff, without rereading an already-ready asset. Clips becoming
  ready after a refresh starts require a subsequent refresh snapshot.

The early window intentionally makes more lightweight owner asset reads than the
old 15-second interval: for instantaneous reads, 16 checks through 30 seconds,
then 5/15-second backoff. Visibility gates, shared subscriptions and the two-read
limit bound that increase; this is not evidence of a specific user capacity.

## Validation

- New deterministic scheduler, actual component lifecycle and API adapter tests
  cover ready/failed/long-running states, read concurrency, duplicate cards,
  refresh contention/coalescing, late-ready snapshots, hidden/unmounted work,
  account changes before effect cleanup, retries, stale terminal cache and global
  overlays. Adjacent activity, viewability, feed rendering, identity lifecycle
  and guest media-action suites are included in the focused run.
- Timing fixture: a synthetic clip becoming ready at 7 seconds is observed at
  8 seconds (checks at 0/2/4/6/8 seconds). The previous first check was at 15
  seconds. This is fake-clock client evidence, not measured production latency.
- No new telemetry event or sensitive logging was added. Existing analytics has
  no suitable completion-timing event; the timing evidence stays in tests.
- Focused run: **87 tests passed**, including **27 new tests**. Node syntax
  passed for **823 files**; architecture and whitespace checks passed.
- Independent review approved the final patch with no blocking findings after
  its own **37-test** run. It caught the cached-failure case, now fixed and
  covered by regressions, and checked the shared global-overlay visibility gate.
- Full test/export and desktop/mobile browser checks remain cloud gates. No
  local Chromium or heavy build was run, as instructed.

## Remaining limits and release gate

Existing `refreshFeed` refreshes the feed head. Profile history owns a separate
post projection, and an older post outside that refreshed head can remain stale;
this patch does not add profile-specific or exact-post reconciliation. Therefore
the timing benefit is established for notices whose media updates with that feed
refresh. These pre-existing surface limits remain follow-up work.

The parent owner-browser worker coordinates the draft PR and cloud CI. Before
release, verify desktop/mobile visible completion, background/navigation pause
and resume, failed retry, duplicate cards and account replacement against the
tested head. Full cloud checks and final scope review precede merge/deployment.
No schema migration, environment change, new cloud resource, credential, grant,
purchase, production load generation, merge or deployment is part of this patch.
