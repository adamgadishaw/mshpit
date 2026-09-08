# Mshpit — usability and search review
Date: 2026-09-08

## What changed

- Landing: a clear concert/review explanation, Find concerts opens the event directory, and public artist, venue, and city links are available before signup. Existing consent-filtered community photography remains in place.
- Search: category counts describe the matches already loaded. Show all reveals those matches without another request or losing the query. Empty categories offer matching alternatives and a focused Clear search action.
- Discover: the selected date request owns loading/error messages. Failed requests offer retry; empty ranges offer a wider date window or Worldwide. Search keeps its horizontal city rail; Discover keeps its city grid.
- Public links: venue browsing and authentication entry pages have explicit routes, so the displayed destination can survive reload and new-tab navigation.
- Search presentation: venue titles include location; event titles/descriptions show readable dates and cancellation/postponement status; past events are not advertised as upcoming. Default city summaries describe available content, while moderation-authored overrides remain authoritative.
- Public schedules: local clock times no longer show raw ISO strings. Artist totals use the full count and identify the short schedule as a preview.
- Crawlable mobile pages: public navigation stays available rather than hiding everything except login. Navigation, loading notices and legal footer links are excluded from snippet text; substantive page content remains available.
- Public Terms: eligibility, shared-email signup and inactivity language now matches the already-approved in-app policy. No new policy or effective date was introduced.
- Import integrity: a provider event that changes venue can no longer inherit an old, omitted title/address/timezone or clock value. Stable-ID venue renames and same-venue partial updates retain their existing behavior. Tests use isolated databases, not production data.

## What the live review found

Sampled home, artist, event and city URLs returned HTTP 200 with readable public HTML, canonical URLs and indexing directives. There was no evidence of a site-wide crawlability outage in those samples.

Two existing catalog issues remain unresolved; the import safeguard does not retroactively guess at their facts:

1. Bob Marley's public page and a Tanni Browne & One Love Orchestra event treat Marley as a current performer. This originates in provider/canonical billing, not simply title wording. Verify the provider attraction mapping and identity-bound lifecycle evidence before correcting it. Do not suppress artists based on generic “dissolved” data; bands can reunite.
2. Toronto's CKY listing has a title referring to Scranton's Ritz Theater but a Toronto venue/location. The mixed-snapshot import defect was reproduced, but no retained provider snapshot proves this specific record's history. Confirm the authoritative event record before correcting it. Two Damien Jurado listings at the same address also need canonical venue/duplicate review.

Public examples:
- https://www.mshpit.com/artist/bob-marley
- https://www.mshpit.com/event/tm_LvZ18QOvDtdbYu8vvzEV7
- https://www.mshpit.com/event/tm_1Ae0Z_aGki3ueoo
- https://www.mshpit.com/city/ca/toronto

## Click-through measurement

Search Console could not be read because the local browser-control connection failed. No click, impression, position or CTR figures have been assumed.

Export Performance → Search results for the last three months, including Queries and Pages. Prioritize relevant, high-impression pages with weak clicks; compare branded/non-branded searches and mobile/desktop separately. Read average position alongside CTR: poor ranking and an unpersuasive result are different problems. Compare the same page/query cohorts over equivalent periods after release and recrawl, accounting for changing show dates and demand.

These changes improve clarity and result accuracy; they do not guarantee rankings, rich results or clicks. Google can choose its own title and snippet and needs to recrawl updated pages.

Official references:
- [Google title-link guidance](https://developers.google.com/search/docs/appearance/title-link)
- [Google snippet guidance](https://developers.google.com/search/docs/appearance/snippet)
- [Google event structured-data requirements](https://developers.google.com/search/docs/appearance/structured-data/event)

## Release status

Validation completed against the final local build:

- Full release check: 3,485 tests passed; production dependency audit reported zero vulnerabilities; syntax and architecture checks passed.
- Initial web JavaScript: 486.6 KiB gzip, below the existing 512 KiB budget.
- Isolated browser verification: 20 landing destination checks, 14 signup/optional-setup flows, 15 auth/navigation cases, 9 Search/Discover cases, and 6 rendered public-page cases. Relevant widths: 320, 390, 844 and 1280 pixels. No browser render errors in the successful runs.
- Expo navigation/UI guidance informed the shared mobile/web controls and tested route intent; the existing navigator, theme and photo system were retained.

Local implementation and regression checks only. No production database changes, commit, push or deployment were performed for this request. Earlier uncommitted signup-flow improvements are preserved. Browser tests use synthetic, isolated accounts/data and mocked external requests; they are not production traffic or physical-device tests.
