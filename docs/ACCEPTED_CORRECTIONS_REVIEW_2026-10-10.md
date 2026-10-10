# Accepted corrections only - release review, 2026-10-10

## Scope and source

Base commit: `ceab0d50b82c6a9fa88e13e8f79c7e2462948114` (PR 39).
Base tree: `3ef3786adb2635e359abd91d59645b6b273a57b0`.
Branch: `review/privacy-diagnostics-alerts`.

This candidate contains only the existing public event visibility predicate
correction, bounded resolver diagnostics and alert scheduler wake-up correction.
It was assembled from the reviewed diagnostics/alert patch and event-visibility
patch on the release base, rather than subtracting features from the larger
experimental composition. No admission scheduler, member capacity reservation,
new overload error mapping or candidate-provider admission change is included.
The failed hardening experiment and all prior evidence are preserved separately.

The privacy correction blocks known-ID public snapshots of restricted member
events while preserving provider events and authorized private calendar reads.
Diagnostics add fixed categories, capped durations and bounded staff summaries
without raw names, query text or identities. Alert scheduling restores a single
cooldown wake-up while preserving eligibility, successful-send checkpoints,
frozen batches, idempotency, shutdown and the existing failed-send policy.

## Validation

Fresh validation on this accepted-only composition completed:

- Default suite: **6214 passed, 0 failed, 1 skipped** (6215 total).
- Hosted-flag suite: **6214 passed, 0 failed, 1 skipped** (6215 total).
- Independent scope and focused regression review: **142 passed, zero failures
  or skips**. The 19 source/test files match the accepted reference blobs; all
  14 abuse-only paths remain baseline-equivalent or absent.
- Blueprint, syntax (836 Node files), architecture and production web export
  passed. Web entry: 523933 gzip bytes / 524288-byte budget
  (355 bytes headroom). Offline Expo dependency alignment passed using
  installed metadata, without claiming a current remote compatibility check.

The single full-suite skip is the existing dangling-file-symlink restore case:
this Windows host does not permit file symlinks. Both suites used two workers,
fresh synthetic databases and a strict loopback-only guard. The hosted command
supplied production/Render flags; the existing repository runner normalizes
NODE_ENV and removes RENDER/mail credentials in its test children.

The literal `npm run check` passed its test phase, then exited 1 because its
guard blocked the npm registry audit. That native wrapper result is preserved;
it is not reported as a successful aggregate command. The static/build checks
were run separately on the same runtime snapshot. Final edits changed only
documentation, with separate status regression and diff verification.

The sandboxed fresh audit could not contact the npm registry. Automatic
approval review rejected the elevated request because dependency metadata would
leave the private project without destination-specific approval. No workaround
or unauthorized retry was used. The earlier production audit at
2026-10-10T09:02:40.8993293Z passed with zero vulnerabilities against the exact same
lockfile (SHA-256 32cfb10f2e6d6d75312490ca350d1e71f081efc2311ea8c719aef21bb73b9b3e). This is prior evidence, not a fresh advisory
check; destination approval or a current CI audit remains a release gate.

The exact tree, base-relative patch, source hashes, native logs and portable
transfer verification are recorded in `accepted-only-manifest.json` in the
review archive. Earlier combined-tree test results are not substituted for
these fresh smaller-composition checks. No current cloud CI, browser,
production provider or live load test is claimed.

## Release boundary

The owner requested a reviewable portable artifact only. No source commit,
push, merge, deployment, restart, production test, migration, credentials or
settings change is authorized. Saved data, matching and provider deadlines are
unchanged. Publication remains a separate owner decision followed by applicable
exact-commit CI and deployment verification.
