# A$AP Rocky artist lookup / PIT-REQ-002

## Confirmed cause

Read-only production checks on 2026-09-08 reproduced a 404 `NOT_FOUND` from `/api/artists/a%24ap%20rocky/live-summary`. Searches for both `A$AP Rocky` and `ASAP Rocky` returned no catalog entry while a Drake control lookup succeeded. Both checked-in artist catalogs also lacked A$AP Rocky. This establishes a missing current identity, not when or whether an older record was deleted.

Artist profile reads allowed a page to open without a catalog row, but the newer show-summary endpoint required that row. The page presented a generic retry message, and retry repeated the same missing lookup. Separately, public provider resolution swallowed provider errors as `artist: null`, making provider outages indistinguishable from a genuine no-match result.

## Repairs

- Add one source-reviewed artist identity at startup, with an exact `ASAP Rocky` alias. The [MusicBrainz identity and aliases](https://musicbrainz.org/artist/25b7b584-d952-4662-a8b9-dd8cdfbfeb64/aliases) establish the name and provider ID. No biography, photos, tour dates or ownership are invented.
- Insert only missing identities in a transaction. Preserve existing metadata and profiles; skip conflicting identities, ambiguous provider IDs and already-registered IDs under another key. Do not rename, delete or duplicate those records.
- Use the persisted, provider-ID-checked alias for public catalog search, artist resolution, profile and show-summary reads. Existing exact names and slugs retain priority. Public GET requests never create artists.
- Report provider failure as `PROVIDER_UNAVAILABLE`, separately from a successful lookup with no match.
- Preserve matching persisted artist keys in the client, including after delayed metadata hydration. Keep transient provider previews distinct from registered artists. Expo networking guidance informed the stale-request and hydration checks.
- Distinguish missing catalog records from empty successful schedules and temporary request failures; retain previously loaded dates with an explicit warning if an update fails.

## Verification

`npm run check` passed: **3,735/3,735 tests**, zero reported production dependency vulnerabilities, syntax checks for 529 Node files, architecture checks and the production web export. The final build is `index-b4d75b1b0d5267d049e4ba84c009d0ba.js`; initial JavaScript is 492.4 KiB gzip against the 512.0 KiB budget.

Regression tests prove that both spellings and the generated public slug read the same stored future show, unknown identities remain 404, provider failures do not become false empty success, delayed catalog hydration replaces obsolete requests, and the reviewed repair preserves existing data. A cache-promotion regression also verifies that a newly persisted search result clears an earlier transient-preview marker.

Actual local-server browser verification: **2/2 passed**, mobile (390 px, touch) and desktop (1280 px), on the exact final build above. Both followed the visible landing-page Find concerts action, searched `ASAP Rocky`, opened A$AP Rocky, and received HTTP 200 from the show-summary endpoint with the correct empty-schedule state. Neither produced API failures, runtime errors or crash receipts. The isolated fixture deliberately contained no real provider dates; stored-date retrieval is covered separately by the route integration test. The listener was stopped and its temporary database removed. Earlier attempts started at the empty fixture's direct `/events` URL and encountered its expected SSR 404 before reaching Search; these are not counted as artist-flow passes.

## Release boundary

Changes are local and have not been committed, pushed or deployed. The additive repair runs on startup after deployment. Actual upcoming-date coverage still depends on stored/ingested provider results and the existing authenticated profile refresh queue; the fixture show is not a claim about A$AP Rocky's real schedule. No production data was changed by this investigation.
