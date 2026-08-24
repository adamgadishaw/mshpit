# Pit security and privacy readiness

Last reviewed: 2026-08-24

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
- Staff sessions expire after 12 hours. Production cookies use the host-only
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

- Production dependency audit currently has no known advisories. Expo SDK 56
  dependencies are pinned to compatible patched versions and are checked with
  `expo install --check`.
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

Before production-scale restore operations, add an append-only erasure and email
suppression journal stored outside the SQLite backup lifecycle, authenticated or
signed against tampering. Every restore must replay that journal before traffic,
workers, email, exports, or media publication are enabled, then record evidence
that the replay completed.

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
