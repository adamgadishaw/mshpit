# After-show planning refresh — 2026-11-11

Local review candidate, based on `2b0151a448e8f29affb5d7e3b0052a3adc3e2cd5`.
The source checkout was read only. All implementation and checks run in the isolated
`task-8/aftershow` clone. No service was enabled and nothing was pushed, merged,
published, deployed, or written to production.

## Decision and evidence

Adam asked to rethink stale late-night recommendations with Astra and to keep
layout, flow and branding consistent. Astra independently inspected the pinned
code and researched primary sources. The current feature is four Google Maps
category links, **not an in-app business recommendation feed**. There is no
destination inventory, opening-hours response, ranking, retrieval timestamp or
business-hours cache to refresh. The inspected client/server/scripts contain no
Places nearby-search integration.

The old module appears after reviews and the original post. Its name
`verifiedVenueCoordinate` means numeric validation, not independent verification.
The Store matches catalog/event/review coordinates by venue name; this refresh
does not silently broaden that identity contract. Show documents expose a
start/date/timezone/lifecycle but do not consistently establish an end time.
The legacy date-only 8 p.m. countdown fallback must not drive after-show timing.

The useful next step is a compact planning module beside attendance and the
Lounge. It opens on demand and asks **Where to next?** Three real choices:

- **Food:** late-night food, coffee and dessert, with a kitchen-hours reminder.
- **Stay out:** bars, clubs/live music, karaoke/arcades, with last-entry and ticket
  guidance. These are search categories, not assertions that any place is open.
- **Get home:** enter a destination, choose transit/walking/driving, and open
  directions with the venue as the explicit origin. No device location is requested.

The surrounding ShowScreen card stays intact. Reuse theme colors, radii, spacing,
fonts, focus treatment and the hand-drawn icons; no new UI package, photos, map
embed, top-level navigation or competing primary booking action. Rows wrap on
narrow screens, with 44-point minimum controls and full-row actions.
A containing concert-page section can use `showTitle={false}` to avoid two
disclosures. The default module is collapsed.

## Primary-source findings

| Evidence | Product consequence |
| --- | --- |
| [Google Places resource reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places) distinguishes regular hours from current opening hours, which cover the next seven days with exceptions; it also models business status, timezone and secondary service hours including KITCHEN. | Regular hours and OPERATIONAL status do not prove availability at a future arrival. No open-at, kitchen-open or “verified” badges. |
| [Google special-hours guidance](https://support.google.com/business/answer/6303076?hl=en) describes hours crossing into the next calendar day and special-hours replacement behavior. | Arrival after midnight needs the actual arrival date and intervals that may have started the previous day. Never filter solely by the show's named day. |
| [Massey Hall FAQ](https://masseyhall.mhrth.com/frequently-asked-questions/) says performance lengths and set times vary, with day-of-show checks. | Do not derive finish time from doors/start plus a universal duration. This release has no departure-time picker implying a filter it cannot apply. |
| [fabric FAQ](https://www.fabriclondon.com/faq) describes last entry before the event ends and ticket-specific entry slots. | Club closing time is not the admission deadline or proof a ticket holder can get in. |
| [Duck & Waffle dinner](https://duckandwaffle.com/london/menu/dinner/) and [late-night menus](https://duckandwaffle.com/london/menu/late-night/) have separate service periods. | Food-service/menu hours are distinct from premises hours. These are research examples, not recommended inventory. |
| [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) documents api=1 search and directions, explicit origin/destination and travel modes without an API key. | Use supported URLs. Venue name/city is a category-search hint, not a guaranteed search radius. Route home from explicit venue coordinates; do not label straight-line distance as walking time. |
| [Google business-data sources](https://support.google.com/business/answer/2721884?hl=en) includes owner/user contributions, sites and other sources. | Retrieval age and source verification age are different. No fabricated “updated just now” badge. External results may still be inaccurate. |
| [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) set attribution and storage constraints for Places content. | A future provider-backed design needs its own policy/cost review; this release stores no Places content and enables no paid API. |
| [TTC routes and schedules](https://www.ttc.ca/routes-and-schedules) describes a distinct overnight network. [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/) represents after-midnight service-day times above 24:00:00 using the agency timezone. | A nearby station is not proof of a running service. A future transit engine must preserve service-day/calendar semantics; this release hands route and last-service checks to Maps. |
| [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) is the repository's required versioned source. | Preserve the existing Expo 57 / React Native Web implementation and startup split. |

The browser-style search URL previously appended an undocumented viewport path.
This release uses the documented universal search URL and encodes the venue and
city in the query. It does **not** promise that Google will keep a strict center,
radius or ignore personalization. Real Maps app handoff still needs phone acceptance.

## Data and behavior limits

- Venue-local calendar dates are formatted without converting them through the
  viewer's timezone. No show-end estimate, opening interval, distance or ETA is
  computed. Midnight/DST tests cover date preservation, not a nonexistent
  availability engine.
- The exact validated lifecycle already computed by ShowScreen is passed in.
  Completed, cancelled and postponed shows use neutral **Around the venue** copy.
  Existing post-event presentation handles historical legacy records. Map listings
  are not presented as evidence of what existed on an old show date.
- Missing coordinates produce a real unavailable state. The existing “See this
  venue” action remains available on the show page. No phone-centered fallback.
- No saved recommendations or hours means there is no app-side stale-result cache.
  Current provider freshness remains unknown and stated as unverified.
- The typed route destination exists only in component memory and is sent to
  Google Maps only when the person opens the route. No analytics or persistence
  is added. Changing show identity or unmounting clears it.
- Double taps while a link is pending are gated. A later outcome cannot set an
  error after unmount, an intent change or a target change. Errors are visible
  with the deliberate `PIT-LINK-001` catalog entry; tapping again retries.
- React Native Web's Linking implementation does not report a browser popup
  blocker that silently returns null. The visible failure path handles rejected/
  thrown launches; it cannot certify that the external app rendered a route.
- Maps must resolve a usable route, departure time, last service, accessibility,
  pickup rules and ride availability. None is guaranteed here.

## Integration

No backend schema, provider, Store, account permission or location permission changes.

The overlapping file with the concert redesign is **src/screens/ShowScreen.jsx**.
Its changes are only: move the section immediately after Going/Lounge/going-ticket
controls and before Crowd, pass the existing lifecycle, and set
`keyboardShouldPersistTaps="handled"` on the containing vertical ScrollView.

When integrating into the combined concert/rating page:
1. Keep its photos, essentials, overall score and Reviews first. Place this in
   the secondary section group beside Crowd & Lounge, ahead of Setlist.
2. Render `<NearbyAfterparty log={norm} coord={coord} lifecycle={...} showTitle={false} />`
   inside its own disclosure, or use the component's default disclosure by itself.
3. Pass `lifecycleView.lifecycle`, using `"completed"` for the existing legacy
   post-event presentation only when lifecycle is `"unknown"`.
4. Use **Around the venue** for completed/cancelled/postponed section headings.
5. Preserve the containing ScrollView keyboard behavior.
6. Recheck venue coordinate identity after merging venue work. Prefer its canonical
   resolved coordinate if available; do not invent a new source contract here.

Read-only comparison: `task-7/concert-page-clarity` at
`cabcd13328817b48cf0344cbb2a221c0bb24be11` already has a `ShowSection`
with key `nearby:${socialIdentity}`, title `Nearby`, and an inner afterCard.
Adapt that existing section; do not replay the baseline card move wholesale.
Rename its title to After the show/Around the venue, use the summary
`Food, places to go & routes home`, remove the redundant inner afterCard, and
pass `showTitle={false}`. Preserve its other rating/review and section changes.

Other possible merge overlaps are **src/lib/errorCatalog.mjs**, **ERROR_CATALOG.md**
(the additive PIT-LINK-001 entry) and **STATUS.md** (append this local status).
No venue or creator-account files are edited. Avoid replacing those owners'
ShowScreen or error-copy changes wholesale. Re-run the browser verifier and web
budget on the combined tree.

## Validation

Final-source receipts:

- `npm test`: **7,389 tests; 7,388 passed, 0 failures, 1 existing Windows
  file-symlink skip**. The focused selection passes 31/31 (8 dedicated after-show
  cases plus existing error and concert/discussion integration assertions).
- Browser verifier: **7/7** scenarios at 320/375/1280 px, Stage and Daylight,
  missing coordinates, cancelled and historical shows, plus 160% enlarged browser
  text at 320 px. It exercises actual intent changes, all three route modes,
  keyboard Enter on search links, failure/retry, collapse/reopen and navigation
  away/back with destination clearing. No app writes or external requests occur.
- Syntax: **955 Node files passed**; final browser script also checked directly.
  Architecture and `git diff --check` pass.
- Final production export and startup budget pass: **521,996 bytes (509.8 KiB)
  gzip / 524,288 bytes (512 KiB)**, with 2,292 bytes headroom. No paused-player
  labels leaked into startup. Recheck this narrow headroom after integration.
- `npm run check` is **not fully passed**: its tests passed, but the dependency
  audit could not reach npm. A separate escalation for
  `npm --cache .tmp/npm-cache audit --omit=dev --audit-level=high` was **denied
  before execution** by automatic review, which said: “The audit sends the
  project's dependency metadata to the public npm advisory service, an untrusted
  external destination, without explicit user authorization for that disclosure.”
  Trusted user history supplied no new authorization; the denied action was not
  retried. The other aggregate gates were run separately. Both dependency files
  are unchanged. Completing this gate needs explicit disclosure approval.
- Not run: physical iOS/Android Maps handoff, real search relevance, native screen
  reader/Dynamic Type/keyboard, and the combined concert/venue/creator build.
  Browser text enlargement is only an approximation of native Dynamic Type.

Commands for a subsequent local verification (`npm run check` includes the
external audit and must wait for the disclosure approval above):
```text
node --test src/lib/afterparty.test.mjs
node scripts/verify-aftershow-browser.mjs
npm run check
git diff --check
```

Browser verifier uses only an exported local build and synthetic intercepted APIs.
Google launches are intercepted; all non-loopback requests are aborted.
Set PIT_PLAYWRIGHT_MODULE and PIT_BROWSER_EXECUTABLE when Playwright/Chromium is
provided separately. Screenshots and JSON results are under
`.tmp/aftershow-browser/`; aggregate logs under `.tmp/checks/`.
