# Security and launch readiness — mshpit.com

Honest status: Pit now has a real server boundary and is suitable for controlled
testing, but it is not yet engineered or operated for millions of users. This
document separates controls already present from work still required before a
broad public launch.

Release and production truth lives in `STATUS.md`. Controls added by the active
August 13 remediation branch are not production controls until that batch is
merged, deployed, and smoke-tested.

## Controls present now

- **Server-owned authentication and authorization.** Passwords are hashed,
  sessions use `HttpOnly` cookies, `/api/me` is authoritative, and protected
  routes resolve the signed-in account server-side. Production cannot enable the
  bundled development identities or demo feed.
- **Fail-closed durable database boot.** Before migrations, production opens the
  configured SQLite file read-only and refuses a missing mount/file, zero-byte
  file, wrong schema, or structurally empty legacy Pit database. A deliberate
  one-time bootstrap is the only initialization bypass, and health reports
  storage identity/readiness rather than treating any open SQLite handle as good.
- **Safe public failures.** API errors return stable codes, status, retryability,
  and request IDs. Raw server stacks, SQL/provider details, request bodies,
  credentials, and internal 5xx messages are not returned to users. Client
  diagnostics store only bounded, privacy-safe metadata described in
  `ERROR_CATALOG.md`.
- **Input and profile projection controls.** Text and rating inputs are bounded;
  profile `extras` cannot overwrite trusted role/verification/identity fields;
  malformed stored JSON fails safely. React Native views do not use an HTML
  injection sink.
- **Transport headers.** The Node server sets CSP, frame restrictions, HSTS in
  production, `X-Content-Type-Options`, and a referrer policy. Provider/frame
  domains are explicitly allow-listed.
- **Rate limiting and abuse foundations.** Sensitive and mutating API paths are
  rate-limited, primarily by authenticated account where available. Blocking and
  staff moderation/report surfaces exist.
- **Password recovery.** Reset tokens are random, expiry-limited, stored as a
  one-way hash, single-use, and revoke other sessions after reset. Recovery
  responses do not reveal whether an email is registered.
- **Durable upload boundary.** The server issues short-lived, user-scoped,
  AWS-SigV4 PUT URLs for configured S3-compatible storage. Types and declared
  sizes are allow-listed, and the client never saves `file:`, `blob:`, or `data:`
  values as media URLs.
- **Account lifecycle.** Authenticated export excludes session, password, reset,
  IP, and user-agent fields and produces a real JSON download on web or shareable
  file on native. Password-confirmed deletion removes the relational account
  graph in one transaction; an ambiguous lost response is verified before local
  cleanup. Banned and suspended accounts retain export/delete access while social
  use stays locked.
- **Backup correctness.** The current branch creates SQLite-consistent snapshots,
  independently opens them, runs `integrity_check`, rejects lost critical rows,
  publishes atomically only after verification/requested upload, ignores failed
  partials for freshness, bounds child/upload time, and schedules a daily retained
  copy on the mounted data disk. A complete, separate private `BACKUP_S3_*`
  configuration adds off-host upload and refuses the public media bucket.
  Production snapshot/upload/restore evidence is still required before treating
  this as disaster recovery.
- **Build gates.** Tests, Node syntax checks, and the Expo production export run
  through `npm run check`; the current Render Blueprint runs that full gate in
  isolated build storage rather than racing a web-only auto-deploy against CI.

## Required before broad public uploads

The current presign path trusts the declared MIME type and size. Add an upload
finalization pipeline that:

1. reads object metadata and sniffs magic bytes rather than trusting extensions;
2. rejects polyglots/invalid formats, strips EXIF/location metadata, and decodes
   images with resource limits to prevent decompression bombs;
3. generates fixed avatar/feed/full derivatives and serves them through a CDN;
4. quarantines new objects until malware and content-moderation checks pass;
5. records object ownership and state in the database, then deletes abandoned,
   replaced, moderated, and account-owned objects through durable jobs;
6. applies bucket lifecycle/versioning and denies public listing and direct
   unsigned writes. CORS should permit only the intended origins and methods.

Until that pipeline exists, uploads should remain limited to trusted testers.

## Required before high-volume public launch

1. **Managed state and resilience.** Migrate single-instance SQLite to managed
   Postgres; move rate limits/cache to a shared service; use durable queues/workers
   for email, media, exports, ingestion, fan-out, and deletion; test off-host
   backups and restore procedures.
2. **Abuse prevention.** Add risk-based signup/login throttling, CAPTCHA or an
   equivalent challenge at abuse thresholds, email verification, spam/link
   controls, media/text moderation, staff audit logs, appeals, and emergency
   account/content disable controls.
3. **Privacy operations.** Version consent immutably, document retention, make
   large exports asynchronous, complete object deletion, verify third-party image
   licensing, and obtain jurisdiction-specific privacy/terms review.
4. **Observability without content leakage.** Centralize request-ID logs, metrics,
   traces, error rates, queue lag, storage failures, and alerting. Never put
   messages, reviews, searches, tokens, emails, or image contents in telemetry.
5. **Session and secret operations.** Add secret rotation, environment separation,
   session/device management, dependency update cadence, and incident response.
   Native session persistence must use platform-secure storage rather than
   browser-oriented storage.
6. **Authorization coverage.** Expand automated tests for every role, blocking in
   both directions, moderation transitions, deleted/private resources, and object
   ownership. Treat client-side visibility as presentation, never authorization.

## Dependency note

The 2026-08-13 SDK 56 alignment passes `npx expo install --check` and Expo Doctor
21/21. The installed versions include Expo 56.0.19, React Native 0.85.3, and
React 19.2.3, matching the exact SDK 56 line.

`npm audit --omit=dev` currently reports **19 advisories: 8 moderate and 11
high**. They are concentrated in the Expo/Metro/React Native/Xcode dependency
graph, including Metro's `image-size` denial-of-service advisories and Xcode's
UUID chain. This replaces the obsolete claim that only 11 moderate UUID
advisories remain. npm's automatic remediation proposes incompatible downgrades
to Expo 53, React Native 0.72, and older Expo modules; it is not a safe SDK 56
fix. Do not run `npm audit fix --force`. Track compatible SDK 56 patches or plan
a deliberate SDK upgrade with full native-device testing.

## Launch decision

Pit is no longer a backendless prototype. It has credible authentication, API,
error, and data-integrity foundations. The blocking risks are now operational and
scale-related: unfinished media verification, single-instance storage/process
state, incomplete abuse automation, synchronous export/object deletion, and
production observability. Do not market the service as “millions-ready” until
those controls have been implemented and load/restore/incident tested.
