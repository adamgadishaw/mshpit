# Application and database integrity review — 2026-09-26

## Scope and provenance

Independent review of the completed changes between `bda7894` and production
`7a3b7d23c14a2b58ee5e85023212a25ff6a5f6f3`, including durable media conversion,
artist management, news, research workers, Discover and browser navigation.
Remediation was isolated on `codex/integrity-review-20260926`.

The separate `pit-newsdesk` checkout contains unfinished edits and was **not**
merged or altered. `pit-design` was clean at `9373dbd`; `pit-slideshow` was clean
at `7a3b7d2`. Findings below are reproducible defects, not evidence of exploitation.
This is a scoped code/fixture/operational review, not a guarantee that no other
vulnerabilities exist.

## Confirmed findings and remediation

| Priority | Finding | Remediation and proof |
| --- | --- | --- |
| High | Returning an artist to the catalogue cleared page ownership but left the account's artist role/name/check, allowing an immediate legacy reclaim. | Revoke matching artist authority, sessions, old claims and active story challenges atomically; preserve staff roles. Historical moderator removals also block implicit legacy claims until deliberate staff approval. Reclaim, upgrade-state and rollback regressions. |
| High | A composer opened before video conversion completed could silently remove the newly-ready attachment. | Conversion increments the post edit version in the same transaction; stale edit gets a conflict and the clip remains attached. |
| High | Sessionless video retries skipped decoder admission and current account restrictions. | Recheck account status and owner/global budgets before work and publication. Network-limit and revoked-session failures require a fresh member request. Deleted/banned/suspended/dormant/unverified and mid-request deletion regressions. |
| High | Extreme pixel-aspect metadata could allocate an enormous FFmpeg intermediate frame before the final size clamp. | Calculate finite bounded final geometry before encoding and use one scale. Command-level tests cover extreme and normal anamorphic/rotated inputs; no destructive load test was run. |
| High | Cached news did not consistently apply current member-created artist visibility and authored-event blocks. | Recheck canonical visibility, pass viewer, prohibit shared API caching, keep bounded pagination through filtered records. |
| Medium | Optional background chunk warming could reload an active composer after deployment. | Warmups cannot trigger page reload; explicit navigation retains one-shot recovery. Executable stale-chunk regressions. |
| Medium | Video-only converting posts hid the public artist-gallery consent control. | Consent remains available and opt-in while clips process; no composer features removed. |
| Medium | Fractional news limits produced SQLite errors; filtered pages could strand later visible news. | Integer bounded limits, bounded server scanning and visible continuation even for an empty filtered page. |
| Medium | Failed/abandoned paid research could lose incurred cost and restart against an apparently unused allowance. | Durable pre-request reservation, partial receipts, uncertain-cost pause, per-continuation admission, midnight-safe settlement and 35-day receipt retention. |
| Medium, dormant | Disabled Crew leave endpoint let nonmembers request a protected plan response. | Reject outsiders and recheck access for cleanup responses. Feature remains disabled. |

## Database checks and limits

- Local database: 44 read-only checks passed, zero warnings/errors. Includes
  SQLite structure/foreign keys, ownership, linked sessions, duplicates and JSON.
  Added durable-job owner/type/request/deadline and variant/revision checks.
- Audits run inside one consistent read transaction and emit counts, not private
  row samples. Synthetic corrupt fixtures prove detection without modifying data.
- Local database is a development copy, **not a current production snapshot**.
- Production startup backup at 2026-09-26 14:41 UTC reported `integrity_check ok`.
  That proves the snapshot's SQLite structural integrity, not all business rules.
- Direct read-only production relational audit was not completed: SSH stopped at
  host-key verification. Trust verification was not bypassed.
- New `catalog_research_spend` table is created idempotently by the existing
  research schema initializer. No destructive data migration is required.

## Live operational evidence before remediation

Service `mshpit` was on `7a3b7d2`. Public core probes all passed, including
health/readiness, artist search, Discover, tour dates and sidebar. Media readiness
passed for the private conversion pipeline. No test accounts/posts/uploads were
created on production.

At 15:06 UTC, the production database was about 197 MiB, with 3,554 MiB free on
the 5 GiB disk (about 71%). Read probe was 0.06 ms. Render's 14:43–15:13 samples
showed roughly 0.009–0.107 CPU cores and 117–265 MiB memory, not capacity pressure.
HTTP 200 p95 bins were usually 75–116 ms, with two roughly 2-second bins. A single
Discover probe took 2.07 seconds; this is a follow-up latency observation, not a
load-test result or a reason by itself to buy a larger server.

App error-level log query after the latest deployment returned no entries in the
reviewed window. Earlier 502s coincided with deploy transitions. A service with a
persistent disk still has brief deploy downtime; do not represent it as zero-downtime.

## Remaining operational/security work

1. **Off-host backup is still unconfigured.** Owner requested a new private
   Cloudflare R2 bucket during this review. No bucket or credential was created:
   browser startup fails in this environment and no Cloudflare management
   connection is configured. Existing media buckets/keys must not be reused.
   Required next steps: dedicated private bucket and restricted key, Render
   `BACKUP_S3_*` secrets, intentional lifecycle retention, verified upload and an
   isolated restore/integrity drill. No successful receipt means no off-host claim.
2. Research default remains USD 5/day (up to USD 150 over 30 days if consumed),
   unless the live environment overrides it. Live billing/default override was
   not established. Reservations are estimates, not a provider-enforced hard bill
   cap; an already-admitted request can exceed its estimate. Set provider-side
   spend limits and choose an explicit daily allowance before relying on this
   worker under a USD 50 total website budget. Unknown charges pause paid work
   for the rest of the UTC day rather than silently resetting spend.
3. Crew stays disabled; its timestamp-only chat cursor and access-revocation UI
   require review before enabling. Artist-page news rows still have a minor
   inert-button affordance. Neither was advertised as a completed redesign.
4. Removing artist-management authority intentionally does not erase existing
   posts/events; content takedown remains a separate moderation decision.
   Pre-upgrade moderator removals also warrant an administrative review of any
   stale account badges/sessions. The legacy-claim guard prevents reacquisition;
   this release does not blindly bulk-demote historical accounts.
5. Historical security backlog remains: old repository credential/database
   history remediation and an erasure/suppression journal outside restored
   backups. This review did not rewrite Git history or erase member data.

## Validation and rollout

Focused regressions passed. The first full suite found one sitemap fixture that
created news for a nonexistent artist; the corrected regression proves orphaned
news stays unindexable and real visible artist news enters the sitemap.

The final review-branch `npm run check` passed: 5,458 tests, zero known dependency
vulnerabilities, syntax/architecture checks and production web export. Initial
JavaScript is 500.4 KiB gzip against the existing 512 KiB budget. The targeted
sitemap suite passes 21 tests; the integrity-audit suite passes 8 tests.
The preceding remediation also passed the full check on master (5,457 tests).
After the historical-revocation upgrade guard added one regression, the final
post-merge master check passed all 5,458 tests before pushing.
Isolated browser checks passed 4/4 posting scenarios (375/1280px, including quota
recovery) and 10/10 Discover navigation scenarios (390/1280px, artist resolution,
retry/conflict handling and Back navigation). They used only synthetic local
fixtures, not production accounts or uploads.

### Completed rollout

- Code commits `1575dac` and `8b24a3a` were pushed to `origin/master`.
- [GitHub Quality run 385](https://github.com/adamgadishaw/mshpit/actions/runs/36252508678)
  passed both jobs: server/build plus hosted-setting tests, and all nine browser
  suites (account access, artist accounts/identity, navigation, Discover photos
  and venues, catalogue controls, quick logging, and media uploading).
- `mshpit` deployment `dep-daruh2e7bikc739mpu5g` became live on `8b24a3a`
  at 2026-09-26 15:55:04 UTC. The hosted web bundle was 498.1 KiB gzip.
- `pit-video-verifier` deployment `dep-daruilgjo6nc739gda5g` became live on the
  same commit at 15:49:01 UTC. Its filtered automatic deployment did not start
  for this two-commit push; one targeted deployment was triggered after CI
  succeeded and repeated checks confirmed none was queued. No cache was cleared.
- The converter's actual Docker self-test passed AVI, Matroska, WebM, MPEG,
  portrait MP4 and anamorphic MP4. FFmpeg was unavailable locally, so this
  hosted build evidence is distinct from local command-level tests.
- Post-deploy public core verification passed all eight probes; media readiness
  passed for 13 formats, source admission revision 2. Discover overview took
  2,069 ms; the other probes took 99–466 ms. These are individual probes, not
  load-test percentiles or proof that every user flow is fast.
- The new production startup backup reported structural integrity OK at
  15:54:56 UTC; storage was healthy, database 198 MiB, free disk 3,549 MiB
  (70.9%), read probe 0.02 ms. This still does not establish off-host recovery
  or a complete live business-rule audit.
- Error-level application logs across both services were empty in the reviewed
  post-deploy window beginning 15:55:04 UTC. This is a bounded observation, not
  a promise that no future failures can occur.

No live test accounts, posts, uploads, bulk ownership changes or destructive
database repairs were performed. The Cloudflare and production relational-audit
access blockers above remain unresolved.
