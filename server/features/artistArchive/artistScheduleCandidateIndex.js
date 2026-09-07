import { canonicalBillingIdentity, storedBillingIdentities } from "../../artistBillingIdentity.js";
import { ApiError } from "../../errors.js";

const shared = new WeakMap();
const MAX_SOURCE_ROWS = 200_000;
const MAX_MEMBERSHIPS = 1_000_000;
const MAX_ARTIST_CANDIDATES = 20_000;

// A tiny source revision, not a derived-event table or a database-wide rewrite.
// Visibility fields intentionally do not invalidate this ID-only lookup: every
// request still reads current release, account, block, memorial and lifecycle
// predicates. Native triggers cover every writer, including another connection.
export function ensureArtistScheduleRevisionSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS artist_schedule_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision TEXT NOT NULL DEFAULT 'initial');
    INSERT OR IGNORE INTO artist_schedule_revision(singleton,revision) VALUES(1,'initial');
    CREATE TRIGGER IF NOT EXISTS trg_artist_schedule_event_insert AFTER INSERT ON tour_dates BEGIN
      UPDATE artist_schedule_revision SET revision=lower(hex(randomblob(16))) WHERE singleton=1; END;
    CREATE TRIGGER IF NOT EXISTS trg_artist_schedule_event_delete AFTER DELETE ON tour_dates BEGIN
      UPDATE artist_schedule_revision SET revision=lower(hex(randomblob(16))) WHERE singleton=1; END;
    CREATE TRIGGER IF NOT EXISTS trg_artist_schedule_event_identity AFTER UPDATE OF id,artist,artist_key,owner_id,source,music_evidence,billed_artists ON tour_dates
      WHEN NOT(NEW.id IS OLD.id AND NEW.artist IS OLD.artist AND NEW.artist_key IS OLD.artist_key AND NEW.owner_id IS OLD.owner_id
        AND NEW.source IS OLD.source AND NEW.music_evidence IS OLD.music_evidence AND NEW.billed_artists IS OLD.billed_artists) BEGIN
      UPDATE artist_schedule_revision SET revision=lower(hex(randomblob(16))) WHERE singleton=1; END;
    CREATE TRIGGER IF NOT EXISTS trg_artist_schedule_catalog_insert AFTER INSERT ON artists BEGIN
      UPDATE artist_schedule_revision SET revision=lower(hex(randomblob(16))) WHERE singleton=1; END;
    CREATE TRIGGER IF NOT EXISTS trg_artist_schedule_catalog_delete AFTER DELETE ON artists BEGIN
      UPDATE artist_schedule_revision SET revision=lower(hex(randomblob(16))) WHERE singleton=1; END;
    CREATE TRIGGER IF NOT EXISTS trg_artist_schedule_catalog_identity AFTER UPDATE OF norm,name ON artists
      WHEN NOT(NEW.norm IS OLD.norm AND NEW.name IS OLD.name) BEGIN
      UPDATE artist_schedule_revision SET revision=lower(hex(randomblob(16))) WHERE singleton=1; END;
  `);
}

function capacityError() {
  return new ApiError(503, "Artist dates are temporarily unavailable. Please try again shortly.", "DATABASE_UNAVAILABLE");
}

export function artistScheduleCandidateIndex(database) {
  if (shared.has(database)) return shared.get(database);
  const revision = database.prepare("SELECT revision FROM artist_schedule_revision WHERE singleton=1");
  const events = database.prepare(`SELECT id,source,music_evidence,billed_artists FROM tour_dates
    WHERE owner_id IS NULL AND source IN ('ticketmaster','bandsintown') AND music_evidence IS NOT NULL
    LIMIT ${MAX_SOURCE_ROWS + 1}`);
  const artists = database.prepare(`SELECT name FROM artists LIMIT ${MAX_SOURCE_ROWS + 1}`);
  let cached = null;
  let capacityFailureRevision = null;
  let buildCount = 0;
  function refresh() {
    database.exec("SAVEPOINT artist_schedule_candidates");
    try {
      // Unique tokens cannot repeat when an outer transaction rolls back and a
      // different update follows. A plain revision++ would reuse that number.
      const version = revision.get()?.revision;
      if (typeof version !== "string" || !/^(?:initial|[0-9a-f]{32})$/u.test(version)) throw capacityError();
      if (capacityFailureRevision === version) throw capacityError();
      if (cached?.revision === version) return cached;
      const failCapacity = () => { capacityFailureRevision = version; throw capacityError(); };
      const started = performance.now();
      const billing = new Map();
      const nameCounts = new Map();
      let sourceRows = 0, artistRows = 0, memberships = 0;
      for (const row of artists.iterate()) {
        if (++artistRows > MAX_SOURCE_ROWS) failCapacity();
        const key = canonicalBillingIdentity(row.name);
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
      }
      for (const row of events.iterate()) {
        if (++sourceRows > MAX_SOURCE_ROWS) failCapacity();
        for (const key of storedBillingIdentities(row.source, row.music_evidence, row.billed_artists)) {
          if (++memberships > MAX_MEMBERSHIPS) failCapacity();
          const ids = billing.get(key) || [];
          ids.push(row.id); billing.set(key, ids);
        }
      }
      cached = { revision: version, billing, nameCounts, sourceRows, memberships, buildMs: performance.now() - started };
      capacityFailureRevision = null;
      buildCount += 1;
      return cached;
    } finally { database.exec("RELEASE artist_schedule_candidates"); }
  }
  const index = Object.freeze({
    candidates(name) {
      const state = refresh();
      const identity = canonicalBillingIdentity(name);
      const unambiguous = state.nameCounts.get(identity) === 1;
      const ids = unambiguous ? state.billing.get(identity) || [] : [];
      if (ids.length > MAX_ARTIST_CANDIDATES) throw capacityError();
      return { ids: JSON.stringify(ids), unambiguous };
    },
    diagnostics() {
      return { buildCount, revision: cached?.revision ?? null, sourceRows: cached?.sourceRows ?? 0,
        memberships: cached?.memberships ?? 0, buildMs: cached?.buildMs ?? 0 };
    },
  });
  shared.set(database, index);
  return index;
}
