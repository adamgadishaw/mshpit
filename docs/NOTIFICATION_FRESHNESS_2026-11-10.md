# Activity freshness and unread-count correction

Scope: isolated shared client/server correctness patch based on `942e1f3`,
continuing the held notification reliability candidate. No deployment, phone
interaction, production mutation, push delivery or main integration was performed.

## Diagnosis

The reported installed runtime `296ce4b` was inspected directly. It hydrates
Activity on sign-in and explicit pull, but does not fetch new Activity on entry
or poll while the app remains open. Entry also calls the legacy mark-all-read
route. It intentionally excludes the prior held reliability fix. An old release
receipt naming `a7a8117` is historical, not the current installed version.

The post-like route atomically creates an Activity event for a new cross-account
like. Repeating desired liked=true does not duplicate it; self-likes, blocks and
mutes do not notify. A synthetic integration test now reproduces three different
posts liked by another account and confirms exactly three unread events remain
after repeated reads. The public production health request succeeded, but does
not disclose revision or account events. The user's exact three live events
were not verified. No authenticated live notification or DM state was changed.

The held Activity implementation had another gap: its active-app poll only
updated a total and left visible rows stale. Inbox badge calculation also counted
cached messages although startup loads just one preview per thread, undercounting
unread messages and lacking a reliable app-wide total.

## Correction

- Active, authenticated apps read a fresh Activity head every 15 seconds and on
  foreground entry. No polling while hidden/backgrounded. This is foreground
  polling, not push or a claim of instant/background OS alerts.
- Updates merge the latest server rows with connected older loaded history.
  A complete or disconnected head restarts from the correct server cursor rather
  than retaining a hidden gap. Explicit pull still resets pagination. Reads stay
  account/epoch scoped, queued, bounded to 1,000 rows and memory-only.
- Notification GET uses no-store. Failures retain confirmed data and expose the
  error; a refresh cannot mark Activity read. Existing explicit scoped read
  commands and server-first rollout safeguards remain intact.
- The private notification response adds `inboxUnread`, counting all unread
  incoming messages in accepted conversations (followed peers or peers the owner
  has replied to), independent of the 200-thread/one-message preview cap. Requests,
  blocked peers in either direction, removed messages and read cursor ranges are
  excluded. GET remains read-only; no schema migration is needed.
- The production Inbox badge uses this server total, never a partial message
  cache. Unknown/unsupported totals remain null in the resource and do not show
  a numeric badge. Demo behavior remains local. Account/epoch changes clear totals
  synchronously; failed refresh retains the last confirmed total.
- App supplies iOS Feed `onRefreshCounts` for the separately reviewed all-filter
  refresh/badge UI. Android/web Feed refresh/UI is unchanged. Shared Activity and
  unread correctness applies to all three platforms.

## Validation before aggregate integration

- 146 focused notification, backend, message-read, screen-lifecycle and Store
  projection cases passed. An additional overlapping 91-case compatibility run
  covered startup, responsive route lifecycle and direct-message cursor behavior.
- Syntax passed (929 Node files). Architecture passed with the existing ceilings:
  Store hooks 144/144, state hooks 47/47, inline API routes 154/154.
- Independent review ran 58 state/hook tests and separate in-memory SQL checks for
  accepted peers, request exclusion, removed rows, bilateral blocks, cursor ties
  and account isolation; no runtime blocker was found.
- Full combined serial tests and fresh exports/budget are still required after
  combining the Feed UI and notification candidates. No physical acceptance has
  been performed. The existing web startup budget has very little headroom.

## Release conditions

This is not install-ready against the old server. Deploy all serving backend
instances only after separate approval, then verify an authenticated, read-only
notification response supplies both `notification-ids-v1` and a nonnegative
integer `inboxUnread`, plus the scoped read endpoint contract. Only then release
or install the paired client. An old backend lacking `inboxUnread` intentionally
produces no Inbox numeric badge, not an invented count. Legacy mark-all reads on
old backend instances remain unsafe until every instance is upgraded. Push
registration, delivery and OS notification badges remain separate work.
