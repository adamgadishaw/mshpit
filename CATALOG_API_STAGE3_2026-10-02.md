# Catalog pilot stage 3: offline review deliverable

Branch: `codex/catalog-api-pilot-20261002`.
Parent: `3cd40779da5cf5506f9255588b5fdef50174d1de` (stage 2).
Stage 1 remains `f4c375baaca26a9841119ccc329b6c6202b0dfb4`.

This stage adds local pilot inspection to the existing Catalog upkeep panel and
an offline CLI. It does not connect an assistant, issue credentials, claim work,
approve proposals, commit catalog findings, call providers or activate either
catalog API flag. No push, merge or deployment is authorized. The parent's
release hold remains in force, including PR 19; this local commit is not evidence
of a production release. Production was last reported as `fd8b1d09` and was not
queried in this stage.

## Local review and identity

The existing authenticated maintenance status response includes `localPilot`
metadata. Review visibility requires the current verified, unrestricted admin
to match the durable version-2 locked Owner identity. Other administrators keep
their existing upkeep panel without pilot controls. There is no new endpoint or
private-user query. The owner identity comes from the existing `app_meta` marker
and authenticated request actor. The response remains private/no-store.

The pilot component loads lazily. Account changes, inactive tabs, permission loss
and unconfirmed status unmount it and discard the local preview. The owner can
copy an explicit JSON checkpoint before leaving and import it to resume. No
snapshot, report or credential is automatically persisted in browser storage.
Local pause/resume changes the preview only; the existing upkeep mode controls
retain their existing behavior.

The view shows inventory confidence, observed versus reported counts, type
selection, current/proposed findings, exact catalog keys and identity hashes,
submitted source/evidence provenance, actor attribution, conflicts, quarantine,
pause and revocation observations. Sources are selectable text; the preview does
not fetch them. An image remains a Commons file-page candidate, not an attached
photo. Event enrichment still needs a separately scoped public renderer.

## Offline CLI

```sh
# Synthetic fixture; full resumable report goes to stdout. No files are created.
node scripts/catalog-pilot-dry-run.mjs --batch 100

# Explicit local checkpoint; each invocation checks the next bounded batch.
node scripts/catalog-pilot-dry-run.mjs --checkpoint pilot.json
node scripts/catalog-pilot-dry-run.mjs --checkpoint pilot.json --batch 25
node scripts/catalog-pilot-dry-run.mjs --checkpoint pilot.json --pause
node scripts/catalog-pilot-dry-run.mjs --checkpoint pilot.json --resume

# An independently supplied, authorized catalog-only snapshot.
node scripts/catalog-pilot-dry-run.mjs --input authorized.json --authorized-snapshot --checkpoint reviewed-pilot.json

# Recheck the same selection against a newer observation from the same source.
node scripts/catalog-pilot-dry-run.mjs --checkpoint reviewed-pilot.json --input newer.json --authorized-snapshot --batch 0
```

`--limit` accepts 1–100 for a new selection. `--expected-revision` optionally
fences a command against an exact checkpoint revision. Resuming preserves the
original limit, keys, baseline values, identity hashes and proposal bytes. A
revoked/expired grant observation cannot become active again within the same
report. A different grant requires a new selection with new authority evidence.
Pause transitions require a newer control revision; an advanced control revision
also invalidates the old baseline. The evaluation watermark never moves backward,
so clock rollback cannot restore evidence already found stale.

The CLI accepts only explicit regular local files, bounded to 8 MiB, and rejects
unknown options and unknown JSON fields. It imports no application bootstrap,
database, network, credential or provider module. Input files are read through
bounded descriptors. Only a named checkpoint and its temporary/lock files are
written. An exclusive `.lock`, revision check, original-content check, fsync and
atomic rename protect cooperating writers and interrupted saves. An abandoned
lock is never automatically removed: inspect the prior process and checkpoint
before manually recovering it. This is local cooperative locking, not a defense
against a hostile process with filesystem write access.

## Snapshot and checkpoint contract

`syntheticPilotSnapshot()` is the executable example of the version-1 format in
`src/features/catalogMaintenance/catalogPilot.mjs`. An authorized input uses
`kind: "authorized-catalog-snapshot"` instead of `"synthetic"` and requires the
CLI's `--authorized-snapshot` acknowledgement. This acknowledgement confirms the
operator's permission to use the file; it is not a live grant or source signature.

Snapshots contain `sourceId`, `capturedAt`, `coverage` (`sample` or `complete`),
per-type `totals` (integer or null), `control` (paused, revision, grantStatus) and
at most 1,000 catalog records. Each record supplies type/key/name, revision,
value/identity hashes, explicit eligibility/protection/hidden flags, current
findings, optional proposal, and work status/revision/leaseUntil. Proposals
contain exact base bindings, an allowlisted enrichment patch, actor label and
submitted evidence (URL, title, accessedAt, evidenceHash). No users, tokens,
grant secrets, arbitrary provider fields or raw provider pages are accepted.
Venue address and event date/lineup/ticket/provider identity patches are excluded.

Selection sorts exact keys within each type and interleaves artist, venue and
event queues, up to 100 eligible records. Active leases are retained as visible
conflicts when checked, rather than being counted as successful observations.
A balanced fixture selects
34 artists, 33 venues and 33 events; a smaller or uneven snapshot uses only the
records it actually supplies. Protected, hidden and quarantined rows are excluded.
New claims, changed proposals/identity/value/revision, newly protected rows,
pause, revocation and stale evidence invalidate prior consistent observations.

Counters are derived from selected rows and validated observations, never from
an imported claimed success count. `consistent` means only that supplied snapshot
bindings and evidence references agree. It does **not** mean the proposal passes
the live semantic validator, the cited page was independently verified, a human
approved it, or the catalog page is complete. Reports explicitly expose
`liveProposalValidation: "not_performed"`, `humanApproval: "not_recorded"`, and
zero live claims/writes/provider calls. Checkpoints validate internal consistency;
they are unsigned local records, not cryptographic proof of server state.

Reported inventory totals are never described as verified live totals. A supplied
sample can report a 60,000-record inventory while exposing only its bounded
sample; no mass crawl or claim of 60,000 completed pages is made. This stage does
not ship a live snapshot exporter. An operator must provide an independently
authorized, appropriately filtered catalog snapshot for a real pilot review.

## Policy and rollout prerequisites

The first 100-record pilot is reviewable without performing live writes. The
stage-2 backend still requires approval of an exact immutable proposal before a
commit. This does not establish a permanent manual-click requirement for every
catalog page. A future narrowly bounded automatic-commit policy needs a separate
owner-approved design and activation decision; assistant review is never recorded
as human review.

Before any connected pilot: approve and implement the credential/transport setup
(none exists here), obtain a real authorized catalog snapshot, verify inventory
and eligibility against current data, and agree the pilot's commit/review policy.
Keep the API and commit flags off until activation is explicitly authorized.
Deployment must drain older research writers before new shared-lease writers run;
pause/drain before binary rollback as documented in stage 2. Do not overlap
writers that cannot enforce the new nonce/control generations. Image attachment,
event public rendering, MCP/OAuth and broader rollout remain separately scoped.

## Validation

The final full suite passed 6,000 tests with zero failures and one known Windows
symlink skip. All 42 focused tests passed. Syntax (821 Node files), architecture,
Render Blueprint and web export checks passed. The initial web bundle is
524,037 / 524,288 gzip bytes, leaving only 251 bytes of headroom.
All 12 browser scenarios passed at 390px and 1280px, covering the existing upkeep
actions/retries/access loss plus pilot review and non-owner exclusion. Pilot
scenarios confirmed zero live claims, writes and provider calls. Screenshots are
under ignored `.tmp/catalog-maintenance-browser/`.

The required `npm run check` reached the dependency audit after passing its
tests, then stopped because npm's advisory endpoint was unavailable. The later
checks were run separately and passed; dependency advisories remain unverified,
so the aggregate check is not fully green. No dependency versions were changed.

Evidence logs are under ignored `.tmp/stage3-validation/`. Browser fixtures run
only against a local static export, intercept application requests, and block
external traffic. The CLI subprocess test denies all network access and points
`PIT_DATA_DIR` at an immutable synthetic sentinel to catch accidental database
bootstrap. It proves no catalog/database/provider work for the exercised path.

Independent Astra review found and prompted fixes for revocation/clock rollback
rehabilitating an old preview and for overstated proposal-readiness language.
Final independent review passed all 42 focused tests plus eight revocation/expiry
revival variants and checkpoint restoration after clock rollback. No material
findings remain within the offline-only scope. This is readiness for a local
review commit, not connected-pilot or production readiness.
