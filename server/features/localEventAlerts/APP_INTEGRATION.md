# App integration candidate — November 13, 2026

This separate local candidate starts at reviewed foundation commit
98454b0d97af9ce4f3834275724e0cc584a03147 (application base f37660a). Earlier
INTEGRATION.md and REMAINING_INTEGRATION.md describe those frozen deliveries;
this document supersedes their unmounted-status statements for this candidate.
No deployment, remote branch, credential change or real delivery is included.

## Composition and activation

`db.js` mounts the eight foundation tables plus `local_alert_runtime` and
`local_alert_event_queue`. `api.js` composes the service with the canonical
public-document event reader and existing fan-club identity resolver. The
repository's optional `eventOnly` projection uses its existing visibility SQL
without loading related reviews or events for every alert eligibility check.
All authenticated preferences, binding, registration, revocation and target
routes are mounted. Mutation authorization requires the current session, and
registration derives the session hash from the server's token, never the body.

`index.js` owns the opt-in scheduler through `additionalSchedulers`. Set
`LOCAL_EVENT_ALERTS_ENABLED=1` only in the environment explicitly approved for
delivery. It defaults off; importing the app does not deliver anything. Tests
use temporary databases and synthetic data. The local settings API exposes
this activation state so a disabled runtime is not presented as live delivery.
The flag also switches imported show notices from the old generic artist-news
notifier to the event-aware path. Public artist-news cards and release notices
are preserved. Keep this switch atomic across instances; this is not a mixed
old/new writer protocol or a production rollout approval.

First activation records a finite quiet baseline, including events accumulated
while disabled. New calendar inserts and updates queue work transactionally.
The queue's autoincrement sequence prevents reused SQLite event rowids from
turning fresh dates into historical ones. Bootstrap runs in bounded pages.
Scheduled dates have no observation or announcement while private; the queue
wakes at release time (or its hourly safety recheck). Post-publication edits,
cancellations and provider withdrawal enter the same queue. Existing creator
publication notices are reused by exact event/publication identity.

Every minute, the existing background coordinator runs one non-overlapping
tick: at most 20 catalogue rows, 20 due queue rows, 20 unfinished reconciliation
pages, 20 planning pages, 20 account scans, 100 due deliveries and 100 cancellation/
retention rows. Inner pages default to 100, cap at 500; outer pages cap at 50.
Durable cursors rotate unfinished events/accounts fairly across restarts. A
tick is one IMMEDIATE transaction; shutdown awaits its current work before DB
closure. Bounds are row/page limits, not production-volume latency evidence.
Each canonical queue entry is eligible for recheck after an hour; backlog can delay
that recheck. Fresh read/send guards apply
immediately even before physical cleanup. Large backlogs can delay delivery;
the foundation's 24-hour announcement and two-hour sale expiry windows still
apply. No production capacity or scanner-coverage claim is made.

Trusted Ticketmaster projection retains only transient `sales.public` evidence
for the existing row writer. Evidence, the canonical row and its queue intent
commit together. Public start/end timestamps must have explicit offsets and
cannot be TBD/TBA; absent evidence becomes a tombstone. The canonical provider
ID must still match and no member-owned record can be overwritten. Actual
sale delivery requires current `onsale`, evidence refreshed within 24 hours,
and an exact curated home-city match. No new provider polling cadence was added;
missing timely refresh can suppress an alert rather than invent availability.

## Inbox, preferences and navigation

Tour announcements are global for eligible followed/favourited artists.
Ticket-sale alerts alone use the home city. The defaults are inbox on for both,
device channels off. Artist-specific notification opt-outs, historical fan-club
aliases, favourites, account visibility, blocks and mutes remain enforced.
Triggers queue a fresh future-sale scan for profile city/favourite changes and
fan-club/creator-follow changes; these scans do not replay past announcements.

The existing notification query adds an owned-local-notice predicate before
pagination, unread counts and scoped read acknowledgements. A synchronous SQLite
policy function rechecks the canonical event and audience through the same
service. Unknown/orphan local notices fail closed. Reused creator notices retain
their own lifecycle. Existing reactions, messages and release notices keep
their policies; existing creator-update preferences remain separate.

Activity receives `alertId`, displays both new types in Updates and resolves
the authenticated `/api/me/local-alerts/:id/target` on every tap. That response
contains a canonical event projection for `openShow`, never an archive ID or
raw push URL. The iOS and web navigation owners fence account/auth-epoch changes,
Back, unmount and competing post/event lookups. An unavailable show has a useful
retry state. No attendance or purchase is inferred.

The lazy settings section reuses the existing Row/Toggle components, typography,
spacing and account profile-location entrypoint. Reads and complete four-channel
writes use the feature API and canonical LoadState/CommandResult contracts;
cancelled account scopes cannot project old preferences. Failed writes retain
confirmed values. Device controls honestly state this build is unsupported and
allow disabling previously enabled device categories without prompting the OS.

## Account transitions and retention

Ordinary login, signup identity replacement and password-reset session issuance
now delete the outgoing session inside the credential-issuance transaction.
This cascades its active device registrations/outbox without revoking unrelated
sessions, changing roles, converting account classification or changing page
ownership. Linked-account switching already uses that transaction boundary.
Failed authentication leaves the outgoing session intact. Logout retains the
existing immediate local reset and durable remote-revocation retry behavior;
offline logout cannot prove immediate remote revocation.

Account export includes preferences, alert receipts, nonsecret device status and
delivery metadata. Erasure (including privacy-journal replay on restore) calls
the explicit alert eraser before deleting the account. Active device/token/
session records are removed. The minimal installation security fence retains
installation ID, proof hash and consumed generation indefinitely; account link
and revocation timestamp are cleared. This is deliberate security retention,
not a claim of complete anonymization. The Privacy screen states it explicitly.
Backup verification includes the durable new tables; backup files remain private
and contain operational secrets under the existing backup controls. Restoration
must keep alert delivery disabled while journal replay and eligibility are checked.

## Remaining native work and release limits

No native notification dependency, config plugin, real EAS project ID, APNs/FCM
credential or entitlement was added or inspected. The generation-aware native
controller remains an injected/tested foundation, not a mounted SDK instance.
Before native shipping, mount it at the existing auth-epoch boundary with secure
storage/CSPRNG, explicit OS permission, foreground/token-refresh handling, cold-
start/response listeners and awaited pre-switch preparation. A new authorized
native build and real test-account/device verification are required. Tablet
support still needs review (`supportsTablet` is false in this base).

The server push worker is deliberately not constructed or enabled here. No live
push, provider receipt, OS prompt, physical phone/tablet install, deployment or
production notification was exercised. The app inbox work is local and testable;
phone/tablet push is still a release blocker, not a completed capability.

Integrate the explicit changed-file manifest into the current app branch; do not
overwrite newer Discover/layout/auth/privacy work with this older application
base. The startup cap remains 512 KiB. Re-run the combined budget and regression
gates after integration; this candidate's evidence is not evidence for another
commit or a production deployment.
