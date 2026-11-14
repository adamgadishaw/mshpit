# PC privacy and reliability follow-up — 2026-11-10

Base: `ac6a8374165e27c527c3f3cb23e8ea85bb2dc49e`, on new local branch
`fix/pc-privacy-reliability-20261110`. The original five-feature commit
`20975b1ead3fc1f447522dfe433d24a9fb945829`, large-history follow-up and all
previous deliverables remain preserved. This bounded review targets cases not
established by their green tests. Parallel Astra workers have separate source
ownership; final combined review is independent of implementation.

## Reproduced defects and resulting behavior

- A delayed profile success or denial could overwrite newer profile authority.
  Per-target active-read tickets now reject older completions, and confirmed
  badge reconciliation invalidates pending profile reads. Tickets are removed
  on settlement; account epoch and cancellation guards still apply.
- A single-post read lacked an account check at consumption. It now supplies
  the expected account to transport and checks the account epoch and abort
  signal before returning a post to navigation. Independent review caught the
  same-account variation: it also rejects intervening authority changes and
  currently blocked/muted authors before a detail can mount. A mounted
  standalone detail now subscribes to confirmed author-badge changes, with
  viewer and source-snapshot isolation, preserving post identity/content.
- Delayed notification history could restore a blocked/muted actor or rows
  omitted by a newer successful refresh. Reads now have a monotonic sequence
  plus account/cancellation guards and apply current actor privacy at commit.
  History and acknowledgement remain separate; no unconfirmed acknowledgement
  clears a new count.
- Creating a newer recommendation head deleted a still-live snapshot, expiring
  another tab/device's scroll cursor. Previous snapshots now survive until the
  existing TTL/capacity eviction. The 250-snapshot bound remains; quiet head
  reads no longer evict a snapshot just because the pool is full.
- Expired/invalid recommendation cursors lost their failure type in the Store,
  so the footer retried an unusable cursor. They now yield an explicit Refresh
  feed action, keep current cards and do not claim exhaustion or silently reset
  ordering. Failed refresh retains that recovery control. The home refresh
  callback aggregates other reads, so their failure can conservatively require
  another refresh even after the head succeeded.
- A cancelled head read retained its in-flight lock until transport settled.
  A subsequent explicit refresh can now proceed immediately; the sequence
  guard rejects the cancelled completion.

## Checks and limits

Focused worker runs passed: 57 server paging/snapshot checks, 36 profile/post
checks, 26 notification checks followed by 17 client checks after the
cross-owner cache regression fix, and 18 feed refresh/pagination checks.
These groups overlap. Independent review ran 92 combined checks and then 27
affected checks on the final source; all passed. Its two actionable findings
(failed expiry refresh losing recovery and delayed same-account detail
authority) were fixed and retested. No remaining actionable finding was
identified within the bounded review.

The complete `npm run check` passed on the final source with approved network
access (`privacy-quality-gate-network.log`): 7,186 passing tests, zero failures,
one skip (7,187 total); zero production dependency vulnerabilities; syntax,
architecture and web export passed. Initial JavaScript is 510.1 / 512 KiB gzip.
`git diff --check` passed. A preceding restricted rerun passed the same complete
test suite but stopped at the unavailable npm audit endpoint
(`privacy-quality-gate-final.log`). Both attempts remain preserved.

Baseline feed regressions are retained in task-workspace
`privacy-feed-before.log`; those failures are reproduction evidence, not final
failures. API tests use synthetic temporary SQLite databases, with test-runner
mail credentials cleared. No production requests are involved.

The first aggregate attempt (`privacy-quality-gate.log`) ran 7,187 tests:
7,167 passed, 19 failed, one skipped. Seventeen failures came from test
fixtures missing the new profile authority map or using real React for the
new hook inside a mocked renderer. Two unchanged suites also failed timing
assertions (`socialShareCardProcess` renderer deadline and `venueMapCatalogue`
body deadline). Those two suites passed 29/29 in an isolated rerun without any
source or deadline changes (`privacy-timing-recheck.log`). The failed aggregate
is retained and is not counted as a passing gate.

The added long-inbox acceptance passed without runtime changes. A temporary
script exercised actual Store callbacks, the history helper and real synthetic
server routes: 100 initially cached rows, 235 unread plus 17 read history rows,
and eight blocked rows. Opening fetched 100/100/52 rows and acknowledged
100/100/35 IDs. All 235 existing unread rows became read; all history remained.
A new arrival inserted after the first opening page stayed unread locally and
on the server (one visible unread, 253 retained local rows). Blocked rows stayed
excluded and unmodified. The measured receipt is
[`evidence/notification-open-acceptance-2026-11-10.json`](evidence/notification-open-acceptance-2026-11-10.json).
Its unchanged reproduction script is retained in task-workspace
`notification-open-acceptance.mjs` and the delivery folder; its receipt records
placement and inherited-environment limits. This is Store/helper/server
acceptance, not a rendered screen or device interaction.

The route-level adversarial matrix checks For You ranked head and chronological
tail, Local and Following after viewer/author blocks, mutes, bans, suspension,
dormancy, removal, badge revocation and profile-audience changes. These existing
authorization paths pass; private profile settings intentionally mask profile
and badge details without making otherwise-public posts private.

Existing large-history measurements remain in
`PC_LARGE_FEED_VALIDATION_2026-11-10.md`; this follow-up makes no new production
performance claim. Snapshot TTL/capacity expiry and process restart still need
explicit refresh. No schema migration is required.

## Integration boundaries

Native iOS/export checks belong to the independent workstream frozen at
`ac6a837`. This patch touches shared `src/store.js` and feed/post presentation;
coordinate those overlaps when integrating that result. `App.js` navigation is
not changed here. Unrecovered Mac calendar, messaging and keyboard work remains
separate; none is reconstructed or claimed integrated. No phone or Mac access,
production change, push, merge, deployment, recovery-transfer workaround or
edit to `D:\Websites\Concert Website\pit` is performed.
