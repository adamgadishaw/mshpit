// Metadata-only registration during trusted provider ingestion. No fetches,
// MusicBrainz guesses, or changes to an existing artist/owner profile.
import { createHash } from "node:crypto";
import { slugify } from "../src/domain/urls.mjs";
import { ticketmasterBilledArtists } from "./artistBillingIdentity.js";
import { REVIEWED_ARTIST_IDENTITIES, resolveReviewedArtistAlias } from "./reviewedArtistIdentities.js";

export const PROVIDER_ARTIST_SOURCE = "ticketmaster-attraction";
export const PROVIDER_ARTIST_LIMITS = Object.freeze({ maxPerBatch: 40, maxPerDay: 1000, maxTotal: 10000 });
const MAX_BATCH_ROWS = 5000;
const MUSIC_SEGMENT = "KZFzniwnSyZfZ7v7nJ";
const MUSIC_EVIDENCE = "ticketmaster:classification:music";
const norm = (value) => String(value || "").trim().toLowerCase();
const searchKey = (value) => String(value || "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const providerId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(value) ? value : null;
const artistName = (value) => typeof value === "string" && value.trim().length <= 120
  && value.trim() && !/[\u0000-\u001f\u007f-\u009f<>]/u.test(value) ? value.trim() : null;
const reviewedAliases = new Set(REVIEWED_ARTIST_IDENTITIES.flatMap((record) => record.aliases || []).map(norm));

// An event's verified Music taxonomy is necessary. Explicit non-Music
// attractions, requested-name aliases, title fallbacks and joint acts do not
// become new catalogue identities from this evidence.
export function ticketmasterPrimaryArtistIdentity(event, { artist, musicEvidence } = {}) {
  if (musicEvidence !== MUSIC_EVIDENCE || !artistName(artist)) return null;
  const matches = (Array.isArray(event?._embedded?.attractions) ? event._embedded.attractions : [])
    .slice(0, 50).filter((value) => norm(value?.name) === norm(artist));
  const ids = new Set(matches.map((value) => providerId(value?.id)).filter(Boolean));
  if (ids.size > 1) return { status: "conflict" };
  if (ids.size !== 1) return null;
  const attraction = matches.find((value) => providerId(value?.id));
  const name = artistName(attraction?.name);
  if (!name || ticketmasterBilledArtists([attraction]).length !== 1) return null;
  const contradictsMusic = (value) => {
    const classes = Array.isArray(value?.classifications) ? value.classifications.slice(0, 20) : [];
    const classification = classes.find((entry) => entry?.primary === true) || classes[0];
    const segment = classification?.segment;
    if (segment?.id) return segment.id !== MUSIC_SEGMENT;
    return segment?.name != null && (typeof segment.name !== "string" || !/^music$/iu.test(segment.name.trim()));
  };
  if (matches.some(contradictsMusic)) return null;
  return { id: providerId(attraction.id), name };
}

export function ensureProviderArtistRegistrationSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS provider_artist_identities (
    provider TEXT NOT NULL CHECK(provider='ticketmaster'),
    provider_id TEXT COLLATE BINARY NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 100),
    artist_key TEXT NOT NULL REFERENCES artists(norm) ON DELETE CASCADE,
    provider_name TEXT NOT NULL CHECK(length(provider_name) BETWEEN 1 AND 120),
    created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,
    PRIMARY KEY(provider,provider_id));
    CREATE INDEX IF NOT EXISTS idx_provider_artist_identity_key ON provider_artist_identities(artist_key);
    CREATE TABLE IF NOT EXISTS provider_artist_registration_budget (
      id INTEGER PRIMARY KEY CHECK(id=1),utc_day TEXT NOT NULL,
      daily_inserted INTEGER NOT NULL CHECK(daily_inserted>=0),
      total_inserted INTEGER NOT NULL CHECK(total_inserted>=0));
    INSERT OR IGNORE INTO provider_artist_registration_budget VALUES (1,'',0,0);
    CREATE INDEX IF NOT EXISTS idx_artists_trimmed_name_lookup ON artists(lower(trim(name)),norm);
    CREATE INDEX IF NOT EXISTS idx_artists_search_key ON artists(search_key);`);
  const columns = new Set(database.prepare("PRAGMA table_info(tour_dates)").all().map((row) => row.name));
  if (columns.size && !columns.has("provider_artist_id")) database.exec("ALTER TABLE tour_dates ADD COLUMN provider_artist_id TEXT");
  if (columns.size && !columns.has("artist_identity_status")) database.exec(`ALTER TABLE tour_dates ADD COLUMN artist_identity_status TEXT
    CHECK(artist_identity_status IS NULL OR artist_identity_status IN ('registered','pending','conflict'))`);
}

function candidateFor(row) {
  const id = providerId(row?.provider_artist_id), name = artistName(row?.provider_artist_name);
  if (row?.source !== "ticketmaster" || row?.owner_id != null || row?.music_qualified !== 1
    || row?.music_evidence !== MUSIC_EVIDENCE || !id || !name || norm(row.artist) !== norm(name)
    || !Array.isArray(row.billed_artists) || !row.billed_artists.some((value) => norm(value) === norm(name))) return null;
  return { id, name, key: norm(name), search: searchKey(name) };
}

function boundedLimit(value, maximum) {
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(maximum, value)) : maximum;
}

// Same immutable slug rules as db.js, with the shared URL slugifier and
// deterministic collision digest; never invokes its global-database builder.
function slugFor(database, name, key) {
  const base = slugify(name) || `artist-${digest(key).slice(0, 12)}`;
  const hash = digest(`artist-public-slug\0${key}`);
  const candidates = [base, ...[10, 16, 24, 32, 48, 64]
    .map((size) => `${base.slice(0, Math.max(1, 79 - size))}-${hash.slice(0, size)}`)];
  const occupied = database.prepare(`SELECT 1 FROM artists WHERE public_slug IS NOT NULL AND public_slug<>''
    AND lower(public_slug)=lower(?) LIMIT 1`);
  return candidates.find((value) => !occupied.get(value)) || null;
}

// One decision per input row. The importer persists decisions and events in
// one outer savepoint. Null status is legacy binding, never an ID crosswalk.
export function registerProviderArtistRows(database, rows, { at = Date.now(), limits = {} } = {}) {
  if (!Number.isSafeInteger(at) || at < 0) throw new TypeError("registration time must be a non-negative integer");
  if (!Array.isArray(rows)) throw new TypeError("provider rows must be an array");
  if (rows.length > MAX_BATCH_ROWS) throw new RangeError("provider artist registration batch exceeds 5000 rows");
  ensureProviderArtistRegistrationSchema(database);
  const cap = Object.fromEntries(Object.entries(PROVIDER_ARTIST_LIMITS)
    .map(([key, value]) => [key, boundedLimit(limits[key], value)]));
  const candidates = rows.map(candidateFor);
  const idsByName = new Map(), namesById = new Map();
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const name of [`norm:${candidate.key}`, candidate.search && `search:${candidate.search}`].filter(Boolean)) {
      if (!idsByName.has(name)) idsByName.set(name, new Set());
      idsByName.get(name).add(candidate.id);
    }
    if (!namesById.has(candidate.id)) namesById.set(candidate.id, new Set());
    namesById.get(candidate.id).add(candidate.key);
  }
  const mapped = database.prepare(`SELECT a.*,m.provider_name FROM provider_artist_identities m
    JOIN artists a ON a.norm=m.artist_key WHERE m.provider='ticketmaster' AND m.provider_id=? COLLATE BINARY`);
  const occupied = database.prepare(`SELECT norm,name,source FROM artists
    WHERE norm=? OR lower(trim(name))=lower(trim(?)) OR search_key=? LIMIT 3`);
  const legacyMatches = database.prepare("SELECT norm,name,source FROM artists WHERE lower(trim(name))=lower(trim(?)) ORDER BY norm LIMIT 2");
  const hasProfiles = !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artist_profiles'").get();
  const heldProfile = hasProfiles ? database.prepare(`SELECT 1 FROM artist_profiles WHERE artist_key=?
    AND (removed<>0 OR COALESCE(identity_review_status,'clear') IN ('pending','rejected')) LIMIT 1`) : null;
  const hasMapping = database.prepare("SELECT 1 FROM provider_artist_identities WHERE artist_key=? LIMIT 1");
  const reviewedAlias = (name, existing) => {
    if (!reviewedAliases.has(norm(name))) return null;
    const artist = resolveReviewedArtistAlias(database, name);
    // A known alias with missing or ambiguous registry identity is not a new
    // performer. Never insert a second row merely because search keys differ.
    if (!artist) return { status: "pending" };
    if (existing.some((value) => value.norm !== artist.norm)
      || artist.source === "artist-created" || artist.source === PROVIDER_ARTIST_SOURCE
      || heldProfile?.get(artist.norm) || hasMapping.get(artist.norm)) return { status: "conflict" };
    return { status: null, artist };
  };
  const insertArtist = database.prepare(`INSERT INTO artists
    (norm,name,public_slug,search_key,rank_score,data,source,created_at,updated_at)
    VALUES (@norm,@name,@slug,@search,0,@data,@source,@at,@at)`);
  const insertMapping = database.prepare(`INSERT INTO provider_artist_identities
    (provider,provider_id,artist_key,provider_name,created_at,last_seen_at) VALUES ('ticketmaster',?,?,?,?,?)`);
  const touch = database.prepare("UPDATE provider_artist_identities SET last_seen_at=MAX(last_seen_at,?) WHERE provider='ticketmaster' AND provider_id=? COLLATE BINARY");
  const readBudget = database.prepare("SELECT * FROM provider_artist_registration_budget WHERE id=1");
  const saveBudget = database.prepare("UPDATE provider_artist_registration_budget SET utc_day=?,daily_inserted=?,total_inserted=? WHERE id=1");
  let inserted = 0;
  database.exec("SAVEPOINT provider_artist_registration");
  try {
    // Acquire the write lock before absence checks, also when called alone.
    database.prepare("UPDATE provider_artist_registration_budget SET total_inserted=total_inserted WHERE id=1").run();
    const budget = readBudget.get(), previousBudget = { ...budget }, day = new Date(at).toISOString().slice(0, 10);
    if (day > budget.utc_day) { budget.utc_day = day; budget.daily_inserted = 0; }
    const decisions = rows.map((row, index) => {
      const candidate = candidates[index];
      const result = (status, artist = null) => ({
        artistKey: artist?.norm || null, artistName: artist?.name || null,
        providerArtistId: candidate?.id || null, status,
      });
      const legacy = () => {
        const matches = legacyMatches.all(row?.artist || "");
        if (matches.some((artist) => artist.source === PROVIDER_ARTIST_SOURCE || hasMapping.get(artist.norm))) return result("conflict");
        if (row?.source === "ticketmaster" && matches.some((artist) => artist.source === "artist-created" || heldProfile?.get(artist.norm))) return result("conflict");
        if (row?.source === "ticketmaster") {
          const name = artistName(row?.artist);
          const alias = name && reviewedAlias(name, occupied.all(norm(name), name, searchKey(name)));
          if (alias) return result(alias.status, alias.artist);
        }
        if (row?.source === "ticketmaster" && row?.music_qualified === 1 && row?.music_evidence === MUSIC_EVIDENCE
          && matches.length !== 1) return result("pending");
        return result(null, matches.length === 1 ? matches[0] : null);
      };
      if (row?.artist_identity_status === "conflict") return result("conflict");
      if (!candidate) return providerId(row?.provider_artist_id) && row?.source === "ticketmaster" ? result("pending") : legacy();
      if (idsByName.get(`norm:${candidate.key}`)?.size > 1 || idsByName.get(`search:${candidate.search}`)?.size > 1) return result("conflict");
      if (namesById.get(candidate.id)?.size > 1) return result("pending");
      const known = mapped.get(candidate.id);
      if (known) {
        // Keep the old mapping on rename. Name-only client navigation cannot
        // safely infer a new public alias, so the event stays explicitly pending.
        if (norm(known.name) !== candidate.key || known.source === "artist-created" || heldProfile?.get(known.norm)) return result("pending");
        touch.run(at, candidate.id);
        return result("registered", known);
      }
      const existing = occupied.all(candidate.key, candidate.name, candidate.search);
      const alias = reviewedAlias(candidate.name, existing);
      if (alias) return result(alias.status, alias.artist);
      if (existing.length) {
        // Preserve older imported-catalogue behavior, without claiming that a
        // name match proves this provider ID or modifying any existing artist.
        if (existing.length === 1 && norm(existing[0].name) === candidate.key
          && existing[0].source !== PROVIDER_ARTIST_SOURCE && existing[0].source !== "artist-created"
          && !hasMapping.get(existing[0].norm) && !heldProfile?.get(existing[0].norm)) return result(null, existing[0]);
        return result("conflict");
      }
      if (inserted >= cap.maxPerBatch || budget.daily_inserted >= cap.maxPerDay || budget.total_inserted >= cap.maxTotal) return result("pending");
      const slug = slugFor(database, candidate.name, candidate.key);
      if (!slug) return result("conflict");
      insertArtist.run({ norm: candidate.key, name: candidate.name, slug, search: candidate.search,
        data: JSON.stringify({ name: candidate.name, providerIdentity: {
          provider: "ticketmaster", id: candidate.id, evidence: MUSIC_EVIDENCE,
        } }), source: PROVIDER_ARTIST_SOURCE, at });
      insertMapping.run(candidate.id, candidate.key, candidate.name, at, at);
      inserted += 1; budget.daily_inserted += 1; budget.total_inserted += 1;
      return result("registered", { norm: candidate.key, name: candidate.name });
    });
    if (budget.utc_day !== previousBudget.utc_day || budget.daily_inserted !== previousBudget.daily_inserted
      || budget.total_inserted !== previousBudget.total_inserted) saveBudget.run(budget.utc_day, budget.daily_inserted, budget.total_inserted);
    database.exec("RELEASE provider_artist_registration");
    return decisions;
  } catch (error) {
    database.exec("ROLLBACK TO provider_artist_registration; RELEASE provider_artist_registration");
    throw error;
  }
}
