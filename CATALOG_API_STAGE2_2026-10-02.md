# Catalog API stage 2: local review deliverable

Branch: `codex/catalog-api-pilot-20261002`.
Stage 1 parent: `f4c375baaca26a9841119ccc329b6c6202b0dfb4`.

This change adds the catalog backend and shared research coordination. Both
`PIT_CATALOG_API_ENABLED` and `PIT_CATALOG_API_COMMIT_ENABLED` default to false.
No production configuration, credentials, grants, activation, provider requests,
pilot writes, push, merge or deployment were performed. Stage 1 is unchanged.

## Contract

- Separate `api_grants` storage with the `pit-catalog-v1` audience. Existing
  Media API grants and pairing codes cannot authorize catalog work and are not
  migrated or expanded. Only an assistant actor is accepted. The issuing locked
  owner must remain a verified, active administrator. There is no grant-issuance
  endpoint, OAuth server, MCP transport or connector setup in this stage.
- Nine explicit scopes: `catalog:{artist|venue|event}:{read|propose|commit}`.
  Bearer credentials never become the session user. Authentication is checked
  at entry and again within each write transaction; commits also require the
  propose scope. Claim identity includes the grant's actor, owner, scopes and
  validity interval, so a changed grant cannot reuse its prior claim.
- `GET /api/catalog/v1/:type/inventory`, `/entities/:key`, `/status` and
  `/proposals/:id` provide bounded reads. Inventory uses a type-bound cursor
  with a unique catalog-key order, at most 50 rows per page. Status is restricted
  to the current grant and entity scope, with an exclusive `after` key. These
  are live keyset pages, not a frozen multi-request snapshot.
- `POST /api/catalog/v1/:type/entities/:key/{claim|renew|propose|commit|finish}`
  coordinates research. Claims require the observed revision, current-value hash
  and identity hash. Every later step requires the current nonce, unexpired
  lease, current grant, matching control generation and fresh eligible page.
  The exclusive `research` field group covers summary, facts and image candidates
  together; partial patches preserve unmodified fields.
- Proposals are bounded source-backed submissions. Their evidence records
  source URL, title, access time and evidence hash, labelled `submitted`.
  This records what the assistant supplied; it does not independently verify
  the page or claim. There are no URL fetches, model calls or provider adapters
  in the catalog API service.
- Owner-only backend routes read/review a proposal, pause/resume shared work,
  and revoke a catalog grant. Approval binds the exact immutable proposal hash.
  A commit needs that approval and the separate commit flag. The assistant
  cannot approve its own proposal. Review and pilot UI remain future work.
- Artist and venue results use existing `catalog_research` findings. Staff
  biography/genre markers, claimed/removed/identity-review profiles, existing
  biographies, hidden results and ambiguous venue bindings block claims and
  commits. Assistant attribution is stored in findings provenance and the
  append-only audit, separately from staff corrections and Claude work.
- Events write only `catalog_event_enrichment`. Provider event rows, dates,
  venue, lineup, ticket links, availability and source identity are read-only.
  No entity creation, deletion or merge endpoints exist. Event public rendering
  and attachment/licensing of image candidates are outside this stage.

## Durability and limits

Claims, proposals, reviewed commits, revisions, receipts and audits use
synchronous SQLite IMMEDIATE transactions. There is no awaited provider work
inside a catalog API write. An audit or receipt failure rolls back all database
effects of that operation. Idempotency keys are scoped to grant and operation;
payload conflicts return 409. Receipts persist for 72 hours, after which a key
may execute again. HTTP request IDs are generated per request and are not part
of the saved operation result.

Claude and assistants share one exclusive lease per entity. Leases last
20 minutes; assistant renewal cannot extend past 60 minutes from the claim.
There are at most two active leases, 100 new claims and 100 successful findings
commits per UTC day. Existing Claude dollar ceilings and paid-request admission
remain intact. Continuations and result publication recheck lease, protection,
identity and pause state. A stale result cannot publish or inflate the published
counter. Not-found/unsure completions do not count as findings commits.

Pause/resume increments a durable generation and preserves daily counters;
old claims remain invalid after resume. The existing catalog-maintenance pause
also applies. Mode-change/insert/delete triggers fence same-tick legacy control
changes; ordinary budget updates preserve active leases. Malformed legacy control
fails closed using the existing control parser. Revocation denies every subsequent operation, including receipt
replay, and releases that grant's active work leases in the same transaction.
Failed work has a one-hour retry delay; quarantined work requires operational
review and is excluded from automatic selection.

Output and storage ceilings are explicit: 50 rows per page, 20 KB proposal and
stored findings, 32 KiB receipts, 10,000 work rows, 10,000 proposals, 20,000 receipts
and 100,000 append-only audit rows. Cleanup removes at most 100 expired receipts,
old proposals or eligible 30-day terminal work rows per relevant operation.
Capacity exhaustion fails closed. Audit archival and quarantine resolution are
operator tasks; this stage does not add those interfaces. HTTP quotas additionally
charge IP, owner and grant buckets, using the existing process-local limiter.

Venue inventory and legacy selection use grouped catalog queries with bounded
pages, reusing the aggregate projection instead of scanning the entire event
table for every candidate. These queries still aggregate provider rows; no
production-scale latency or disk-growth acceptance is claimed.

## Migration and rollback

Boot-time initialization adds `api_grants`, `catalog_work_control`,
`catalog_work_items`, `catalog_entity_versions`, `catalog_proposals`,
`catalog_event_enrichment`, `catalog_api_receipts`, `catalog_work_audit`, their
indexes, append-only audit triggers and three legacy-control generation triggers
on `app_meta`. It changes no existing media-grant scope,
provider row, staff correction or credential. The new schema initializers are
idempotent and transactional. A failed initialization leaves no partial new
tables; initialization inside a caller's transaction respects its rollback.

Unexpired pre-queue `catalog_research` leases block new shared claims until
their original expiry. Deployment must still drain old research writers before
starting new ones: old binaries cannot enforce shared nonces, and a very late
old result could write after its original lease expires. An older binary can
coexist with the additive tables but cannot uphold these coordination guarantees.
For binary rollback, pause/drain catalog writers and leave the new tables intact;
do not overlap old and new workers or delete audit history. A production rollback
exercise has not been performed.

## Independent review and validation

Independent Astra review reproduced two material gaps and verified their fixes:

1. A blocked highest-priority subject could starve the Claude backlog. Artist
   selection now filters shared leases/backoff/quarantine and protected state
   before LIMIT. Venue selection skips protected or ambiguous candidates within
   the existing bounded traversal.
2. An unexpired old Claude lease had no shared queue row and could overlap a new
   assistant claim. The shared claim boundary now respects the old lease expiry.

Astra independently ran 66 focused tests with zero failures, including the final
grouped-venue-query and legacy-control changes, and reported no remaining blocking findings. The
only existing test fixture adjusted outside catalog modules was
`searchGrowthPriorities.test.mjs`: two synthetic shows at the same room now share
one provider venue ID, preserving the intended alternating-priority test while
retaining ambiguity protection.

Focused coverage includes the production HTTP dispatcher and schema, two competing
server processes, current owner/scope/actor checks, owner-only approval, disabled
exposure, replay across connections/restart, audit rollback, stale lease takeover,
protected fields, source validation, cursor completeness, scoped status, receipt
retention, migration rollback, legacy lease compatibility, same-tick pause/resume and Claude continuation
pause. Local HTTP fixtures block and count outbound fetches; the count was zero.
Provider behavior is simulated; no live Anthropic, storage or production endpoint
was used. Final repository-check results are recorded in `STATUS.md`.

- Final full suite with two test workers: 5,978 passed, zero failed, one Windows
  symlink skip. The preceding serial run passed 5,977 tests before the final
  legacy-control regression was added. The final focused run passed all 66,
  including invalid grant timestamps and maximum-length Unicode cursor replay.
- Syntax passed for 819 Node files. Architecture, Blueprint and diff checks passed.
- Web production export passed: initial JavaScript 521,916 / 524,288 gzip bytes.
- The initial aggregate run identified the venue-ID fixture mismatch described
  above. A later default-concurrency run hit a pre-existing startup race in
  `musicPlayerPausePolicy.test.mjs`: `databaseRecovery.js` queried a locked test
  database before the shared connection's busy timeout was configured. Its five
  tests passed separately, and the complete serial/two-worker reruns passed.
  No out-of-scope database-bootstrap change was made.
- The separate dependency check could not reach npm's advisory endpoint. The
  aggregate `npm run check` is not fully green; advisories remain unverified.
  No package or lockfile changes are included.

Readiness: local review and commit only. Production activation, credential setup,
MCP/OAuth, live pilot writes, review UI and event/image presentation remain separate
gates. Evidence quality still requires the owner's review of submitted sources.
