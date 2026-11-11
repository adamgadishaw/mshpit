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

Integration review also reproduced the same unnecessary live-profile disclosure
through both inbox `otherUser` projections on the released baseline. The owner's
explicit follow-up authorization extends DB01's minimal, viewer-bound projection
to those two sites. Message history, consent, unread/read state, ordering, removal
IDs and replies keep their contracts. Five new actual-route regressions cover
visible and inaccessible peers, live changes, account boundaries and normal thread
operations. Previously delivered client-cache fields and the separately scoped
relationship-context object are not claimed to be purged by this server change.

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

## Backup and privacy recovery (DB04–08)

Verified source `389105eaf08e35ca68debd0972a7348408c57d6e` is integrated with its
history retained. Both supplied artifact hashes, exact parent and tree matched.
The only merge conflict was the current-status introduction; both source records
were preserved. See [recovery implementation details](DATABASE_RECOVERY_REMEDIATION_2026-11-11.md)
and [the operations runbook](../BACKUP_OPERATIONS.md).

- **DB04:** Backup receipt v2 and journal shipment proof bind to nonsecret storage
  identity. Signed sequence/hash chains and conditional coverage checkpoints
  prevent empty, incomplete, wrong-destination or unproven legacy coverage from
  authorizing replay. The ordinary live service still starts with legacy continuity
  marked unknown; restoring that history requires manual reconciliation and an
  explicitly recorded recovery decision. A successful synthetic replay is not a
  real off-host restore. Integration review additionally found that replay must
  advance the local journal writer to the verified remote head before new decisions
  can extend the stream. The integrated correction atomically resumes covered
  outbox rows, local sequence/heads and destination, applies all privacy decisions,
  and saves receipt v4 with the original snapshot anchor. Old v3 receipts cannot
  certify a stale head. Failure rolls all replay/resume/receipt writes back;
  subsequent decisions, shipment and a second restore are regression-covered.
- **DB05:** The first regular backup deadline follows persisted due time across
  restarts, retaining daily cadence and the bounded retry.
- **DB06:** Capacity admission can reclaim only aged, proven abandoned owned
  partials in the matching host/process namespace. Unknown, linked, active, recent
  or foreign partials remain for operator review.
- **DB07:** Health summaries include aggregate journal readiness, backlog and
  allowlisted failures. Integration review corrected a zero-pending gap: a known
  privacy-probe or checkpoint failure remains visible until successful verification
  clears it. The digest itself makes no external probe and exposes no record content.
- **DB08:** The runbook specifies both object prefixes, exact coverage-object
  access, scoped listing, conditional writes, key continuity and isolated verification.
  No real bucket policy, credentials or security settings were changed.

The combined erasure regression injects failures at outbox insertion, continuity
head update and account deletion. Reply ancestry, account data, journal rows and
the chain head must all roll back; a successful retry advances one event exactly.

## Validation

- Combined owned regression selection: **73 passed, 0 failed, 0 skipped**.
  This includes injected notification failures, keyed/unkeyed retries, preserved
  preexisting conversations, revoked sessions, bans/blocks, policy matrix,
  private/inactive management targets, account boundaries and export over-limit
  fixtures (501 mutes, 201 plans and the disclosed 1,000-message history cap).
- Individual agent checks additionally exercised the existing export/auth,
  festival, notification, mute and block regressions. Counts overlap; they are
  not added to the combined count above.
- Earlier privacy/export-stage `npm run check` for `72af15a`: **passed**.
  That stage's full suite **7,252 passed, 0 failed,
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
- Initial combined recovery/upgrade/erasure selection: **187 passed, 0 failed,
  1 Windows file-symlink skip** (~6.42 seconds). This preceded the integration-review
  journal-resume and zero-pending-health corrections; it is retained as stage
  evidence, not certification of the final corrected source.
- DM participant repair: **31 focused tests passed**; DB07 zero-pending correction:
  **63 focused tests passed**. Independent reviews found no blockers in those fixes.
- Final replay-resume/receipt/erasure selection: **70 passed, 0 failed, 0 skipped**
  (~2.91 seconds). Eleven expected failures reproduced the defect before repair;
  independent review of the corrected atomic resume and readiness rules passed.
- First frozen combined gate: **7,367 passed, 1 failed, 1 skipped**. The failure
  was an existing social-window test expecting the home-city field deliberately
  removed by the approved participant privacy fix. The assertion now verifies
  retained participant identity and the explicit seven-field boundary for both
  inbox variants; all pagination/order assertions remain. No runtime assertion
  or budget was relaxed. Subsequent gate stages did not run in that failed command.
- The exact final source tree, remaining affected checks and complete aggregate
  gate are recorded in the delivery manifest and release handoff. Earlier stage
  outcomes above must not be substituted for that final-source receipt.

Evidence directory: `database-fixes-evidence-20261111` beside this checkout.
No production SQL, production restore, native compilation or device checks were
run for these backend changes.
