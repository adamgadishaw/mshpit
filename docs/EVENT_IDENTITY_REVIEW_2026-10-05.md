# Event recommendations and venue-link identity - 2026-10-05

Base: `a056e64d13ab6185f4b91965060fc492fb110326` (PR32).
Branch: `codex/event-identity-20261005`.

## Diagnosis

Anonymous production HTML and `/api/resolve` reads reproduced both issues.
The SLIFT page (`/event/tm_rZ7HnEZ1Af_38d`) recommended Isaiah Falls
(`tm_177Zv0G6GwPwexa`) and Ravyn Lenae (`tm_177Zv0G6uazHfGA`), whose
resolver snapshots explicitly report `cancelled`. The related city query lacked
the cancellation predicate already used by venue calendars. The related artist
query had the same omission.

Oktoberfest pa Tynset (`/event/tm_Z698xZb_Z1kbxCfZk`) retains the exact
Ticketmaster venue ID `Z698xZb_Zakot`, with Stortelt foran radhuset, Torvgata 1,
Tynset. Voi Voi has a different ID, `Z698xZb_ZakOT`, and Osloveien 12, Roros.
Both IDs become `ticketmaster-z698xzb-zakot` under the existing public slug
normalization. The canonical resolver selects the latest eligible record, Voi
Voi. The Tynset name alias found the correct raw ID, then re-resolved its lossy
slug and silently adopted Voi Voi. This is a URL/read-resolution collision;
the observed event identity itself was preserved.

## Change and boundaries

- Related artist/city queries exclude both `cancelled` and `canceled`, including
  case/whitespace variants, before their existing limits and artist deduplication.
  Direct cancellation detail pages and structured event status are unchanged.
- Public event projections link a provider venue only when its canonical
  destination matches the exact source and provider ID. An explicit rejection
  cannot be replaced by a fallback built from the same lossy slug. The correct
  event venue/address remain visible; the wrong HTML and JSON-LD URL are omitted.
- Name aliases reject a canonical destination belonging to another raw ID.
  Voi Voi's existing canonical page is preserved. Tynset does not receive a new
  standalone canonical venue URL in this patch; its conflicting alias returns
  unavailable instead of redirecting to the wrong building.
- No production writes, record repair, schema migration, index/function change,
  URL-format change, permission change, credentials or infrastructure change.

Runtime files: `server/seo.js`, `server/features/seo/publicDocumentRepository.js`,
`server/features/seo/publicDocumentProjection.js`.
Regressions: `publicDocuments.test.mjs` and `publicVenueSnapshot.test.mjs` in the
same feature directory. Status and this audit complete the scoped diff.

## Validation and release

Validation passed: 143 tests across ten focused SEO, venue, sitemap, resolver,
alias and index suites; syntax for 823 Node files; architecture; diff whitespace.
Independent read-only review approved the seven-file diff with no blockers and
independently reran both modified suites (56/56 passed). Regressions cover
cancelled rows outnumbering preview limits, retained cancellation details, exact
case and punctuation collisions, blocked wrong aliases, separate provider
namespaces, unchanged canonical venue data, repeated same-identity events, and
read-only projection. Existing venue hydration, historical location, metadata,
collection and sitemap suites are included.

No local Chromium, Android or production web export. The complete check/build
belongs to cloud CI under the resource constraint. Push, draft PR and CI status
will be reported separately; no merge/deployment is part of this patch task.
