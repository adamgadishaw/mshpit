// An exact source-reviewed package for one Toronto occurrence. No production
// apply hook, scheduler, or endpoint lives here. Keep marketplace identity,
// venue catalog identity, and availability evidence separate.
export const SASHA_EDITORIAL_OCCURRENCE = Object.freeze({
  id: "editorial_sasha-keable_toronto_2027-03-30",
  source: "reviewed-editorial",
  artist: Object.freeze({ key: "sasha keable", name: "Sasha Keable", slug: "sasha-keable", searchKey: "sashakeable" }),
  eventName: "Sasha Keable - Act Right Tour",
  tourName: "Act Right Tour",
  support: "EJ Ross",
  lifecycle: "scheduled",
  date: "2027-03-30",
  startLocalTime: "2027-03-30T20:30:00",
  startDateTime: "2027-03-31T00:30:00Z",
  accessStartDateTime: "2027-03-30T23:00:00Z",
  timezone: "America/Toronto",
  venue: Object.freeze({
    name: "The Opera House", city: "Toronto", region: "ON", countryCode: "CA", address: "735 Queen St. E.", postalCode: "M4M 1H1",
    catalogueSource: "ticketmaster", catalogueId: "KovZpZAFlvvA", canonicalPath: "/venue/ticketmaster-kovzpzaflvva",
  }),
  promoterSource: "https://news.livenationentertainment.com/news/sasha-keable-announces-act-right-world-tour",
  venueSource: "https://www.theoperahousetoronto.com/shows",
  sellerSource: "https://www.ticketmaster.ca/sasha-keable-act-right-tour-toronto-03-30-2027/event/1000656CE4C7E82A",
  sellerSku: "1000656CE4C7E82A",
  promoterAlias: "1AvZZ_pGkS0sXOn",
  availabilitySource: "https://sasha-keable.lnk.to/actrighttour",
});

const DAY_MS = 86_400_000;
const eventStart = Date.parse(SASHA_EDITORIAL_OCCURRENCE.startDateTime);
const folded = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/gu, "");
const matchesVenueName = value => ["theoperahouse","operahouse"].includes(folded(value));
const validCheckedAt = (checkedAt, at) => Number.isSafeInteger(checkedAt)
  && checkedAt >= Date.parse("2026-11-20T15:00:00Z") && checkedAt <= at && at - checkedAt < DAY_MS && at < eventStart;

// A new official verification must be supplied before preparing live use.
// Absence/expiry never turns into "available" or a stale purchase/queue CTA.
export function reviewedSashaAvailability({ checkedAt, at = Date.now() } = {}) {
  const verified = validCheckedAt(checkedAt, at);
  return Object.freeze({
    status: verified ? "sold_out" : "unknown",
    source: SASHA_EDITORIAL_OCCURRENCE.availabilitySource,
    checkedAt: Number.isSafeInteger(checkedAt) ? checkedAt : null,
    waitlistUrl: verified ? SASHA_EDITORIAL_OCCURRENCE.availabilitySource : null,
    purchaseUrl: null,
  });
}

export function previewReviewedSashaEditorialBackfill(database, { checkedAt, at = Date.now() } = {}) {
  const facts = SASHA_EDITORIAL_OCCURRENCE, v = facts.venue, wantArtist = facts.artist;
  const availability = reviewedSashaAvailability({ checkedAt, at });
  const blockers = [];
  const artists = database.prepare(`SELECT norm,name,public_slug,search_key,source FROM artists
    WHERE norm=? OR lower(trim(name))=? OR lower(public_slug)=? OR search_key=? LIMIT 3`)
    .all(wantArtist.key, wantArtist.key, wantArtist.slug, wantArtist.searchKey);
  const ourArtist = artists.length === 1 && artists[0].source === facts.source && artists[0].norm === wantArtist.key
    && artists[0].name === wantArtist.name && artists[0].public_slug === wantArtist.slug && artists[0].search_key === wantArtist.searchKey;
  if (artists.length && !ourArtist) blockers.push("existing_artist_requires_binding_review");

  const probable = database.prepare(`SELECT id,artist,artist_key,event_name,date,venue,venue_city,venue_country_code,
       venue_provider_id,source,owner_id,provider_event_id,ticket_url,event_source_url,release_at
    FROM tour_dates WHERE id IN (?,?) OR provider_event_id=?
       OR instr(upper(coalesce(ticket_url,'')),?)>0
       OR (date=? AND (lower(trim(artist))=? OR artist_key=? OR instr(lower(event_name),?)>0))
    LIMIT 25`)
    .all(facts.id, `tm_${facts.promoterAlias}`, facts.promoterAlias, facts.sellerSku, facts.date, wantArtist.key, wantArtist.key, wantArtist.key);
  const ours = probable.find(row => row.id === facts.id);
  const ourEvent = ours && ours.artist_key === wantArtist.key && ours.artist === wantArtist.name && ours.event_name === facts.eventName
    && ours.source === facts.source && ours.date === facts.date && ours.venue === v.name && ours.venue_city === v.city
    && ours.venue_country_code === v.countryCode && ours.event_source_url === facts.promoterSource && ours.owner_id == null
    && ours.provider_event_id == null && ours.ticket_url == null;
  if (ours && (!ourEvent || !ourArtist)) blockers.push("editorial_identity_drift");
  if (probable.some(row => row.id !== facts.id) || probable.length === 25) blockers.push("existing_event_requires_dedupe_review");

  const venueRows = database.prepare(`SELECT DISTINCT venue, venue_city, venue_country_code, venue_address_line1
    FROM tour_dates WHERE source=? AND venue_provider_id=? AND venue_address_line1 IS NOT NULL AND release_at<=?
    LIMIT 20`).all(v.catalogueSource, v.catalogueId, at);
  if (!venueRows.length || venueRows.length === 20 || !venueRows.every(row => matchesVenueName(row.venue)
      && folded(row.venue_city) === folded(v.city) && folded(row.venue_country_code) === folded(v.countryCode)
      && folded(row.venue_address_line1) === folded(v.address))) blockers.push("canonical_venue_requires_review");
  if (availability.status !== "sold_out") blockers.push("availability_requires_fresh_check");

  const reviewed = blockers.length === 0;
  return {
    mode: "read_only",
    status: reviewed ? (ourEvent ? "already_prepared" : "fixture_candidate") : "needs_review",
    blockers,
    evidence: facts,
    availability,
    eventRecord: reviewed ? {
      id: facts.id, artist: wantArtist.name, artist_key: wantArtist.key, venue: v.name,
      place: "Toronto, Ontario, Canada", date: facts.date, event_name: facts.eventName, tour_name: facts.tourName,
      source: facts.source, provider_event_id: null, owner_id: null,
      // Current production columns cannot express a dated availability
      // assertion. Do not set a sticky flag or make a waitlist a buy offer.
      sold_out: 0, ticket_url: null, event_status: facts.lifecycle, event_timezone: facts.timezone,
      start_date_time: facts.startDateTime, start_local_time: facts.startLocalTime,
      access_start_date_time: facts.accessStartDateTime, access_start_approximate: 0,
      venue_address_line1: v.address, venue_city: v.city, venue_region: v.region, venue_country_code: v.countryCode,
      venue_country: "Canada", venue_postal_code: v.postalCode,
      // Bind via the separate reviewed venue identity, not a fake editorial
      // provider venue ID, which would mint a second venue route.
      venue_provider_id: null, event_kind: "concert", music_qualified: 1, music_evidence: "staff:verified-official-source",
      billed_artists: JSON.stringify([wantArtist.name, facts.support]),
      event_source_url: facts.promoterSource, release_at: 0, updated_at: at,
    } : null,
  };
}
