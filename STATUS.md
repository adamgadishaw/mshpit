# Pit current status

Last production reconciliation: **2026-08-13**. Local working-tree review:
**2026-09-02**. This is the source of truth for current code, release, and
production state. See `AUDIT_AND_REMEDIATION_2026-08-13.md` for the deployed
remediation evidence and `TODO.md` for the longer backlog. `HANDOFF.md` and the
August 4/5 audit/session log are historical journals, not current status.

## 2026-09-02 native runtime remediation

- The project is aligned to Expo SDK 57.0.19, React Native 0.86.3,
  React Native Reanimated 4.5.1, and Worklets 0.10.1.
- `expo install --check` reports compatible dependencies and Expo Doctor passes
  **21/21** checks. The earlier SDK 56 Hermes V1 memory-regression blocker is
  removed from the dependency graph.
- Physical iOS and Android device acceptance remains required before submitting
  a signed native build; a passing dependency check or web export is not that
  acceptance test.

## 2026-08-21 pre-push audit (historical)

- The accumulated feature branch passes the exact `npm run check` gate:
  **880/880 tests**, **135** Node files in the syntax sweep, and a fresh web
  export with **43 chunks**. Fresh iOS and Android JavaScript exports are also
  green at approximately **6.5 MB** each.
- Expo SDK 56 dependencies pass `expo install --check`. Expo Doctor is **21/22**
  only because Expo 56.0.20 / React Native 0.85.3 remains on the documented
  Hermes V1 memory-regression line; that remains a native-distribution gate.
- `npm audit --omit=dev` reports **17 advisories: 9 moderate and 8 high**, all in
  the Expo/Metro/Xcode build graph. It reports no critical issue and proposes an
  incompatible Expo 53 downgrade rather than a safe SDK 56 remediation.
- This audit targets the feature branch. Production remains on the separately
  reconciled release until an intentional merge/deploy and live smoke check.

## 2026-08-14 release candidate

- This section records the exact candidate verified before the direct-master
  rollout. At that checkpoint production remained on `c9d86eb9b8b2`; the
  release is complete only when both the custom domain and Render origin report
  the resulting release commit and preserve the public-data baseline below.
- Mobile now has an independent 44-by-44 Stop/Close control plus a dedicated
  `SWIPE UP TO CLOSE` rail on both expanded and minimized player surfaces. The
  gesture belongs to the player rail only--never the feed, transport controls,
  title, queue, or scrubber--and requires a deliberate dominant upward motion.
  The 44-dp rail claims its single touch at touch-down so React Native cannot
  discard the opening movement when responder ownership is granted.
  Closing pauses playback, clears the account-owned queue and resume position,
  unmounts the playback engine, and restores the feed's full height. The
  verification banner moves below an active mobile player instead of covering
  either close path.
- Email verification now adopts the confirmed state immediately for the exact
  matching signed-in account instead of leaving `session.emailVerified` stale
  until reload. Confirmation and resend are no-store, ambiguous responses use
  bounded idempotent receipts and identity-bound reconciliation, an already
  verified stale banner self-heals, and guest/different-account tokens cannot
  disclose or adopt the token owner's private self projection. A consumed token
  is removed from the visible URL while the completion state remains on screen.
- The logged-out hero remains stock-first but can now rotate in separately
  opted-in community review photos. Homepage consent defaults off, is owner-only,
  survives drafts/edits/export/idempotent retries, and never inherits the older
  artist-page photo toggle. Eligibility requires a confirmed active account, a
  PIT-owned HTTPS JPG/PNG/WebP under that author, public photos, no open post
  report, and no relevant block. The response exposes only a bounded credit,
  artist, venue, post id, and media URL; per-author SQL and projection caps keep
  one account from monopolizing the reel.
- The hero renders one bundled stock frame immediately, mounts at most the
  current/outgoing layers, prefetches the exact first community frame before an
  early transition, preserves deterministic stock fallback, resets the full
  seven-second deadline after every transition, and honors reduced motion.
  Existing rows migrate opted out, so production will remain stock-only until
  verified owners explicitly enable the new control on eligible reviews.
- Final local gates: **514/514** tests, **118** Node files in the syntax scan,
  Expo dependency alignment, Expo Doctor **21/21**, fresh SDK 56 web export,
  fresh Android export (**926 modules**, approximately **4.5 MB** Hermes), and
  fresh iOS export (**930 modules**, approximately **4.5 MB**).
  The web entry is **2,348,998 bytes raw, 641,523 gzip, and 529,579 Brotli**;
  it remains inside the executable raw/compressed budgets. Isolated browser QA
  passed at 390-by-844 and 1440-by-1000 with community and stock-only paths,
  two or fewer mounted hero images, no horizontal overflow, and no console errors.
- Credential-free App Store preparation now pins `com.mshpit.app`, version
  `1.0.0`/build `1`, phone-only initial scope, export-compliance and
  required-reason privacy declarations, EAS preview/production profiles, and a
  real native version label in Settings. No Apple/Expo credential, cloud build,
  TestFlight upload, or App Store Connect write occurred. Final Pit-owned icon
  and splash artwork, public support/privacy URLs, non-post UGC report controls,
  physical iPhone acceptance, reviewer access, and owner store metadata remain
  explicit blockers in `APP_STORE_READINESS.md`.
- Before broad traffic, add owned responsive image derivatives/CDN transforms:
  prefetch prevents a blank transition but a community hero can still be an
  original upload up to 12 MB. Durable per-photo suppression or a curated
  homepage approval workflow is also still needed; current safety filters are
  reactive, and whole-post moderation is the durable removal path. Real-device
  acceptance of the player stop/release lifecycle remains required.

## Release state

- Remediation commit `1e2ba65` was fast-forwarded to `master`, pushed, and
  deployed through the explicitly recorded direct-master path on 2026-08-13.
  The declared staging hostname still had no service, so this was not a staging
  rehearsal.
- Render build-gate fix `2ec2679` was then pushed and deployed successfully; this
  status update is its documentation-only descendant. GitHub Quality run
  `31742684092` passed. The custom domain and Render origin both reported commit
  `2ec267978e37`, HTTP 200, the configured database file present, bootstrap
  disabled, backups enabled, and matching uptime at 106 seconds.
- Both public endpoints returned the same 13 post IDs. The J. Cole/Bas post,
  three other J. Cole posts, and the attached 3,909,908-byte R2 image remain
  intact. The earlier claim that a free-tier restart erased that content was not
  supported by the evidence.
- Feature-branch and merged-`master` gates pass. The release ran **350/350**;
  the Render-environment follow-up now runs **351/351**, plus the
  100-file syntax scan, fresh web and Android exports, Expo dependency alignment,
  and Expo Doctor **21/21**. Physical-device acceptance remains open below.
- Final live checks retained the 2,253,157-byte immutable entry with zero venue
  gallery arrays/server split references, a 12-photo bounded venue response,
  and a missing-chunk 404 with `Cache-Control: no-store`. The J. Cole/Bas image
  remained HTTP 200 at 3,909,908 bytes.

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
- The release implements account-scoped native draft durability, dirty/busy Back
  guards, late-response ownership, Android picker-result recovery, and iOS media
  permission preflight. Fresh web and Android exports pass; physical-device proof
  remains a release-acceptance gap.
- Create retries compare canonical stored meaning, legacy missing hashes are
  healed only after equivalence, and ambiguous edits read canonical server state.
- Filtered feed paging reveals loaded matches before fetching; hosted job flags
  fail closed; heavy jobs serialize; missing hashed chunks return `no-store`.
- Render builds now run the full test/syntax/export gate in isolated temporary
  storage instead of exporting web only. The first Blueprint-controlled build
  exposed that the test subprocess inherited Render's one-build bootstrap flag,
  which made the health-policy assertion fail. It also isolates staging's
  recipient-suppression policy from campaign tests. The runner now pins its own
  test/runtime-policy environment and bootstrap-disabled policy; the exact
  production- and staging-like Render commands pass the complete **351/351**
  gate.
- Production now schedules a verified daily SQLite snapshot under `/data/backups`
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
- Health confirms the production backup scheduler is enabled, but no post-change
  snapshot, off-host upload, restore, or rollback has been independently
  observed. Off-host configuration is currently false. Configure private backup
  credentials, observe a scheduled snapshot/upload, and rehearse restore before
  relying on it for disaster recovery.
- Real Android/iOS acceptance remains mandatory for activity recreation,
  permissions, poor-network publish/retry, browser/hardware Back, memory, and
  interaction latency.
- `src/store.js` remains a broad Context. Comment fan-out is fixed, but domain
  provider/selector splitting and profiler-based rerender work remain open.
- Provider enrichment jobs remain deliberately disabled on hosted services until
  capacity and database pressure are observed one job at a time.
- `npm audit --omit=dev` reports **17 advisories: 9 moderate and 8 high**, in the
  Expo/Metro/React Native/Xcode dependency graph. npm's automated fix proposes
  incompatible Expo 53/React Native 0.72 changes. Do not use
  `npm audit fix --force`; track compatible SDK 56 patches or plan a deliberate,
  device-tested SDK upgrade.

## Release checklist

1. Keep the passing feature-branch and merged-master evidence (`npm run check`,
   `npm run integrity`, isolated production boot, web/Android exports) attached
   to the release.
2. Confirm a verified production backup/restore point and keep the last-known-good commit
   (`1c6d91f`) available for code rollback.
3. Provision and smoke the real staging service before calling future releases
   staged; this release is explicitly recorded as direct-master.
4. Post-deploy read-only proof covers custom/origin commit and data parity,
   durable-storage health, J. Cole post/photo presence, missing-chunk behavior,
   venue-cache behavior, exact live bundle size, and health beyond 60 seconds.
5. Complete a real-device authenticated create/edit/poor-network retry pass. The
   production smoke deliberately made no public test post or other data write.
