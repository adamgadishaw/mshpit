# September 14 daily health readout

## Evidence and open incident

The supplied email was generated at `2026-09-14T13:01:18.548Z`, on release
`1abcf10e1000`. It reported seven serious occurrences across three grouped
patterns in its hourly-bucketed last-24-hour window. The screenshots contain
neither the three route/code pairs nor their latest occurrence times. They
do not establish whether those faults were uploads, rendering, providers,
capacity, or sessions. The incidents remain unidentified until their ledger
rows or correlated application logs are available.

The email also reports a verified local backup about 19 hours old and no
configured private off-host backup destination. Database readiness, media
configuration and cleanup counters are positive evidence for those checks
only; they do not prove successful user uploads or external availability.

Authenticated browser access failed during this investigation before any
Render or moderation page could be read. No production database, storage,
credentials or hosting configuration was accessed or modified. No real
emails or backup uploads were triggered.

A read-only search of the connected inbox found no matching September 12-14
error alerts or health readouts. An older readout does not identify this
incident's three patterns and was not treated as substitute evidence.

## Reproduced defects and changes

### 1. Identify the faults without confusing historical counts

The daily readout formerly gave totals alone. Moderation returned retained
pattern counts but rendered only its first eight rows. It also described
release details as unrecorded even though a companion diagnostic table existed.

The readout and moderation now share a bounded query for serious occurrences,
with an explicit window, up to eight ranked patterns, and an omitted count.
Later-hour buckets are excluded. Retained totals remain separate. Hourly
storage cannot separate events within a historical boundary hour, so times
are explicitly approximate and cannot reconstruct an exact past snapshot.

Email metadata permits only known route literals, codes, methods and validated
fingerprints. Unknown values are withheld, not copied from arbitrary paths.
Unavailable telemetry is not represented as a clean health result. Moderation
can expand all 50 returned retained rows. The locked Owner alone receives
bounded, redacted diagnostic captures and their capture times; ordinary
administrators retain only their existing error summary access.

### 2. Preserve asynchronous upload failure evidence

Detached video-finalization failures recorded their general error category
but discarded the original exception and initiating request ID. They now
preserve both through the existing redacted companion ledger. Joined requests
cannot overwrite the original job's request ID. Public polling still returns
only the stable code, status, message and retryability fields.

Regression coverage exercises a real finalization route with a mocked storage
503, joined requests, mutable request context, owner cancellation and caller
disconnect. A cancelled draft's late storage failure is not counted as an
application fault. Diagnostic captures also now replace location and reason
together, preventing an old source location from being attributed to a newer
release. A later occurrence without diagnostic data keeps the old capture and
its original timestamp rather than pretending it was captured again.

### 3. Keep owner diagnostics tied to the current account

Moderation's error read depended on the admin boolean rather than account
identity. Two admin accounts could therefore see stale diagnostics from the
previous account after switching. Reads and rendered state are now bound to
the active staff identity, including account A-to-B-to-A transitions. Old
requests are aborted or ignored, and concurrent loads are ordered.

### 4. Repair backup scheduling without inventing remote protection

A recent local snapshot no longer prevents an initial configured off-host
backup or recovery from missing, invalid or stale upload evidence. If a
confirmed upload succeeds but writing its receipt fails, the existing bounded
retry can write one retained receipt without uploading again. Process restart
loses that in-memory evidence and requires a fresh confirmation.

The regular daily timer could skip an entire day because it fired slightly
before a snapshot's 24-hour completion age. A bounded completion grace fixes
that phase mismatch while preserving the daily timer, single-flight behavior,
memory admission and one recovery retry. The default grace is 40 minutes,
capped at 90 minutes and one-sixteenth of the configured cadence.

This does not configure off-host storage. That requires a separately scoped
private destination and credentials. Local snapshots are not off-host copies;
an upload receipt proves a past upload, not present remote existence or a
successful restore. Private storage validation and an isolated restore drill
remain operational requirements.

## Follow-up evidence needed

1. Obtain the three serious patterns' route, code, fingerprint, latest time,
   request ID and available Owner-only captured details.
2. Correlate them with the matching release and server logs, then reproduce and
   patch each confirmed cause. Do not classify these reporting fixes as the
   resolution of unidentified production failures.
3. Configure and verify the approved private off-host backup destination.
4. Confirm the resulting commit completes CI and becomes the live release;
   then check actual recurrence rather than interpreting old retained totals
   as either new faults or proof of resolution.

## Local release verification

- Complete quality gate: 4,591 tests passed, no failures or skipped tests;
  dependency audit reported zero vulnerabilities; syntax, architecture,
  production web export and bundle budget passed.
- Hosted-build environment parity: the same 4,591 tests passed with the
  Render runtime flags; the runner still uses isolated temporary data.
- Exported-app browser suite: 52/52 passed, including mobile and desktop
  diagnostics, expansion to ten rows, viewport bounds, and clearing Owner
  details after an account switch.
- Actual loopback server and browser: 12/12 passed, including cookie rotation,
  logout replay denial, password recovery and concurrent authenticated reads.
- Tested browser entry: `index-76e6cbe3825446a60f49d767f69d471b.js`.

These are local correctness results, not a production load test or proof that
the three unidentified incidents have stopped. Release CI and deployment
results are reported separately after push.
