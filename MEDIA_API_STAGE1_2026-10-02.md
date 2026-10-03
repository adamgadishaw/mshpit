# Media API stage 1: local activation fixes

Base: fd8b1d09b3755b1d4cdcc01b7b3abc6a518914d4.
Branch: codex/catalog-api-pilot-20261002.

This is a local review deliverable. The production Media API remains off.
No configuration, permission, credential, deployment, or live-data operation
was performed. Catalog endpoints, queue work, MCP/OAuth, video/audio and the
other remediation branches are outside this change.

## Changes

- Bearer writes charge atomic IP, issuing-owner and grant rate buckets.
  A cookie no longer selects the write quota. Failed bearer authentication
  has a separate bounded IP budget; owner pairing/revoke and exchange retain
  their existing numeric limits. Buckets remain process-local, consistent
  with the existing single-process limiter.
- A completed media-create receipt can renew an expired upload ticket through
  the existing owned-asset adapter. The asset, private source object, payload
  hash, receipt creation time and 72-hour expiry are retained. Renewal and its
  assistant audit are transactional. The create-only PUT contract is preserved.
  An already-ready asset returns no upload capability. Client IDs use the
  same whitespace normalization as the original create.
- The bounded receipt ceiling is 512 KiB, accommodating the existing
  60,000 UTF-16-code-unit article contract with ordinary source/photo metadata.
  Article character limits, request-body limits and generated-story quotas
  have not changed. Oversized internal responses still fail inside the
  transaction; they cannot leave a partial article publication.
- Each idempotency reservation gets a fresh nonce. Completion requires its
  current nonce and unexpired lease; cleanup deletes only that nonce's pending
  reservation. Finalization checks the lease before its durable commit.

## Migration and compatibility

The existing boot-time Media API schema initializer adds nullable
`media_api_idempotency.lease_nonce` when absent. It does not rebuild the
receipt table or rewrite existing timestamps, payload hashes, responses or
grant scopes. Existing completed receipts remain replayable. Legacy pending
reservations keep their original 15-minute lease and receive a nonce only
when taken over after expiry.

The migration is idempotent and additive. An older binary can read the added
column but cannot enforce nonce fencing; do not overlap old and new writers
or describe a binary rollback as preserving the new fence. No new scopes,
endpoints or activation defaults are introduced.

## Validation

- Focused service and local HTTP tests cover the real server dispatcher,
  authenticated cookie changes, simultaneous requests from different loopback
  source addresses, and multiple grants belonging to one owner.
- Real media creation and signed-ticket renewal use synthetic storage settings;
  no storage request is sent. Tests preserve receipt/asset identity, reject
  payload conflicts and revoked grants, and inject an audit failure to verify
  receipt and ledger rollback.
- Real editor/SQLite/HTTP tests save and publish a 60,000-character multilingual
  article, verify exact replay, and prove audit failure leaves no new draft
  or receipt. Outbound fetches are blocked and counted.
- Two HTTP workers with separate SQLite connections use a controlled deferred
  finalizer to exercise lease takeover. Stale success, stale failure, late
  success after replacement completion, and expiry without takeover cannot
  invoke an old durable commit or remove the replacement receipt. These are
  coordination tests, not real object-storage concurrency acceptance.
- Migration tests preserve completed and pending legacy receipt contents and
  verify that existing grant scopes are unchanged.

Independent Astra review found two regressions and verified their corrections:
an accepted whitespace-padded client ID could fail replay, and a shared media
finalization callback could capture the first caller's nonce and reject a
second valid key. Real-adapter tests now cover both. Each caller fences its
own lease in the outer transaction before invoking the shared commit closure.

The independent final review found no remaining blocking findings and
independently ran all 33 focused tests successfully.

- Focused suite: 33 passed, zero failed.
- Syntax: 809 Node files passed. Architecture, Blueprint and diff checks passed.
- Web production export passed: 521,916 / 524,288 bytes initial JavaScript gzip.
- The aggregate `npm run check` passed its test phase but stopped at the
  unavailable npm advisory endpoint. Dependency advisories remain unverified.
- Final full suite: 5,940 passed, zero failed, one Windows symlink skip.

## Remaining boundaries

The aggregate check's dependency audit requires the npm advisory service.
Source URL normalization has no URL-length bound: unusually large, expanded
URLs can still exceed the response ceiling and fail with a rolled-back write.
The receipt change resolves normal maximum-length multilingual articles;
it does not establish that every possible metadata payload fits.
No live endpoint, bucket policy, production migration, or real upload delivery
was tested. Activation and persistent connector access require separate
action-time approval. The eventual catalog pilot remains a dry-run plan.
