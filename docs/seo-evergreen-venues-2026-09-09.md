# Venue and city indexing repairs

## Scope

The Search Console screenshot reported 40,935 discovered-but-not-indexed URLs.
That is not evidence that those URLs are broken or that a single change will
make Google index them. This patch repairs two confirmed site-side defects;
it does not remove the event catalogue or weaken private/thin-page protections.

## Changes

- City sitemap entries retain the saved numeric modification timestamp until
  XML rendering. Missing, invalid, or out-of-range values remain omitted instead
  of being replaced with the sitemap build time.
- Useful venue guides remain eligible for indexing after their last concert.
  The shared page/sitemap rule requires a verified locality, real capacity,
  and valid coordinates. A photo or generic directions link alone is not enough.
- Public venue reads retain historical locality through an indexed, single-row
  lookup. Exact provider identity and existing publication/account restrictions
  remain enforced. Historical dates do not become upcoming dates.
- Same-named buildings in different cities cannot borrow another venue's facts.
  Unknown-location, nonmusic-only, and unreleased records do not earn the new
  evergreen eligibility. Sitemaps preserve existing canonical URL safeguards.
- Venue identity resolution uses the same public music evidence as guide and
  sitemap eligibility. A newer nonmusic or parking record cannot replace the
  valid music venue's name. Slug-equivalent provider IDs consistently use the
  latest valid music identity without borrowing another raw ID's locality.
- Sitemap policy revision is now 5. A persisted revision 4 snapshot is rejected
  even when fresh, so startup rebuilds it under the repaired eligibility rules
  instead of reusing old-policy XML for up to 15 minutes.

## Verification

Regression coverage includes a show leaving the calendar, withdrawn historical
dates, wrong-city names, exact provider namespaces, unreleased/inactive records,
unknown modification dates, saved city edits, and indexed SQL query plans.
Additional cases cover newer nonmusic/parking renames and colliding provider
public slugs with matching and mismatched cities.
The integrated `npm run check` completed successfully on September 9, 2026,
before the final server-only snapshot revision bump:

- 3,872 tests passed; zero failed (including 26 focused routing and venue tests).
- Production dependency audit: zero reported vulnerabilities.
- Syntax check: 539 Node files passed; architecture checks passed.
- Production web export passed. Initial JavaScript was 493.0 KiB gzip against
  the 512.0 KiB budget; entry bundle `index-a24aa692b0afdc78ba22fb6e1eb91997.js`.
- Whitespace review passed. The local log is `.tmp/seo-evergreen-final-check.log`.

After the revision 4-to-5 change, all 36 focused snapshot-manager, sitemap,
city-integration, and evergreen-venue tests passed, including the new persisted
revision rejection/rebuild regression. This follow-up did not rerun the entire
suite or web export. Its log is `.tmp/seo-snapshot-revision-check.log`.
Syntax (539 Node files), architecture, and whitespace checks also passed again
after the revision bump.

No production database, Search Console settings, or server configuration was
changed. These code changes need deployment and subsequent Google recrawling;
the affected URL examples are still needed to diagnose the whole indexing queue.

The subsequent memory/reliability patch includes these repairs. Its final
integrated check passed 3,919 tests, syntax and architecture checks, dependency
audit, and production export. See `memory-reliability-2026-09-09.md`.
