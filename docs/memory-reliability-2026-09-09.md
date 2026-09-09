# Memory and reliability repairs — September 9, 2026

## Incident and scope

The supplied Render alert confirms the web service exceeded its memory limit
and restarted. It does not identify the triggering request or prove traffic
was the sole cause. Live Render graphs could not be read because both browser
and desktop-control connections failed. No production load test was performed.

This change addresses concrete allocation and concurrency risks found in code.
It does not delete accounts, posts, venue/artist records, uploaded sources, or
change the paid hosting plan.

## Changes

- Shared admission checks container memory (including child/native allocations),
  with Node constrained-memory fallback, reservations, and a safety margin.
  Photo processing, share rendering, and sitemap rebuilding cannot overlap.
  Already-running provider work has a smaller reservation; new maintenance waits
  when interactive heavy work is active. Pending background callbacks are capped.
- Under pressure, uploads receive the established retryable response and retain
  their stored source. Cached share cards and the last valid sitemap still serve.
  Cancellation is no longer mislabeled as an invalid photo.
- PNG dimensions are checked before decompression. Isolated validation streams
  scanlines in small chunks rather than retaining an entire decoded image.
  The 50MP source ceiling and support for normal 48MP phone photos remain.
- Image queues hold at most two waiting inputs / 60 MiB. Aborted or expired
  waiters release their buffers. Worker reservations remain held until actual
  process close, including cancellation and timeout.
- Production share decoding/rendering now runs in a disposable child process,
  without storage/mail credentials. A 3.5-second hard deadline kills stuck native
  work; process close is required before memory admission is released.
  Input/output limits and artwork provenance checks remain enforced.
  Completed share-image cache is reduced from 48 to 24 MiB.
- Song search streams tracks from SQLite and retains only the requested top
  results; it no longer keeps a full-catalog song index. No catalog-count cutoff
  is introduced. Discover reads genre fields without hydrating photos/albums.
  Enrichment keeps identities and reads rich metadata one artist at a time.
- Sitemap rendering avoids retaining individual XML strings for every URL,
  validation iterates matches, and persistence writes bounded JSON chunks
  atomically. Low-memory rebuilds defer without replacing the valid snapshot.
- Aggregate memory readings are logged once per minute with active work kinds.
  Logs contain no account identifiers, request contents, credentials, or media.
  Diagnostic failures cannot crash the server.
- Test files run sequentially by default on constrained hosts up to 4 GiB;
  real memory checks stay enabled. This reduces build-time container pressure.

Admission is proactive backpressure, not an OS-enforced RSS limit or a proof
that every possible future allocation fits. It cannot reclaim memory held by
unrelated processes. Production memory/request graphs remain required after
deployment to confirm whether additional changes or capacity are necessary.

## Local benchmark

Two refresh/validation/atomic-persistence cycles with identical selected
datasets: 59,289 URLs (including 50,000 events), eight shards.
The old and new XML SHA-256 hashes were identical.

| Measurement | Before | After |
| --- | ---: | ---: |
| Peak RSS | 421.2 MiB | 323.1 MiB |
| Elapsed | 1.333 s | 1.347 s |

This is a 98 MiB / approximately 23% reduction in the local synthetic pipeline.
The benchmark excludes SQLite hydration and eligibility selection; it does
not reproduce the production incident or measure total production memory.
Evidence: `.tmp/sitemap-memory-benchmark-results.json`.

## Verification

Focused suites cover container/nested-cgroup accounting, exhausted budgets,
idempotent release, queue recovery, real worker termination, 48MP PNG validation,
source privacy, cancellation, unchanged song ranking/Spotify proof, and sitemap
content equivalence.

Final integrated `npm run check` passed on September 9, 2026:

- 3,919 tests passed; zero failed.
- Production dependency audit reported zero vulnerabilities.
- Syntax check passed for 547 Node files; architecture check passed.
- Production web export passed; initial JavaScript remains 493.0 KiB gzip
  against the 512.0 KiB budget.
- Whitespace review passed.

The final run includes the corrected cancellation-test setup and the real
noncooperative share-worker termination regression. Test setup initially placed
a new case before remaining top-level imports, allowing the test database's
cleanup hook to run early; the case was moved after setup, then both the
28-test upload suite and the full integrated suite passed.
Log: `.tmp/memory-reliability-final-check.log`.

## Release checks

After deployment, confirm `[memory]` logs report the expected service limit,
observe one upload and Going-share generation, and compare memory/request
graphs through at least one sitemap/provider cycle. A successful local test
does not establish production recovery. The existing venue/city SEO repairs
are included in the working tree and require Google recrawling after release.
