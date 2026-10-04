# Catalog empty-page queue review - 2026-10-04

Base: `cb493996a97fc964614099bf263458326044bf01` (released PR27).
Branch: `codex/catalog-empty-queue-20261004`. Reviewed; browser CI pending.

## Scope and behavior

The previous queue filtered eligibility after taking 30 candidates, so a page
could be empty while useful matches existed immediately afterward. Its missing
text filter also admitted intentional biography clears and existing research.

The queue now examines at most 150 candidates and returns at most 30 matches.
Its cursor is the last examined key, not the additional lookahead key. Default
fill results exclude existing biography/staff text, found or hidden research,
protected biography clears, hidden staff text and stale staff identities.
Existing research marked found remains excluded even if malformed: it requires
review rather than being silently classified as an empty page. Venue research
uses the public canonical-name/city association conservatively; a different
city is not hidden by a same-name result elsewhere.

Exact-key lookup, explicit all-eligible review, account binding, cancellation,
admin authorization, email verification, revision hashes, individual saves and
receipts are unchanged. There is no schema or runtime configuration change and
no provider call, research worker import or production content write.

## Coordination

Current master was verified against GitHub before creating this isolated
worktree. The existing Catalog editor and enrichment checkouts were clean.
The local Claude session was idle in a separate older checkout. Open PR19
touches the shared browser suite and research implementation; this patch does
not import that branch or edit its worktree or research worker. Open PR22
concerns countdown isolation. The console-design artifact remains separate.

## Validation

Passed: 34 checks across the repository/service, API adapter, real JSX selection
harness and browser-fixture unit suites; seven additional checks in the real
isolated HTTP suite. These include sparse scans for all three entity types,
exact cursor continuation, the 150-candidate/30-result bounds, preserved content,
canonical venue research association, changed-filter reset and cancellation.
Existing authorization, publication, receipt, public HTML and sitemap coverage
also passes. The HTTP fixture blocks outbound networking and uses only synthetic
accounts and a throwaway database; its final assertions verify zero outbound
attempts and unchanged provider records.

The initial HTTP attempt could not create its directory under the Windows short
temporary path (EPERM). It passed after TEMP and TMP were set, for that command
only, to the writable task-local validation folder. No permission was widened.

`node scripts/check-syntax.mjs` passed for 822 Node files;
`node scripts/check-architecture.mjs` and `git diff --check` also passed.

The browser suite adds synthetic
`catalog-queue` scenarios at 390px and 1280px, including bounded continuation,
changed-filter cursor reset and no writes or unrelated private staff requests.
Actual browser execution requires a fresh export and an approved cloud runner;
no local Chromium or heavy build is authorized in this task.

Independent final review found one stale exact-key browser assertion that still
expected the old venue search explanation. Its selector now matches the new
copy. The reviewer verified the fix, found no remaining correctness or security
issues, and independently reran all 34 non-HTTP focused checks successfully.
The isolated HTTP suite (seven checks), syntax and architecture checks passed
again after that fix. Permissions, exact-key and identity protections are intact.

Browser cases are prepared and their fixtures unit-tested, not browser-executed.
The current executor has no callable approved cloud runner. A fresh source-only
archive is prepared for Library transfer; it includes this uncommitted patch
and per-file hashes, without local settings, dependencies, build output,
credentials or databases. The parent can run the following on the approved
Node 24 cloud runner with its existing pinned Playwright/Chromium setup:

```sh
npm ci --include=dev
CI=true EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_GOOGLE_MAPS_KEY=fixture-only npm run build:web
node scripts/verify-catalog-maintenance-browser.mjs catalog-queue
node scripts/verify-catalog-maintenance-browser.mjs catalog-exact-key
```

Each browser command selects both 390px and 1280px cases. All requests use the
existing loopback synthetic fixtures, with off-origin requests blocked. The
repository cloud workflow pins Playwright 1.62.1; a prepared runner may supply
its module and executable through the suite's existing environment overrides.
Record actual case output before claiming browser acceptance. No merge,
deployment or live pilot acceptance is included. Prior live pilot status remains
35 biographies previously verified and zero venue pilot writes.

## Cloud validation and publication handoff

The parent cloud runner reported verification of all 2,136 source hashes in
Library archive `libfile_447918f5f73c8191b1ad893c087e05c2` (SHA-256
`b53f3f80315e573fe254b5ee1828c0b1b784a98486087841345b2b7502e46c18`).
It passed the 34 focused checks and a single-worker, memory-capped web export.
The startup bundle was 508.4 KiB gzip against the 512 KiB budget. The runner's
socket permission restriction prevented Chromium from launching, so all four
queue/exact-key browser cases remain UNEXECUTED, not failed or passed.

The existing `.github/workflows/quality.yml` runs on pull requests, including
drafts. Its `browser-regressions` job builds a fresh web export, installs pinned
Playwright 1.62.1 and runs `npm run verify:catalog-maintenance-browser` without
a case filter. The suite includes `catalog-queue` and `catalog-exact-key` at
390px and 1280px. No workflow change is needed; actual CI output is still
required before browser acceptance or readiness for merge.

The owner authorized a normal commit and push of this reviewed nine-file patch
for draft PR validation. All source hashes were rechecked locally before this
documentation-only evidence update. No implementation or test file changed
after the validated export, and no force-push, merge or deployment is included.
