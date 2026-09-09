# Upload storage recovery

## Incident evidence

The supplied overnight application log contains the previously reported request
`c271bd7f-8637-4fd4-8a8e-e087ed9447b4`. It records two scheduled privacy-check
failures (`probe_timeout`, `probe_failed`), six upload-preparation 503s in 1–4 ms,
three share-render 503s, and three media-finalization 503s with TypeError causes.
This is evidence of actual failed member requests, not merely readiness probes.
The excerpt does not identify Alex or contain per-line timestamps. It does not
establish CPU/memory overload or the underlying cause of outbound failures.

## Repairs

- Storage privacy checks remain fail-closed. A transient failed check now gets
  another check after two seconds, backing off to at most one check per minute
  while unavailable. Successful checks return to the normal five-minute cadence.
  Configuration/denial failures do not enter the fast retry loop.
- Probe deadlines settle independently of transport cooperation. Late responses
  cannot change readiness, shutdown cancels active checks, and response bodies
  are released. Recovery is explicitly logged.
- Upload preparation and owner reads retry temporary failures with the same
  deterministic upload identity, within a fixed attempt/time limit. Health reads
  recover similarly and negative capability caching is short. Cancellation and
  identity fences remain in place, and original-file PUTs are not blindly replayed.
- Finalization reconciles uncertain submissions with an owner-scoped read and
  can resume a temporarily failed job. Repeated failed reads stop rather than
  keeping a spinner indefinitely. Confirmed processing retains its longer budget.
- Server storage HEAD and generation-bound GET/body reads retry brief transport
  failures within their original deadline. Changed bytes, authorization failures,
  and invalid media never become retryable transport success. Conditional PUTs
  retain create-only semantics and exact-byte reconciliation.
- Share artwork retries the same approved image once, within the existing
  per-image and overall budgets. It does not substitute a blank image or change
  the design, source permissions, or attribution rules.
- Private operational logs identify bounded storage stages and failure categories
  without including signed URLs, credentials, response bodies, or member details.

## Verification and release boundary

Focused tests reproduce privacy failure/recovery, concurrent checks, ignored
cancellation, late responses, interrupted storage reads, uncertain writes,
same-identity retries, account changes, and photo-bearing share recovery.
The final integrated `npm run check` passed: 3,856 tests, zero known dependency
vulnerabilities, syntax checks for 537 Node files, architecture checks, and the
production web export. Initial JavaScript is 493.0 KiB gzip against a 512.0 KiB
budget. The verified entry is `index-a24aa692b0afdc78ba22fb6e1eb91997.js`.

The built-app Going share test passed at a 390px mobile viewport: an intentionally
non-cooperating request settles at the 15-second deadline, manual retry reaches
ready, the late first response cannot replace the result, and closing releases
both generated object URLs. No browser exceptions or client crash reports were
observed. This uses local fixtures and never publishes to a social account.

All 30 exported-app authentication browser scenarios passed with mocked API
responses, covering mobile/desktop login, logout, account switching, cancellation,
session expiry, offline recovery, and credential form boundaries.

The separate real-server/browser harness passed all nine checks on the same
build using a fresh temporary database, actual HttpOnly sessions, and a loopback
listener with external traffic blocked. Login, account switching, logout/replay
rejection, password reset/change revocation, and concurrent authenticated reads
for 5, 10, 50, and 100 accounts passed without browser crashes. This establishes
local correctness, not Render capacity. The temporary database was removed and
the fixture server stopped after the run.

No production data, hosting settings, storage permissions, quota, or backup
credentials were changed. These repairs cannot make an unavailable provider
healthy; they shorten recovery and keep retry/cancellation safe. The separate
off-host backup warning and provider catalog failures remain operational follow-up
items. Deployment and a live upload check are still required to verify production.
