# Provider event identity

Provider event IDs identify provider records, not necessarily performances. The
existing ingestion deliberately stores each record, which can include two
syndicated records for one show. Public reads previously treated every stored ID
as an independent event and emitted independent self-canonical pages.

`server/providerEventIdentity.js` supplies a conservative public identity layer.
It does not delete or merge rows, rewrite imported provider facts, move member
content, or change attendance references. Exact legacy API references remain
readable. Collections, public documents, artist primary schedules and sitemap
reads choose a deterministic representative, and public alias URLs redirect to
that representative with `302` and `Cache-Control: no-store`, so withdrawing a
representative cannot strand a browser behind a cached permanent redirect.
Supporting-artist schedules retain unique billing evidence
when the representative's provider snapshot lacks it.

Automatic matching requires a supported single-sale ticket URL, identical
performance instant with a complete explicit UTC offset, artist, venue, location,
date, event title and status. Date-only and offset-free input never proves an
instant. Peer eligibility uses the request's publication time, rather than one
provider row's release timestamp.
Known tracking parameters are ignored; unknown parameters are retained.
Member-authored records, unknown providers, festivals, missing times, different
sale URLs, separate start times and ambiguous evidence remain separate. Artist,
venue and date alone are never sufficient, nor is a small time difference.

## Reviewed doors/start exception

The venue confirms one **The South** show at **The Brook, Southampton**, on
**30 October 2026**, with **7:30 PM doors** and **8 PM approximate show time**,
with **King Brasstards** supporting:

<https://www.the-brook.com/tm-event/the-south/> (checked 30 October 2026).

The two observed mshpit provider records are:

- `tm_16wZk8IvsZA5v122`: 8 PM, retained public representative.
- `tm_LvZ18QnJ_3ZBENPibGAjN`: 7:30 PM, public alias.

The exception is scoped to those exact IDs, provider, artist, title, date, venue
and city, original precise provider instants, local clocks, timezone and status.
Changed, postponed, cancelled, or rescheduled provider facts supersede the
reviewed correction. It projects sourced doors/show fields and supporting billing without
altering either stored snapshot. The start remains marked approximate in the
data projection; doors are emitted as `doorTime` separately from `startDate` in
structured data. There are no additional visual badges or disclaimers.

Future exceptions require similarly explicit source evidence. Do not expand
matching to nearby times or invent a doors time from a discrepancy. Unresolved
potential duplicates remain visible until stronger evidence exists.

## Validation

Regression tests cover sale tracking aliases, distinct sales and times,
member-authored records, invalid/unknown evidence, reviewed exception scope,
non-destructive storage, inactive representatives, public redirects, canonical
sitemap inclusion, artist schedule totals, supporting billing, and separate
doors/start fields. The `(artist,date,id)` peer index bounds candidate lookup.

Attendance reads use the same proven performance group. Existing show IDs,
provider references, ticket snapshots, verification rows and attendance rows stay
stored in place. The member's latest state and audience control the grouped
projection, including crowd visibility and ticket authorization. Writes reuse
that member's existing show; an explicit removal clears only that member's
selections across the currently proven group. A withdrawn provider snapshot can
remain an existing attendance reference while only an active record can be the
public representative. Reads do not merge records, and
unproven same-night performances remain independent.
