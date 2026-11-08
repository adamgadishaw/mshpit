# Activity reliability candidate

Scope: local cross-platform client/server fix, based on ef83fb0. No push delivery,
production notification mutation, deployment or device installation is included.

## Behavior and rollout

- Activity fetches on entry/foreground, exposes loading/error/older-page states,
  and preserves authoritative unread totals independently of the loaded page.
- Viewing or refreshing Activity does not mark anything read. The explicit
  “Mark loaded as read” control snapshots only the currently loaded unread IDs.
- GET advertises `notification-ids-v1`; new clients write only the distinct
  `/api/me/notifications/read/scoped` route. Old servers fail safely instead of
  interpreting a scoped request as their old global mark-all command.
- Upgraded servers make old bodyless `/read` calls a no-op. Old clients may
  temporarily display locally cleared badges until reloading; no unseen server
  activity is cleared. Upgrade every serving backend instance before publishing
  the client when approved. Old clients routed to an old instance still have the
  old unsafe behavior, so a partial backend rollout is not complete protection.
- Acknowledgements validate ownership/visibility and return exact confirmed IDs,
  including retry confirmations. Batches are at most 100. A later batch failure
  preserves prior confirmed updates and allows idempotent exact-ID retry.
- Pagination applies block/mute visibility before LIMIT. Private cache is bounded
  to 1,000 loaded rows, with an explicit UI limit notice. A refresh resets paging.
- Background/hidden tabs stop optional badge polling; active apps poll a one-row
  summary every 60 seconds without replacing expanded history. This is not push.
- The explicit acknowledgement command loads on demand inside its reserved queue
  operation. Chunk loading cannot reorder commands; scope/cancellation checks run
  again before any write, and a failed chunk load remains retryable.

## Architecture decision: migrate the notification Store seam

Owner: notification feature (`src/features/notifications`). The existing
`usePrivateEphemeral` notification binding is replaced one-for-one by
`useNotificationActivity`; no Store hook-count ceiling increases. The feature
owns all new state, lifecycle, services, command and cache policy. Store retains
only its compatibility facade for older callers such as confirmed DM reads and
block/mute scrubs. The exact hook baseline registers this replacement while
removing the legacy state binding and its direct API calls. Two notification
routes leave server/api.js for `server/features/notifications`.

Removal condition: once consumers use a dedicated notification feature provider,
remove the Store integration hook/facade and shrink its hook allowance. This
migration is not permission to add other Store state or raise hook ceilings.

## Regression risks specifically covered

Concurrent/unseen/older notifications; owned and visible acknowledgements;
legacy/mixed-version servers; retries and partial batches; account/epoch changes
including A-B-A; cancelled observers and remounts; external confirmed DM reads
or privacy scrubs racing GET responses; pagination/cap; explicit-only UI writes.
