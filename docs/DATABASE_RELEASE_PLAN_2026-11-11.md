# Database remediation release plan

This is a prepared local release handoff, not a deployment or production restore.
The final delivery manifest identifies the exact combined commit/tree, checksums
and completed checks. The separate member-theme stream is not included.

## Remediation mapping

| Finding | Primary implementation | Acceptance evidence |
| --- | --- | --- |
| DB01 | `relationshipManagementProjection.js`, mute/block and inbox projections in `api.js` | Current private/inactive identities unavailable; owned removal controls and normal threads work. |
| DB02 | `directMessageSafety.js` | Static 216-case policy/age/conversation/follow matrix and persisted API cases. |
| DB03 | Atomic POST DM handler in `api.js` | Notification failure rollback, deliberate mute suppression, retries, session/account restrictions. |
| DB04 | `privacyJournal.js`, continuity/storage-identity helpers, backup receipts | Destination/legacy/chain/snapshot/fault matrices; verified replay must resume future decisions without forking. |
| DB05 | `backupScheduler.js`, `periodicJobScheduler.js` | Restart follows persisted due time and bounded retry. |
| DB06 | `scripts/backup-db-partials.mjs` | Killed-copy cleanup, active/unknown/recent/link protection and recovered capacity in disposable fixtures. |
| DB07 | `siteHealthDigest.js` | Aggregate-only readiness/backlog/failures, including unresolved failures with no pending rows and verified recovery clearing. |
| DB08 | `BACKUP_OPERATIONS.md` | Reviewed permission/runbook scope; actual provider permissions and restore remain untested here. |
| DB09 | `features/accountPrivacy/commentErasure.js` | Surviving reply ancestry/privacy and rollback across erasure/journal writes. |
| DB10 | Show lifecycle/repository/attendance routes | Fresh Here resolves current source authority under lock; historical identity and stable-ID operations remain. |
| DB11 | Account privacy export route | Owned mutes/plans, hidden/past editions, allowlists, password/account boundaries, disclosed history caps. |
| DB12 | Partial unread-notification index in `db.js` | Additive startup/restart and unchanged visibility/acknowledgement behavior; local indexed fixture comparisons. |
| DB13 | `directMessageThreads.js` and read/consent projections | Indexed peer/latest/removal reads preserve ordering, complete unread totals, consent and history access. |

## Data and startup implications

Ordinary startup adds nullable `entry_json` and `shipped_storage_identity` columns
to `privacy_journal_outbox`, creates its durable continuity record in `app_meta`,
and creates `idx_notifs_unread_user` on unread rows. Initialization is additive and
idempotent. No account data repair, historical orphan repair, notification backfill,
bulk deletion, key rotation or new production credential is part of deployment.

Existing legacy journal continuity remains explicitly unknown. That status does
not stop ordinary live startup, but it cannot authorize an automated restore.
Unbound legacy local rows remain retained. Old upload receipts cannot certify the
new destination-bound format; a scheduled verified upload must establish new proof.

The existing production launcher requires a verified local pre-migration snapshot
before importing the server/migrations. It retains its bounded timeout and storage
admission rules. On the currently reported single-instance persistent-disk service,
plan a restart interruption; do not promise zero downtime or an unmeasured duration.
If the local snapshot fails, startup deliberately stops before migration. Index
build time and production interruption duration have not been measured here.

## Evidence for the release owner

1. Reconfirm live server identity and divergence before publishing this candidate.
   The audit baseline was `c2bbe882`, Render deployment `dep-dbq7mjgu01pc73a27an0`
   completed November 11 at 14:39:06 UTC; that is parent-verified historical evidence,
   not a fresh query by this implementation task.
2. Confirm current disk headroom and the fresh readable local pre-migration snapshot.
   Parent evidence at 18:54 UTC showed DB 257 MiB, WAL 13 MiB and 2,441 MiB free.
   Recheck operational state at release; those figures are not a reserved capacity
   guarantee. Preserve the snapshot identity/hash privately, not user records.
3. For an off-host-recovery readiness claim, verify the actual private destination,
   authenticated object size/hash/readability, journal/checkpoint access and signed
   continuity with the preserved signing key. Parent observed scheduled upload logs
   through November 10 at 20:24:51 UTC and a verified local startup snapshot; log
   success does not prove current retrieval, provider retention or a completed
   restore drill. Real provider conditional-write support is still untested here.
4. Follow the runbook's disposable permission/restore procedure when separately
   authorized and an approved access route is available. Never use an empty listing,
   reset continuity metadata or set a waiver merely to make a check pass. Legacy
   reconciliation and a recorded recovery decision are explicit owner operations.

These are operational handoff requirements and limits, not claims that production
checks have already occurred. Existing service startup does not depend on a remote
provider being available; failed/unconfigured coverage remains visible and retryable.

## Rollback and authority

Preserve the exact previous binary/source and pre-migration snapshot. Extra SQLite
columns and an index are additive, but journal writer semantics changed: an older
binary cannot maintain the new signed sequence/head contract. Do not assume a code
rollback after new privacy decisions is a safe recovery plan. Prefer a reviewed
forward correction; otherwise stop accepting writes and make an explicit recovery
decision that preserves subsequent erasures/opt-outs and journal/key continuity.
Never overwrite the database as a routine code rollback.

Publication/merge/deployment is a separate coordinator-owned authorization check.
No production data repair, production restore, IAM/credential change or signing-key
change is authorized by this local implementation. Any required change to those
targets needs a concrete owner-approved plan. No phone or Mac action is required
for these server-only changes; the installed build remains untouched.

## Practical limits

- Full historical export remains subject to the existing disclosed history caps;
  the new current mutes/plans categories are complete. No queued archive job is added.
- Known client-cache values are not comprehensively purged by narrower server
  participant projections; separate relationship-context metadata is unchanged.
- Historical malformed comment ancestry and missing notifications are not repaired.
- Missing/ambiguous source evidence may leave public Shows as historical records;
  fresh check-in still requires current authority.
- Local benchmark improvements are synthetic, not production performance/SLOs.
  Many-peer and removal-heavy inboxes retain documented costs; indexing adds writes.
- Journal verification remains bounded and fails closed rather than truncating a
  larger archive. Keep complete remote chains and signing material while related
  snapshots survive. Journal replay covers erasure and marketing opt-out, not every
  credential/privacy change; existing manual reconciliation requirements remain.
- Windows file-symlink execution and Linux process-namespace behavior are reported
  separately from passing fixtures. No real off-host restore was performed.
