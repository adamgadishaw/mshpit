# Account inactivity policy and integration

Database startup, session issuance, public visibility, approved interactive
mutations, the existing complete-erasure callback, warning transport, and a
bounded daily scheduler are connected in the local implementation. Terms/Privacy
disclose the policy. Local implementation and test execution do not deploy the
feature or run a production migration, warning, suspension, or deletion.

## Requested policy

- Every account except the permanently locked Owner account becomes dormant after
  365 days without an authenticated, explicit interaction. This includes fan,
  artist, delegated staff, unverified, and unfinished-signup accounts.
- A successful login or authenticated account switch clears inactivity dormancy.
  It never changes a moderation ban or moderation suspension.
- An account becomes eligible for complete erasure after 730 inactive days, and
  only after an acknowledged advance warning has allowed at least 30 further days.
- The latest all-account instruction supersedes the earlier request to keep
  unfinished accounts indefinitely. Nothing expires earlier solely because setup
  is incomplete or email is unverified.
- “Days” here means exact 24-hour UTC durations, not calendar-year arithmetic.

These are product rules, not a claim of legal compliance. The production Terms
must disclose the policy and warning/reset behavior before activation. Any legal
retention requirements need a reviewed, explicit handling policy in the existing
erasure workflow; this module does not invent one.

## Safe rollout

`ensureAccountLifecycleSchema(database, { at })` must run outside a transaction,
after the users/shared-email schema is established. It adds private lifecycle
columns and an indexed due-time queue. Missing historical activity is initialized
to the rollout timestamp, never guessed from `created_at`. Re-running preserves
recorded activity. An insert trigger starts tracking new rows at actual insertion
time, including rows with backdated creation dates.

The helper itself does not suspend or delete. Starting with unknown historical
activity therefore cannot immediately classify an old account for deletion.
The lifecycle columns should not appear in public profile projections.

## Integration contract

1. Import the schema helper during database initialization. Do not execute this
   migration against production as part of a test or this implementation task.
2. After a successful explicit interaction, call
   `recordInteractiveAccountActivity(database, { userId, at, kind, reactivate })`.
   Kinds are `login`, `account-switch`, `signup`, `foreground`, and `mutation`.
   Only successful `login` and `account-switch` may pass `reactivate: true`.
   Server middleware must identify successful, authenticated, user-initiated work;
   never call it from passive session reads, polling, analytics, impressions,
   background refresh, or failed requests. A `foreground` event must represent
   deliberate foreground use, not an automatic heartbeat. Update only the selected
   account ID, never all accounts sharing its email.
   `createSession` already does this for successful authentication inside a
   savepoint, so an enclosing password-change transaction can roll back both the
   new session and activity together. `getSession` deliberately does not record
   activity or clear dormancy; a valid session remains usable for privacy rights.
3. Apply the separate `dormant_at` marker at the same authenticated mutation
   boundaries that already enforce restrictions. Preserve privacy/export/deletion
   access. Do not write `is_banned` or `suspended_until` for inactivity. Successful
   password login/account switching remains the explicit dormancy recovery path.
4. Reuse the complete existing privacy-erasure workflow (relationships, tags,
   email queues, media cleanup ledger, and account row), extracted into a
   synchronous function. Supply it as `eraseAccount(user, { at, reason })`; it must
   use the provided database connection and must not start/commit a transaction.
   Never replace it with a partial `DELETE FROM users` implementation.
5. Supply `sendWarning({ user, at, idempotencyKey, deleteAfter })`. It must verify a
   durable delivery acknowledgement and return
   `{ delivered: true, receiptId: "durable-provider-receipt" }`. A queue insertion,
   console/dev transport, marketing campaign flag, unverified assumption about
   receipt delivery, or provider error must not return that acknowledgement.
   Use the stable idempotency key for each account/activity cycle. Identify the
   individual account/handle in the warning so shared inboxes are unambiguous.
6. Schedule `runAccountLifecycleSweep({ database, at, limit, sendWarning,
   eraseAccount })` at most daily, initially with a reviewed bounded batch size
   (default 100, hard maximum 500). Warn from day 700; acknowledge before starting
   the 30-day countdown. An undeliverable/unverified address is not an exemption
   from dormancy, but inability to deliver the warning blocks deletion safely.
   `startAccountLifecycleScheduler` checks hourly after an initial ten-second
   delay but claims at most one batch per rolling 24-hour period durably in
   `app_meta`; a restart or second process cannot repeat that daily batch. It
   aborts receipt polling and drains current work during graceful shutdown.
7. Publish the reviewed inactivity Terms disclosure and cover the real auth,
   dormant-access, email-receipt, and complete-erasure integration with tests
   before activating the scheduler. The isolated tests do not prove that wiring.

## Concurrency and failure handling

The worker checkpoints the next due time before network work so an undeliverable
old account does not starve other accounts. Failed warnings and erasures retry
the next day. Worker calls have no import-time side effects.

Selection excludes the durable Owner ID. Each state-changing worker transaction
re-reads that locked v2 identity; absent/invalid/unlocked identity stops the sweep.
The `owner_account_no_dormancy` database trigger additionally rejects a direct
attempt to set the locked Owner account's dormancy marker. Public SQL therefore
does not need an additional Owner lookup in every read.
Warning acknowledgements recheck the exact activity timestamp. Activity advances
monotonically, including same-millisecond interactions, invalidating stale work.

`eraseInactiveAccount` obtains `BEGIN IMMEDIATE`, re-reads Owner, activity, warning,
and age, then invokes the complete-erasure callback and commits as one synchronous
operation. Login that wins the writer lock invalidates the candidate; a stale
candidate cannot erase the recently active account. Erasure failures roll back
all callback writes. An asynchronous or incomplete callback is rejected. No
network request is made while holding the erasure transaction.

The warning sender persists one stable, account-specific warning, its provider
message ID, and the originally stated earliest deletion date in
`account_inactivity_warnings`. That row disappears on account erasure or new
activity. It uses ordinary transactional mail delivery and respects the existing
remaining daily send budget; marketing consent does not gate required warnings.

Resend send acceptance is not a delivery acknowledgement. A later daily pass
queries the [official retrieve-email endpoint](https://resend.com/docs/api-reference/emails/retrieve-email)
and requires the same provider ID, the exact sole recipient, and
`last_event: "delivered"`. Only that verified response can start the 30-day grace
period. Acceptance without a usable provider ID blocks erasure and repeat sends.
Accepted messages with IDs are polled rather than re-sent. Provider errors,
missing/expired records, mismatched recipients, and non-delivered states all fail
closed. The configured Resend key needs permission to retrieve sent emails;
sending-only credentials cannot authorize inactivity deletion. No new webhook,
public receipt endpoint, or webhook secret is required. No actual production
delivery lookup or credential-permission test was performed during development.

## Operator checks before deployment

- Verify the deployed Resend credential can retrieve sent-email records, not only
  submit mail. Test with an operator-owned test recipient; never substitute an
  HTTP send-success response or an operational `sent` log row for delivery proof.
- Record the migration/activation time. Previously untracked accounts must have
  their `last_active_at` baseline anchored to that rollout time. Do not backdate
  it from `created_at`, import an inferred inactivity age, or clear existing
  activity timestamps to accelerate cleanup.
- Confirm the permanently locked v2 Owner identity is present before enabling
  maintenance. Missing or invalid identity leaves the sweep disabled.
- Monitor the privacy-safe `account inactivity` batch counts. Persistent `pending`
  warnings can indicate provider read permissions, undelivered mail, or expired
  provider records; these conditions must delay deletion, not waive warning grace.
- A restore must preserve or conservatively reset activity/warning state. Never
  convert a provider acceptance ID into a delivered receipt during restoration.
  Validate the complete account/media erasure workflow against a disposable
  fixture before releasing any change to its transaction boundaries.

## Verification

Run `node scripts/run-tests.mjs server/features/accountLifecycle/accountLifecycle.test.mjs server/features/accountLifecycle/accountLifecycleRuntime.test.mjs server/mailer.test.mjs`.
Lifecycle tests use `node:sqlite` in-memory databases and mocked network requests,
and import no live database.
Coverage includes exact 365/700/730-day boundaries, legacy rollout, Owner
exemption/fail-closed identity, new-account baseline, unfinished/unverified and
staff inclusion, independent shared-email accounts, moderation preservation,
noninteractive exclusions, durable-warning failures, login races, rollback and
idempotent retries, callback validation, and bounded queue fairness.

The additional session integration tests live in `server/auth.security.test.mjs`
and use that suite's isolated temporary database. Run runtime-connected suites
through `node scripts/run-tests.mjs <test paths>` so they never open the local or
production database. Affected public repository fixtures include `dormant_at` to
match the new authoritative SQL predicate.
