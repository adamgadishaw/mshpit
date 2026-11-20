// Organizer-reviewed provider metadata: exact festival edition/date and bad venue,
// not a global alias for names containing "Redirect". Keep all ticket identities.
const CORONA_FRIDAY_IDS = new Set(["tm_G5vIZ_G2gu-Q7", "tm_1AfZk3_GkdB4TdH", "tm_1AfZk3_Gkdw1XuQ"]);
const EDITIONS = {
  corona: new Set(["2026-11-20", "2026-11-21", "2026-11-22"]),
  flow: new Set(["2026-11-28", "2026-11-29"]),
};
function text(value) { return String(value ?? "").trim().toLowerCase(); }
function normalized(value) {
  return text(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function edition(row) {
  if (!row || row.owner_id != null || row.ownerId != null || text(row.source) !== "ticketmaster") return null;
  const providerId = row.provider_event_id ?? row.providerEventId;
  if (!String(row.id || "").startsWith("tm_") || (providerId != null && row.id !== `tm_${providerId}`)) return null;
  const title = normalized(row.event_name);
  if (EDITIONS.corona.has(row.date) && (title === "corona capital" || /(^| )corona capital 2026($| )/.test(title))) return "corona";
  if (EDITIONS.flow.has(row.date) && (title === "coca cola flow fest" || /(^| )coca cola flow fest 2026($| )/.test(title))) return "flow";
  return null;
}
function wrongVenue(row) {
  return normalized(row.venue) === "autodromo hermanos rodriguez redirect"
    && (normalized(row.venue_city) === "temple city" || normalized(row.place).startsWith("temple city california"));
}
function lineup(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function hasReviewedMexicoLocation(row) {
  return text(row.venue_country_code) === "mx" || /(^| )mexico$/.test(normalized(row.place));
}
function reviewedCoronaFriday(row, festival = edition(row), isMexico = hasReviewedMexicoLocation(row)) {
  return festival === "corona" && row.date === "2026-11-20"
    && (CORONA_FRIDAY_IDS.has(row.id) || isMexico || wrongVenue(row));
}

// Mutate no saved Show, aliases or attendance. Project the recognized source's
// corrected information alongside the existing stable ID and private plan.
export function reviewedFestivalSavedShowPatch(show, source, corrected, performers) {
  if (!edition(source)) return null;
  const location = normalized(show.venue) === "autodromo hermanos rodriguez redirect"
    && normalized(show.city).startsWith("temple city") && hasReviewedMexicoLocation(corrected);
  const friday = reviewedCoronaFriday(source);
  if (!location && !friday) return null;
  const artist = friday && (normalized(show.artist) === "daniel caesar" || normalized(show.artist_key) === "daniel caesar");
  const lineupRows = friday ? performers.filter((performer) =>
    normalized(performer.name) !== "daniel caesar" && normalized(performer.key) !== "daniel caesar") : performers;
  if (friday && !lineupRows.some((performer) => normalized(performer.name) === "jamie xx")) {
    lineupRows.push({ key: null, name: "Jamie xx", role: "support", position: lineupRows.length });
  }
  return {
    ...(location ? { venue: corrected.venue, venueKey: null, city: corrected.venue_city } : {}),
    ...(artist ? { artist: "Corona Capital", artistKey: null } : {}),
    ...(friday ? { performers: lineupRows } : {}),
  };
}

export function reviewedFestivalEventRow(row) {
  const festival = edition(row);
  if (!festival) return row;
  let result = row;
  const isMexico = hasReviewedMexicoLocation(row);
  if (wrongVenue(row)) {
    result = {
      ...row, venue: "Autódromo Hermanos Rodríguez", place: "Mexico City, Ciudad de México, Mexico",
      venue_city: "Mexico City", venue_region: "Ciudad de México", venue_country_code: "MX",
      venue_country: "Mexico", venue_postal_code: "08400", venue_provider_id: null,
      venue_address_line1: null, venue_address_line2: null, lat: null, lng: null,
      event_timezone: "America/Mexico_City", start_date_time: null, start_local_time: null,
      access_start_date_time: null, access_start_approximate: null,
    };
  }
  if (!reviewedCoronaFriday(row, festival, isMexico)) return result;
  const billed = lineup(row.billed_artists).filter((name) => normalized(name) !== "daniel caesar");
  // Keep an existing confirmed billing slot unless it would be hidden by the
  // first 20 names shown on the event page and in structured performers.
  const jamiePosition = billed.findIndex((name) => normalized(name) === "jamie xx");
  if (jamiePosition < 0) billed.unshift("Jamie xx");
  else if (jamiePosition >= 20) billed.unshift(...billed.splice(jamiePosition, 1));
  const changedPrimary = normalized(row.artist) === "daniel caesar" || normalized(row.artist_key) === "daniel caesar";
  return {
    ...result,
    billed_artists: typeof row.billed_artists === "string" ? JSON.stringify(billed) : billed,
    ...(changedPrimary ? {
      artist: "Corona Capital", artist_key: null, canonical_artist_key: null,
      provider_artist_id: null, artist_identity_status: null,
    } : {}),
  };
}

// Public artist-index SQL runs before event display projection. Restrict this
// predicate to the exact reviewed Friday records, owned by the provider.
export function reviewedFestivalStoredArtistAllowedSql(alias) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("Invalid tour-date SQL alias");
  const ids = [...CORONA_FRIDAY_IDS].map((id) => `'${id}'`).join(",");
  return `NOT (${alias}.id IN (${ids})
    AND ${alias}.owner_id IS NULL AND LOWER(TRIM(COALESCE(${alias}.source,'')))='ticketmaster'
    AND COALESCE(${alias}.date,'')='2026-11-20'
    AND (LOWER(TRIM(COALESCE(${alias}.artist,'')))='daniel caesar'
      OR LOWER(TRIM(COALESCE(${alias}.artist_key,'')))='daniel caesar'))`;
}

export function reviewedFestivalArtistQueryAllowedSql(alias) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("Invalid tour-date SQL alias");
  const ids = [...CORONA_FRIDAY_IDS].map((id) => `'${id}'`).join(",");
  return `NOT (${alias}.id IN (${ids}) AND ${alias}.owner_id IS NULL
    AND LOWER(TRIM(COALESCE(${alias}.source,'')))='ticketmaster'
    AND COALESCE(${alias}.date,'')='2026-11-20'
    AND LOWER(TRIM(@name))='daniel caesar')`;
}
