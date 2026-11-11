# Database audit remediation — 2026-11-11

Local review branch from released server `c2bbe88246f249a5fa7cd60f3184f55b6b8794bf`.
This records implementation evidence; no production data repair, migration run,
credential change, deployment or device operation is part of this work.
The completed audit and its synthetic evidence remain preserved outside this tree.

## Privacy, messaging and portability (DB01–03, DB11)

- **DB01:** Mute and block management used the general public-user projection
  without applying the requesting member's current profile-access boundary.
  `relationshipManagementProjection.js` now rechecks visibility and bilateral
  blocks, allows only seven management identity fields for accessible profiles,
  and returns a fixed nonidentifying placeholder otherwise. The opaque ID keeps
  unmute/unblock functional. Both lists are private/noncacheable. The existing
  web/native Settings and Avatar contracts remain supported.
- **DB02:** Teen and unknown-recipient mutual-follow branches returned before
  checking the recipient's first-contact policy. `directMessageSafety.js` now
  applies Nobody before those branches. Existing adult conversations remain
  writable; unknown senders remain denied and teen/unknown-recipient safety is
  still rechecked for subsequent messages. A static 216-case truth table covers
  policy, age classifications, existing conversation and every follow direction;
  actual API cases exercise persisted settings and absence of denied writes.
- **DB03:** A DM and its consent triggers previously committed before its
  notification was attempted. The complete send handler now uses the existing
  synchronous `BEGIN IMMEDIATE` boundary, including current-session, recipient,
  block, contact-policy and idempotency checks. Required notification failure
  rolls back the message and consent changes. Intentional mute suppression still
  delivers the message successfully; an idempotent retry after unmuting does not
  create a new notification. Historical missing notifications are not backfilled:
  those rows cannot safely distinguish old failures from intended suppression.
- **DB11:** Account export now includes all owned mutes and festival plans with
  explicit fields and stable opaque references. It exports saved selections even
  when an edition is past, hidden or later changes. No counterpart live profile,
  internal column or storage capability is added. Password confirmation and the
  existing disclosed history caps remain; the new current-preference categories
  are not silently capped. A queued complete historical archive remains future
  work already disclosed by the export.

No schema or client changes are required for these four fixes. New export keys
are additive. Production adoption requires the normal separately authorized
server release; this local patch does not alter the installed iPhone build.

## Validation

- Combined owned regression selection: **73 passed, 0 failed, 0 skipped**.
  This includes injected notification failures, keyed/unkeyed retries, preserved
  preexisting conversations, revoked sessions, bans/blocks, policy matrix,
  private/inactive management targets, account boundaries and export over-limit
  fixtures (501 mutes, 201 plans and the disclosed 1,000-message history cap).
- Individual agent checks additionally exercised the existing export/auth,
  festival, notification, mute and block regressions. Counts overlap; they are
  not added to the combined count above.
- Required `npm run check`: **passed**. Full suite **7,252 passed, 0 failed,
  1 skipped** (host cannot create a file symlink for one offline-restore test);
  dependency audit found 0 vulnerabilities; syntax passed for 937 Node files;
  architecture and web export passed. Initial web JavaScript is 519,663 bytes
  gzip against the unchanged 524,288-byte budget. `git diff --check` passed.
- Independent read-only reviews of DB01/DB11 and DB03 found no blockers; the
  DM reviewer also passed 28 focused tests. DB02's static matrix was separately
  checked against the contract (40 allowed / 176 denied combinations).
- These changes do not claim universal client-cache revocation, historical
  notification repair, or tested cross-process crash recovery. One optional
  Windows CIM process-detail read was denied; it was not retried, and ordinary
  gate logs and completion receipts established successful completion instead.
- Recovery and data-integrity workstreams remain separate until their verified
  commits are integrated and checked on the combined tree. Those final combined
  checks are still pending and are not represented by the gate above.

Evidence directory: `database-fixes-evidence-20261111` beside this checkout.
No production SQL, production restore, native compilation or device checks were
run for these backend changes.
