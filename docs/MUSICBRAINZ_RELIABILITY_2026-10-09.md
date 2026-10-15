# MusicBrainz reliability - 2026-10-09

## Scope and release state

Branch `fix/musicbrainz-reliability` contains the reviewed correction authorized
by the owner.
The owner authorized checks and release within existing access. Public remote
`master` was reconfirmed at `faa1b0cacb7e99810b50954c89524e0e57f132b8` and its
commit object was imported through a read-only public Git bundle. Its tree,
`9cde9b6e12b5aaac5e5133f270466078b2fb52ad`, exactly equals the reviewed local
base `9ae431b76349a441343e6c0e4456dd637d8118b1`. The release branch uses the real
remote commit as its parent; no runtime integration change was needed.

The connected GitHub account, `myentertainmenttoronto-source`, reports
`pull=true`, `push=false`. The authorized request to create this branch returned
HTTP 403, `Resource not accessible by integration`. Remote write attempts
stopped. No remote branch, draft PR, final-commit CI, merge or deployment is claimed.
No alternate identity, changed grant or security-setting exception was used.

The reviewed 52-file patch remains unchanged:

- Patch SHA-256:
  `0ceb353c5031e6966418218031c67f40331883493af78c8d240dc057f8af285a`.
- Candidate tree before these release notes:
  `ee887e8e63685ce2084fb2fed9e0749c7ec33cb5`.
- Review ZIP SHA-256:
  `b22e5361924b08335d09fd7c586f66bdbe5dc4e32268d4c5c92d3c4ebb657abf`.
- Library file: `libfile_11b1227e1fa4819185beb27253bb5ade`, version 0.

The release commit adds only `STATUS.md` and this dated audit to that reviewed
patch. The overload candidate, draft festival patch and Newsroom importer remain
separate and are not authorized for this release.

## Diagnosis and correction

An unresolved artist name still needs a safe canonical identity. If external
providers fail and neither exact cached identity nor a valid fallback is
available, HTTP 502 `PROVIDER_UNAVAILABLE` honestly represents that failure.
Treating provider unavailability as an empty successful result would hide it.
Exact stored catalog and stale exact MusicBrainz identities already resolve
before outbound work; new regressions verify both paths with network denied and
the database in query-only mode. Identity matching is not weakened.

The early October 9 evidence contains six resolver 502s at 03:04:44-03:05:32 UTC:
four network errors and two circuit-open errors. The retained 18:42:35 UTC Render
snapshot also records a 17:36:26 upstream-5xx resolver error associated in time
with an Alicia Villarreal lookup. It does not expose the exact upstream status or
nested network cause. Twenty-one morning request 502s lack matching application
errors and remain unattributed. A later resolver 200 can come from stored data,
cache or fallback; it does not establish MusicBrainz provider recovery or prove
all reported errors share one cause.

The correction extends existing safeguards rather than adding parallel ones:

- `server/musicBrainzCooldownStore.js`, `db.js` and
  `musicBrainzRequestThrottle.js` persist the shared absolute cooldown in the
  existing `app_meta` table, atomically preserve later deadlines, restore it
  before outbound admission and allow one recovery probe after expiry.
- `providerResponsePolicy.js`, `artistLookupWork.js`, `responseHeaders.js` and
  the catalog, genre and death-watch adapters preserve accurate remaining
  Retry-After timing, including long provider waits, replay and cancellation.
- `server/api.js` and `musicProviders.js` distinguish unavailable or malformed
  fallback responses from valid empty results without storing guessed identities.
- `src/lib/api.js`, retry helpers, `useCanonicalArtistIdentity.js`, affected
  artist screens, `App.js` and the public-navigation recovery feature preserve
  stored identity, existing content and input, expose manual retry/cancel and
  fence stale responses across navigation and account changes. Recovery timers
  update the display without starting automatic provider retries.

Existing catalog-first lookup, cache recovery, deadlines, single-flight, pacing
and circuit-breaking mechanisms remain. Public failures use existing catalogue
code `PIT-SVC-002`; no new public error code is introduced.

## Local validation and source accounting

Validation used temporary databases, mocked providers, loopback browser fixtures
and external-network instrumentation. No real provider or paid call was used.
The retained evidence directory is
`musicbrainz-investigation/implementation-validation` in the investigation
workspace; `final-evidence-manifest.json` records commands, times, source trees,
original failures and evidence hashes. It is review evidence, not a deployed
runtime file.

- Normal and hosted full suites each passed **6,158 of 6,159 tests**, with zero
  failures and the existing Windows file-symlink-permission skip, on tree
  `993c841f7e6faf5a5358faab2cd0459d744dae56`.
- A three-file architecture correction then injected the same existing helpers
  from `App.js`; the recovery function body was unchanged. All **2,737 client
  tests** passed and the web bundle was rebuilt on tree
  `1e265cb8abfe62f8c308aabdf5166a923716508d`.
- The only subsequent source change corrected obsolete browser-message
  expectations and checked manual retry availability. Its **10 fixture unit
  tests** and syntax check passed. Final candidate tree
  `ee887e8e63685ce2084fb2fed9e0749c7ec33cb5` has the same application runtime as
  the client/build checks and the same server subtree as both full-suite runs.
- All **16 browser suites** passed against that runtime: the first three before
  the browser-fixture correction, navigation and the remaining twelve afterward.
  The navigation rerun passed **67/67**. The earlier obsolete-copy assertion
  failures remain in the evidence.
- Blueprint, final architecture and syntax checks passed (832 Node files).
  The retained production dependency audit reports zero vulnerabilities.
  The final standalone web-bundle check captured exit 0: **523,936 / 524,288
  gzip bytes**, leaving **352 bytes** of headroom with the budget unchanged.
- The build log and artifacts establish completed export, but its terminal
  session expired before a final process exit status was captured. The audit's
  zero-vulnerability output is retained; its original numeric process status
  was not separately saved. Neither is represented as a captured exit code.
- The installed Expo CLI's `install --check` passed in offline check-only mode
  during release preparation. Expo warns that offline dependency validation is
  less reliable; this confirms alignment with installed metadata, not a fresh
  online SDK compatibility lookup. No installation or dependency fix was run.

Regression coverage includes shared cooldown and restart recovery, storage
failure, cancellation, late longer deadlines, immutable provider errors,
decreasing Retry-After on replay, valid-empty versus unavailable fallback,
malformed identities without writes, exact stored/stale identity preservation,
failed hedge with successful primary, and client account/navigation/retry races.
Independent source and evidence review found no remaining source blocker.

These are component and affected-change checks, not a claim that one aggregate
`npm run check` process passed on the final release commit. Only documentation
and commit ancestry changed during release preparation; the reviewed runtime is
unchanged. Exact final-commit cloud Quality checks remain a release gate, as does
the repository-required check after any merge. All three documentation status
tests and the staged whitespace check passed before the local commit.

## Data and deployment

No schema migration or saved-data rewrite is needed. Persistence uses only the
existing `app_meta` cooldown key; importing the module does not write at startup.
No dependency, credential, production environment, budget or security setting is
changed. The existing verified-snapshot startup gate remains in force.

Limits remain explicit: pacing is process-local, and a persistence write failure
retains the original error and local cooldown but cannot guarantee cooldown
survival across a restart. Offline tests do not establish provider health or
attribute every production 502.

## Remaining release proof

An authorized repository writer must publish the local commit on the separate
branch and create a draft PR against `master`. Confirm its full remote SHA and
both Quality jobs (`test-and-build` and `browser-regressions`) on that exact head;
inspect the actual branch protection requirements rather than inferring them
from workflow names. Do not ready or merge until required checks pass.

After an authorized merge and successful checks, verify the Render deployment's
full commit matches the actual merged remote commit. The Blueprint's existing
`checksPass` auto-deploy setting alone does not prove a deployment happened.
Bounded verification consists of health/readiness, one Discover overview, one
catalog artist search and resolution of the exact returned stored artist key,
plus bounded logs. A successful stored-catalog response is not evidence of
MusicBrainz recovery. Production load tests, ingestion, broad security mutation
tests, provider retries, migrations, restarts and paid calls are outside this
verification scope.
