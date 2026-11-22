# Sasha Keable: exact Toronto editorial backfill preflight

This package includes a read-only default preflight and an explicit local
operator command, with no startup write, HTTP writer or permission change.
It is for a single performance: Sasha Keable, Act Right Tour, with EJ
Ross, March 30, 2027 at The Opera House, Toronto. [The seller's event
details](https://www.ticketmaster.ca/sasha-keable-act-right-tour-toronto-03-30-2027/event/1000656CE4C7E82A)
separate doors at 19:00 EDT (23:00Z) from the show at 20:30 EDT (00:30Z March
31). The [promoter announcement](https://news.livenationentertainment.com/news/sasha-keable-announces-act-right-world-tour)
and [venue](https://www.theoperahousetoronto.com/shows) identify the same
occurrence. The artist's [tour and waitlist](https://sasha-keable.lnk.to/actrighttour)
is the source for sold out, not the seller's generic purchase label or the
Discovery event lifecycle. Re-check the exact Toronto section before release.

## Exact release gates

1. Verify a current source check on the artist's Toronto entry. Persist an
   availability status, its source and its review time separately from the
   scheduled lifecycle. Suppress the waitlist at the start of the event, on a
   conflicting update, or after the 24-hour evidence window without refresh.
   Never generate an available purchase offer from stale/unknown evidence.
2. Use a read-only catalog snapshot with the exact preview. Resolve any name,
   slug, venue, seller SKU or event ambiguity before writing anything. The
   retail SKU 1000656CE4C7E82A and promoter link key 1AvZZ_pGkS0sXOn are not
   verified Discovery event IDs. Do not set provider_event_id or claim a
   Ticketmaster attraction link. Keep the existing venue independently bound
   to ticketmaster / KovZpZAFlvvA, Toronto, CA, 735 Queen St. E.
3. The ordinary admin form still lacks this contract. After a separately
   reviewed/deployed exact code release, use a current database backup and
   first rehearse on a copy with the command below. It atomically creates
   the exact identities and stores dated evidence; runtime projects the
   current waitlist without a purchase link or Offer schema. It is not
   invoked during startup or research. Do not apply to the live database
   before backup verification and explicit exact-release approval.
4. Exact future licensed matches for the same seller SKU, venue, artist,
   local date and verified doors/show clock are held for review, not silently
   merged. An existing provider record with these IDs is never overwritten.
   A matching occurrence accompanied by a provider lifecycle disagreement or
   uncertain clock suppresses stale editorial availability; ambiguous or
   genuinely different provider records remain on their independent path.
   Preserve saved IDs and reviews, review any ambiguity before reconciling.
5. Verify one discoverable event and one artist; check the direct event, local
   city/date, canonical Opera House venue and native/web official waitlist
   with no purchase offer. Verify a repeated identical apply is a no-op; do
   not delete or reassign the public editorial ID after anyone can save it.

On a verified throwaway copy (or later on the authorized database only after
the above gates), the exact commands are:

```sh
node scripts/backfill-reviewed-sasha-editorial.mjs --database "$ABSOLUTE_DB_PATH" --checked-at "$FRESH_UTC_CHECK_ISO"
# Only if explicitly authorized for this database after a matching preview:
node scripts/backfill-reviewed-sasha-editorial.mjs --database "$ABSOLUTE_DB_PATH" --checked-at "$FRESH_UTC_CHECK_ISO" --apply sasha-keable-toronto-2027-03-30
```

## Separate Ticketmaster Discovery filter preflight

Run this only on the Mac with separately authorized existing local
Discovery API access. No production environment, database, auth token
logging, write-through artist resolve, ingestion, flag enablement, or retries
after 401/403/429. Use HTTPS and the official Discovery v2 event search, with
normal Music classification and Toronto city filters, locale wildcard and
TBA/TBD excluded. Stop at page zero for each comparison; total at most
eight requests, paced at least 550 ms apart, redacting the key and output
limited to matching records and coverage counts. If a match is missing from
a truncated sample, record it as inconclusive, not proof of absence.

Replay as of `2026-11-21T23:55:00Z`: ordinary event-date window Nov 21
through Feb 18 (UTC, 90 inclusive days), then held early-lane event dates
Feb 19 through Nov 22, 2027 with `onsaleStartDateTime` Nov 19 23:55 UTC,
`onSaleStartDate,asc`, and an independently enforced sale-start upper bound
Nov 28 23:55 UTC. This reproduces the real held candidate, not what the
provider returned in the past. Compare targeted Toronto keyword/day scans
for March 30 (Sasha), March 6 (Gabriel Jacoby), March 24 (Jhené Aiko) and Feb
4 (Chase Matthew / Lauren Alaina). Use Toronto local dates or UTC daylight
windows that include the next UTC midnight. If needed, reserve two
additional queries to probe separate `publicVisibilityStartDateTime` and
`preSaleDateTime` windows Nov 17 00:00 UTC through before Nov 22 00:00 UTC.
Confirm these array filters’ wire encoding and actual behavior before
considering any change to the held branch. The alternate Ticketmaster
manual and current API reference disagree on the meaning of
`onsaleEndDateTime`; do not use it as an upper bound for sale starts.

Match seller IDs 1000656CE4C7E82A, 1000656F182E7E07, 1000656B90865C8C and
1000656DBE8EB9CA. Record nearby parking separately as 1000656DBDFCB897, not
admission. Record current query time, sanitized parameters, totals, the
actual Discovery event/attraction/venue IDs as returned, seller link, date,
classification, status, public sale start and presale times; preserve the
difference between data missing today and unknown historical delivery. The
held early lane remains opt-in off until live semantics are verified.
