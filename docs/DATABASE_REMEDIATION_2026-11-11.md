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

## Data integrity and read performance (DB09–10, DB12–13)

Verified and locally integrated source commit
`6652e88a50470a83d5c9a792c1d76f8cb82a5179`, also based on released `c2bbe882`.
All 21 supplied delivery/evidence hashes and bundle prerequisites matched. Both
source histories are retained. `server/api.js` merged without conflicts and its
privacy projection and atomic send boundaries were compared against `72af15a`.

- **DB09:** Shared account erasure reparents another member's surviving replies
  to the nearest surviving ancestor inside the deletion transaction. It preserves
  surviving ancestor privacy restrictions and keeps malformed ancestry unavailable.
  Authored content still cascades away; existing production orphans are not repaired.
- **DB10:** Fresh Here transitions resolve current source eligibility while
  holding the write lock, covering stable Show IDs and aliases. Stale cancellation,
  timing, missing/reassigned sources or visibility cannot authorize a fresh check-in.
  Public Show reads use current lifecycle when authoritative evidence exists and
  retain historical timing when it is missing, mismatched or ambiguous. After source
  deletion, existing retry/privacy/removal compatibility uses stable IDs or aliases;
  requests carrying `tourDateId` still resolve the source first, as before this fix.
- **DB12:** Additive startup initialization creates the partial unread-notification
  index. Privacy and acknowledgement predicates are unchanged. No live index build
  has run; production build duration/storage impact is unmeasured.
- **DB13:** Indexed directional peer seeks replace complete-history ranking and
  enumeration for inbox previews/read projections. Full unread totals, consent,
  stable timestamp/ID ordering, the existing 750-removal inbox window and complete
  per-thread removal history remain. Send and authorization code is preserved.

The committed performance documents give reproducible local synthetic evidence.
They are not production timings or a capacity guarantee. Shallow many-peer inboxes
have overhead, and removal-heavy histories still dominate remaining query work.

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
- The two-stream combined selection passes **225 tests, 0 failures, 0 skips**
  (~20.34 seconds). Independent messaging/privacy and erasure/attendance reviews
  found no merge-introduced blockers. Changed Node syntax, architecture and diff
  whitespace checks pass. Evidence: `combined-two-streams-focused.log` and
  `two-stream-source-boundaries.json` in the evidence directory below.
- Recovery DB04–08 is still awaiting its verified commit. The final aggregate
  gate is deliberately reserved for all three integrated streams; the own-only
  aggregate result above does not certify the combined source.

Evidence directory: `database-fixes-evidence-20261111` beside this checkout.
No production SQL, production restore, native compilation or device checks were
run for these backend changes.
