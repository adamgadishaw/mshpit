# Media alert follow-up — September 9, 2026

## Evidence and scope

The reported digest names media creation/finalization 503s, share-card rendering
503s, and one artist-resolution 502. A later moderation screenshot shows windowed
totals above retained per-problem counts. Digest counts are unacknowledged
occurrences; moderation rows are retained totals. Those two counts alone cannot
establish that another failure happened between the screenshots.

Read-only production checks passed for public health, strict readiness, negotiated
video-publishing readiness, artist search, Discover, tour-date pagination, and the
discovery sidebar. This is point-in-time readiness evidence, not an authenticated
upload/share end-to-end test. Browser control failed before it could read Render.
The exact live commit and incident-time runtime state remain unverified.

## Confirmed recovery defect and fix

An anonymous storage privacy probe receiving HTTP 408, 429, or 5xx previously
reported `anonymous_access_not_denied`. That selected the five-minute interval
instead of the short recovery backoff used for transport failures.

The probe now distinguishes a temporary HTTP outage (`probe_http_unavailable`)
while keeping publishing closed until both privacy checks actually pass. Recovery
starts at two seconds and backs off to one minute. An observed `Retry-After` can
extend that delay, including when the peer probe fails; delays cannot overflow
Node's timer range. A definite unexpected anonymous response takes precedence
over a temporary failure on the other check. Healthy recovery clears old delays.

This defect is reproduced in tests. It is not proven to be the cause of the
specific screenshot incidents without their timestamped production logs.

## Diagnostic improvements

- Moderation labels retained counts separately from hourly-window totals.
- Error routes and causes wrap instead of being truncated on mobile.
- Last-occurrence UTC timestamps and selectable request IDs are visible.
- The already-fetched current release is shown explicitly as current, not as the
  release at the time of an older failure.
- New email batches freeze the last-occurrence timestamp with the request ID.
  Existing pending batches retain their original rendered content and retry key.
- Error access remains admin-only. No user content, credentials, bucket names,
  signed URLs, or new raw exception data were added to telemetry.

## Audit conclusions

Share worker/admission/client focused tests pass. An uncached share requires
384 MiB reserved headroom plus 192 MiB safety; it cannot run on a 512 MiB instance.
The repository specifies a 2 GiB service, but its live configuration was not
verified. No memory guard, photo requirement, or ownership check was weakened.

Artist resolution uses the local catalog before MusicBrainz. Its reported
`ProviderError/http_error` identifies an upstream non-success response, not an
established session or traffic fault. No provider behavior was changed here.

## Verification

- Full suite: 3,928 passing, zero failing.
- Focused real-photo tests cover interrupted transfers, generation changes,
  uncertain conditional writes, and authority changes before publication.
- Privacy regressions cover temporary HTTP failures, partial failures,
  Retry-After, fail-closed behavior, cancellation, and successful recovery.
- Alert regressions preserve durable checkpoints and byte-identical legacy
  pending sends across retries.
- These follow-up changes require commit/deployment before affecting production.
