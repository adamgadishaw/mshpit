# Reviews for artists outside the catalog - October 6, 2026

Branch: `codex/review-unlisted-artist-20261006`.
Base: `a056e64d13ab6185f4b91965060fc492fb110326`, verified remote master.

## Cause and supported flow

The review composer already accepts an artist name without a selected catalog
key, and the server already persists it. The picker prominently offered search
results and a full-directory lookup, but no explicit action to keep the name.
Only a completed directory lookup explained that unlinked posting was possible.
This made an absent band, a provider outage or unrelated suggestions look like
a dead end even though the minimum posting requirements did not require a match.

The picker now offers **Use “name” for this review** for any nonblank artist
name, including when similar or same-named results exist. Confirming it retains
the trimmed display name, clears the catalog binding, cancels pending catalog,
directory and attachment work, and dismisses suggestions. A confirmation explains
the selection; **Change artist** or editing the field restores normal search.
Catalog suggestions retain their existing disambiguating facts and explicit
selection/attachment behavior. Festivals retain their separate name handling.

The user can continue with the existing venue-or-city and rating requirements.
The entered artist and review survive step navigation, draft serialization,
restoration and save retries. Restoring a draft also cancels stale artist work.
An existing unlinked draft or review restores as a confirmed entered name, while
a linked one retains its key. No new persisted field or schema migration is used.
Optional guidance no longer asks someone who confirmed their name to select a
different search result.

## Scope and boundaries

Runtime changes: `src/screens/LogScreen.jsx` and
`src/domain/postCompleteness.mjs`. Tests cover their callbacks, guidance, draft
restoration, existing post idempotency and the quick-log browser contract.
The existing quick-log browser scenario now exercises this action at mobile and
desktop widths, including similar/no-result searches, Back, Change artist,
cancelled Close and failed-save retry.

The API continues to receive an explicit `artistKey: null` for an entered name.
The existing server checks and moderation rules remain authoritative. The action
does not create a catalog artist, profile, ownership claim or verification,
and does not widen account permissions or change provider matching rules.
Historical name-based review projections are unchanged; a null binding is not a
new globally unique artist identity or a rewrite of legacy aggregate behavior.
No source of truth is inferred from a similar search result.

No modifications to the outstanding event identity, infrastructure bounds,
video player, completion polling or GEO branches. No production posts, provider
jobs, credentials, grants, security settings or infrastructure changes.

## Validation

- **126/126 focused tests passed**, run sequentially with
  `node scripts/run-tests.mjs --test-concurrency=1` across the six LogScreen
  suites, composer draft/close/navigation/recovery/log-details, post payload
  and guidance, three artist-search suites, server post editing/idempotency,
  and the quick-log browser contract tests.
- New cases cover no results, similar results, exact same-name alternatives,
  short/Unicode names, repeated choice, cancelled pending searches/attachments,
  explicit reselection, Back, draft serialization/restoration and stable retry
  identity. Adjacent close/cancel and account-boundary tests also passed.
- The real API/database regression creates an unlisted-band review as an ordinary
  fan, repeats the request without duplication, reads the committed fields from
  a separately opened database connection, verifies no artist/profile/role
  change, and checks changed-payload conflicts and removed-post protection.
- Syntax checks passed for **823 Node files**; architecture and whitespace checks
  passed. Exact [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
  was checked before editing, along with repository instructions.

Full `npm run check`/web export and the updated mobile/desktop browser scenarios
remain cloud gates. No local Chromium or heavy export/build was run. The browser
scenario changes are prepared, not evidence that those scenarios already passed.

## Publication gate

Commit and branch publication are separate from merging and deployment. The
GitHub connector could read repository state but could not verify repository
permission for its connected identity (403). No PR creation was attempted with
that identity. The authorized owner session must create the draft PR and run
cloud CI after the tested branch is pushed; final publication state is reported
in the task handoff. No merge or deployment is authorized in this task.
