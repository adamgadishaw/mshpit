# Stored artist identity on event navigation — local review

Base: fresh GitHub clone of `adamgadishaw/mshpit`, remote master
`9c219b2afad591c45cd87fe215f27e48972483a4`.
Branch: `fix/stored-artist-navigation`. The protected D: checkout and draft
search PR74 were not used or changed. The suggested Sources checkout was read
but Git rejected cloning it for ownership; no ownership or Git trust changes
were made. No `.agents` directory or additional tracked AGENTS files exist in
this base. AGENTS, CLAUDE, product/security/migration/error guidance and exact
Expo SDK 57 documentation were read.

## Finding and correction

ShowScreen passes its trusted/legacy artist label to
`useCanonicalArtistIdentity`. That hook needs an exact persisted catalogue key
for memorial policy; transient provider previews cannot satisfy it. Its call
to `store.resolveArtist` previously reached `fetchResolvedArtist` without a
scope, enabling provider discovery on catalogue misses. The server already
supports `scope=stored` after its catalogue visibility checks and before
provider/cache fallbacks.

The hook now opts into `scope: "stored"`; the store forwards that option and
the existing API adapter appends `&scope=stored`. The default API request is
unchanged, preserving explicit discovery and composer provider lookup. Existing
response validation, input bounds, durable cache use, transient markers,
abort signals, typed failures, manual retry and account/route isolation remain.
Archive/fan-club consumers of the same canonical identity hook also use stored
scope because they have the same durable identity requirement. No heuristic
filters, UI changes, schema changes or server changes are included.

The reported six-second failures for “Simba Prisen 2026” and
“2026 Premium Offerings - Thunder Ridge Nature Arena” are motivation supplied
with the task, not new production observations. This review makes no claim
about client automation or a release regression.

## Reproduction and validation

- Before correction: 13 tests passed and the two added regressions failed.
  The API test observed a missing stored query parameter; the real
  hook → store → API fixture likewise observed discovery scope.
- After correction: 85 focused tests passed. Coverage includes stored known and
  unknown names, both reported event-like labels, encoded malformed labels,
  blank/overlong input, direct/repeated/back navigation, explicit stored keys,
  stale responses, account changes, unmount, typed errors, preview rejection,
  hidden catalogue identities, public event rendering, and explicit provider
  discovery/composer behavior. Provider fixtures use mocked fetch only.
- First `npm run check`: 6,998 passed, one existing Windows skip, one failure in
  the unrelated map test `only a loopback response with the opt-in header extends
  its bounded body deadline`. Its isolated rerun passed all 18 tests.
- Second `npm run check`: 6,999 passed, zero failed, one skip; stopped at npm
  audit because the sandbox registry request failed. Separate network-enabled
  `npm audit --omit=dev --audit-level=high` passed with zero vulnerabilities.
- Blueprint and `git diff --check` passed.

- Remaining aggregate gates passed separately: syntax (906 Node files),
  architecture, production web export and web bundle budget (506.1 / 512 KiB
  gzip initial JavaScript). The aggregate wrapper itself was not represented
  as a complete pass after its registry failure.
- Hosted CI environment `npm test`: 6,999 passed, zero failed, one existing
  Windows skip, using the quality workflow's background settings and the
  hermetic runner's disposable database/mail isolation.
- Real exported app browser fixtures passed 18/18 using pinned Playwright
  1.62.1 and installed Chrome, at widths 390 and 1280. Commands were
  `node scripts/verify-navigation-browser.mjs discover-show` (6),
  `node scripts/verify-navigation-browser.mjs event-` (10), and
  `node scripts/verify-navigation-browser.mjs artist-lookup` (2).
  These cover known artist links, event artist recovery/conflict, direct event
  entry, cancelled/fallback events, event Back navigation and lookup recovery.
  All requests are isolated loopback/static fixtures with API interception.
- Full unrelated browser suites and physical/native device checks were not run.
  No live-provider requests, production writes or account actions were used.

The focused invocation used `node scripts/run-tests.mjs` with:
`src/hooks/useCanonicalArtistIdentity.test.mjs`,
`src/features/artistSearch/artistSearchApi.test.mjs`,
`server/artistNavigationResolve.test.mjs`,
`src/features/artistOverview/artistOverviewHydration.test.mjs`,
`src/domain/artistMemorialUi.test.mjs`,
`src/domain/artistArchiveIdentityUi.test.mjs`,
`src/domain/legacyFanClubUi.test.mjs`,
`src/domain/artistComposerSearchIntegration.test.mjs`,
`src/screens/LogScreen.artistSearch.test.mjs`,
`src/features/publicNavigation/publicNavigationApi.test.mjs`,
`src/domain/publicEventSnapshotRender.test.mjs`,
`src/domain/publicEventSnapshot.test.mjs`,
`src/hooks/usePublicEventSnapshot.test.mjs`, and
`scripts/verify-navigation-browser.test.mjs`.

## Risk and rollback

An unknown or preview-only artist now produces a confirmed missing durable
identity without waiting for providers. Existing public-event fallback remains
responsible for readable event details, venue/ticket actions and recovery;
protected artist actions still require an authoritative key and memorial policy.
Catalogue read failures still propagate rather than becoming a false miss.
No live-provider recovery or device-native behavior is certified by fixtures.

Rollback is limited to reverting this local commit's three client code files,
two regression test files and review documentation. No migration, production
data, credentials, account action or service setting requires rollback.
