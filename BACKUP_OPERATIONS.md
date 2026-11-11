# Database backup operations

Code readiness is not off-host coverage. A configured private destination, a
successful scheduled upload, and a restore drill are required. Until then,
`offhost_backup_unconfigured` must remain visible in the health readout.

## Guarantees and boundaries

- The startup gate makes a verified local, pre-migration SQLite snapshot. It does
  not receive remote credentials or call storage providers. A remote outage is
  not a dependency for starting the website.
- The daily scheduler serializes heavy maintenance, applies bounded process and
  upload deadlines, and allows one recovery retry. A fresh local snapshot does
  not suppress an overdue or missing off-host upload receipt.
- A provider outage leaves the verified local snapshot intact. The upload failure
  remains visible and retryable; it cannot create a remote-success receipt.
- A copy is admitted only when free disk space can hold 110% of database plus WAL
  size **and leave 64 MiB for ongoing writes**. Missing disk metrics or insufficient
  room defers it before retention rotation. This is a minimum emergency margin,
  not a recommended capacity target; plan operating headroom separately.
- Local retention remains `BACKUP_KEEP=7` unless explicitly configured otherwise.
  The newest completed snapshot is never selected for preflight pruning. If
  pruning all older copies cannot safely admit the backup, history is preserved.
- SQLite page integrity, foreign keys, schema and member-row baselines are checked
  in an independent snapshot. A concurrent legitimate deletion may safely fail
  the row-floor check and require a retry; it never silently approves lost rows.
- Upload hashes and sends the immutable snapshot in 64 KiB chunks instead of
  allocating a database-sized buffer. S3 validates `Content-MD5`; SHA-256 is stored
  as object metadata. An authenticated HEAD must match size and SHA-256 before
  success. Redirects are refused, response bodies discarded, and failures do not
  publish a fresh success receipt.
- HEAD is an existence/size/metadata check, not a downloaded restore. The receipt
  proves successful upload at that time, not permanent object survival.

## Configure a private destination (operator action required)

1. Create or select a dedicated private S3-compatible backup bucket. Never use the
   public media bucket or the private media-source bucket. Disable public access,
   public development URLs and public custom domains in its control panel. Anonymous
   S3 endpoint denials alone cannot establish whether an alternative public URL
   exists. Confirm provider-side encryption at rest (R2 provides it by default).
2. Create separate credentials restricted to this dedicated bucket. Apply the
   object and listing permissions in **DB08: backup and journal permissions**
   below; `db/` access alone cannot ship or replay the privacy journal. Do not
   grant account-wide permissions or reuse media credentials.
3. Store these only in Render's server environment, never client/public variables:
   `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
   `BACKUP_S3_SECRET_ACCESS_KEY`, and optionally `BACKUP_S3_REGION` (`auto` for R2).
   Also configure `PRIVACY_JOURNAL_KEY` with at least 32 characters for signing
   and verification. Preserve that key outside the database and bucket in the
   approved secret store; it is required to verify historical journal evidence.
4. Keep `BACKUP_ENABLED=true`. The scheduler's next startup pass attempts missing
   remote coverage even when the local startup snapshot is fresh. Look for
   `database backup verified and uploaded off-host`, then check the health readout
   changes from unconfigured/unverified to a recent confirmed upload.
5. Download one exact snapshot through an authenticated provider tool into a new
   private recovery directory. Compare its byte size and SHA-256 with the object's
   metadata. Never paste signed download URLs or database content into tickets.
6. Run `npm run backup:verify -- <downloaded-snapshot-path>` against that file.
   For a full restore drill, use an isolated clone as described in `LAUNCH.md`;
   disable outgoing email, background fetches and uploads, use no production
   credentials, and never replace the live database during the drill.

No bucket, credentials, uploads, public access settings or live database were
changed by this implementation. A successful private upload and real restore
must still be verified after the destination is configured.

## DB08: backup and journal permissions

Use these minimum runtime rights where the provider supports action and prefix
scoping. In AWS IAM, object resources use `arn:aws:s3:::<backup-bucket>/<key>`;
`ListBucket` instead uses the bucket resource `arn:aws:s3:::<backup-bucket>`.

| Resource | Required actions | Purpose |
| --- | --- | --- |
| `db/*` | `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` | Upload, verify/download, and remove a database upload after a privacy failure. |
| `privacy-journal/v1/*` | `s3:PutObject`, `s3:GetObject` | Ship and read the complete signed journal; the path remains `v1/` for the version 2 chain format. |
| Exact object `privacy-journal/coverage-v1.json` | `s3:PutObject`, `s3:GetObject` | Write and directly read the signed coverage checkpoint. No listing or delete right is needed for this object. |
| Backup bucket | `s3:ListBucket`, with `StringEquals: { "s3:prefix": "privacy-journal/v1/" }` | Enumerate journal entries, including every continuation page. No unprefixed, `db/`, or parent `privacy-journal/` listing is required. |

`GetObject` also authorizes HEAD. Object grants do not authorize listing; keep
the listing condition on its separate bucket statement. Check that no other
attached policy expands these rights. See the AWS documentation for
[HEAD permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
and [prefix-scoped listing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html).

Do not grant the runtime identity bucket administration, ACL/public-access
changes, lifecycle changes, or journal/checkpoint deletion. If a provider's
credential model offers only bucket-scoped object read/write/list access, use
one dedicated private backup bucket and record that broader permission boundary
in the operator review; do not report it as enforced prefix/action isolation.
For example, R2's standard Object Read & Write token can be limited to selected
buckets; it is not the AWS IAM policy above. See
[R2 token permissions](https://developers.cloudflare.com/r2/api/tokens/).

### Verify permissions on a disposable target

This is an operator acceptance procedure, not evidence that permissions have
already been configured. Use a new private **non-production** bucket, credentials
scoped only to it, a new synthetic fixture database and a fresh test signing key.
Use a clean process environment that explicitly sets this target; do not inherit
production credentials, database paths or signing keys. Disable mail, provider
jobs and application uploads. Keep the fixture and all results private.

1. Apply the proposed permission policy only to the disposable identity. Record
   its effective scope and the test endpoint/bucket identity. Confirm public
   access and alternate public domains are disabled in the provider control panel.
2. With the disposable credentials, PUT a small synthetic object under a unique
   `db/` key, HEAD it, GET it and compare its bytes/hash, then DELETE that exact
   test object. Require all operations to succeed.
3. Use the fresh fixture with `ensurePrivacyJournalSchema`,
   `recordPrivacyEvent` and `shipPrivacyJournal` from `server/privacyJournal.js`.
   First ship its empty stream and verify a directly readable signed zero-entry
   checkpoint. Save a fixture snapshot before recording both supported event
   kinds, then record and ship them. Require
   successful journal PUT/GET, direct checkpoint GET/PUT, and authenticated
   `ListObjectsV2` with `prefix=privacy-journal/v1/`. Exercise continuation pages
   with a small page size; retain only counts, hashes and status results, not
   signed URLs, credentials or member data.
4. Prepare a separate offline recovery copy of the saved snapshot and run the actual
   replay path. Require complete chain/checkpoint verification and both synthetic
   privacy decisions to apply. A successful listing or empty bucket alone is
   insufficient. Deny one required permission at a time on disposable identities
   and require the operation that needs it to fail without a successful coverage
   receipt. Use a newly prepared recovery copy for each replay case so a prior
   successful replay receipt cannot bypass the check.
5. Where exact scoping is supported, verify that unprefixed listing, listing
   `db/` or `privacy-journal/`, writes outside the allowed object resources, and
   journal/checkpoint DELETE are denied. Use only disposable fixture objects for
   destructive probes. Record any provider-specific broader rights separately.
6. Using a separate disposable-target administrator, remove one journal object
   and replay into another newly prepared fixture copy: it must remain gated.
   Also require an empty
   target without the valid checkpoint to remain gated. Retain the redacted
   acceptance results, then destroy the disposable bucket and fixture with that
   administrator; do not expand runtime permissions for cleanup.

Local mocked regression tests do not verify a provider's effective permission
policy. Production setup and restore acceptance remain separate operator work;
this procedure must never be run against a retained recovery stream.

## Restore replay coverage

`server/privacyJournal.js` currently signs and replays only `account_erased`
and `marketing_opt_out` events. A successful journal replay does not reconcile
post, comment or message deletions, blocks, account restrictions, password
changes or role changes made after the snapshot.

Before an actual cutover, reconcile those changes from authoritative evidence
into the offline recovery copy and retain the operator's privacy and credential
review references. Do not interpret a reference accepted by
`scripts/prepare-db-restore.mjs` as proof that reconciliation happened:
`server/databaseRecovery.js` explicitly relies on the operator's review.
It invalidates restored sessions, outstanding tokens and queued mail, but does
not reconstruct newer password hashes or access roles. If the required evidence
is unavailable, keep the copy isolated and resolve the recovery decision before
serving it. A synthetic restore test cannot establish this operational coverage.

### Chain coverage and legacy restores

New journal streams use signed version 2 entries with a stream identity,
sequence and previous-entry hash. The signed checkpoint at the exact key
`privacy-journal/coverage-v1.json` binds the destination, stream identity and
head sequence/hash. Restore requires the complete verified chain through that
head and consistency with the snapshot's durable journal anchor before any
privacy changes are applied. A valid signature on each remaining object cannot
prove that an omitted object never existed.

A newly initialized stream can have a signed zero-entry checkpoint. A plain
empty bucket, missing checkpoint, deleted entry, sequence gap, wrong destination
or invalid signature cannot clear the restore gate. An off-host database upload
receipt is not journal coverage evidence.

The checkpoint requires an authenticated GET with a strong ETag. First binding
uses `If-None-Match: *`; subsequent writes use `If-Match` so an older writer
cannot replace newer proof. The configured provider must enforce these
conditions atomically. See the official [R2 conditional operations](https://developers.cloudflare.com/r2/api/s3/conditional-operations/)
and [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
contracts. Include rejected conditional writes in the disposable permission
check; a generic S3-compatible endpoint must not silently ignore these headers.

Existing databases/snapshots adopted from the legacy journal have unknown chain
coverage, including history that may already have been pruned. Their
`legacyUnknown` state is not repaired by a new upload, empty outbox or new
checkpoint. Shipping may continue at the existing destination, but local
unknown-history legacy journal rows are retained and automatic restore remains
gated. Chained v2 rows can still expire locally after 30 days of confirmed
shipment because their signed remote chain is retained.
Before restoring such a snapshot, reconcile deletions, consent and credentials
from authoritative evidence and record the owner's recovery decision. Only then
set `PRIVACY_JOURNAL_REPLAY_WAIVER` to that non-secret incident/review reference
for the isolated recovery run. The waiver is recorded as a decision, not as
successful chain verification; remove it from the environment after the run.
Keep the recovery copy isolated when evidence or the required decision is absent.

### Destination migration and signing-key continuity

Coordinate a destination migration so the journal cannot advance while its
history is being copied. Preserve the source bucket and the durable database
anchor. Copy every signed journal object under `privacy-journal/v1/` and the
exact signed checkpoint `privacy-journal/coverage-v1.json` byte-for-byte to the
new private destination, along with any retained database snapshots being moved.
Retain a verified source/destination inventory; copying only pending outbox rows
or recent journal dates omits evidence already pruned locally.

For a stream with known coverage, the shipper verifies the copied complete chain
and checkpoint against the local durable anchor before signing a checkpoint
bound to the new destination. Do not manually edit/re-sign the checkpoint or
replace it with a zero-entry checkpoint. Leave the original source available
until an isolated restore verifies the destination and the migration is accepted.
A legacy/unknown-history stream cannot gain automatic coverage by migration:
preserve its original source and use the recorded recovery-decision procedure
above when a restore is required.

Keep `PRIVACY_JOURNAL_KEY` available for verification while any corresponding
journal entry or snapshot remains recoverable. This change supplies no key
rotation protocol. Generating a replacement key, taking a fresh backup or
changing destination credentials does not make historical entries verifiable
with the new key. Do not rotate the journal signing key as part of this procedure.

Shipping has a two-minute total transport deadline; restore replay has five
minutes. Enumeration remains capped at 20,000 objects, 1,000 list pages, 4 MiB
per listing response and 4 KiB per object. Exceeding a bound leaves recovery
gated; do not truncate history to make verification pass. Plan a separately
reviewed archival/recovery method before the stream reaches these limits.

## Disk and cost control

Budget peak local storage for the live database, WAL, retained snapshots, one
in-progress snapshot and working headroom. Repeated restarts create local
pre-migration snapshots but do not cause a remote upload on every restart.

Off-host transfers send one full snapshot per successful daily backup plus failed
attempts/retries. For snapshot size S GiB, budget roughly `30 × S GiB/month` of
outbound transfer before retries; Render may bill outbound traffic even when a
destination advertises free downloads. The upload does not redownload the database
daily: HEAD adds one small request, while full restore drills are explicit.

Remote retention is deliberately not silently destructive. After a first successful
restore, explicitly select and configure a lifecycle policy scoped to `db/`
(for example 30 days of daily snapshots). Until configured, objects accumulate:
at one daily S-GiB backup, a 30-day retention window consumes approximately
`30 × S GiB`.
If monthly archives are required, copy selected verified backups into a separate
prefix with its own retention before shortening daily retention. Lifecycle changes
must never expire the only verified recovery copy. Schedule periodic restore drills
and retain external host-down alerts because in-process health cannot run during
an outage.

Exclude `privacy-journal/v1/` and `privacy-journal/coverage-v1.json` from snapshot
lifecycle expiration. **Retain the complete remote journal chain and its
checkpoint while any snapshot from that stream remains recoverable**, including
local copies, monthly archives, provider versions and migration source copies.
Expiring journal entries by age, even entries older than the oldest retained
snapshot, breaks full-chain verification. Local shipped-outbox pruning is not
permission to remove remote evidence. There is no automatic chain-compaction or
journal-retirement procedure in this change; review the entire stream's recovery
inventory before any later retirement decision.

If disk space is low, measure database, WAL and backup sizes first. Do not delete
the live database, WAL, media, or unknown partial files. A refused startup backup
is a data-preservation gate; recover space from explicitly identified expendable
files or expand the disk, then retry. Do not bypass the gate or enable empty-DB
bootstrap to start a service whose data disk is full or missing.
