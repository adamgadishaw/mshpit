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
  if (!ourArtist && database.prepare("SELECT 1 FROM artist_profiles WHERE artist_key=?").get(wantArtist.key)) {
    blockers.push("existing_profile_requires_binding_review");
  }

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
  if (metaObject(database, PROVIDER_REVIEW_KEY)?.lifecycleChanged) blockers.push("provider_lifecycle_requires_review");
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

const EVIDENCE_KEY = "reviewed-editorial:sasha-keable:2027-03-30:availability";
const PROVIDER_REVIEW_KEY = "reviewed-editorial:sasha-keable:2027-03-30:provider-review";
const META_READ = "SELECT value FROM app_meta WHERE key=?";
const META_WRITE = "INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE app_meta.value<>excluded.value";

function metaObject(database, key) {
  try { return JSON.parse(database.prepare(META_READ).get(key)?.value || "null"); }
  catch { return null; }
}

export function sashaEditorialVenue(row) {
  const f = SASHA_EDITORIAL_OCCURRENCE;
  return row?.id === f.id && row.source === f.source && row.owner_id == null
    && row.provider_event_id == null && row.artist_key === f.artist.key && row.artist === f.artist.name
    && row.date === f.date && row.venue === f.venue.name && row.venue_city === f.venue.city
    && row.venue_country_code === f.venue.countryCode && row.event_name === f.eventName
    && row.event_source_url === f.promoterSource ? f.venue : null;
}

// The independent venue binding is an exact exception to the provider-pair
// query, without changing the event's own source or minting a venue.
export function sashaEditorialRowSql() {
  const f = SASHA_EDITORIAL_OCCURRENCE;
  const text = value => "'" + String(value).replaceAll("'", "''") + "'";
  return `(td.id=${text(f.id)} AND td.source=${text(f.source)} AND td.owner_id IS NULL AND td.provider_event_id IS NULL
    AND td.artist_key=${text(f.artist.key)} AND td.artist=${text(f.artist.name)} AND td.event_name=${text(f.eventName)}
    AND td.date=${text(f.date)} AND td.venue=${text(f.venue.name)} AND td.venue_city=${text(f.venue.city)}
    AND td.venue_country_code=${text(f.venue.countryCode)} AND td.event_source_url=${text(f.promoterSource)})`;
}

export function sashaEditorialVenueSql() {
  const v = SASHA_EDITORIAL_OCCURRENCE.venue;
  return `(?1='${v.catalogueSource}' AND ?2='${v.catalogueId}' AND ${sashaEditorialRowSql()})`;
}

export function projectSashaEditorialAvailability(database, row, at = Date.now()) {
  const venue = sashaEditorialVenue(row);
  if (!venue) return null;
  const evidence = metaObject(database, EVIDENCE_KEY);
  const providerReview = metaObject(database, PROVIDER_REVIEW_KEY);
  const exactEvidence = evidence?.source === SASHA_EDITORIAL_OCCURRENCE.availabilitySource
    && evidence.status === "sold_out" && row.event_status === SASHA_EDITORIAL_OCCURRENCE.lifecycle
    && (!providerReview?.lifecycleChanged || evidence.checkedAt > providerReview.observedAt);
  const availability = reviewedSashaAvailability({ at, checkedAt: exactEvidence ? evidence.checkedAt : null });
  return {
    venueCanonicalPath: venue.canonicalPath,
    soldOut: availability.status === "sold_out",
    ticketUrl: null,
    ticketWaitlistUrl: availability.waitlistUrl,
    ticketAvailability: availability.status,
    ticketAvailabilityCheckedAt: availability.checkedAt,
    ticketAvailabilitySource: availability.source,
  };
}

export function applyReviewedSashaEditorialBackfill(database, { checkedAt, at = Date.now() } = {}) {
  // This is explicit maintenance only, never installed as a route or invoked
  // from a read/startup. A single write lock covers dedupe, event and evidence.
  const nested = database.isTransaction === true;
  database.exec(nested ? "SAVEPOINT reviewed_sasha_editorial" : "BEGIN IMMEDIATE");
  const rollback = () => database.exec(nested ? "ROLLBACK TO reviewed_sasha_editorial; RELEASE reviewed_sasha_editorial" : "ROLLBACK");
  try {
    const plan = previewReviewedSashaEditorialBackfill(database, { checkedAt, at });
    if (!plan.eventRecord) {
      rollback();
      return plan;
    }
    const f = SASHA_EDITORIAL_OCCURRENCE, a = f.artist;
    if (plan.status === "fixture_candidate") {
      database.prepare(`INSERT OR IGNORE INTO artists(norm,name,public_slug,search_key,source,data,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(a.key,a.name,a.slug,a.searchKey,f.source,JSON.stringify({ name:a.name }),at,at);
      const fields = Object.keys(plan.eventRecord);
      database.prepare(`INSERT INTO tour_dates(${fields.join(",")}) VALUES(${fields.map(()=>"?").join(",")})`)
        .run(...fields.map(field => plan.eventRecord[field]));
    }
    const existing = metaObject(database, EVIDENCE_KEY);
    const fresh = !existing || !Number.isSafeInteger(existing.checkedAt) || checkedAt > existing.checkedAt;
    const evidence = { status: "sold_out", source: f.availabilitySource, checkedAt };
    const evidenceUpdated = fresh && database.prepare(META_WRITE).run(EVIDENCE_KEY, JSON.stringify(evidence)).changes === 1;
    database.exec(nested ? "RELEASE reviewed_sasha_editorial" : "COMMIT");
    return { ...plan, mode: "explicit_maintenance", status: plan.status === "fixture_candidate" ? "inserted" : "already_prepared", evidenceUpdated };
  } catch (error) {
    rollback();
    throw error;
  }
}

// For this exact normal occurrence only, don't manufacture a second public
// event when licensed data first arrives. Retain a bounded receipt for review.
// Different date/venue/artist or nonmatching seller SKU stays visible to the
// default importer and is never deemed a duplicate by this clause.
export function deferExactSashaProviderDuplicate(database, row, observedAt) {
  const f = SASHA_EDITORIAL_OCCURRENCE, v = f.venue;
  if (row?.source !== "ticketmaster" || row.owner_id != null || row.artist !== f.artist.name || row.date !== f.date
    || row.venue_provider_id !== v.catalogueId || row.venue_city !== v.city || row.venue_country_code !== v.countryCode
    || !matchesVenueName(row.venue) || !/^[A-Za-z0-9_-]{1,100}$/u.test(row.provider_event_id || "")) return false;
  let seller;
  try { seller = new URL(row.ticket_url); } catch { return false; }
  if (seller.protocol !== "https:" || seller.username || seller.password || seller.port
    || !["www.ticketmaster.ca","ticketmaster.ca"].includes(seller.hostname)
    || seller.pathname.match(/\/event\/([\da-f]+)\/?$/iu)?.[1]?.toUpperCase() !== f.sellerSku) return false;
  if (!sashaEditorialVenue(database.prepare("SELECT * FROM tour_dates WHERE id=?").get(f.id))) return false;
  // Never assume an existing provider event (with reviews or saved IDs) is ours to suppress.
  if (database.prepare("SELECT 1 FROM tour_dates WHERE id=? OR provider_event_id=? LIMIT 1").get(row.id || "", row.provider_event_id)) return false;
  const previous = metaObject(database, PROVIDER_REVIEW_KEY);
  const lifecycle = String(row.event_status || "").trim().toLowerCase();
  const localClock = String(row.start_local_time || "");
  const knownLocal = [f.startLocalTime, f.startLocalTime.slice(0,16), `${f.date}T19:00:00`, `${f.date}T19:00`];
  const knownInstant = [Date.parse(f.startDateTime), Date.parse(f.accessStartDateTime)];
  const clockMatches = Boolean((row.start_date_time || localClock)
    && (!row.start_date_time || knownInstant.includes(Date.parse(row.start_date_time)))
    && (!localClock || knownLocal.includes(localClock)));
  // Ordinary sale states don't prove inventory. A distinct lifecycle statement
  // blocks the public waitlist immediately until source review is newer.
  const changed = !clockMatches || ["canceled","cancelled","postponed","rescheduled"].includes(lifecycle);
  const receipt = { discoveryEventId: row.provider_event_id, lifecycle, observedAt, clockMatches,
    lifecycleChanged: changed || previous?.lifecycleChanged === true };
  if (!previous || previous.discoveryEventId !== receipt.discoveryEventId || previous.lifecycle !== lifecycle
    || previous.clockMatches !== clockMatches || previous.lifecycleChanged !== receipt.lifecycleChanged) {
    database.prepare(META_WRITE).run(PROVIDER_REVIEW_KEY, JSON.stringify(receipt));
  }
  return clockMatches;
}
