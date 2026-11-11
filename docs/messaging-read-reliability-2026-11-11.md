# Messaging read and unread reliability

Based on combined candidate `7db9a75fd40976a09b43e824ff9858f90c416f73`. This change fixes the three failures reproduced by the independent messaging acceptance check. It preserves the installed messaging presentation, keyboard behavior, consent rules and unrelated calendar work.

## Resulting behavior

- A conversation opening or receiving a message no longer automatically marks the newest stored message read. A read-through target is earned only when the bottom of an inbound row is measured inside the active conversation viewport. Scroll/layout events and requested auto-scrolls alone are insufficient. The marker remains a monotonic account-wide read-through watermark: observing a later message also clears earlier messages through that target.
- The new `/api/dms/:otherId/read-through` endpoint accepts only a `messageId`. The server resolves its timestamp and ownership, requires an existing inbound message in the authenticated conversation, and clears notifications only through the saved target. A later server arrival remains unread even if it arrives between the fetch and receipt POST. Foreign, outgoing, removed, blocked and unauthenticated targets are rejected.
- Inbox rows preserve the full authoritative per-thread unread total and the incoming-message boundary it describes. Cached arrivals beyond the already covered range are counted once. A separate monotonic coverage boundary prevents an omitted deletion tombstone from making an old cached row look new. A one-message preview, outgoing preview or 500-message page no longer replaces a full-history total. The global message badge retains its existing server-backed implementation.
- Count snapshots from startup, Inbox and thread reads share request issue order. A stale snapshot cannot replace a later count or move a confirmed read cursor backwards. Production message and read state remains in account-private ephemeral memory, with account epoch, cancellation, block and current-route checks repeated at queued state publication.
- Failed receipts retain their observed target. A successful manual refresh can retry the unchanged target without reopening, including after the automatic recovery budget is exhausted. Observations and rerenders do not spin retries. Backgrounding, covering overlays, navigation, blocking and account changes revoke eligibility and pending work; recovery cannot earn unseen targets.

## Regression evidence

Final focused run: **492 tests passed across 35 files, zero failures or skips** (serial, 17.02 seconds). Syntax passed for **950 Node files**; architecture and `git diff --check` passed. The combined full application suite and native build are reserved for the release owner after integration.

`server/dmReadAcceptance.test.mjs` combines actual SQLite/API handlers, extracted actual Store callbacks, actual ThreadScreen, actual visibility hook and actual iOS scroll hook with synthetic users and native geometry. It replaces all five diagnostic failure assertions with expected fixed behavior and adds a removal-cap regression:

| Case | Verified result |
|---|---|
| 1,200 unread; cold startup, partial page and outgoing preview | Row and global totals remain 1,200 |
| Open before any measured viewport evidence | No receipt |
| Three arrivals while reading older history | All three remain unread, including after fresh client hydration; actual scroll hook does not auto-scroll |
| Arrival between measured target and read POST | Unfetched message and its notification remain unread; fresh client shows one |
| Receipt failure followed by successful same-target refresh | Retry succeeds without closing/reopening; confirmed counts become zero |
| Latest message deleted behind 800 newer removals elsewhere | The 750-tombstone response cannot inflate the correct count of two |

Additional focused tests cover target authorization, canonical timestamps, same-time ID ordering, monotonic cursors, query-index use, stale cross-lane snapshots, account A–B–A transitions, queued React updates, abort and covering-route guards, measured tall-message visibility, background/web visibility, StrictMode cleanup, scoped history, consent, notifications, composer and keyboard controls.

Synthetic native bounds are not a device rendering claim. Fresh-client tests discard all client state and run startup hydration against durable server state; they do not kill/relaunch an installed iOS process. Polling/network timing is controlled. All database fixtures are throwaway test databases; no live messages or accounts are used.

## Integration and compatibility

The backend and client must be released together through the combined release owner:

1. Integrate server commit `f85c163d97b3e010272467a3798f729846c9b7b0` into the calendar backend release candidate. Its code changes are confined to `server/dmReadRoutes.js` and the messaging import/read response additions in `server/api.js`; no schema migration is required. Include its server regression tests.
2. Integrate both server and client commits into a new app checkpoint based on the current combined source. Run the combined required checks once, then create and verify one replacement native build.
3. Preserve signed build 3 and its historical evidence. It was built from `7db9a75` and does **not** contain these fixes; it remains on installation hold.

The legacy `/read` route is hardened to require the same explicit target. Old clients making target-free calls receive a validation error and retain unread state. New clients use the distinct `/read-through` route so an old backend returns 404 instead of silently performing a blanket read; there is no unsafe fallback. The release owner must account for this server/client compatibility dependency before installation. Production push/deploy and device installation remain outside this worker's phase.

## Remaining device checks

After the corrected server and a newly signed app build are available, verify real iOS measurements and lifecycle behavior with synthetic accounts: short and long threads, arrivals while scrolling older history, large text/tall messages, keyboard appearance and dismissal, rotation, covering account/menu/auth overlays, background/foreground, offline receipt failure followed by refresh, account switch and force-quit/relaunch. Verify both row and global counts and confirm later unseen notifications remain unread. The host tests preserve existing keyboard/composer contracts; native performance and measurement timing still require device QA.
