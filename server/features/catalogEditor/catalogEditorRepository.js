import { createHash } from "node:crypto";
import { canonicalVenueKey } from "../../../src/domain/venueIdentity.mjs";
import { isIndexableMusicEventRecord } from "../seo/publicEntityPolicy.js";

export const catalogDigest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const catalogVenueEditorKey = (source, id) => source && id ? `${source}:${id}` : null;
const text = value => typeof value === "string" ? value.trim() : "";
const parse = value => { try { return JSON.parse(value || "null"); } catch { return null; } };
const TYPES = new Set(["artist", "venue", "event"]);
const visibleProvider = "owner_id IS NULL AND release_at<=? AND provider_active=1 AND music_qualified=1 AND COALESCE(artist_identity_status,'') NOT IN ('pending','conflict')";

export function ensureCatalogEditorSchema(database) {
  // New, empty feature tables only: no rewrite, backfill or index of existing catalog data.
  database.exec(`CREATE TABLE IF NOT EXISTS catalog_editor_entries (
    entity_type TEXT NOT NULL CHECK(entity_type IN ('artist','venue','event')),
    entity_key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
    identity_hash TEXT NOT NULL, summary TEXT NOT NULL, sources TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
    updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(entity_type,entity_key));
    CREATE TABLE IF NOT EXISTS catalog_editor_receipts (
    actor_id TEXT NOT NULL, operation_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    receipt TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(actor_id,operation_key));`);
}

export function readCatalogEditorEntity(database, { type, key, at = Date.now() }) {
  if (!TYPES.has(type) || typeof key !== "string" || !key || key.length > 450) return null;
  let identity, protectedFacts, protectedReason = null;
  if (type === "artist") {
    const row = database.prepare("SELECT * FROM artists WHERE norm=?").get(key);
    if (!row || row.source === "artist-created") return null;
    const profile = database.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);
    if (profile?.owner_id || profile?.removed || (profile?.identity_review_status && !["clear", "approved"].includes(profile.identity_review_status))) return null;
    identity = { type, key, name: row.name, mbid: row.mbid || null, source: row.source || null };
    protectedFacts = { biography: text(profile?.bio) || text(row.bio), genre: row.genre || null, country: row.country || null };
    if (profile?.bio_staff_curated && !text(profile.bio)) protectedReason = "Staff intentionally cleared this biography. Use the artist editor to review that decision.";
  } else if (type === "event") {
    const row = database.prepare(`SELECT * FROM tour_dates WHERE id=? AND ${visibleProvider}`).get(key, at);
    if (!row || !row.provider_event_id || !row.source || !isIndexableMusicEventRecord(row)) return null;
    identity = { type, key, name: row.event_name || row.artist, source: row.source,
      providerId: row.provider_event_id, artistKey: row.artist_key || null, venueId: row.venue_provider_id || null,
      venue: row.venue, date: row.date, city: row.venue_city || null, country: row.venue_country_code || null };
    protectedFacts = { artist: row.artist, venue: row.venue, date: row.date, startDateTime: row.start_date_time,
      ticketUrl: row.ticket_url, status: row.event_status, soldOut: row.sold_out, lineup: row.billed_artists };
  } else {
    const separator = key.indexOf(":");
    if (separator < 1) return null;
    const source = key.slice(0, separator), providerId = key.slice(separator + 1);
    // Uses the existing provider-venue index, never a same-name global lookup.
    const row = database.prepare(`SELECT MIN(venue) name, MIN(venue_city) city, MIN(venue_country_code) country,
      MIN(venue_address_line1) address, COUNT(*) n,
      COUNT(DISTINCT json_array(lower(trim(venue)),lower(trim(venue_city)),lower(trim(venue_country_code)))) identities
      FROM tour_dates WHERE source=? AND venue_provider_id=? AND ${visibleProvider}`).get(source, providerId, at);
    if (!row?.n || row.identities !== 1 || !text(row.name) || !text(row.city) || !text(row.country)) return null;
    identity = { type, key, name: row.name, source, providerId, city: row.city, country: row.country };
    protectedFacts = { address: row.address || null };
  }
  const stored = database.prepare("SELECT * FROM catalog_editor_entries WHERE entity_type=? AND entity_key=?").get(type, key);
  const identityHash = catalogDigest(identity);
  const content = stored ? { summary: stored.summary, sources: parse(stored.sources) || [], hidden: !!stored.hidden } : null;
  return { type, key, identity, protectedFacts, protectedReason, revision: stored?.revision || 0,
    identityHash, expectedHash: catalogDigest({ identity, protectedFacts, protectedReason, revision: stored?.revision || 0, content }),
    content, identityCurrent: !stored || stored.identity_hash === identityHash,
    missingFields: !stored?.summary && !protectedFacts.biography ? ["sourced summary"] : [],
    updatedAt: stored?.updated_at || null };
}

export function listCatalogEditorEntities(database, { type, after = "", query = "", missingOnly = true, at = Date.now() }) {
  const like = `%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`;
  // At most 150 candidate reads per request, plus one key to prove continuation.
  // The cursor follows the last inspected candidate, never the lookahead key.
  const scanLimit = 150, pageLimit = 30;
  let rows;
  if (type === "artist") {
    rows = database.prepare(`SELECT norm k FROM artists WHERE norm>? AND COALESCE(source,'')<>'artist-created'
      AND name LIKE ? ESCAPE '\\' ORDER BY norm LIMIT ?`).all(after, like, scanLimit + 1);
  } else if (type === "event") {
    rows = database.prepare(`SELECT id k FROM tour_dates WHERE ${visibleProvider} AND id>?
      AND COALESCE(event_name,artist) LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?`).all(at, after, like, scanLimit + 1);
  } else {
    const separator = after.indexOf(":");
    const afterSource = separator < 0 ? "" : after.slice(0, separator), afterId = separator < 0 ? "" : after.slice(separator + 1);
    // The existing (source, venue_provider_id, date) index supplies the grouping
    // order. Filter names inside this bounded slice rather than sorting/scanning
    // the entire grouped catalog for every search request.
    rows = database.prepare(`SELECT source||':'||venue_provider_id k FROM tour_dates
      WHERE owner_id IS NULL AND venue_provider_id IS NOT NULL
      AND (source,venue_provider_id)>(?,?)
      GROUP BY source,venue_provider_id ORDER BY source,venue_provider_id LIMIT ?`).all(afterSource, afterId, scanLimit + 1);
  }
  // Read only existing research. Found (including malformed/stale findings) and
  // intentionally hidden records need review, not another empty-page draft.
  // Do not import the research worker or start provider work from this queue.
  const research = missingOnly && type !== "event"
    && database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_research'").get()
    ? database.prepare(type === "artist"
      ? "SELECT 1 FROM catalog_research WHERE entity_type='artist' AND entity_key=? AND status IN ('found','hidden') LIMIT 1"
      : "SELECT 1 FROM catalog_research WHERE entity_type='venue' AND entity_key>=? AND entity_key<? AND status IN ('found','hidden') LIMIT 1")
    : null;
  const items = [];
  let scanned = 0;
  for (const candidate of rows.slice(0, scanLimit)) {
    scanned++;
    const row = readCatalogEditorEntity(database, { type, key: candidate.k, at });
    if (!row || (type === "venue" && !row.identity.name.toLowerCase().includes(query.toLowerCase()))) continue;
    if (missingOnly) {
      if (row.protectedReason || !row.identityCurrent || row.content?.hidden || !row.missingFields.length) continue;
      // Public venue research uses canonical name + city; preserve it even if
      // another country's same-name record also exists. Never guess its owner.
      const venuePrefix = type === "venue" ? `${canonicalVenueKey(row.identity.name)}|${text(row.identity.city).slice(0, 80).toLowerCase()}|` : null;
      if (research && (type === "artist" ? research.get(row.key) : research.get(venuePrefix, `${venuePrefix}\uffff`))) continue;
    }
    items.push(row);
    if (items.length === pageLimit) break;
  }
  const nextCursor = scanned < rows.length ? rows[scanned - 1].k : null;
  return { items, nextCursor, scanLimitReached: scanned === scanLimit && !!nextCursor && items.length < pageLimit };
}

export function readPublicCatalogEditorText(database, { type, key, at = Date.now() }) {
  if (!database?.prepare || !TYPES.has(type) || typeof key !== "string" || !key || key.length > 450) return null;
  // SEO fixtures and pre-feature databases may not contain the new feature table.
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_editor_entries'").get()) return null;
  const stored = database.prepare("SELECT hidden FROM catalog_editor_entries WHERE entity_type=? AND entity_key=?").get(type, key);
  if (!stored || stored.hidden) return null;
  const entity = readCatalogEditorEntity(database, { type, key, at });
  if (!entity || !entity.identityCurrent || entity.protectedReason || entity.content?.hidden) return null;
  return { summary: entity.content.summary, sources: entity.content.sources, revision: entity.revision, updatedAt: entity.updatedAt };
}

export function publicCatalogEditorArtistTexts(database, at) {
  const result = new Map();
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_editor_entries'").get()) return result;
  // Scheduled sitemap work revalidates edited identities only, not every artist.
  const keys = database.prepare("SELECT entity_key FROM catalog_editor_entries WHERE entity_type='artist' AND hidden=0").all();
  for (const row of keys) {
    const content = readPublicCatalogEditorText(database, { type: "artist", key: row.entity_key, at });
    if (content) result.set(row.entity_key, content);
  }
  return result;
}
