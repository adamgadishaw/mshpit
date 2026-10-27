# Artist provider reliability follow-up — 2026-10-26

## Scope and source

This local candidate implements three gaps reproduced by an independent offline
review. Branch `fix/artist-provider-reliability-20261026` starts at
`60ff9d3445144137fc619be4347ffd4291a1f86a`, the deployed navigation and diagnostics
base identified by the owner. Remote master was checked against that commit and
was identical when the implementation started. Draft search PR74 is excluded.
No production, credentials, dependency versions, CI, security settings, provider
quota policy or schema was changed. No commit, push, PR, merge or deploy occurred.

The owned checkout is
`C:/Users/Adam Gadishaw/Documents/Codex/2026-10-26/task-3/mshpit-reliability-fix`.
Its sibling `evidence/` preserves the original 140-test review, failure
reproductions, observations and hashes; `implementation-evidence/` holds the
implementation runs and final checkpoint. Dependencies were independently copied
into this checkout, without changing the other task's checkout or installing
packages. The protected original checkout was not accessed.

## Reproduced gaps and changes

### MusicBrainz timeout health

Previously, the artist fetch had an eight-second inner timeout inside a
six-second shared job. A genuine active transport stall consequently ended as
an aborted caller before the inner timeout could contribute to breaker health.
Two such fake transport stalls left consecutive failures at zero. Two explicit
503 replies opened the existing breaker, establishing the control case.

`server/api.js` now gives an admitted fetch and its response body a five-second
active budget, starting after queue and pacing admission. The six-second total
lookup deadline is unchanged. An inner deadline becomes `provider_timeout` and
is counted once by the existing throttle. A parent signal still takes precedence,
so caller abandonment and queue expiry cannot count as provider failures.
No throttle threshold, admission limit, pacing, retry or durable cooldown rule
was changed.

The route-level regression coalesces eight remaining subscribers plus one
departing caller into one physical stalled fetch. That failure counts once;
a second stalled response body opens the breaker; a third distinct name makes
no MusicBrainz request. Separate cancellation and queue-expiry cases count zero.

Tradeoff: an otherwise successful response taking five to six seconds now times
out earlier. If queue time leaves less than five seconds for an active attempt,
the outer deadline still wins and the shortened attempt does not count against
provider health. This is a conservative health sample, not a claim that every
in-flight outer deadline diagnoses a provider fault. Fake-provider tests cannot
measure the real provider latency distribution.

### Shared Deezer Retry-After

Previously, per-name resolver failure memoization suppressed repeats of that
name but did not stop distinct names, artist candidates or track callers during
the same provider-specified wait. The original fixture made five physical calls
during `Retry-After: 120` after MusicBrainz was unavailable.

`server/deezerRequestCooldown.js` adds constant-size process-local state around
all Deezer calls through `providerJson` in `server/musicProviders.js`. Only an
actual 429 or 503 provider response with a valid future Retry-After deadline
establishes a shared wait; existing parsing and its 24-hour ceiling remain.
Names, endpoint paths and injected transports share the same wait. Expiry admits
one recovery probe; competitors receive the existing typed provider-unavailable
error. No automatic retry, speculative quota, new queue or blanket admission
limit is added. Existing cache hits can still return before outbound work.

A newer refusal cannot be erased by an older successful probe. Concurrent
refusals preserve the latest deadline. Cancellation before dispatch makes no
request; cancellation does not erase a concrete refusal already received.
An abandoned or failed recovery probe releases its slot without announcing
recovery; a later deliberate request can try again. No delay is invented when
a provider gives no valid hint.

Regressions use fake time and providers across resolver names, candidate and
track endpoints, including competing probes, late replies, malformed hints,
frozen errors and cancellation. The integration test observes one initial
refusal and no additional Deezer dispatches before expiry, then one probe.
The pre-existing two-hour Retry-After replay test retains its assertions but
lives in its own test process so its shared wait cannot poison healthy fixtures.

Independent review found a P2 defect in the first implementation: JSON decoding
completed the recovery probe before the candidate endpoint validated its schema
and identities. Four reproduced malformed directories each let eight subsequent
requests dispatch. `providerJson` now accepts a projection callback inside the
guarded request; the existing candidate validation and projection execute there,
before recovery is declared. Invalid directories keep the probe requirement;
valid empty directories restore ordinary admission. The new integration tests
also keep asynchronous projection exclusive and verify that cancellation during
projection does not announce recovery. This revision changes only
`server/musicProviders.js` in application code, adds
`server/deezerRecoveryValidation.test.mjs`, and updates these notes.

Limitations: calls already dispatched when the refusal arrives can finish;
this is not a total provider-concurrency limit. State and probe coordination
are local to this Node process and reset on restart. Multi-process coordination
is future work, not an established cause of the single-service incident.

### Complete Unicode identity validation

Previously, server `clean(name, { max: 120 })` truncated UTF-16 units before
identity resolution. An overlong ASCII request could select a stored 120-unit
prefix, and a valid 61-astral-character name could select its 60-character
prefix. Client code-point validation did not protect direct API callers.

`src/domain/artistNameInput.mjs` now validates the full trimmed input as at most
120 Unicode code points with no unpaired surrogates, then applies the established
whitespace/control normalization without truncation. It is used by resolve and
candidate routes, attachment, identity projection and the client artist API.
Invalid names fail validation before catalogue/provider lookup. Valid complete
Unicode names survive provider projection and durable fallback caching.

The existing bounded catalogue suggestion prefix remains a search prefix; it
cannot end with a broken surrogate. Provider fallback and catalogue refresh use
the full validated identity. Remote suggestion cache keys include that complete
identity so two names with the same search prefix cannot share a fallback.
This does not alter search ranking or import the draft search work.

The regression suite covers ASCII overflow, 61/120 astral code points, mixed
scripts, surrogate boundaries, prefix collisions, full fallback/cache identity,
attachment and exact refresh comparison. The limit is code points rather than
user-perceived grapheme clusters. Invalid historical truncated records are not
renamed or migrated by this patch.
Independent review also confirmed that unmodified downstream consumers, including
the discography route, still use historical UTF-16 truncation. This patch repairs
the specified resolution, candidate, attachment and client identity paths; it is
not an end-to-end migration of every artist-name consumer.

## Validation

Node 24.16.0 / npm 11.13.0, in the owned checkout:

- Final default full suite: 7,026 passed, zero failed/cancelled, one skipped, from
  7,027 tests. The skip is the existing Windows file-symlink permission case.
- Final hosted-settings full suite: the same 7,026 passes and one skip, with
  `NODE_ENV=production PIT_ENV=production RENDER=true CACHE_WARM_ENABLED=false
  TOURDATE_REFRESH_ENABLED=true EMAIL_CAMPAIGN_RECOVERY_ENABLED=false
  PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true npm test`. The repository test runner still
  strips the hosted runtime marker and mail credentials and owns temporary data.
- `npm run check:dependencies`: passed, zero production vulnerabilities. The
  first sandboxed attempt returned registry `EACCES`; approved read-only registry
  access completed the same audit. No audit fix or package change was used.
- `npm run check:blueprint`: passed; this is local schema/reference validation,
  not live Render synchronization or secret-presence validation.
- `npm run check:syntax`: passed on the final revision, 915 files. `npm run check:architecture` and
  `git diff --check` passed.
- `npm run build:web`: passed on the final revision, including the Expo export
  and bundle checks. Initial gzip JavaScript is 518,492 bytes (506.3 KiB) against
  524,288 bytes (512 KiB); paused-player UI checks also pass. Output stays ignored.
- Focused validation before the full suites: 217 passed, followed by 22 identity
  tests after the adjacent client repair (219 unique cases across those runs),
  then all three song-search cancellation tests passed.

The P2 regression failed all four malformed-payload cases before correction
(eight requests dispatched instead of one). The affected provider/cancellation
suite after correction passes all 93 tests, with no failures or skips. The final
default and hosted full suites both pass as recorded above.

Aggregate execution has an environment split: ordinary sandbox execution passes
Git privacy inspection but cannot access the npm audit registry (`EACCES`).
Elevated execution allows that audit, but `git ls-files` refuses this sandbox-owned
checkout as dubious ownership, so two privacy tests fail. The elevated aggregate
had 7,019 passes, two failures and one skip before the P2 revision. Those tests are
not removed or bypassed, and no ownership or `safe.directory` setting is changed.
Individual audit and ordinary privacy checks remain separately reported;
an uninterrupted aggregate pass is not claimed.

Retained failed runs are not substituted or erased. The first focused run had
32 passes, four failures and one cancellation; fixture corrections isolated the
long provider wait and waited for shared subscribers before cancelling. The first
full suite had 7,019 passes, one failure and one skip: the existing song-search
test cancelled before dispatch but asserted that two fetches started anyway.
It now waits for both active fetches and retains the two-fetch and abort
assertions. A separate regression proves immediate cancellation dispatches zero
fetches. The later independent P2 correction is the only application change
after the initial stable review snapshot.

### Follow-up after independent discography recheck

The candidate repair passed independent recheck, which then reproduced the same
boundary through `getDeezerDiscography -> findDeezerArtist`. The added regression
failed before this revision: the rejected artist directory let eight distinct
candidate requests dispatch. The revised guard now includes existing selection
and response processing at every current Deezer dispatch site, including
discography lists/details, previews, song search, recording proof, catalogue
enrichment and the photo/release-news adapters. The two adapters forward the
projection callback; their feature test fakes implement that contract without
removing assertions. Writes and cache mutations remain outside the guard.

The complete 13-site inventory and preserved normal-empty behavior are recorded
in `implementation-evidence/DEEZER_CALLER_AUDIT.txt`. Its 26 cross-caller cases
plus the six candidate/discography/async cases pass 32/32. This follow-up changes
`musicProviders.js`, `catalogSeed.js`, the two API adapters, the photo reader and
the release-news reader. It does not change discography name validation, matching
thresholds, provider quotas/retries or the cooldown state machine. The larger
full-suite counts above describe the prior revision. On this follow-up, default
and hosted suites each pass 7,053 tests with zero failures and one existing
Windows symlink skip (7,054 total). Syntax (916 files), architecture, Blueprint,
web export/bundle (506.3/512 KiB) and the separate zero-vulnerability production
audit pass. The aggregate still fails at sandboxed registry access; no combined
pass is inferred. Exact commands, retained failures and the new 25-file manifest
are recorded in `implementation-evidence/ALL_CALLERS_CHECKPOINT.txt`. Independent
recheck of this final composition remains pending.

Browser CI suites are unrun here: the copied dependencies do not include the
separately installed Playwright runtime. Native device tests and live provider
acceptance are also unrun. This is local implementation evidence, not a claim
that remote CI, browser acceptance or a release has completed. Exact commands,
logs and source hashes are in `implementation-evidence/FINAL_CHECKPOINT.txt`.

Tests use temporary databases, fake providers and loopback fixtures. A preload
in the evidence directory rejects external provider fetches/sockets; only the
public npm registry is allowed for the required dependency audit. The preload
is not an application or CI change. No live provider stress or load test ran.

The original 140-test review remains unchanged and is not represented as a
post-patch acceptance suite: some of its experiments deliberately assert the
old defects. New regression tests establish corrected behavior; existing
coalescing, bounded admission/cache, cancellation, pacing, visibility and event
availability coverage remains in the full suite.

## Interpretation and release requirements

Production evidence of 31 distinct IPs each loading an event page, multiple
application bundles and one artist lookup suggests automated JavaScript clients;
it does not identify their operator. Incoming lookup rate is not provider
dispatch rate. Coalesced, cached, queued or circuit-rejected work can produce
different physical counts. A four-per-minute client peak does not prove an
outbound quota breach. These fixes address reproduced reliability gaps, without
claiming they explain every production error or the source of the traffic.

Official context: MusicBrainz documents IP-based pacing and load-related 503s
in its [rate-limiting policy](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
[RFC 9110 section 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)
defines Retry-After. No numerical Deezer quota is assumed.

Independent review remains required before any release decision, especially
the active timeout budget, shared cooldown races and identity boundary coverage.
No database migration or environment/configuration change is required. A future
release would need the server update and web bundle together; native distribution
and device acceptance are outside this local checkpoint. Rollback is a normal
code revert of this follow-up, retaining the navigation/diagnostics base, with
no data migration to undo. That rollback also restores the reproduced gaps.
