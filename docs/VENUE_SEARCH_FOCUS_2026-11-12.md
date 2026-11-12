# Venue search focus and city results — 2026-11-12

This isolated follow-up starts at combined candidate
`7be234d526bd177570f3948167b7ece782168bd8`, on branch
`fix/venue-search-focus-20261112`. The checkout is
`C:/Users/Adam Gadishaw/Documents/Codex/2026-11-11/task-4/venue-search-20261112`.
Previous venue feature artifacts and other workers' checkouts remain unchanged.

## Observed cause and existing behavior

The exported, unchanged base reproduced the reported symptom at 375 and 1280 px.
Keyboard typing `Toronto` left the value `T`: the original input was disconnected
and the replacement was unfocused. `FlatList key={mode}` switched from `cities`
to `search` on the first character, remounting its header and TextInput.

The existing search engine already matches city/place text. Giving the base input
the whole value `Toronto` returned three synthetic fixture venue results at both
widths. This change keeps that engine; it does not add a remote search provider.
The old city directory used a name-only projection that could lose provider IDs
and collapse same-named rooms. City browsing now groups the existing bounded
venue index by full city/region/country identity and retains each original row.

The requested installed Build 8 source
`31860b2d080805bfef1da3e29d38400cbd85b5d7` was absent from the current combined
checkout, the previous venue checkout and the 2026-11-10 integration repository.
An authorized read-only GitHub commit lookup for `adamgadishaw/mshpit` returned
HTTP 422, “No commit found for SHA”. Its exact implementation could not be
inspected. No installed-build equivalence or phone verification is claimed.

## Change and contracts

- The controlled search input sits outside the result list and stays mounted.
  Native `submitBehavior="submit"` and React Native Web 0.21's
  `blurOnSubmit={false}` keep typing available after the Search/Enter key.
- Matching cities appear separately, with region/country labels. Selecting one
  clears the query and browses that complete place. Venue-name search remains.
- Country filtering happens before the 50-result search cap. City matches are
  capped at eight and come only from venues already in the existing index.
- Query updates are synchronous local projections. They do not request device
  location, geocode city text, fetch on every keystroke or manufacture identities.
- Existing `refreshTourDates` sequence, account and abort guards remain unchanged.
  New tests execute that actual loader and prove that older, aborted and
  previous-account responses cannot replace an accepted snapshot.
- Existing catalogue eligibility, photo attribution/privacy, canonical venue
  paths, ratings, creator ownership, follows and posting interfaces are reused.
  No Store, API, schema, ShowScreen, review detail or creator code is changed.
- The new helper is reached through the existing lazy venue-screen boundary.
  No package dependencies, architecture allowances or budget baseline changed.

Changed files (exact manifest):

1. `STATUS.md`
2. `docs/VENUE_SEARCH_FOCUS_2026-11-12.md`
3. `scripts/verify-venue-directory-search-browser.mjs`
4. `src/domain/venueDirectorySearch.mjs`
5. `src/domain/venueDirectorySearch.test.mjs`
6. `src/screens/VenuesScreen.jsx`

User-facing copy changes are confined to `VenuesScreen.jsx`: city-choice
accessibility labels, the Cities section, and concise no-match guidance.

## Verification

All fixtures are synthetic, loopback-only test data. They are not real user
uploads or actual venue media. The browser runner blocks external requests.

| Check | Result |
| --- | --- |
| Unchanged-base browser reproduction, 375/1280 px | Both reproduce one-letter/focus loss; whole-value city search already works |
| Focused directory, unified search, discovery, pull-refresh and product UX tests | 43 pass, zero fail/skip |
| `npm run test -- --test-concurrency=4` | 7,526 tests: 7,525 pass, zero fail, one skip |
| Exported app browser runner | Six pass: guest/member × 320/375/1280 px |
| `npm run check:syntax` | Pass, 996 Node files |
| `npm run check:architecture` | Pass, no allowance changes |
| `npm run check:blueprint` | Pass; no live environment validation implied |
| `npm audit --omit=dev --audit-level=high` | Pass, zero vulnerabilities; read-only network retry after restricted endpoint failure |
| `npm run build:web` | Pass, including catalogue split and web budget gate |
| Web startup gzip budget | 523,575/524,288 bytes, 713 bytes remaining (511.3/512 KiB) |
| `expo export -p ios` | Pass, 2,259 modules; export only |

The six browser cases assert continuous typing, retained DOM input/focus/caret,
delayed catalogue hydration (home response before global for members), changed
queries during those responses, Search/Enter followed by further typing, clear
and retry, venue-name and city searches, zero results, and repeated navigation.
London, Ontario and London, England open distinct exact provider venue paths.
They assert no per-query requests, no geolocation calls and no page errors.
The actual exported mobile city results and desktop empty state were visually
inspected for consistency with existing typography, spacing and controls.

The browser's mobile viewport is not an iOS keyboard test. Native keyboard,
IME composition, physical device and installed Build 8 behavior were not tested.
No phone work was authorized for this follow-up.

Final local commit/bundle/patch, file hashes, complete command logs, screenshots,
post-stage repository-privacy and whitespace checks accompany this source in
`task-4/deliverables-venue-search-20261112`.

## Integration limits

Apply the isolated increment after `7be234d` or reconcile it with the integration
owner's later commits. The separately running scheduled-publication eligibility
fix is not imported here. Only `STATUS.md` is likely to overlap unrelated work;
preserve both entries. Re-run combined gates after integrating because startup
headroom is small. This delivery does not address the separate review-detail
request. Nothing was merged, deployed, published, transferred or installed.
