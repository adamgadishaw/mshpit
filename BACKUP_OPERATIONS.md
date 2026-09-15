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
2. Create separate credentials restricted to this dedicated bucket, and to its
   `db/` prefix where the provider's policy supports prefix scoping, allowing
   PutObject, GetObject (including HEAD), and DeleteObject for removal after a
   privacy failure. Do not grant account-wide permissions or reuse media credentials.
3. Store these only in Render's server environment, never client/public variables:
   `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
   `BACKUP_S3_SECRET_ACCESS_KEY`, and optionally `BACKUP_S3_REGION` (`auto` for R2).
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
restore, explicitly select and configure the bucket's lifecycle policy (for example
30 days of daily snapshots). Until configured, objects accumulate: at one daily
S-GiB backup, a 30-day retention window consumes approximately `30 × S GiB`.
If monthly archives are required, copy selected verified backups into a separate
prefix with its own retention before shortening daily retention. Lifecycle changes
must never expire the only verified recovery copy. Schedule periodic restore drills
and retain external host-down alerts because in-process health cannot run during
an outage.

If disk space is low, measure database, WAL and backup sizes first. Do not delete
the live database, WAL, media, or unknown partial files. A refused startup backup
is a data-preservation gate; recover space from explicitly identified expendable
files or expand the disk, then retry. Do not bypass the gate or enable empty-DB
bootstrap to start a service whose data disk is full or missing.
