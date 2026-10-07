# Artist research scope and provider event text repair — 2026-10-07

## Scope and release state

Branch `codex/artist-research-event-repair-20261007` starts at released master
`a056e64d13ab6185f4b91965060fc492fb110326`. The owner authorized implementation,
testing, review, PR/cloud checks, merge and deployment. Final-commit cloud checks
and production verification remain release gates; this document is not evidence
of a completed deployment.

PR 33 (`codex/event-identity-20261005`, `f6629179576575111d9916f6be716e0eecdf5122`)
remains a separate open draft. Its exact-provider-venue identity and cancelled
recommendation changes are not included here. Its checkout was clean on inspection.
Other pending review, video, completion, geo and infrastructure work is untouched.

## Research behavior and budget

The research pass formerly alternated artist and venue subjects, including a
venue fallback when no artist was due. It now selects artists only, retains the
artist priority/regular queue rotation, and returns `nothing_due` for an empty
artist queue. The explicit research-disabled gate also applies to direct passes.
The saved legacy venue turn and historical venue findings remain intact. Existing
claim leases, pause controls, eligibility, reservations, continuation admission,
spend receipts, retry limits and publication validation are unchanged.

The Blueprint restores only the approved cap values from `a7d4890`:

- `ANTHROPIC_MONTHLY_USD=10` (shared news and research allowance).
- `CATALOG_RESEARCH_MONTHLY_USD=10`.
- `CATALOG_RESEARCH_DAILY_USD=0.30` (unchanged).
- `CATALOG_RESEARCH_ENABLED=true` and `NEWS_DESK_ENABLED=false` (unchanged).

This does not merge the broader security integration branch. Existing code
fallback defaults remain unchanged; Blueprint values must be applied to the live
service and verified rather than assumed. A non-secret scheduler startup line
reports the effective artist scope and daily, monthly and shared monthly limits.
No spend history, key, grant, provider-side hard cap or news activation changes.

## Direct-load event defect

Read-only production diagnosis found `/event/tm_16e0Z_o8MG7Bv5g` resolving through
the JSON API while its HTML route returned 404. Known UTF-8 apostrophe bytes
decoded as Latin-1 created C1 controls in the provider title. The HTML policy
rejected that corruption; the JSON resolver had not applied the same policy.

The new pure helper repairs only the two known curly-apostrophe sequences in
Latin-1 and CP1252 form. It applies to public provider display text, never
member-authored text, persisted names, opaque IDs, billing evidence or catalog
keys. The same repaired display text is used by event policy, HTML projection,
JSON resolution and public event-name metadata. Identity decisions still use
the stored evidence before display repair. The JSON resolver now applies the
same public music-event policy as HTML.

Unknown corruption, sports admission, VIP/access products, unreleased records
and existing identity protections remain excluded. No database migration or
provider re-ingestion is required. Complete-address and other indexing thresholds
still apply independently of whether a public event document can render.

## Reported pages intentionally outside this repair

- The Formula 1 Friday admission title violates the existing sports-admission
  rule; it is not reclassified as a music event.
- The reported withdrawn news ID is present in the existing owner-withdrawal
  migration. `/crew` remains disabled by the existing availability flag.
- The reported city archive/directory pages retain their minimum-content rules.
  Upcoming city-guide entries do not establish a historical concert archive.
- The Andrew Johnson Theater lookup did not establish a safe canonical target.
  No guessed redirect or venue identity rewrite is introduced.

## Validation and remaining release work

Focused checks passed: 63 research, search-priority, provider-text, metadata,
event-policy and SEO tests, plus 8 unchanged-after-validation Blueprint tests.
Tests use temporary databases and mocked provider responses. Coverage includes
the reported byte sequence, exact case-sensitive event ID, pending artist
binding, unchanged stored row, SQL/JavaScript eligibility parity, intentional
404s, legacy venue-state preservation, empty artist queues and shared spend.

Syntax checks passed for all 825 Node files. Architecture checks, offline Render
Blueprint validation and `git diff --check` passed. The source diff was reviewed
for permission, identity, budget and persistence boundaries. PR 33's server patch
still passes `git apply --check` against this checkout; it was not applied.
Remote master was reconfirmed at the branch base during validation.

The full local Node suite passed: **6,043 passed, 0 failed, 1 skipped** (6,044
tests), using `node scripts/run-tests.mjs --test-concurrency=1`, in 717 seconds.
The skip is the existing dangling-symlink restore case because this Windows host
does not permit file symlinks. No test was disabled or weakened for this patch.

Execution deviation: `src/seed/catalog.bundle.test.mjs` launches an Expo export
inside the full Node suite. This was missed when selecting the suite despite the
owner's no-local-heavy-build constraint. It passed in 49 seconds, including the
unchanged bundle budget, and removed its temporary output. No local Chromium ran.
Do not repeat that embedded build locally. Final-commit cloud build/browser,
dependency audit and hosted-environment tests remain required; no dependency files
changed here. The full `npm run check` release gate is not yet complete.

The connected GitHub account currently reports repository `push=false` and
`pull=true`. No PR write or merge has been attempted through that connection.
Publishing a Git branch does not by itself trigger the repository's PR workflow.
An authorized owner PR session is required if connector access remains unchanged.

After final-commit cloud checks pass: merge the reviewed scope, verify the deployed
master SHA, confirm the startup line shows artist / 0.30 / 10 / 10, confirm automatic
news remains off, and check the repaired public event plus intentional exclusions.
If Blueprint values have not synchronized, merge only the three approved budget
environment values into the existing Render service configuration. Do not replace
the environment or expose credentials. No paid research call is needed for these
verification steps.
