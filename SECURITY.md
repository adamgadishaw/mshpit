# Security and launch readiness — mshpit.com

Honest status: Pit now has a real server boundary and is suitable for controlled
testing, but it is not yet engineered or operated for millions of users. This
document separates controls already present from work still required before a
broad public launch.

## Controls present now

- **Server-owned authentication and authorization.** Passwords are hashed,
  sessions use `HttpOnly` cookies, `/api/me` is authoritative, and protected
  routes resolve the signed-in account server-side. Production cannot enable the
  bundled development identities or demo feed.
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
- **Build gates.** Tests, Node syntax checks, and the Expo production export run
  through `npm run check` before deploy.

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

`npm audit --omit=dev` currently traces a moderate UUID advisory through Expo's
build tooling: `expo -> @expo/config-plugins -> xcode@3.0.1 -> uuid@7.0.3`.
The project does not import `uuid`; the installed `xcode` package uses `uuid.v4()`
rather than the affected buffer-writing APIs. The proposed forced npm fix would
downgrade Expo to 46 and violate the SDK 56 requirement. Track the Expo upstream
update and rerun the audit regularly; do not apply the breaking forced downgrade.

## Launch decision

Pit is no longer a backendless prototype. It has credible authentication, API,
error, and data-integrity foundations. The blocking risks are now operational and
scale-related: unfinished media verification, single-instance storage/process
state, incomplete abuse automation, synchronous export/object deletion, and
production observability. Do not market the service as “millions-ready” until
those controls have been implemented and load/restore/incident tested.
