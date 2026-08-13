# Pit current status

Last reconciled: **2026-08-13**. This is the source of truth for current code,
release, and production state. See `AUDIT_AND_REMEDIATION_2026-08-13.md` for the
evidence and `TODO.md` for the longer backlog. `HANDOFF.md` and the August 4/5
audit/session log are historical journals, not current status.

## Release state

- Work is on `codex/audit-hardening-20260813`, based on production baseline
  `1c6d91f`. The release candidate is locally complete but **not deployed** as of
  this checkpoint; production still represents the pre-change baseline.
- Baseline read-only checks found the J. Cole/Bas post, three other J. Cole
  posts, and the attached R2 image intact. The earlier claim that a free-tier
  restart erased that content was not supported by current evidence.
- Local tests pass: `npm test` **350/350**. Expo SDK 56 dependency validation
  passes, and Expo Doctor passes **21/21** checks.
- The complete feature-branch gate, post-change SQLite integrity check, isolated
  production boot, web/Android exports, and adversarial legacy-database upgrade
  replay pass. Merge-to-master gate, deploy, physical-device acceptance, and
  post-deploy smoke are still required. Do not describe this batch as live until
  the production checks pass.

## What this batch changes

- Production performs a read-only preflight before migrations and refuses a
  missing mount/database, zero-byte file, wrong schema, or structurally empty
  legacy Pit database instead of silently creating or migrating a healthy-looking
  empty site. Only an explicit first-boot bootstrap bypasses initialization
  checks; health also checks the configured storage identity.
- Venue galleries load one venue at a time through a bounded API/client cache.
  The final release-candidate export entry is **2,253,157 bytes raw, 615,705
  gzip, and 504,824 Brotli**, down from the 4,402,225-byte live baseline. No literal venue gallery
  arrays or server split-file reference occur in client JavaScript.
- Feed responses embed the latest two visible comments per post, removing the
  one-comments-request-per-card mount fan-out. Full threads still load on demand.
- The branch implements account-scoped native draft durability, dirty/busy Back
  guards, late-response ownership, Android picker-result recovery, and iOS media
  permission preflight. Fresh web and Android exports pass; physical-device proof
  remains a release-acceptance gap.
- Create retries compare canonical stored meaning, legacy missing hashes are
  healed only after equivalence, and ambiguous edits read canonical server state.
- Filtered feed paging reveals loaded matches before fetching; hosted job flags
  fail closed; heavy jobs serialize; missing hashed chunks return `no-store`.
- Once deployed from the Blueprint, Render builds run the full
  test/syntax/export gate in isolated temporary storage instead of exporting web
  only.
- The production-mode branch schedules a verified daily SQLite snapshot under `/data/backups`
  and retains seven by default. A complete, separate private `BACKUP_S3_*`
  configuration additionally uploads off-host; without it, backups remain on the
  same persistent disk and are not disaster recovery. A snapshot remains under
  a `.partial-*` name until verification and any requested upload succeed, then
  publishes atomically. Partial files do not suppress retries, and bounded child
  and upload deadlines prevent a stuck run from holding all maintenance work.

## Known release and operating gaps

- The declared `mshpit-staging` hostname returned HTTP 404 with
  `x-render-routing: no-server` on 2026-08-13. The `staging` branch and Blueprint
  entry exist, but a usable Render staging service was not verified. Do not claim
  a staging rehearsal until the actual service URL is healthy and tested.
- No post-change production snapshot, off-host upload, restore, or rollback has
  been exercised. Configure private backup credentials, observe a scheduled
  snapshot/upload, verify it independently, and rehearse restore before relying
  on it.
- Real Android/iOS acceptance remains mandatory for activity recreation,
  permissions, poor-network publish/retry, browser/hardware Back, memory, and
  interaction latency.
- `src/store.js` remains a broad Context. Comment fan-out is fixed, but domain
  provider/selector splitting and profiler-based rerender work remain open.
- Provider enrichment jobs remain deliberately disabled on hosted services until
  capacity and database pressure are observed one job at a time.
- `npm audit --omit=dev` reports **19 advisories: 8 moderate and 11 high**, in the
  Expo/Metro/React Native/Xcode dependency graph. npm's automated fix proposes
  incompatible Expo 53/React Native 0.72 changes. Do not use
  `npm audit fix --force`; track compatible SDK 56 patches or plan a deliberate,
  device-tested SDK upgrade.

## Release checklist

1. Keep the passing feature-branch evidence (`npm run check`, `npm run integrity`,
   isolated production boot, web/Android exports) attached to the release.
2. Confirm a verified production backup/restore point and keep the last-known-good commit
   (`1c6d91f`) available for code rollback.
3. Provision and smoke the real staging service, or explicitly record that the
   release is using the direct-master path without a staging rehearsal.
4. Merge only after the branch gate passes; rerun `npm run check` on `master`
   before pushing the auto-deploy.
5. After deploy, verify custom-domain/origin commit parity, durable-storage
   health, J. Cole post/photo presence, create/edit/retry, missing-chunk behavior,
   entry bundle size, and health beyond the delayed-job startup window.
