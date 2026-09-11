# Mshpit security, privacy, and technical audit

Audit date: 2026-09-01
Scope: current `master` worktree, web/API application, Expo SDK 56 client configuration, SQLite data model, media pipeline, CI/deployment configuration, and release checks.

## Executive result

No critical or high-severity remotely exploitable application-code issue was found in the audited tree. The batch closes concrete authorization-adjacent privacy leaks, malformed location acceptance, low-entropy identifiers, post retry races, media preflight side effects, unsafe API-origin selection, and several reliability failures.

The application is suitable for controlled testing after deployment and deployed smoke verification. It must not yet be described as fully hardened for a large public or native-store launch. Three priority operational/release items remain: purge the historical database objects from all Git refs after credential rotation, make privacy erasure replayable after backup restoration, and move from the known Expo SDK 56 Hermes regression to a tested fixed SDK before a production App Store/Play Store release.

This audit used source review, repository/history inspection, dependency and Expo diagnostics, hermetic automated tests, syntax and architecture gates, and a production web export. It did not access production user records, run destructive tests, attack production, verify provider dashboards, or certify regulatory compliance.

## Findings fixed in this release

### Authentication, authorization, and privacy

- Staff moderation projections now accept profile images only when they are owner-bound, ready/finalized image assets. Arbitrary legacy avatar URLs can no longer act as tracking beacons in staff tools.
- Profile updates now reject malformed fields as one atomic validation failure. Invalid coordinates can no longer be silently ignored while another field is saved.
- Latitude and longitude are bounded to `[-90, 90]` and `[-180, 180]`, with boundary and out-of-range regressions.
- Production web API requests are always same-origin. Native release builds accept only Mshpit's canonical HTTPS origin and fail back to it when a public environment value is unsafe; local HTTP remains development-only.
- New opaque identifiers use 128 bits of cryptographic randomness encoded as lowercase hexadecimal. The alphabet deliberately cannot contain the existing direct-message `__` participant delimiter.

### Posting and media integrity

- An author-deleted post retains only its opaque client mutation receipt. A lost-response retry cannot recreate content that the author permanently removed.
- Duplicate post creation is rechecked under `BEGIN IMMEDIATE`. Concurrent requests with the same mutation key now return the canonical duplicate or a deterministic conflict instead of leaking a SQLite uniqueness failure as a 500.
- Stable media selection is read-only before publication. Ownership, readiness, durable video cover, and object-ledger state are rechecked while the post and media association commit atomically.
- Online/YouTube reviews use canonical validated YouTube links and are excluded from physical attendance, calendars, venue counts, live ratings, event SEO, and other in-person statistics.

### Reliability and data quality

- Public liveness is independent of optional media readiness, preventing an optional storage outage from producing continuous whole-service readiness failures.
- Feed impressions use authenticated, idempotent, account-scoped events and do not depend on optional product-analytics consent. The feed preserves server ordering and avoids treating an impression as a completed video view.
- Artist, people, genre, messaging-context, and recommendation additions use bounded server queries and privacy-filtered projections.
- Event-directory queries enforce real calendar dates as well as a date-shaped string. Impossible future dates cannot create empty sitemap pagination or indexable artist/event directory entries.

## Controls verified

### Sessions and browser boundary

- Passwords use scrypt and login executes a dummy verification path for missing accounts.
- Production sessions are random, hashed server-side, expiry-bounded, and delivered with host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookies. Staff sessions are shorter-lived and authority changes revoke sessions.
- Production unsafe requests require the exact allowed Origin, expected Fetch Metadata, and JSON content type. Host and trusted-proxy validation do not trust arbitrary forwarding headers.
- Public error responses use stable codes and request IDs. Secrets, request bodies, raw SQL/stacks, credentials, email addresses, and raw provider responses are excluded from client errors and routine diagnostics.
- Security headers include a script CSP without `unsafe-inline`, production HSTS, frame denial, MIME protection, referrer policy, COOP, CORP, and Origin-Agent-Cluster.

### Authorization and social privacy

- IDOR-sensitive resources enforce ownership or visibility on the server, including posts, media, profiles, reactions, comments, attendance identities, artist tools, messaging, and moderation actions.
- Blocks are bilateral on reviewed public content and interaction paths.
- Public projections omit email, password/session/token material, precise coordinates, internal restrictions, private media source URLs, and signed storage capabilities.
- Attendance and tagged-person projections expose only deliberate social relationships and never imply physical proximity beyond the shared event.
- Analytics is opt-in, schema allow-listed, categorical, and does not retain raw IP addresses or user agents.

### Media and external content

- Image publication requires verified owner-bound assets. Images are framed and magic-byte checked, decoded and re-encoded in an isolated bounded child process, stripped of EXIF/GPS metadata, and re-inspected before publication.
- Video originals remain private. Public clips require an authoritative finalized derivative and verified durable poster; incomplete assets fail closed.
- Provider artwork and outbound ticket/source URLs pass allow-list and canonical HTTPS policies that reject credentials, unsafe schemes, non-default ports, IP/special-use hosts, and provider lookalikes.
- Native configuration does not request location access. Photo-library permission is explicit; camera and microphone permissions are disabled in the current app configuration.

### Founder error diagnostics (2026-09-10)

- Public failures are unchanged: clients still receive stable `PIT-*` codes and request IDs, and Render's log line still prints only the error class.
- A founder-only channel now carries diagnostic detail to the owner's alert email. `error_event_details` stores, per grouped error, repo-relative application stack frames (file, line, column and function name), the redacted message and cause chain, and the release commit. Raw stack text, request bodies, query values, cookies and account identifiers are not stored.
- Messages are redacted on the device and again on the server by one shared module. Signed URL query strings and userinfo, email addresses, bearer tokens, `key=value` secrets, JWTs, long hex and mixed-alphabet tokens, IP addresses, and quoted free text, including text echoed by `JSON.parse`, are replaced. Unquoted prose that application code writes into a message cannot be detected and will reach the founder email.
- Web source maps are emitted for diagnosis but every `.map` path, including encoded and trailing-slash variants, is refused over HTTP with 404; the server reads them from disk only. Map parsing is bounded to 20 per 10 minutes per process.
- The privacy policy's crash section said crash reports contained no error message. The change was held until the owner approved replacement wording on 2026-09-11, which discloses the redacted message, the web code position, server code locations and release, alert email delivery through the email provider, that alert emails stay in the staff mailbox until deleted, and that a message can occasionally still contain on-screen text. Policy dates and `LEGAL_ACCEPTANCE_VERSION` moved to 2026-09-11; existing acceptance records are unaffected.

### Startup backup disk exhaustion (2026-09-11)

- Production was unavailable from about 18:43 to 19:25 UTC. The pre-migration backup in `scripts/start-production.mjs` failed with `database or disk is full` on the 1 GB `/data` disk that also holds up to seven local snapshots, and the launcher refuses to start without a verified backup. The release code booted locally in production mode behind the same backup gate.
- The owner raised the disk to 5 GB. `scripts/backup-db.mjs` now deletes the oldest completed snapshots only when that makes a new copy fit, never the newest verified one, and retries once after a disk-full copy before refusing. Off-host backups remain unconfigured, so local pruning can remove the only older recovery points.

### Supply chain and repository

- Production dependency audit: zero known high-severity advisories.
- Expo SDK 56 packages are aligned to compatible patch versions.
- CI actions are pinned to immutable commit SHAs and checkout does not persist a repository credential.
- Current-tree repository checks reject environment files, databases/WAL files, private keys, and common backup artifacts. `.env` and `server/data` are ignored.

## Open findings and required actions

### P1 — Historical database objects remain in Git history

The current tree is clean, but `.tmp/browser-smoke-3107/data/pit.db` plus its WAL/SHM files remain in reachable history. Treat the snapshot as disclosed because it contains a real-looking privileged identity and an offline-crackable password hash.

Required order: rotate production and staging administrator credentials and any reused secret; revoke privileged sessions; inventory collaborators, forks, mirrors, CI artifacts, and caches; coordinate an all-ref history rewrite and force push; require fresh clones; purge hosting caches; verify the object IDs are unreachable. This is intentionally not performed by an ordinary feature commit because it is disruptive and must be coordinated with every contributor.

### P1 — Privacy erasure is not replayed after backup restoration

An older backup can resurrect deleted accounts, withdrawn email consent, or queued mail. Add an authenticated append-only erasure/suppression journal outside the SQLite backup lifecycle. Every restore must replay it before traffic, workers, mail, exports, or media publication are enabled and retain evidence of completion.

### P1 — Expo SDK 56 Hermes memory regression

`expo-doctor` reports the upstream Hermes V1 memory regression for Expo 56 / React Native 0.85. Patch alignment cannot fix it; the available fix requires a separately tested Expo SDK 57 / React Native 0.86+ upgrade. Treat that upgrade and device soak testing as a native-store release gate, not a silent dependency bump in this web release.

### P2 — Shared abuse controls

Login, signup, posting, and provider budgets are process-local. A restart resets them and horizontal replicas split them. Move them to an atomic shared store and add edge/WAF controls before material public scale.

### P2 — User privacy controls

Search-engine opt-out is not account privacy. Add an account-level profile-visibility policy, apply it consistently to direct profiles, follower/following lists, recommendations, search, shares, and SEO, and test transitions and existing links.

### P2 — Complete data portability

The synchronous export intentionally caps large collections. Build a complete queued export that is encrypted, expiry-limited, owner-authenticated, and includes every owned row and approved media object without another member's current identity fields.

### P2 — Side-effect-free reads

Some authenticated GET paths can enqueue artist refresh demand, renew media leases, or register lounge lifecycle work. Move durable state changes to explicit POST commands or background maintenance so retries, crawlers, prefetching, and cache revalidation cannot create work.

### P2 — Staff assurance and provider controls

- Add phishing-resistant MFA/WebAuthn and recent-auth step-up for staff changes.
- Verify bucket separation, least privilege, KMS encryption, object lock/retention, backup restore drills, and video-worker CPU/native-memory isolation in provider dashboards.
- Verify the public Google Maps key is restricted to exact production hosts and exact APIs.
- Re-sanitize or delete quarantined legacy public objects whose URLs may already be cached.

### P3 — Contract and retention cleanup

- Make post/chat idempotency keys and edit versions mandatory after compatibility telemetry shows old clients are retired.
- Approve and enforce a deletion deadline for closed lounge archives while retaining only the separately authorized legal/audit record.
- Narrow broad Google CSP domains as provider behavior permits.

## Verification record

- Complete hermetic Node test suite: passed.
- Focused API and post-idempotency suite: 74/74 passed.
- Focused security/privacy backend suite during audit: 102/102 passed.
- Focused online-review server/client suites: passed.
- Focused public-directory and sitemap suites: 36/36 passed.
- Production and development dependency audits: 0 vulnerabilities.
- Expo dependency alignment: passed; dependencies are up to date for SDK 56.
- Syntax gate: passed across 393 Node files.
- Architecture gate: passed.
- Production web export and bundle-budget gate: passed at 466.9 KiB gzip of the 512 KiB initial-JavaScript budget.
- Staged diff hygiene and private credential/data scan: passed.
- Expo Doctor: 21/22 checks passed. The sole failure is the documented upstream SDK 56 Hermes memory regression; it remains the native release gate described above.

- 2026-09-10 founder error diagnostics: complete `npm run check` passed with 4,237/4,237 tests, dependency audit, syntax across 563 Node files, architecture, and the web export with source maps; initial JavaScript 498.4 of 512.0 KiB gzip.
- 2026-09-10 real-build source-map check: a minified position in the shipped index bundle resolved to its original `src/screens` file and line through the real crash route, and that bundle's `.map` was refused.
- 2026-09-11 committed-scope gate: the change alone, including the privacy policy update, on `4603cb3` in an isolated worktree without unrelated uncommitted work, passed `npm run check` with 4,174/4,174 tests, dependency audit, syntax across 557 Node files, architecture, and the web export with 54 source maps; initial JavaScript 495.2 of 512.0 KiB gzip.
- 2026-09-11 backup disk-full fix gate: the fix on `2098442`, in an isolated worktree without unrelated uncommitted work, passed `npm run check` with 4,179/4,179 tests, dependency audit, syntax across 557 Node files, architecture, and the web export with 54 source maps; initial JavaScript 495.2 of 512.0 KiB gzip.

## Release and ongoing review rule

After deployment, use synthetic accounts to smoke-test login, generic signup responses, verification, reset, block boundaries, export/deletion, staff authorization, post lost-response retries, media upload/finalization, private-bucket isolation, health/readiness separation, backup creation, and campaign recovery state. Do not attack production or access real member data without written scope and authorization.

Repeat threat modeling whenever Mshpit adds precise location, direct messaging expansion, ticket or Wallet imports, payment data, minors, third-party ad/analytics SDKs, background mobile tasks, or new public/staff routes.
