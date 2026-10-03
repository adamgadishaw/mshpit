import { canonicalVenueKey } from "../../../src/domain/venueIdentity.mjs";
import { payloadDigest } from "../mediaApi/mediaApiPolicy.js";
import { catalogRevision } from "../catalogResearch/catalogWorkQueue.js";
import { CATALOG_LIMITS, catalogKey, catalogType } from "./catalogApiPolicy.js";
import { ApiError } from "../../errors.js";
import { CATALOG_RESEARCH_FACTS, httpsUrl } from "../catalogResearch/catalogResearchFindings.js";

const text = (value, max = 200) => typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
export function venueResearchKey(name, city, country) {
  const venue = canonicalVenueKey(name);
  return venue ? [venue, text(city, 80).toLowerCase(), text(country, 8).toLowerCase()].join("|") : null;
}
const configured = new WeakMap();
function schema(database) {
  if (!configured.has(database)) {
    database.function("pit_catalog_venue_key", { deterministic: true }, venueResearchKey);
    configured.set(database, new Set(database.prepare("PRAGMA table_info(tour_dates)").all().map(row => row.name)));
  }
  return configured.get(database);
}
const json = value => { try { return JSON.parse(value || "null"); } catch { return null; } };
function providerFilter(columns) {
  return ["owner_id IS NULL",
    ...(columns.has("release_at") ? ["release_at<=?"] : []),
    ...(columns.has("provider_active") ? ["COALESCE(provider_active,1)=1"] : []),
    ...(columns.has("music_qualified") ? ["COALESCE(music_qualified,1)=1"] : []),
    ...(columns.has("artist_identity_status") ? ["COALESCE(artist_identity_status,'') NOT IN ('pending','conflict')"] : []),
  ].join(" AND ");
}
function venueProjection(columns) {
  const extra = column => columns.has(column) ? `MIN(${column})` : "NULL";
  const binding = column => columns.has(column) ? `NULLIF(lower(trim(${column})),'')` : "NULL";
  // IDs are local to their provider. Include incomplete bindings as their own
  // tuple so a known provider cannot silently absorb an unidentified record.
  const providers = `COUNT(DISTINCT json_array(${binding("source")},${binding("venue_provider_id")}))`;
  return `MIN(venue) name,MIN(venue_city) city,MIN(venue_country_code) country,
    ${extra("venue_address_line1")} address,${extra("venue_provider_id")} provider_id,
    ${extra("source")} source,${providers} providers,COUNT(*) n`;
}
export function catalogVenueResearchRows(database, { at, limit, offset }) {
  const columns = schema(database);
  // One grouped catalogue scan per bounded page. Passing this projection to
  // readCatalogEntity avoids a full venue scan for every rejected candidate.
  const rows = database.prepare(`SELECT pit_catalog_venue_key(venue,venue_city,venue_country_code) k,
    ${venueProjection(columns)},${columns.has("venue_region") ? "MIN(venue_region)" : "NULL"} region
    FROM tour_dates WHERE ${providerFilter(columns)} AND venue IS NOT NULL
    GROUP BY k HAVING k IS NOT NULL AND providers<=1 AND trim(COALESCE(city,''))<>'' AND trim(COALESCE(country,''))<>''
    ORDER BY n DESC,k LIMIT ? OFFSET ?`).all(...(columns.has("release_at") ? [at] : []), limit, offset);
  return rows.map(row => ({ venue: row.name, city: row.city, country: row.country, region: row.region,
    address: row.address, shows: row.n, catalogSnapshot: row }));
}
export function readCatalogEntity(database, { type, key, at = Date.now(), venueRow }) {
  catalogType(type); catalogKey(key);
  const columns = schema(database);
  let identity, canonical = {}, protectedFields = false;
  if (type === "artist") {
    const artist = database.prepare("SELECT * FROM artists WHERE norm=?").get(key);
    if (!artist || artist.source === "artist-created") return null;
    const profile = database.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);
    const data = json(artist.data);
    identity = { type, key, name: artist.name, mbid: artist.mbid || null, source: artist.source || null };
    canonical = { biography: text(artist.bio, 1200), genre: text(artist.genre, 100), country: text(artist.country, 100),
      formed: text(artist.formed, 100) };
    protectedFields = !!(artist.bio?.trim() || profile?.owner_id || profile?.removed || profile?.bio?.trim()
      || profile?.bio_staff_curated || (profile?.identity_review_status && !["clear","approved"].includes(profile.identity_review_status))
      || (data && Object.hasOwn(data, "biographyStaff")) || data?.genreRecord?.source === "staff");
  } else if (type === "venue") {
    const row = venueRow || database.prepare(`SELECT ${venueProjection(columns)} FROM tour_dates WHERE ${providerFilter(columns)}
      AND pit_catalog_venue_key(venue,venue_city,venue_country_code)=?`)
      .get(...(columns.has("release_at") ? [at] : []), key);
    if (!row?.n) return null;
    identity = { type, key, name: text(row.name, 160), city: text(row.city, 80), country: text(row.country, 8),
      providerId: row.provider_id || null, source: row.source || null, providerCount: row.providers };
    canonical = { address: text(row.address, 160) };
    protectedFields = row.providers > 1 || !identity.city || !identity.country;
  } else {
    const row = database.prepare("SELECT * FROM tour_dates WHERE id=?").get(key);
    if (!row || row.owner_id != null || !row.provider_event_id || !row.source || row.release_at > at
      || row.provider_active === 0 || row.music_qualified === 0 || ["pending","conflict"].includes(row.artist_identity_status)) return null;
    identity = { type, key, name: text(row.event_name || row.artist, 160), source: row.source,
      providerEventId: row.provider_event_id, artistKey: row.artist_key, venueProviderId: row.venue_provider_id || null,
      date: row.date, venue: row.venue };
    canonical = { artist: row.artist, venue: row.venue, date: row.date, startDateTime: row.start_date_time,
      status: row.event_status, ticketUrl: row.ticket_url, soldOut: row.sold_out, eventKind: row.event_kind };
    protectedFields = false;
  }
  const stored = type === "event"
    ? database.prepare("SELECT findings,hidden FROM catalog_event_enrichment WHERE event_id=?").get(key)
    : database.prepare("SELECT findings,status FROM catalog_research WHERE entity_type=? AND entity_key=?").get(type, key);
  const hidden = stored?.status === "hidden" || !!stored?.hidden;
  const findings = json(stored?.findings);
  const revision = catalogRevision(database, type, key);
  const identityHash = payloadDigest(identity);
  const valueHash = payloadDigest({ findings, canonical, protectedFields, hidden });
  return { type, key, identity, canonical, findings, revision, identityHash, valueHash,
    eligible: !protectedFields && !hidden, protected: protectedFields, hidden };
}
export function catalogFindings(type, record) {
  if (!record || record.version !== 1 || typeof record.summary !== "string") return null;
  return { version: 1, summary: record.summary.slice(0, 700),
    summarySources: (Array.isArray(record.summarySources) ? record.summarySources : []).filter(httpsUrl).slice(0, 4),
    facts: (Array.isArray(record.facts) ? record.facts : []).filter(fact => fact
      && Object.hasOwn(CATALOG_RESEARCH_FACTS[type], fact.field) && typeof fact.value === "string" && httpsUrl(fact.source))
      .slice(0, 8).map(fact => ({ field: fact.field, value: fact.value.slice(0, 160), source: fact.source })),
    images: (Array.isArray(record.images) ? record.images : []).filter(url => typeof url === "string"
      && /^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^\s?#]{3,240}$/u.test(url)).slice(0, 3) };
}
export function publicCatalogEntity(snapshot) {
  if (!snapshot) return null;
  // Do not expose source JSON, ownership IDs, user rows, claims or grant hashes.
  return { type: snapshot.type, key: snapshot.key, identity: snapshot.identity, canonical: snapshot.canonical,
    findings: snapshot.hidden ? null : catalogFindings(snapshot.type, snapshot.findings), revision: snapshot.revision, valueHash: snapshot.valueHash,
    identityHash: snapshot.identityHash, eligible: snapshot.eligible, protected: snapshot.protected, hidden: snapshot.hidden,
    fieldGroup: "research" };
}
function decodeCursor(cursor, type) {
  if (cursor == null || cursor === "") return "";
  try {
    if (typeof cursor !== "string" || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (value.v !== 1 || value.type !== type || Object.keys(value).length !== 3) throw new Error();
    return catalogKey(value.after);
  } catch { throw new ApiError(400, "The catalog cursor is invalid.", "VALIDATION_FAILED"); }
}
export function listCatalogInventory(database, { type, cursor, limit = 25, at = Date.now(), entities = null }) {
  catalogType(type);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CATALOG_LIMITS.page) {
    throw new ApiError(400, "Choose a catalog page size from 1 to 50.", "VALIDATION_FAILED");
  }
  const after = decodeCursor(cursor, type), columns = schema(database);
  if (entities) {
    const selected = entities.filter(entry => entry.type === type && entry.key > after)
      .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const page = selected.slice(0, limit);
    return { items: page.map(entry => publicCatalogEntity(readCatalogEntity(database, { type, key: entry.key, at }))).filter(Boolean),
      nextCursor: selected.length > limit ? Buffer.from(JSON.stringify({ v: 1, type, after: page.at(-1).key })).toString("base64url") : null };
  }
  let rows;
  if (type === "artist") {
    rows = database.prepare("SELECT norm k FROM artists WHERE norm>? AND COALESCE(source,'')<>'artist-created' ORDER BY norm LIMIT ?")
      .all(after, limit + 1);
  } else if (type === "event") {
    rows = database.prepare(`SELECT id k FROM tour_dates WHERE ${providerFilter(columns)}
      AND provider_event_id IS NOT NULL AND source IS NOT NULL AND id>? ORDER BY id LIMIT ?`)
      .all(...(columns.has("release_at") ? [at] : []), after, limit + 1);
  } else {
    rows = database.prepare(`SELECT pit_catalog_venue_key(venue,venue_city,venue_country_code) k,${venueProjection(columns)} FROM tour_dates
      WHERE ${providerFilter(columns)} AND venue IS NOT NULL
      GROUP BY k HAVING k>? ORDER BY k LIMIT ?`).all(...(columns.has("release_at") ? [at] : []), after, limit + 1);
  }
  const page = rows.slice(0, limit);
  return { items: page.map(row => publicCatalogEntity(readCatalogEntity(database, { type, key: row.k, at,
      ...(type === "venue" ? { venueRow: row } : {}) }))).filter(Boolean),
    nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ v: 1, type, after: page.at(-1).k })).toString("base64url") : null };
}
