# Discover show-to-artist loading repair — 2026-09-20

## Confirmed failure

Imran Khan and Moon Walker were present as event billing but absent from the saved artist catalogue. The resolver returned a successful **transient provider preview**, not a stored page. Navigation correctly refused to invent a canonical profile from that preview. A profile read returned no artist, and the missing artist's live-summary read returned 404.

This was not evidence of a fresh MusicBrainz outage: the checked production request/application error window on September 20 contained no matching 5xx errors. A bounded sample of ten Toronto event performer names had only one exact stored artist match; one missing value was an event title rather than an actual single performer. That sample is not a site-wide failure rate.

The structural gap was that event ingestion could save names without creating artists, while biography enrichment only selected already-saved artists with a MusicBrainz ID. Adding enrichment concurrency could not repair missing identities.

## Repair

- Add reviewed musician identities for Imran Khan and Moon Walker through the existing INSERT-only boot registry. Preserve existing namesakes, owner content and conflicting identities; do not seed guessed biographies, birth dates or photos.
- Recheck a transient client preview on explicit retry. Never promote transient metadata into proof of a persisted artist/archive identity.
- Register missing, unambiguous performers during the existing trusted Ticketmaster import using the exact attraction ID and Music classification. Do not register the event-title fallback, a requested-name mismatch, or a reviewed joint attraction as a solo performer.
- Store an exact, case-sensitive provider-ID mapping. Do not infer a MusicBrainz ID or grant ownership/verification from provider data.
- Preflight same-name identities across a batch and check existing rows, including member-created and held identities. Existing records are not overwritten. Renames and conflicts require review rather than an automatic name merge.
- Mark unresolved event identities explicitly. Keep the event date, venue, tickets and refresh available, but do not resolve a different artist by name or inherit that artist's memorial, schedule, reviews or profile link.
- Normalize valid-but-non-object legacy artist JSON before public projection so optional metadata cannot crash a profile read.

## Resource bounds

Registration uses metadata already fetched by the existing importer; it adds no provider requests, media downloads, paid worker or service. Limits are 40 new artists per batch, 1,000 per UTC day and 10,000 lifetime registrations. Durable counters survive restarts and clock rollback. Deferred rows remain explicit rather than fabricated. Existing event/provider rate limits, retries and background scheduling remain in force.

This does **not** fill every biography or photo immediately. Provider-only identities deliberately retain a null MusicBrainz ID until an authoritative cross-source identity is established. The existing MusicBrainz-keyed enrichment worker cannot enrich those rows merely from a similar name. Those limitations are preferable to assigning the wrong person's facts or artwork.

## Verification

Automated coverage includes trusted event import → saved artist → public event resolution → local artist resolver → profile/memorial/live-summary/public link, with network calls blocked and SQLite in query-only mode during reads. Additional tests cover rollback, idempotence, budgets, namesakes, held and claimed rows, preserved restrictions after incomplete provider responses, and mobile/desktop Discover Shows → show → artist navigation and retry.

Deployment is verified separately against the running release; local fixtures alone do not prove production is updated.

## Reviewed identity evidence

- Imran Khan: [MusicBrainz bhangra artist](https://musicbrainz.org/artist/ea4c3e59-f2bc-4880-942e-fbeaa64d8573), [official site](https://imrankhanworld.com/), and Ticketmaster's REBEL listing for the Unforgettable Era show. Sources differed on birth date, so no birth-date fact was seeded.
- Moon Walker: [MusicBrainz US rock artist](https://musicbrainz.org/artist/5c4c2df9-63ba-4605-a965-5ea11db27cf5), its official-homepage relationship, and matching releases on the [official artist site](https://www.listentomoonwalker.com/) and [artist-owned Bandcamp](https://moonwalkerbandofficial.bandcamp.com/).
