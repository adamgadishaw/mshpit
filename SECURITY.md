# Pit security and privacy readiness

Last scoped review: 2026-10-02 (local robustness follow-up; deployment held)

The application/media/research follow-up is recorded in
`APPLICATION_INTEGRITY_AUDIT_2026-09-26.md`. It supplements, rather than replaces,
the broader September 1 review and its unresolved operational requirements.

The detailed evidence, fixes, residual risk, and release gates for this review are
recorded in `SECURITY_PRIVACY_TECHNICAL_AUDIT_2026-09-01.md`.

## October 2 targeted robustness follow-up

The follow-up on held integration `a7d4890` is recorded in
`ROBUSTNESS_AUDIT_2026-10-02.md`. It addresses four specific remaining findings;
it is not another comprehensive review or evidence of production configuration.

- A3: limiter expiry uses an indexed heap with one entry per live key. An
  admission removes at most 64 expired entries; saturated live-key denial
  inspects the earliest expiry once. Reservation rollback cannot erase a later
  admission. The existing 50,000-key application limit remains. Health/readiness
  retain their 120/IP/min allowance in a separate 1,024-key pool. That pool can
  itself saturate. Limits remain process-local, with existing account/IP keys
  and fixed-window behavior; there is no crawler user-agent bypass.
- REC-1: backup execution, cleanup and retention share a permanent SQLite
  ownership lock in the private backup directory. Child closure precedes parent
  cleanup. Only matching partial/sidecar names for demonstrably dead PIDs are
  reclaimed; ambiguous, live or reused PIDs are retained. Process death releases
  the kernel lock without deleting its file. This does not protect against loss
  of the storage disk, and overlapping older backup scripts are unsupported.
- REC-2: legacy poster work receives cancellation and drains before SQLite
  closes. The existing 25-second shutdown deadline remains the fallback for
  uncooperative work. The earlier closed-database exception required keeping a
  synthetic process alive after shutdown; normal shutdown exits immediately.
  Neither corruption nor permanent loss was demonstrated.
- CB-01: async editor drafting checks current session, role, verification,
  restrictions and actor identity before paid work, around persistence and
  before response delivery. The draft and audit roll back together on revoked
  authority; incurred provider spending remains recorded. Editor session TTL is
  unchanged (30 days, versus 12 hours for admin/moderator); that remains an
  explicit policy observation, not an established exploit.

A2 remains open: a clips request can keep scanning stored candidates until it
finds eligible items. The proposed bounded continuation contract requires an
explicit compatibility decision for older clients. No clips runtime or client
change is included in this follow-up while that decision is pending.

The local robustness exercise uses actual loopback server routes and synthetic
SQLite records for normal browsing, repeated actions and lock contention. Its
queue check uses the real coordinator with a deterministic private memory lease;
it does not simulate host memory pressure. SQLite's existing synchronous
5,000 ms busy timeout remains, and neither request admission nor a JavaScript
timer preempts synchronous SQL. These checks establish specific behavior, not
production capacity, fair sharing or immunity to denial of service.

## October 2 prior integration scope and limits

The local candidate on `fd8b1d09` combines the separately reviewed availability,
public-identity, mailbox-first signup, owner-approved monthly-budget and manual
news-category patches.
These source changes are not evidence of deployed controls or live configuration.
The earlier reports remain historical records; this scoped follow-up does not
close their unresolved operational requirements.

- Public-read admission precedes expensive HTML/selected GET projections, including
  HEAD. Initial per-process ceilings are 30 requests per second and 600 per minute;
  each real account or guest IP also has 300 per minute. Fixed-window boundary
  bursts remain possible. Shared guest addresses share a budget, and IPv6 addresses
  are not grouped into prefixes. No crawler user-agent string bypasses admission.
  These are request ceilings, not measured production capacity, fair-share
  scheduling, cross-process coordination, or a timeout for synchronous SQLite work.
- Indexed artist-directory probes remove the repeated broad post search tested
  in the synthetic fixture. The query still scans/counts/orders the artist catalog.
  Production index-build time, storage cost and production load have not been tested.
- Signup reservations contain hashed capabilities and a password hash, expire after
  24 hours, and grant no session or durable account before confirmation. Duplicate
  submissions have separate capabilities. Confirmation rechecks mailbox capacity
  and any sibling-account authority inside the creation transaction; replay has one
  effect. No claim of statistically indistinguishable timing is made. Existing
  per-target/IP mail controls remain; this change adds no global transactional-mail
  spending cap. New reservations require confirmation even when
  `EMAIL_VERIFICATION_ENABLED=false` is used for legacy local accounts; local
  testing needs synthetic mail fixtures.
- The signup-specific mail explains that confirmation creates the requested
  account with the submitted password and should only be completed for a signup
  the recipient initiated. Existing-account mail and recovery remain available.
- Manual news keeps the editor's allowlisted category. Category-only correction
  requires current verified editor authority and a matching category/timestamp;
  correction and audit are one transaction. Generated classification and article
  content are unchanged. No real article is corrected by this local candidate.
- The Blueprint's two proposed monthly values are 10 USD each: the shared
  Anthropic ceiling and the catalogue allowance. Catalogue daily pacing stays
  0.30 USD; existing current-month settled and reserved spending still counts.
  No budget ledger, activation flag, credential, disk or live setting is changed.

Remaining availability findings include A2 (unbounded clips candidate scanning).
The local follow-up above addresses A3 limiter-map cleanup. Feed offset
behavior is unchanged. None of this establishes immunity to denial of service.
Combined tests use isolated synthetic data and loopback traffic; browser fixtures
with mocked APIs are distinguished from actual-server HTTP/browser checks.
Native-device, real-mail, provider, production-data and production-load acceptance
remain outside this local review.

## Current status

Pit has a server-enforced authorization boundary and materially stronger privacy
controls than the earlier prototype. The changes in the current worktree are not
production controls until they are reviewed, committed, deployed, and verified
against the production environment.

The application is appropriate for controlled testing after deployment of this
batch. It is not yet ready to be described as hardened for a large public launch:
the two high-priority operational items and the scale controls below still need
to be completed.

## Controls implemented in this review

### Authentication and authorization

- Passwords use scrypt; nonexistent-account login performs the same expensive
  verification path as a real account.
- Production refuses to start without an explicit, valid `ADMIN_EMAIL` and a
  non-placeholder `ADMIN_PASSWORD` of at least 16 characters. Neither value is
  stored in `render.yaml`. The canonical bootstrap root is stored as an
  email-and-user-id marker. First adoption revokes every admin session. A
  configured root transfer also revokes every admin session and retires only the
  prior canonical root by invalidating its password and demoting it to `fan`;
  account content, email ownership, and ordinary password recovery remain intact.
  Other administrators retain their role. Password or authority repair revokes
  every session belonging to the selected root.
- Admin and moderator sessions expire after 12 hours; editors currently retain
  the ordinary 30-day session policy. Production cookies use the host-only
  `__Host-pit_session` name with `Secure`, `HttpOnly`, `SameSite=Lax`, and high
  priority; legacy cookies are cleared but not accepted as active credentials.
- Browser writes require the exact first-party origin and JSON content type.
  Request bodies, headers, timeouts, and connection lifetime are bounded.
- IDOR-sensitive routes resolve ownership and visibility on the server. Media,
  profiles, posts, reactions, comments, attendance identities, artist tools, and
  moderation actions do not rely on client-side hiding for authorization.
- Block enforcement is bilateral on every public profile/content route reviewed,
  including released artist-owned tour dates and the discovery and archive
  aggregates derived from them. Reports validate both the content author and a
  distinct artist-page owner before revealing that a target exists.
- Moderators cannot suspend or unsuspend administrators or peer moderators.
  Role changes revoke sessions.
- New accounts must verify their email before social, publishing, profile,
  review, playlist, report, or artist-management mutations. Production cannot
  disable this gate through an environment flag.
- Signup returns the same body and issues no session cookie whether an email is
  new or already registered. Password hashing occurs before the existence check,
  closing the previous account-enumeration response and cookie oracle.
- Password recovery uses the same response and cookie behavior for malformed,
  unknown, cooldown, and eligible requests. Every path waits behind a non-blocking,
  cryptographically jittered 220–300 ms minimum response floor; ineligible
  identities never queue mail.
- Password-reset bearer tokens are moved to URL fragments, scrubbed from browser
  history, hashed at rest, expiry-limited, single-use, and served with no-store
  responses. Email-verification tokens use the same transport, storage, expiry,
  and cache protections; they are single-effect and allow bounded idempotent replay
  through a hashed receipt until the original expiry. Marketing-unsubscribe tokens are random,
  persistent opt-out-only credentials: they are deliberately reusable and stored
  directly so an old campaign remains able to stop mail. They cannot authenticate,
  read account data, or opt an account back in; unsubscribe responses remain
  uniform and no-store.

### Request, browser, and logging boundaries

- Unsafe browser requests are protected by Origin and Fetch Metadata checks.
  Production Host validation permits only configured first-party hosts; the
  Render hostname is restricted to health probes.
- Trusted proxy handling ignores attacker-supplied forwarding headers unless the
  request came through the expected Render boundary.
- Security headers include a script CSP without `unsafe-inline`, HSTS in
  production, frame restrictions, MIME sniffing protection, referrer controls,
  COOP, CORP, and Origin-Agent-Cluster.
- Public errors contain stable codes and request IDs, not exception text, SQL,
  request bodies, provider responses, email addresses, tokens, or secrets.
  Process and maintenance logging reduces failures to privacy-safe labels.
- Health has a dedicated abuse budget and caches successful readiness probes so
  public polling cannot continuously force synchronous storage checks.

### Data privacy and account rights

- Public user projections exclude email, precise coordinates, session data,
  password material, reset/verification secrets, internal restrictions, and
  untrusted profile fields. Public discovery no longer exposes total membership.
- Raw IP addresses and user agents are not retained in sessions or analytics;
  migrations scrub the legacy values. Product analytics is opt-in and accepts
  only an allow-listed categorical schema.
- Announcement email consent is separate, affirmative, default-off, auditable,
  and withdrawable. Campaigns select only verified, affirmatively consented
  accounts. Unsubscribe tokens can opt out but cannot opt an account back in.
- Email operation logs and terminal campaign rows expire after a bounded
  retention window (90 days by default, configurable from 30 to 365 days).
  Reset, verification, and verification-receipt secrets are also pruned.
- Account export is POST-only and requires the current password. It omits auth
  secrets, raw network/device identifiers, private-source URLs, signed storage
  capabilities, and future media fields that have not been explicitly approved.
  References to other members use opaque IDs only, not their current names,
  handles, emails, or profile fields. Account deletion is password confirmed,
  transactional, and includes owned media/deletion jobs and legacy source
  overrides.
- Banned or suspended members may authenticate only into a restricted session so
  they can export or permanently delete their account.
- Artist and playlist artwork is reconstructed from an accepted provider
  identity or admitted only from narrowly scoped provider CDNs. Arbitrary remote
  image URLs are filtered on write and read, preventing user-created tracking
  pixels from learning another member's IP address or viewing time.
- Listening charts are delayed, require at least three distinct listeners, and
  expose coarse lower-bound buckets rather than live individual behavior.
- Logout and confirmed account deletion synchronously rotate personalized
  in-memory projections and remove account-scoped listening, search, draft,
  social, composer, player, feed, comment, artist, venue, and analytics retry
  caches. Shared multi-account draft and follow payloads retain only records
  owned by other accounts. The same boundary runs after cross-tab session
  invalidation. Native media cleanup retries transient filesystem errors and
  surfaces a visible warning if references were removed but local bytes could
  not be deleted.

### Media and storage

- Original uploads go to a private source bucket. Production performs an
  anonymous exact-object and listing canary. Until that proof succeeds, photo
  and video capabilities remain disabled and every private-media operation
  fails closed; the core site stays available while a bounded background probe
  retries so provider/configuration outages do not become whole-site outages.
- Image uploads are validated by framing and magic bytes, decoded and re-encoded
  in a fresh secret-free child process behind a one-job admission gate, and
  stripped of metadata including EXIF/GPS. The worker has a 12-second kill
  timeout, 12 MiB input/output bounds, 24-megapixel and 16,384-pixel edge limits,
  an eight-bit PNG ceiling, a 160 MiB V8 heap, disabled Sharp file caching, and
  untrusted libvips operations blocked. The parent re-inspects the result. Only
  verified `private_derivative_v1` rows with a live public-object ledger entry
  receive public URLs; older unverifiable rows are hidden and quarantined.
- Video originals remain private. Publishing requires an owner-bound ticket,
  declared size/type bounds, server-recorded ownership, and an authoritative
  verifier/derivative pipeline. Pending or failed rows cannot become public.
- Legacy finalization tokens are owner-bound, expiring, and one-time. Private
  renders use short-lived access tickets rather than exposing source objects.
- Replacement, moderation, failed upload, and account-erasure deletion is
  durable and retryable, with dead-letter state instead of silent best effort.
- Backup storage must use HTTPS, cannot put credentials in URLs, cannot reuse a
  public or private media bucket, and cannot reuse the media access-key identity.
  Backup child processes receive an explicit environment allow-list.
- Ticket URLs are canonicalized through a shared fail-closed policy. Unsafe
  schemes, embedded credentials, non-default ports, IP/special-use hosts, and
  provider lookalikes are rejected on ingestion and projection. Known providers
  open directly; an artist's safe custom hostname is shown for confirmation.
  Calendar exports omit custom ticket links until that exact URL is confirmed.

### Supply chain and architecture

- Production dependency audit currently has no known advisories. Expo SDK 57
  dependencies are pinned to compatible patched versions and are checked with
  `expo install --check`.
- Expo Doctor passes 21/21 checks on Expo 57.0.19 / React Native 0.86.3. The
  earlier SDK 56 Hermes V1 memory-regression dependency has been removed. Real
  iOS and Android device acceptance is still required before a native-store
  release.
- CI actions are pinned to immutable commit SHAs and checkout does not persist a
  repository credential.
- Repository privacy tests reject committed SQLite databases, WAL/SHM files,
  environment files, private keys, and common backup artifacts.
- Architecture gates prevent new raw API calls in UI modules, new feature routes
  in the legacy monolith, unexplained silent catches, and parallel result shapes.
  This review moved account privacy, artist archive, artist discography, and
  media-finalization boundaries into feature-owned modules/adapters.

## High-priority operational work

### 1. Remove the historical database from Git history

A SQLite database plus WAL/SHM files existed briefly in reachable Git history.
The current tree no longer contains them, but ordinary deletion does not remove
old Git objects. The snapshot includes a real-looking privileged identity and an
offline-crackable password hash.

Before treating the repository as clean:

1. rotate production and staging `ADMIN_PASSWORD` and any reused credential;
2. revoke privileged sessions and confirm mailbox MFA;
3. inventory repository visibility, collaborators, clones, forks, CI artifacts,
   caches, and mirrors;
4. coordinate a full-ref history rewrite and force push, remove stale PR/bot
   refs, and require collaborators to re-clone;
5. request hosting-provider cache purge if the repository was shared or public;
6. verify the database, WAL, and SHM object IDs are unreachable from every ref.

History rewriting is disruptive and must not be run casually from an ordinary
feature task. It requires explicit owner authorization and coordination.

### 2. Make privacy erasure survive backup restoration

Restoring an old snapshot can resurrect deleted accounts, withdrawn marketing
consent, and queued email. Automatic production campaign recovery is disabled by
default so a restore cannot immediately send old queued mail, but that is only a
containment control.

Implemented 2026-09-27 in `server/privacyJournal.js`. Account erasure (by the
member or the inactivity worker) and marketing-consent withdrawal (Settings or
an unsubscribe link) write a journal entry in the same transaction as the
change. Entries hold only the opaque account ID, the kind and the time; they are
signed with HMAC-SHA256 under `PRIVACY_JOURNAL_KEY` (server environment only)
and queued for copying to `privacy-journal/v1/` in the private backup bucket,
after the same anonymous-access proof the backups use. Shipping is attempted
every 5 minutes in batches of 50; backlog, configuration errors and outages can
extend that delay. This is not a five-minute durability guarantee. A database
prepared with `scripts/prepare-db-restore.mjs` refuses to serve until the
server has listed the journal, verified every entry, re-applied the verified
erasures and opt-outs, and
saved the evidence in `app_meta` (`privacy-journal:replay:v1`). Only an owner
decision recorded as `PRIVACY_JOURNAL_REPLAY_WAIVER=<incident reference>` lets a
restore proceed without the journal, and the waiver is saved as evidence.

Hardened 2026-09-28: all entries are validated before replay changes anything.
Malformed listings, unreadable objects, invalid signatures and conflicting
duplicate entry IDs fail verification; they cannot produce a successful replay
receipt. Receipts now require `verificationVersion: 2`; an older success receipt
requires a fresh verified replay. Existing explicit owner waivers remain valid.
Reads are bounded to 4 KiB per object, 4 MiB per listing, 20,000 objects and 1,000
listing pages, with repeated pagination tokens refused. These are resource
ceilings, not a whole-run restore deadline; larger recoveries need an offline
reconciliation plan.

Limits: a disk lost before successful journal shipping can lose recent privacy
changes. Journal retention must cover every recoverable older snapshot,
including local copies and pre-replay startup snapshots, not just the remote
backup lifecycle. Preserve historical HMAC verification capability while any
corresponding journal entries or backups remain recoverable; simply changing
the key after a fresh backup is not a safe rotation procedure. Individual post,
comment and message deletions and block/restriction changes are not journaled
yet and require separate reconciliation. A live restore drill remains required.

## Local clips projection hardening, 2026-10-02 (deployment held)

The follow-up from `ee9e2df3f7304de7103f57467250a7fe12c5ba44` uses native SQLite
triggers to maintain ordered candidate posts and exact stored photo references.
The clips query checks current linked-media and URL-only publication rules,
trusted legacy release sources, active accounts, public/removed state and
bilateral blocks before its post limit. Selection and canonical post projection
share a read snapshot. Full projection is limited to `limit + 1` posts, at most
31; ordinary media or privacy changes do not create a global dirty queue or
request-time catch-up loop. Existing admission limits still apply.

This is not a hard SQL execution budget: sparse matches may require many indexed
candidate/reference visits and exact URL checks. SQLite waits, shared-IP fairness
and distributed-account/IP abuse remain separate limits. No crawler-user-agent
exemption or shipping client change is introduced.

Existing databases require explicit preparation; incomplete preparation blocks
server startup. The resumable utility captures a finite initial post-ID horizon,
commits small batches and leaves its cursor unchanged on invalid oversized
historical data. It never truncates attachments to mark an index complete.
Preparation imports ordinary database initialization/migrations and does not run
the production launcher's backup gate. A verified pre-preparation backup and an
owner-approved single-disk preparation/downtime/rollback plan are required before
release. Neither production preparation nor deployment occurred in this task.
See `ROBUSTNESS_AUDIT_2026-10-02.md` for validation and operational limits.

## Remaining defense-in-depth work

- Move login, signup, request, and expensive-route limits from process memory to
  a shared edge/service store and add a managed WAF or equivalent abuse layer.
- Migrate persistent marketing-unsubscribe credentials to a rolling hashed-token
  ledger. Their current plaintext residual is bounded to one-way email opt-out,
  but hashing would reduce the impact of a database-only disclosure while
  preserving the ability of old campaign links to unsubscribe.
- Add phishing-resistant MFA or WebAuthn and step-up authentication for admin and
  moderator actions; use a dedicated role mailbox rather than a personal one.
- Add provider-side backup encryption/KMS policy, retention/object-lock rules,
  restore drills, and independently retained restore evidence.
- Keep video decoding/transcoding out of the web process and verify its worker
  has enforceable CPU, native-memory, time, and output limits. Add malware and
  content-moderation operations appropriate to the product before opening
  uploads broadly.
- Re-sanitize quarantined legacy images and delete their old public source
  objects; runtime quarantine prevents new projection but cannot revoke an URL
  that was already learned or cached. Backfill or remove every other historical
  user/provider URL that predates the current media and artwork allow-lists.
- Confirm the production video verifier and private/public buckets are separate,
  least-privileged, and continuously monitored. Restrict browser API keys (for
  example Google Maps) by exact host and exact API at the provider.
- Replace the capped synchronous portability export with a complete queued,
  encrypted, expiring archive for large accounts.
- Add account-level profile visibility and apply it to direct profiles, social
  lists, recommendations, search, sharing, and SEO. Search-engine opt-out alone
  is not an access-control policy.
- Move durable work out of authenticated GET routes. Artist refresh demand,
  lease renewal, and Lounge lifecycle registration should be explicit commands
  or background maintenance, not a side effect of reads or prefetches.
- Require post/chat idempotency tokens and edit versions after compatibility
  telemetry confirms legacy clients are retired, and approve an enforceable
  deletion deadline for closed Lounge archives.
- Narrow broad Google CSP domains as provider requirements allow and repeat
  authorization tests whenever a new public or staff route is added.

## Release rule

Run the syntax, architecture, complete test, dependency-audit, Expo dependency,
and production web-build gates before release. Then perform a deployed smoke test
for login, generic signup, verification, password reset, export, deletion,
blocked-resource reads, staff authorization, media upload/finalization, private
bucket isolation, health limiting, backup creation, and campaign recovery state.

Security testing against production or real user data requires written scope and
authorization. Prove findings with synthetic accounts and the minimum data
needed; never download another member's data to demonstrate an access-control
bug.
