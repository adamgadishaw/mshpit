# Concert history presentation

`ConcertHistory` is one ticket-style section containing the map and logged-concert list. Mount it with the profile/account scope as its React key. The parent owns data loading, permissions, pagination, and opening the original review/show.

The map is a separately loaded bundle. A map-loading failure leaves the list usable. No remote tiles, geocoder, API key, or tracking service is involved.

## Data and access

The profile replaces its old Past Shows summary with this section; Upcoming Shows and the original posts remain. `GET /api/users/:id/concert-history` reads compact past in-person review metadata, independently of the feed's 30-post page. It checks the same profile audience, account availability, and two-way blocks as profile posts. Every page is checked again and sent with `Cache-Control: no-store`.

Pages scan at most 201 candidate rows using the existing author/creation-time index and return at most 200 concerts. The client automatically drains five pages, then offers explicit continuation with partial counts. Empty filtered pages still advance. No provider calls, full post bodies, photo bytes, or video hydration are needed for the map. A single thumbnail is included only if the existing media ownership/readiness and photo visibility checks allow it.

Only exact stored venue identities or unique normalized venue-name-and-city matches supply pins. Unknown and ambiguous locations remain in the list. Future plans, online reviews, and old Going/Interested records do not become attended concerts. The owner's already-recorded private Went entries remain in their own list, unpinned; they are never added to another viewer's response. When a review and private attendance entry identify the same night, the review takes precedence.

`users.extras.concertMapVisible` defaults to true. Settings saves the boolean through the confirmed profile update path, with no database migration. False hides the map and strips coordinates and country fields from history responses for all viewers, including the owner; the concert list still follows the chosen profile audience.

Client history is held only in a resource scoped to viewer, session generation, and target profile. Account changes cancel requests and quarantine old state. Access denial clears loaded rows; temporary outages keep permitted earlier rows with retry. Deleted-row tombstones stop in-flight pages restoring deleted concerts. Opening a history entry re-fetches its original post with the same identity binding and ignores stale navigation.

## Regression checks

Run `npm run check` for the full test, dependency, syntax, architecture, and exported-build gates. `node scripts/verify-concert-history-browser.mjs` exercises the exported UI using synthetic API fixtures on loopback. Set `PIT_PLAYWRIGHT_MODULE` to an installed Playwright module when needed. The runner blocks external requests and never uses production accounts or databases. Existing `verify:auth-browser` and `verify:auth-real-server` checks cover adjacent login, logout, guest actions, and session behavior.

## Geography provenance

`worldGeography.json` derives from Natural Earth's public-domain 1:110m admin-0 country geometry. Its metadata records the exact source URL, source SHA-256, and license URL. Geometry is unchanged except conversion to equirectangular coordinates (`x = longitude + 180`, `y = 90 - latitude`) and rounding to 0.001 degrees. `countryMetadata.mjs` contains only each source country's code, name, and continent. Country outlines are contextual geography, not a detailed street map.

Sources: [Natural Earth vector data](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson), [public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/).

## Visual checks

On a local profile with at least six logged concerts, check a wide viewport and a 390-pixel mobile viewport. Inspect `profile-concert-history` and `profile-concert-map` test IDs.

- Wide section (at least 680 pixels): map and five-row preview are side by side. Mobile: map sits above three rows.
- Hover or keyboard-focus a pin for an older venue: the connected list reveals that venue's concerts. Nearby venue clusters expose separate venue choices. Selecting a row highlights its map pin; its separate Open review action opens the existing post.
- Tab through pins, zoom controls, rows, review buttons, and expansion. Focus is visible. Every action has a 44-pixel or larger target.
- Exercise See all, Load more, and See less. A partial history is explicitly labelled; paging must not turn loaded counts into a claimed lifetime total.
- One confirmed country frames its continent; concerts in two countries frame the world. Try manual zoom and reset, including a Pacific venue.
- A concert without coordinates remains listed with Location not mapped. Explicit city precision is labelled approximate. No coordinate is inferred from a name.
- Disable map visibility, simulate history load failure, and simulate review-open failure: list access and inline retry/error feedback remain available.
- Compare light and dark themes for text contrast, card borders, focus, and selected rows.
