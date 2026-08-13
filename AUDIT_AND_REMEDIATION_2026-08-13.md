# Pit extreme audit and remediation — 2026-08-13

This is the current evidence-based audit for the mobile lag and posting incident.
It supersedes operational conclusions in the historical August 4/5 audit and
session log where those conclusions conflict with the live checks recorded here.
Those older files remain useful implementation history; they are not current
production status.

"Fixed in this batch" means implemented, exercised on
`codex/audit-hardening-20260813`, fast-forwarded to `master`, and deployed from
runtime commit `1e2ba65` on 2026-08-13. The verification table distinguishes
local proof, release proof, and the physical-device work that remains.

## Executive summary

The J. Cole content was not missing during this audit. Production, the Render
origin, the checked-out repository, and both remote branches all served or
reported the same commit (`1c6d91f` at the pre-change baseline). The public feed
contained the exact July 28 post beginning “Jcole opening is really cool. Bas
made an appearance…”, three other J. Cole posts, and the attached R2 image
returned HTTP 200.

After release, the custom domain and Render origin both reported
`1e2ba657bc11`, the expected persistent database identity, and matching uptime
through checks at 23 and 79/80 seconds. Both feeds still returned the same 13
IDs and all four J. Cole-related posts. The exact J. Cole/Bas image remained HTTP
200 at 3,909,908 bytes. The live entry is now 2,253,157 bytes raw, contains no
venue-gallery arrays or split-file reference, and the independent GitHub Quality
run for the release commit succeeded.

The phone experience nevertheless had several real, compounding defects:

1. The initial web bundle shipped the entire venue-photo catalogue. The live
   entry asset was 4,402,225 bytes uncompressed and 975,855 bytes over gzip,
   including roughly 9,854 venue image records and 22,060 URL literals. A phone
   had to download, parse, allocate, and retain data for venues the user never
   opened.
2. The composer could be dismissed by browser/Android Back while dirty or while
   publishing. Unsaved work could disappear, and a late successful response
   could navigate away from whatever the user opened next.
3. Status posts had no durable draft workflow. Native persistence was only an
   in-memory fallback, so an OS reclaim or process restart could erase a draft.
4. Android image-picker recovery was absent, even though Android may destroy the
   activity while the picker is open. iOS video selection also lacked the media
   permission preflight recommended by the exact Expo SDK 56 API.
5. Several server/deployment safeguards gave false confidence: production could
   silently create a blank database when its disk path disappeared and still
   report a healthy HTTP 200; backup row-count verification could accept loss;
   and Render auto-deploy was not gated by the full test/syntax/export check.

The remediation batch addresses the data-safety, bundle, composer, picker,
pagination, retry, backup, deployment, cache, comment-preview fan-out, and
configuration defects. The large Store context remains an explicit structural
follow-up rather than being hidden by a “fixed” label.

## Scope and method

The audit used four independent passes over the same repository:

- repository/production parity and live asset/data probes;
- server, persistence, deployment, backup, and HTTP behavior;
- mobile/web composer lifecycle, persistence, picker, and feed behavior;
- focused source inspection followed by executable reproduction tests.

Read-only production checks were performed against both the custom domain and
the Render origin. Local failure cases used isolated temporary data directories;
they did not modify production data. The code review baseline was a clean
`master` at `1c6d91f`.

Severity used below:

- **P0** — can silently lose or replace production data, or can make a healthy
  deployment appear healthy while serving the wrong database.
- **P1** — directly causes failed posting, lost user work, unusable mobile
  behavior, or an unsafe release/restore path.
- **P2** — material performance, reliability, or maintainability defect with a
  bounded workaround.
- **P3** — documentation or hardening issue that increases future incident risk.

## Findings ledger

| ID | Severity | Finding | Pre-change evidence | Remediation state |
|---|---:|---|---|---|
| PIT-AUD-001 | P0 | Missing production data mount booted a new blank SQLite database | Reproduced with `NODE_ENV=production` and a nonexistent `PIT_DATA_DIR`; the directory and DB were created | Fixed in this batch; verification recorded below |
| PIT-AUD-002 | P0 | Health returned 200 for the wrong/new database | Same reproduction returned `ok:true`, `database:true`, `storageConfigured:true` | Fixed in this batch; verification recorded below |
| PIT-AUD-003 | P1 | Initial phone bundle embedded all venue galleries | Live asset: 4.20 MiB raw / 953 KiB gzip, ~9,854 gallery records | Fixed by on-demand venue gallery loading |
| PIT-AUD-004 | P1 | Back navigation could discard or race a composer submission | Dirty and busy composer paths had no lifecycle guard | Fixed in this batch |
| PIT-AUD-005 | P1 | Status/native drafts were not durable | Status path lacked draft persistence; native fallback lived only in memory | Fixed in this batch |
| PIT-AUD-006 | P1 | Android picker results could be lost after activity recreation | No `getPendingResultAsync()` recovery | Fixed in this batch |
| PIT-AUD-007 | P1 | Backup row-count verification could accept logical loss | Comparison rejected valid growth but allowed a smaller nonzero snapshot | Fixed and regression-tested in this batch |
| PIT-AUD-008 | P1 | A server-only regression could auto-deploy before CI reported it | Render build command exported web only; GitHub Quality was concurrent, not a deploy gate | Fixed in this batch |
| PIT-AUD-009 | P1 | Legacy create retry token with NULL hash silently returned the old post for changed content | One migrated local row had a mutation ID and NULL hash; conflict check only ran for truthy hashes | Fixed with canonical comparison/healing in this batch |
| PIT-AUD-010 | P2 | Equivalent create retries could conflict across normalization/client versions | Hash was calculated from raw JSON before validation (`false` vs `0`, display date vs ISO) | Fixed with validated canonical hashing |
| PIT-AUD-011 | P1 | A committed PATCH with a lost response appeared to fail on retry | First write advanced the version; retry with the old version returned 409 | Fixed with canonical server reconciliation |
| PIT-AUD-012 | P2 | Filtered “load older” fetched before revealing matches already in memory | `loadOlderFiltered` always called the network | Fixed and unit-tested in this batch |
| PIT-AUD-013 | P2 | Invalid job flag text could enable a background job | Any nonempty value other than recognized false strings was truthy | Fixed with explicit boolean parsing |
| PIT-AUD-014 | P2 | Background jobs could overlap when re-enabled | Tour refresh and cache warm timers had no shared serialization | Fixed in this batch |
| PIT-AUD-015 | P2 | Missing hashed JS chunks had no anti-cache directive | Local server returned correct JSON 404 but no `Cache-Control` | Fixed with executable HTTP coverage |
| PIT-AUD-016 | P2 | Store context is monolithic and feed previews fanned out comment requests | ~150 context fields / ~45 consumers; one comments GET per mounted card | Comment fan-out fixed; Store split remains open |
| PIT-AUD-017 | P3 | Operational docs contradicted current code and live data | Old files still claimed a free-tier wipe, vanished J. Cole content, and obsolete crash behavior | Reconciled in this batch |
| PIT-AUD-018 | P1 | The documented staging gate was not provisioned at its declared hostname | Read-only `mshpit-staging.onrender.com/api/health` probe returned 404 and `x-render-routing: no-server` | Open external release-control action |
| PIT-AUD-019 | P1 | Render's full build gate inherited deployment-only bootstrap/staging policy into the test subprocess | Exact production reproduction failed the health assertion (`bootstrapAllowed:true`); exact staging reproduction also suppressed campaign recipients | Fixed by making the hermetic test runner pin test/application policy and bootstrap disabled; both Render environments regression-tested |

## Detailed evidence and reasoning

### 1. Production disk identity and health were fail-open (P0)

Before this batch, `server/dataDirectory.js` treated a configured but missing
production data directory as something it could create. It could also fall back
to `server/data`. That behavior turns a missing Render disk into a valid empty
SQLite database—the most dangerous possible failure mode for a social product,
because the application starts normally while every account and post appears to
have vanished.

The health endpoint compounded this. It checked that `SELECT 1` worked and that
the storage environment variable existed, not that the process had opened the
expected, pre-existing database. The end-to-end reproduction therefore returned
HTTP 200 with all of these misleading values:

```text
ok: true
database: true
storageConfigured: true
```

Staging also permanently set `PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true`, defeating the
missing-database check after the first intended bootstrap.

Required invariant: in production, a configured durable directory must already
exist, and a read-only preflight must reject an absent, zero-byte, wrong-schema,
or structurally empty legacy Pit database before migrations can make it look
valid. Only a deliberately scoped, one-time first-boot bootstrap may bypass
initialization checks. Health must expose enough storage identity/state for an
operator or platform check to distinguish the durable DB from an accidental
empty fallback.

### 2. Venue media dominated startup work (P1)

The live HTML was small (3,154 bytes identity), but it referenced a single large
entry asset. Measurements from the custom domain:

| Representation | Bytes |
|---|---:|
| JavaScript, identity | 4,402,225 |
| JavaScript, gzip | 975,855 |
| JavaScript, Brotli | 984,396 |

The compressed transfer is only part of the phone cost. The browser must inflate
the asset to more than 4 MiB, parse it, compile it, allocate thousands of strings
and object/array entries, and retain imported catalogue data. The live asset
contained:

- 1,008 literal `galleryPool:[` arrays;
- about 9,854 `uri:"http…"` gallery records;
- 22,060 total HTTP URL literals;
- known venue keys such as `wollman auditorium` and `lefrak concert hall`.

The batch implements that structural boundary as an on-demand venue-gallery
endpoint with a bounded client cache. Venue identity/search metadata remains
local where it helps discovery; heavyweight galleries stay server-side. The
final release-candidate export entry measures 2,253,157 bytes raw, 615,705 gzip,
and 504,824 Brotli. Its client chunks contain zero literal `galleryPool:[` arrays and zero
references to `catalog.venue-photos`. A regression test now enforces 2.50 MiB
raw, 700 KiB gzip, and 600 KiB Brotli budgets.

### 3. Composer lifecycle could lose work or hijack navigation (P1)

The composer protected neither of its two critical states:

- **dirty:** the user had typed or selected content that was not saved;
- **busy:** a publish/edit request was in flight.

On browser or Android hardware Back, the screen could unmount immediately. If
the request later succeeded, completion logic could still force navigation to
Feed, even if the user had already moved elsewhere. If it failed—or if the OS
reclaimed the app—status content had no durable draft to restore.

The fix needs a single ownership rule: the active composer owns its pending
navigation until the user explicitly discards it or the active submission
completes. Late async completion from an inactive composer may reconcile data,
but it must not navigate the current screen.

### 4. Picker recovery must follow Expo SDK 56 behavior (P1)

This repository is pinned to Expo SDK 56, and the exact versioned documentation
was reviewed before implementation. Android may destroy `MainActivity` after the
image-picker activity starts. Expo exposes
`ImagePicker.getPendingResultAsync()` specifically to recover that result. Not
calling it turns a successful user selection into an apparent no-op.

The iOS video flow also needs media-library permission preflight rather than
waiting for a less predictable picker failure. Dependency alignment stays on
SDK 56 patch releases; this batch does not perform a major Expo upgrade.

### 5. Retry identity was based on representation, not meaning (P1/P2)

Create idempotency used a good stable token (`clientMutationId`), but the server
hashed raw request JSON before validation. Two payloads that produce the same
stored post could therefore conflict:

- `photosPublic:false` versus `photosPublic:0`;
- a supported legacy display date versus canonical ISO;
- numeric strings versus normalized rating numbers;
- harmless leading/trailing whitespace cleaned by validation.

Conversely, migrated rows with a token but a NULL hash skipped the conflict test
entirely, so a changed retry silently returned the older post. The safe model is
to compare the validated canonical requested post with the canonical stored post
and heal old/missing hashes only after equivalence is proven.

PATCH has a related ambiguity: a server commit followed by a lost response leaves
the client holding the previous version. Blind retry gets a legitimate 409 even
though the intended edit is already present. Reconciliation must read the
canonical server post and treat it as success only when every intended editable
field matches; a genuinely different server value remains a conflict.

### 6. Backup validation compared counts in the wrong direction (P1)

The backup script read expected counts before `VACUUM INTO`. It then rejected a
snapshot when `got > expected` (which can be valid if concurrent inserts landed)
but accepted `got < expected` as long as the result was nonzero (which is the
actual loss condition). There was no focused backup test or automated schedule.

The repair locks the correctness property with tests: critical tables in the
snapshot may not contain fewer rows than the verified source point, integrity
must pass, and the backup must remain a SQLite database that can be opened and
queried. Production also schedules one verified snapshot per day under the
mounted data directory and retains seven by default. Complete, separate private
`BACKUP_S3_*` credentials add off-host upload; without those credentials the
snapshots remain on the same disk and are not disaster recovery. A current
production snapshot/upload/restore still needs to be observed after deployment.
Each destination stays under a `.partial-*` name until verification and any
requested upload succeed, then renames atomically. Verification/upload failures
publish no final snapshot, partial files never count as fresh, invalid retention
configuration fails before pruning, and bounded child/upload deadlines release
the shared maintenance queue if a run wedges.

### 7. Auto-deploy was not gated by the quality gate (P1)

`render.yaml` had `autoDeploy: true`, but its build command only ran dependency
installation and the Expo web export. GitHub Quality ran independently on push.
That means a server syntax/runtime regression could deploy before CI finished
reporting it.

The release invariant is that the same required gate—tests, syntax, and web
export—must succeed in the deployment build itself. CI remains valuable, but it
is not a gate if the deployment platform does not wait for it.

The first Blueprint-controlled build then exposed a second boundary: its
command-scoped `PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true` correctly permitted a
throwaway build database, but leaked into `node --test`. The health test saw
bootstrap enabled and failed, so Render rejected the deployment while the
previous healthy runtime stayed live. Reproducing the exact production build
environment produced 349/350 and the same assertion. The test runner now owns a
fresh `NODE_ENV=test`, `PIT_ENV=production` child environment with bootstrap
explicitly disabled; this also prevents a staging build's recipient-suppression
policy from muting campaign tests. The same production- and staging-like Render
commands subsequently passed 351/351, syntax, split, and web export. Runtime
startup still receives the fail-closed deployment values.

### 8. Background job flags and overlap were unsafe when re-enabled (P2)

The jobs are currently disabled, which prevents immediate overlap but also means
tour refresh/cache enrichment functionality is paused. Before this batch, typoed
nonempty values such as `flase` enabled a job because parsing treated nearly any
non-false string as true. If both jobs were enabled, their initial 30-second and
60-second timers could overlap without a shared mutex.

The batch makes enablement explicit and serializes the heavy jobs. Operationally,
re-enable one job at a time and observe duration/error/DB pressure before enabling
the second.

### 9. Missing hashed chunks must never be negatively cached (P2)

A stale browser can request an immutable asset name that no longer exists after a
deploy. The server correctly returned a JSON 404 for `/_expo/*.js` rather than the
HTML shell, but it did not send `Cache-Control: no-store`. A CDN or browser could
cache that transient negative result and keep the app broken after refresh.

The fix is a real HTTP response assertion, not only a source-regex policy test:
missing hashed chunks return 404 JSON plus `Cache-Control: no-store`; real hashed
assets keep long-lived immutable caching.

### 10. Comment fan-out fixed; Store context remains structural work (P2)

`src/store.js` exposes roughly 150 values/functions through one Context consumed
by about 45 components. Any provider value replacement can rerender consumers
that do not care about the changed slice.

Before this batch, each mounted `AfterpartyPreview` also requested comments for
its own post. Feed/profile responses now embed the latest two visible comments
per post with one page-level window query. Cards use that preview and retain the
old read only as a compatibility fallback for legacy/local post shapes. The full
thread still loads only when someone opens the post. Executable API coverage
proves the preview is bounded, visible-only, ordered, and returned without
per-card reads.

The next structural performance batch should:

1. split session, feed, social interaction, catalogue, venue, playback, and admin
   state behind narrower providers/selectors;
2. measure rerender counts and request counts before/after rather than relying on
   subjective smoothness.

The remaining item is intentionally listed as open. Venue catalogue removal and
batched comment previews attack measured startup/network costs without pretending
the Context architecture is already solved.

### 11. The staging release gate is declared but not live (P1)

The repository has a `staging` branch and a production-shaped Render Blueprint
service named `mshpit-staging`, but a read-only request to its declared default
hostname returned HTTP 404 with `x-render-routing: no-server` on 2026-08-13.
This means the documented “merge to staging, watch it, then promote master” flow
is not currently proven usable. Provision or identify the actual service, set its
isolated disk/secrets, and record a healthy URL plus smoke result before claiming
a staging rehearsal. Until then, a direct-master deploy must be recorded honestly
as having skipped staging.

### 12. SDK alignment is clean; dependency advisories remain (P2)

The package set remains on the exact Expo SDK 56 line required by this project:
Expo 56.0.19, React Native 0.85.3, and React 19.2.3 with compatible Expo module
patches. `npx expo install --check` reports the dependencies current, and Expo
Doctor passes 21/21 checks.

That is not the same as a clean vulnerability report. On 2026-08-13,
`npm audit --omit=dev` reported 19 advisories (8 moderate and 11 high) in the
Expo/Metro/React Native/Xcode dependency graph. npm's automatic fix proposes
incompatible Expo 53, React Native 0.72, and older module versions. Do not use
`npm audit fix --force`; track compatible upstream fixes or perform a deliberate
SDK upgrade with native-device coverage.

## Production facts that were verified good

At the pre-change baseline:

- local `master`, `origin/master`, and `origin/staging` were the same commit;
- `/api/health` from custom domain and Render origin reported that same commit;
- health remained HTTP 200 across checks more than 60 seconds apart;
- reported uptime implied the process had been continuously running since about
  2026-08-07 11:45:54Z;
- custom domain and origin returned the same 13 public post IDs;
- the exact J. Cole/Bas post was present, along with three other J. Cole posts;
- its R2 JPEG returned HTTP 200 and was 3,909,908 bytes;
- the baseline automated suite passed 277/277 tests;
- local SQLite `integrity_check` had no failures (one expired email-token warning
  was data hygiene, not corruption).

These facts directly contradict the historical claim that a free-tier restart
had erased the J. Cole post. That claim was inference from an old incident log,
not current evidence.

## Remediation and verification record

This section is completed only with executable evidence. A source edit alone is
not a verified fix.

| Check | Result |
|---|---|
| Focused pagination unit tests | PASS — 3/3 |
| Full unit/integration/export-test run | PASS — release `npm test` 350/350; Render-environment follow-up 351/351 |
| Focused storage/health tests | PASS — missing mount/database, invalid file, explicit bootstrap, and health invariants covered |
| Focused backup/scheduler tests | PASS — 12/12 snapshot, atomic publication, row-floor, retention, deadlines, schedule, and private-upload controls |
| Focused composer/draft/navigation/persistence tests | PASS — policy, ownership, recovery, and persistence paths; real picker/device lifecycle remains below |
| Focused venue-gallery tests | PASS — endpoint, client LRU/merge, split invariants, and exported-chunk scan |
| Focused retry/reconciliation tests | PASS — canonical create, legacy healing, single-post read, and ambiguous edit coverage |
| Feed comment-preview test | PASS — latest two visible comments embedded without per-card reads |
| Expo SDK 56 alignment | PASS — `expo install --check`; Expo Doctor 21/21 |
| Dependency audit | REPORTED — 19 advisories (8 moderate, 11 high); forced downgrade rejected |
| Render/GitHub YAML parse and deployment-policy tests | PASS locally; staging service itself is not provisioned at the declared hostname |
| Exact Render production/staging build environments | PASS — reproduced the inherited bootstrap and staging-policy failures, then passed 351/351 plus syntax, split, and web export after isolating the test child environment |
| Full `npm run check` on feature branch | PASS — tests, 100-file syntax scan, catalogue split, and fresh Expo web export |
| SQLite integrity check | PASS — 0 failures; one harmless expired verification-token warning |
| Production-mode isolated boot | PASS — copied DB, durable-storage health, deep route, venue endpoint/cache, and missing-chunk 404/no-store |
| Legacy production-database upgrade replay | PASS — unmarked 18-user/21-post/2,658-artist copy stamped `PIT1`, preserved counts, survived restart and WAL recovery |
| Fresh Android export | PASS — Expo SDK 56, 891 modules |
| Exported bundle measurement and gallery-marker scan | PASS — 2,253,157 raw / 615,705 gzip / 504,824 Brotli; zero gallery arrays or split-file refs |
| Full `npm run check` on merged `master` | PASS — initial release 350/350; follow-up Render-environment gate 351/351, syntax, split, and web export |
| Independent GitHub Quality workflow | PASS — release commit `1e2ba65`, run 31741191910 |
| Post-deploy custom/origin health and data parity | PASS — exact commit on both, durable DB present/bootstrap false, identical 13 IDs, four J. Cole posts and media intact, stable beyond 60 seconds |
| Live HTTP/cache and bundle smoke | PASS — 2,253,157-byte immutable entry, zero gallery arrays/split refs, venue endpoint cache, missing chunk 404/no-store |
| Authenticated physical-device create/edit/retry | OPEN — no public production test content was written during this read-only smoke |

## Release and rollback principles

- Never “recover” from a missing production disk by creating a blank database.
- Never declare a backup usable from file existence alone; open it, run integrity,
  verify critical row counts, and prove the current off-host restore path.
- Never treat an ambiguous write response as failure or success without reading
  canonical server state.
- Keep immutable caching for real hashed assets, and `no-store` for missing ones.
- Do not use `npm audit fix --force`; it proposes incompatible Expo/React Native
  changes. Stay on the documented SDK 56 patch line unless a deliberate SDK
  upgrade is planned and device-tested.
- If a release gate fails, do not push `master`. Preserve the branch and record
  the failing command and first actionable error.
- Do not claim a staging rehearsal while the declared staging hostname returns
  `no-server`; either provision/test it or record that staging was skipped.

## Residual risks after this batch

1. The monolithic Store context still needs a measured provider/selector split;
   the comment-preview request fan-out is fixed.
2. SQLite remains appropriate only for the current single-instance operating
   model. Horizontal scaling requires managed shared state and distributed rate
   limits/queues.
3. Uploads still need server-side finalization, byte sniffing, derivative
   generation, metadata stripping, quarantine/moderation, and durable deletion
   before broad untrusted public uploads.
4. Background enrichment remains deliberately paused until it is re-enabled and
   observed one job at a time.
5. Real-device acceptance is still required for Android activity recreation,
   iOS permission behavior, poor-network publishing, and browser/hardware Back.
6. The Render staging service is unverified/unprovisioned at its declared
   hostname, and private off-host backup credentials plus a current restore proof
   remain external operating actions.
