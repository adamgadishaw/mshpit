# Pit project audit — 2026-07-28

## Remediation update — mobile posting and production recovery

This report began as a read-only audit of `35e7a84`. After the owner reported
that the phone site was unusable while posting a J. Cole concert review, the
highest-impact confirmed issues were repaired in the same working batch. The
original audit remains below as the baseline; this section records what changed.

| Audit/incident finding | Current disposition |
| --- | --- |
| Production `502` | Mitigation implemented, release verification pending. Both the custom domain and direct Render origin still returned `502` at 19:55 UTC before this batch was pushed. |
| Possible scheduled-job crash loop | Timer promise boundaries now contain sync throws and async rejections; default-on cache/tour kill switches were added. Render logs are still required to prove the original cause. |
| Phone render pressure | Closed 60-row player queue no longer renders; phone feed mounts 3 cards initially and 2 per batch; polling is 20 rows every 45s; persisted feed is capped at 80. |
| Slow/opaque media path | Large web camera images are bounded to 2048px/WebP when smaller, feed tiles request 1200px previews, and uploads expose progress, cancellation, and partial completion. |
| Composer cold start/races | The authenticated shell preloads the composer, lazy screens show a loader, and stale artist requests are cancelled/ignored. |
| J. Cole identity loss | Selected `artistKey` now survives create and edit. The phone test persisted `j. cole` with the canonical artist row. |
| Wrong date on edit | DatePicker now initializes from its controlled ISO value and does not emit today on mount. A `2025-06-15` edit survived save and reopen. |
| Duplicate retry | Create requests use a stable client mutation ID with a per-user unique database index and return the original post on retry. |
| Cross-account drafts | Draft migration, reads, writes, and deletes are account-scoped. |
| Narrow/broken rating taps | Six ten-part controls were replaced by six 44px adjustable controls. A center phone tap now records `3.0`, not `0.5`. |
| Expo patch drift | Expo, Metro runtime, Image Picker, and Sharing match the current SDK 56 patch set; `expo install --check` passes. |
| Dependency advisories | Compatible high-severity `brace-expansion` and `shell-quote` fixes were applied. Eleven moderate `uuid`-chain advisories remain; the forced npm proposal is an incompatible Expo downgrade. |

Verification on the remediation tree:

- 168 Node tests pass, including new scheduler containment, idempotent post,
  artist-key, draft-isolation, media-policy, lazy-preload, and feed-bound tests;
- syntax checks pass for 64 Node files;
- the Expo SDK 56 production web export succeeds;
- a 390x844 browser session signed up, linked J. Cole and Scotiabank Arena,
  rated/published/edited/reopened the concert, and produced no console warnings;
- the isolated SQLite database contained exactly one canonical post with a
  non-null mutation token and the edited historical date.

Important remaining work is unchanged: confirm the release stays healthy beyond
the cache warmer's 60-second delay, inspect the Render logs/disk/resource graphs
for the original outage, test a real R2 camera upload on physical iOS/Android,
replace the interim image proxy with owned derivatives, reduce the roughly
4.4 MB startup bundle and broad store context, and move scheduled jobs/SQLite to
durable worker/managed-data infrastructure as usage grows.

## Scope and method

This is a read-only engineering and production audit of the repository at
`35e7a84` (`master`, matching `origin/master`) on 2026-07-28. The audit covered:

- Git state and the last 20 commits;
- application structure, navigation, state, API, database, providers, media,
  deployment, security, and documentation;
- the exact Expo SDK 56 documentation required by `AGENTS.md`;
- the complete local quality gate, Expo package compatibility, npm advisories,
  generated web artifacts, and exact-value secret scanning;
- read-only checks against `https://www.mshpit.com`.

No application or production state was changed. No credential value is included
in this report.

## Executive summary

The repository is substantially stronger than a prototype. The local gate is
green, the server has meaningful authorization and integrity tests, the web
bundle is split, and the data/provider rules are unusually well documented.
However, production was unavailable during this audit, and several confirmed
client privacy/recovery defects sit outside the current test suite.

The most important findings are:

1. **P0 — production is down.** Three consecutive requests to the root,
   `/api/health`, and `/sitemap.xml` returned Cloudflare `502 Bad Gateway` at
   approximately 2026-07-28 19:23 UTC. `robots.txt` returned Cloudflare-managed
   content rather than Pit's generated file.
2. **P1 — review drafts cross account boundaries on a shared browser.** Drafts
   are stored in the device-global `pit.drafts` key and logout does not clear or
   account-scope them. The next signed-in member can open the composer and see
   up to five drafts from the prior member.
3. **P1 — Expo packages are not on the exact SDK 56 compatibility versions.**
   Expo's checker identifies four packages to update.
4. **P1 — dependency documentation is stale.** `npm audit --omit=dev` now reports
   15 transitive advisories (4 high, 11 moderate, 0 critical), not the one
   moderate advisory described in `SECURITY.md`.
5. **P1 — native is source-compatible, not release-ready.** There is no bundle
   identifier/package name, EAS configuration, native secure persistence, native
   full-track player, or physical-device acceptance evidence.
6. **P1 — broad public uploads remain unsafe by the repo's own standard.** The
   presigned upload path trusts declared MIME and size and has no finalization,
   byte sniffing, EXIF stripping, quarantine, moderation, derivative generation,
   or lifecycle deletion.
7. **P1 — image licensing is a material launch risk.** The generated catalogue
   still contains thousands of unlicensed `Source: web` records, including
   Getty, Alamy, and Pinterest/Pinimg URLs.
8. **P2 — the client and server have severe concentration points.**
   `src/store.js` is 3,160 lines with roughly 227 context entries;
   `server/api.js` is 2,649 lines with 115 routes. This increases rerender cost,
   review difficulty, and regression blast radius.
9. **P2 — recovery and migration behavior can conceal failures.** The crash
   reset omits several persisted keys, while additive DB migrations catch every
   error rather than only duplicate-column errors.
10. **P2 — two user-visible strings contain mojibake.** The player shows
    `UP NEXT Â· …`; lounge entry can show `Saving your spotâ€¦`.

## Current repository snapshot

| Area | Observed state |
| --- | --- |
| Git | Clean `master`; matches `origin/master` at `35e7a84` |
| Source size | 195 JS/JSX/MJS files; approximately 33,742 lines |
| UI | 45 screens and 37 reusable JSX components |
| Client state | One broad React context; approximately 227 exposed entries |
| API | Hand-written Node HTTP server; 115 API route definitions |
| Database | SQLite, WAL mode, foreign keys, 5-second busy timeout, 36 tables |
| Tests | 158 Node tests in 22 test files |
| Web build | 39 JS bundles; largest/startup bundle is 4,387,255 bytes |
| Catalogue | 10.4 MB generated source; 1.30 MB startup core; 2.21 MB lazy venue photos |
| CI | GitHub Actions runs `npm ci` and `npm run check` on PRs and `master` |
| Release metadata | No Git tags; no `eas.json`; no `ios/` or `android/` project |

## What changed recently

The last 20 commits landed in a very short period and touched several coupled
systems simultaneously:

- client routing, public URLs, SSR-like metadata injection, robots, and sitemap;
- lazy loading for 36 screens and stale-chunk recovery;
- iOS viewport/input behavior and persistent player layout;
- post creation failure feedback, live comments, author deletion, and rich song
  attachments;
- YouTube resolution, cache warming, provider budgeting, channel identity, and
  Wikidata discovery;
- Discover chart and stat-tile visual changes.

The largest recent batch (`76c8a85`) changed 23 files with 2,288 insertions and
1,317 deletions. Across the reviewed window, `HANDOFF.md` changed in 15 commits,
while the principal runtime hotspots were `App.js`, `src/store.js`,
`server/api.js`, `server/cacheWarmer.js`, and `server/musicProviders.js`.

This explains why the project feels like “a couple of things happened”: routing,
playback, discovery, deployment-facing SEO, and UI presentation all moved at
once. The regression risk is concentrated where those systems meet: startup,
navigation history, cached account state, media playback, and provider state.

## Verification results

### Passing checks

`npm run check` passed completely:

- catalogue split synchronized successfully;
- **158 tests passed, 0 failed**;
- Node syntax check passed for 64 server/script files;
- Expo web production export completed successfully;
- `git diff --check` passed;
- worktree remained clean after generation because `dist/` is ignored.

The test suite is strongest around API integrity, authorization, blocking,
moderation, account deletion/export, media signing, provider matching, quota
behavior, dates, URLs, cursor pagination, catalogue splitting, and error
normalization.

### Expo SDK 56 compatibility

The app uses the correct SDK generation, React 19.2.3, and React Native 0.85.3.
Its use of `File` from `expo-file-system` matches the SDK 56 API. The exact SDK
56 reference also confirms the platform floor is Android 7+ / API target 36 and
iOS 16.4+.

Expo's package checker nevertheless reports these mismatches:

| Installed | SDK 56 expected |
| --- | --- |
| `expo@56.0.12` | `~56.0.17` |
| `@expo/metro-runtime@56.0.15` | `~56.0.18` |
| `expo-image-picker@56.0.20` | `~56.0.22` |
| `expo-sharing@56.0.21` | `~56.0.23` |

This is a focused patch-level alignment task, not an SDK migration. Use
`npx expo install` rather than an arbitrary npm forced fix. References:

- https://docs.expo.dev/versions/v56.0.0/
- https://docs.expo.dev/versions/v56.0.0/sdk/filesystem/
- https://docs.expo.dev/versions/v56.0.0/config/app/
- https://docs.expo.dev/versions/v56.0.0/config/package-json/

### Dependency advisories

`npm audit --omit=dev` reported:

- 4 high;
- 11 moderate;
- 0 critical;
- 15 total.

The high advisories are in `brace-expansion`, `js-yaml`, `postcss`, and
`shell-quote`. Dependency tracing places these primarily in Expo CLI,
configuration, Metro, fingerprinting, and build/prebuild paths. They are not
direct imports in Pit's request handlers, so this is not evidence of a remotely
exploitable production API vulnerability. It is still a CI/developer/build
supply-chain and availability concern.

Do not run the audit's suggested forced downgrade to Expo 46. Align the four SDK
56 packages first, regenerate the lockfile with the SDK-compatible tree, rerun
the audit, and document whatever remains with reachability analysis.

### Secret boundary check

The Expo build log enumerates names loaded from `.env`, including private server
variables. An exact-value scan of every generated `dist/` file found:

- the expected public Google Maps key in the client bundle;
- **no exact value** for Ticketmaster, Resend, mail sender, media endpoint,
  media bucket, media access key, media secret key, or media public base URL.

`.env`, `dist/`, and `server/data/` are correctly ignored. Existing credentials
that were pasted into prior chat sessions should still be rotated for that
separate reason, as the current docs already state.

## Live production incident

### Confirmed observation

At approximately 2026-07-28 19:23 UTC:

| Endpoint | Attempts | Result |
| --- | ---: | --- |
| `https://www.mshpit.com/` | 3 | `502 Bad Gateway` |
| `https://www.mshpit.com/api/health` | 3 | `502 Bad Gateway` |
| `https://www.mshpit.com/sitemap.xml` | 3 | `502 Bad Gateway` |
| `https://www.mshpit.com/robots.txt` | 1 | `200`, Cloudflare-managed body |

The 502 response came from Cloudflare at the Toronto edge and did not contain
Pit server headers. This establishes an unavailable or unreachable origin, but
does not by itself prove whether the cause is a Render crash, failed deploy,
service suspension, origin DNS/TLS configuration, or another Cloudflare-to-
Render connection problem.

### Immediate production checks

1. Open the Render service event/deploy log and the most recent runtime log.
2. Confirm the service is running and the persistent disk is mounted at `/data`.
3. Look for startup failure before `server.listen`, especially DB open/migration,
   missing build artifact, Node version, disk-full, or restart-loop errors.
4. Confirm Cloudflare's origin target and TLS mode still match the Render custom
   domain configuration.
5. Once the origin is reachable, verify `/api/health`, root, one public entity,
   login, and media presign/upload.
6. Disable or reconcile Cloudflare's managed `robots.txt` feature if Pit's
   generated crawl policy is intended to be authoritative.
7. Re-run the sitemap and security-header smoke tests after recovery.

The repo anticipated the robots conflict in `LAUNCH.md`; the live result confirms
that the production action was not completed or did not remain in effect.

## Confirmed functional and privacy defects

### P1 — drafts leak across accounts on the same browser

Evidence:

- `src/store.js` loads and saves all review drafts under `pit.drafts`.
- A draft does not store or enforce an owning account ID.
- `logout()` clears history, playlists, snapshots, friends listening, theme, and
  session, but not drafts.
- `LogScreen.jsx` renders the first five saved drafts without account filtering.
- Account deletion clears drafts, but ordinary logout does not.

Impact: on a shared computer, member B can see member A's unpublished artist,
venue, date, review text, tags, song, and durable photo URLs. It also creates
accidental-post risk if B resumes and publishes A's draft.

Recommended fix: make the persistence key account-scoped, migrate the current
key only to the currently authenticated owner when that can be done safely, and
clear the in-memory draft view synchronously on logout/account switch. Define an
explicit guest-draft policy instead of sharing the same bucket.

### P2 — account-specific caches are not reset atomically on logout

`blockedIds`, DMs, DM read markers, notifications, going state, fan-club state,
and several rating/comment caches survive logout. Most derived selectors include
the current user ID, which prevents direct display of another user's DMs and
notifications, but stale global state can still affect a newly logged-in account
until server hydration finishes or if hydration fails. `blockedIds` is the clearest
example because it is a flat, unscoped list.

Recommended fix: split public cache from account-private cache; key private cache
by account ID; switch the active private snapshot synchronously during auth
transitions; replace, rather than merge, server-authoritative account lists.

### P2 — crash reset is incomplete

`ErrorBoundary.reset()` says it clears state most likely to cause a startup
crash, but it removes only theme, session, users, feed, follows, and `pit.entered`.
It leaves navigation stack, player queue/position, drafts, snapshots, DMs,
notifications, ratings, venue reviews, and other hydrated records. A corrupt
`pit.stack`, `pit.player`, or one of those stores can survive “Reset app data” and
reproduce the crash.

Recommended fix: centralize owned persistence keys and implement a tested
reset-by-prefix or explicit complete registry, preserving only deliberately safe
preferences. Avoid an ad hoc list in the error boundary.

### P2 — two UI strings are corrupted

Exact UTF-8 code-point scanning found:

- `src/components/PlayerBar.jsx:867`: `UP NEXT Â· ...`;
- `src/screens/LoungeScreen.jsx:85`: `Saving your spotâ€¦`.

These should be the middle dot and ellipsis characters respectively. Add a small
source scan/test for common mojibake sequences because the issue is easy to
reintroduce through Windows shell encoding.

## Architecture review

### Client shell and navigation

The app does not use Expo Router. `App.js` implements tabs plus a persisted stack
of overlay frame objects and mirrors selected public frames into browser history.
This preserves the persistent player and avoids full-page reloads. It also means
navigation correctness depends on manual synchronization among stack state,
`window.history`, initial URL resolution, landing state, session state, and
Android hardware back.

Strengths:

- public entity paths are centralized and round-trip tested;
- lazy chunk loading has retry/reload-loop protection;
- browser back and in-app back share a mostly unified path;
- public metadata, sitemap, and client resolution use the same entity model.

Risks:

- there are no browser-level navigation tests;
- web-only routing does not provide a native deep-link contract;
- reset tokens remain in the URL until the reset screen is completed/cancelled;
- root history entries are deliberately re-armed, which can make leaving the
  signed-in app via Back surprising;
- persisted frame objects are an unversioned storage schema.

### State and data flow

`src/store.js` combines authentication, public feed, profile cache, private
messages, notifications, ratings, media reactions, playback/history, playlists,
moderation, admin jobs, provider resolution, recommendations, drafts, and
location discovery in one provider.

The recent work improved request sequencing, optimistic rollback, cursor state,
abort behavior, and background polling. The structural cost remains high:

- every context value is recreated when the provider renders;
- unrelated consumers can rerender on broad state changes;
- account-private and public/device caches share one persistence layer;
- best-effort catches often turn state divergence into silence;
- unit testing React state transitions is difficult because logic is embedded in
  one component rather than small stores/reducers.

Recommended direction: extract account/session, social feed, chat, playback, and
catalogue/provider domains behind stable hooks. Use context selectors or multiple
providers. Keep server state paged and authoritative; retain only deliberately
offline-capable state locally.

### API server

The zero-framework route table is understandable and has useful shared helpers,
but 115 routes in one 2,649-line file is now past the point where ownership and
policy are easy to audit.

Strengths:

- body size cap and structured JSON errors;
- request IDs and safe error envelopes;
- authentication/role helpers and extensive authorization tests;
- stable cursor ordering on the important growing lists;
- per-route plus global flood limits;
- no production CORS because the web app is same-origin;
- graceful shutdown on fatal process errors.

Risks:

- endpoint families are difficult to review independently;
- in-memory rate limits reset on restart and do not coordinate across instances;
- no CSRF token/origin check exists; `SameSite=Lax` materially reduces risk for
  the current same-origin cookie model, but an explicit origin policy would make
  the invariant clearer for future cross-origin/native changes;
- some endpoints still cap rather than cursor-page results;
- polling creates request amplification as active users and open rooms grow.

### Database and migrations

SQLite is configured sensibly for a single-instance Alpha: WAL, foreign keys,
busy timeout, indexed cursor paths, transactions for destructive account/date
changes, and a persistent Render disk.

The additive migration loop is hazardous:

```text
for each ALTER TABLE ... ADD COLUMN:
  try execute
  catch every error and continue
```

It intends to ignore “duplicate column” errors, but also suppresses disk I/O,
corruption, lock, malformed-schema, and other migration failures. The process can
continue with a partially migrated schema and fail later in less diagnosable
places. The single `schema_version` row is not advanced through explicit ordered
versions for these columns.

Recommended fix: inspect schema before each migration or catch only the known
duplicate-column condition; run ordered, transactional, idempotent migrations;
record each version; fail startup loudly on unexpected migration errors.

### Playback and providers

The provider subsystem has received the most sophisticated recent hardening:
separate YouTube budgets/circuits, duration-aware identity, cache expiry,
Wikidata channel provenance, bounded concurrency, no-search warming, retryable
transient errors, and focused regression tests.

Remaining limitations:

- full YouTube IFrame playback is explicitly web-only;
- the fallback audio engine is also HTML5-web-only, so native transport can have
  metadata/UI without an active audio engine;
- background playback, interruption handling, lock-screen controls, and native
  session restoration are not implemented or device-verified;
- in-process warmers are not durable jobs and disappear on restart;
- provider state and catalogue enrichment remain tied to one SQLite/web process.

### Media

The existing design correctly avoids proxying large files through the app server:
an authenticated endpoint validates a declared type/size and returns a short-lived
user-owned signed PUT; the client uploads directly; only durable HTTPS URLs are
persisted. Exact secret scanning confirms credentials stay server-side.

The missing finalization pipeline is the launch boundary. A client-controlled
MIME declaration and extension are not proof of content. There is no object row
tracking pending/finalized/quarantined state, no post-upload HEAD/byte verification,
no EXIF/location stripping, no transcoding/posters, no malware/content scan, and
no durable deletion for abandoned or account-owned objects.

### Images and data provenance

The docs state the correct policy—fan uploads, Wikimedia, licensed Openverse,
then fallback—and explicitly say Google Images is not a license source. The
catalogue does not yet meet that policy.

Observed generated inventory:

| File | `Source: web` | Getty | Alamy | Pinimg | Plain HTTP |
| --- | ---: | ---: | ---: | ---: | ---: |
| `catalog.generated.json` | 5,542 | 37 | 347 | 236 | 375 |
| `catalog.venue-photos.json` | 5,162 | 36 | 332 | 227 | 350 |
| `catalog.core.json` | 380 | 1 | 15 | 9 | 25 |

The image checker verifies liveness/content-type, not license. Hotlink reliability,
mixed-content blocking for HTTP images, attribution sufficiency, takedowns, and
commercial usage rights remain separate problems.

### Maps

The tracked Google key is intentionally public and appears in the bundle, as any
`EXPO_PUBLIC_` value will. `render.yaml` says it is referrer-restricted and enabled
for Maps Static API only. `LiveMap.jsx` also loads the Maps JavaScript API with the
same key and documents that it will fall back if unauthorized. This creates a
configuration mismatch: the “live” map may reliably degrade to a static map even
when the key is present.

Decide whether interactive Maps JS is a product requirement. If yes, enable only
the needed API on a tightly referrer-restricted browser key and monitor quota. If
no, remove the live-loader path and its CSP allowances.

## Security review

### Strong controls already present

- scrypt password hashes with per-user random salts;
- 32-byte opaque sessions with only SHA-256 token hashes stored in SQLite;
- HttpOnly, Secure-in-production, SameSite=Lax cookies;
- generic login and forgot-password behavior against account enumeration;
- reset-token hashes, one-hour expiry, single use, and session invalidation;
- role/ownership checks and auditable moderation actions;
- blocked-user enforcement across major profile/content/chat paths;
- 256 KB JSON body cap;
- CSP, HSTS, nosniff, frame denial, and restrictive production CORS posture;
- safe public error catalogue and request IDs;
- exports exclude password/session/reset/provider/IP/user-agent secrets;
- analytics is allow-listed, consented, aggregated, and purges raw IP data.

### Open security/operations risks

- production outage and unknown origin state;
- credentials previously pasted into chat remain rotation candidates;
- upload verification/moderation/lifecycle gap;
- unlicensed image inventory;
- no email verification, adaptive abuse controls, CAPTCHA threshold, or spam
  controls for a broad public launch;
- in-memory rate limits and single-process jobs;
- no documented, recently tested off-host restore evidence;
- native secure session persistence absent;
- dependency advisory baseline out of date;
- CSP needs broad `img-src *`, `media-src *`, inline scripts/styles, and external
  player/map sources because of current product choices.

## Performance and scale

### Improvements that are working

- 36 screens are lazy-loaded;
- venue photo data is lazy and full discographies are removed from startup core;
- stale chunk loads retry/reload once rather than loop;
- feed uses a stable cursor and abort/backoff behavior;
- heavy provider results are cached;
- database queries have important cursor and relationship indexes.

### Remaining bottlenecks

- 4.39 MB main web JS bundle before transfer compression;
- 1.30 MB JSON startup catalogue, despite the successful split;
- broad store context rerenders unrelated consumers;
- 10.4 MB generated catalogue remains tracked and build-coupled;
- root provider starts public feed polling every 12 seconds for every active app;
- open comments poll every 15 seconds and chats poll while active;
- SQLite and in-memory limits prevent horizontal scaling;
- tour-date, catalogue, and cache-warming jobs run in or beside the web process;
- profile posts and several directories still use fixed caps rather than fully
  paged server state.

Before optimizing blindly, capture Web Vitals and React Profiler traces on a
mid-range Android device and mobile Safari. Set budgets for startup transferred
JS, parse/evaluation time, initial renders, feed request count, and memory.

## Native readiness

The app can be opened by Expo tooling, but the repository is not configured for
store distribution:

- no iOS bundle identifier;
- no Android package identifier;
- no EAS project/build/submit configuration;
- no URL scheme or native deep-link mapping;
- no native project directories or checked-in prebuild output;
- persistence falls back to process memory on native;
- full-track and preview audio engines are web-only;
- no notification/push implementation;
- no physical-device test evidence for upload, playback, backgrounding,
  interruption, safe area, orientation, or accessibility.

This agrees with `TODO.md`, but it should be treated as a release blocker rather
than a minor parity item.

## Accessibility and test coverage

The code contains meaningful accessibility work: approximately 325 accessibility
properties across 410 Pressables, with particularly good labels/states on primary
navigation, post controls, media, themes, ratings, and headers.

Coverage gaps:

- no ESLint configuration or lint script;
- no TypeScript/static type checking;
- no component-render tests;
- no browser E2E suite;
- no native E2E/device suite;
- no automated keyboard traversal, focus-order, screen-reader, contrast, text
  scaling, reduced-motion, or target-size checks;
- many effects suppress exhaustive-dependency warnings without an active linter
  to validate the surrounding code.

The production build proves JSX compiles, but it does not prove interaction,
focus, or rendering behavior. Add a small high-value E2E suite before expanding
unit-test count: auth/logout/account switch, composer draft isolation, post CRUD,
deep links/back, player continuity, DM gate/catchup, upload, and admin denial.

## Documentation drift

The project has excellent documentation volume but conflicting current-state
claims:

- `HANDOFF.md` says the hardening is still a working-tree batch; the tree is
  clean and the batch was merged in `54710ed`.
- `TODO.md` still labels that work `HARDENED / VERIFY` against an active working
  batch.
- `CLAUDE.md` says current stabilization work is on `codex/stabilize-core`, while
  the active branch is clean `master` and that branch is historical.
- `SECURITY.md` describes one moderate dependency advisory; the current audit is
  15 advisories with four high.
- `HANDOFF.md` records an older healthy production check, but production was 502
  during this audit.
- the handoff is 216 KB and mixes current operating truth with chronology, making
  stale “current” claims easy to miss.

Recommended documentation model:

1. keep a short, dated `STATUS.md` containing only current production, branch,
   checks, blockers, and next action;
2. keep `TODO.md` authoritative for product work;
3. move chronological session notes to an append-only archive;
4. make CI verify that the status date/commit is intentionally updated for
   release-affecting changes;
5. update `SECURITY.md` from generated audit evidence, including reachability and
   accepted-risk expiry dates.

## Prioritized action plan

### Now — restore and contain

1. Restore Render/Cloudflare origin availability and retain the failure evidence.
2. Verify the persistent disk and database before restarting or redeploying
   repeatedly.
3. Re-run production health, root, entity, auth, sitemap, headers, and upload
   smoke checks.
4. Disable/reconcile Cloudflare managed robots if Pit's generated policy should
   win.
5. Fix account-scoped drafts and synchronously clear/switch private client caches
   on logout/account change.

### Next verified batch

1. Align the four Expo SDK 56 packages with `npx expo install`.
2. Rerun `npm run check`, `npx expo install --check`, and `npm audit --omit=dev`.
3. Fix the two mojibake strings and add a scan regression test.
4. Make crash reset use a complete persistence-key registry.
5. Make DB migrations explicit and fail on unexpected errors.
6. Update `HANDOFF.md`, `TODO.md`, `CLAUDE.md`, and `SECURITY.md` to current truth.

### Before broad public Alpha

1. Complete media finalization/quarantine/moderation/deletion.
2. Remove or license `Source: web` inventory; eliminate plain HTTP hotlinks.
3. Add high-value browser E2E tests and production synthetic checks.
4. Prove off-host backup restore and disk-full behavior.
5. Add email verification and abuse/spam controls appropriate to the audience.
6. Add centralized production error/rate/latency/storage monitoring with alerts.

### Before native release

1. Decide the native playback contract and implement a real native audio/video
   engine with background/interruption handling.
2. Add secure native persistence, identifiers, schemes, EAS configuration, and
   store metadata.
3. Pass real iOS and Android device matrices for playback, upload, auth, deep
   links, safe areas, accessibility, and poor-network recovery.

### Before scale beyond a controlled Alpha

1. Move SQLite/in-memory shared state to managed, horizontally safe services.
2. Move warmers, enrichment, media, email, exports, deletion, and fan-out to
   durable leased jobs.
3. Split the store and API into bounded domains with explicit ownership.
4. Page all growing server state and replace polling with pub/sub plus cursor
   catch-up.
5. Set and enforce bundle, latency, error-rate, queue-lag, and restore objectives.

## Bottom line

The local codebase is coherent and testable, and the recent provider work is more
careful than the average Alpha. The immediate problem is operational availability,
not a failing local build. After production is restored, the first product fix
should be account-private client persistence—especially drafts—followed by SDK
alignment and truthful documentation. Media finalization, image rights, and native
playback remain hard launch boundaries, not polish.
