// Additive catalogue enrichment, never a dependency of an HTTP read. The
// durable ledger contains public artist keys only, not member search history.
import { randomUUID } from "node:crypto";
import { statfsSync, statSync } from "node:fs";
import { artistBiographyIdentity } from "../src/domain/artistBiography.mjs";
import { artistKnowledgeFieldIsStale, projectArtistKnowledgeSource } from "../src/domain/artistKnowledge.mjs";
import { fetchArtistKnowledge } from "./artistKnowledgeProvider.js";
import { backgroundJobEnabled } from "./backgroundJobs.js";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";
import { startPeriodicJob } from "./periodicJobScheduler.js";
import { privateErrorLabel } from "./errors.js";

const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const COOLDOWN_KEY = "artist-knowledge:v1:cooldown";
const SUMMARY_KEY = "artist-knowledge:v1:last-pass";
const clamp = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;
const blank = (value) => value == null || (typeof value === "string" && !value.trim());
const objectData = (text) => {
  try {
    const data = JSON.parse(text || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch { return null; }
};
const aborted = (signal) => {
  if (signal?.aborted) throw signal.reason || new DOMException("Enrichment stopped", "AbortError");
};

export function ensureArtistKnowledgeSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS artist_knowledge_checks (
    artist_key TEXT PRIMARY KEY REFERENCES artists(norm) ON DELETE CASCADE,
    mbid TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('leased','filled','no_match','skipped','failed')),
    attempted_at INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 10),
    claim_token TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_artist_knowledge_due ON artist_knowledge_checks(next_attempt_at);`);
}

// Keep space for WAL growth and verified snapshots. Unknown disk metrics fail
// closed for optional work, never for user-facing reads.
export function artistKnowledgeStorageReady(directory, databasePath, {
  statfs = statfsSync, stat = statSync,
} = {}) {
  try {
    const disk = statfs(directory);
    const bytes = Number(stat(databasePath).size);
    let walBytes = 0;
    try { walBytes = Number(stat(`${databasePath}-wal`).size); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    const available = Number(disk.bavail) * Number(disk.bsize);
    return Number.isFinite(available) && Number.isFinite(bytes) && Number.isFinite(walBytes)
      && available >= Math.max(256 * 1024 * 1024, (bytes + walBytes) * 2);
  } catch { return false; }
}

export function createArtistKnowledgeRefresher({
  database, fetchKnowledge = fetchArtistKnowledge, now = Date.now, storageReady = () => true,
} = {}) {
  ensureArtistKnowledgeSchema(database);
  const meta = database.prepare("SELECT value FROM app_meta WHERE key=?");
  const setMeta = database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const read = database.prepare(`SELECT a.*,p.artist_key AS profile_exists
    FROM artists a LEFT JOIN artist_profiles p ON p.artist_key=a.norm WHERE a.norm=?`);
  const due = database.prepare(`SELECT a.norm FROM artists a
    LEFT JOIN artist_profiles p ON p.artist_key=a.norm
    LEFT JOIN artist_knowledge_checks c ON c.artist_key=a.norm
    WHERE length(a.mbid)=36
      AND ((trim(COALESCE(a.bio,''))='' AND p.artist_key IS NULL) OR trim(COALESCE(a.country,''))=''
        OR c.mbid<>lower(a.mbid) OR c.status IN ('failed','leased'))
      AND (c.artist_key IS NULL OR c.mbid<>lower(a.mbid) OR c.next_attempt_at<=?)
    ORDER BY COALESCE(c.attempted_at,0),a.rank_score DESC,a.norm LIMIT ?`);
  const claim = database.prepare(`INSERT INTO artist_knowledge_checks
    (artist_key,mbid,status,attempted_at,next_attempt_at,failures,claim_token)
    VALUES (?,?,'leased',?,?,0,?) ON CONFLICT(artist_key) DO UPDATE SET
    mbid=excluded.mbid,status='leased',attempted_at=excluded.attempted_at,
    next_attempt_at=excluded.next_attempt_at,claim_token=excluded.claim_token,
    failures=CASE WHEN artist_knowledge_checks.mbid=excluded.mbid THEN artist_knowledge_checks.failures ELSE 0 END
    WHERE artist_knowledge_checks.next_attempt_at<=excluded.attempted_at OR artist_knowledge_checks.mbid<>excluded.mbid`);
  const finish = database.prepare(`UPDATE artist_knowledge_checks SET status=?,next_attempt_at=?,failures=?,claim_token=NULL
    WHERE artist_key=? AND mbid=? AND claim_token=?`);
  const check = database.prepare("SELECT * FROM artist_knowledge_checks WHERE artist_key=?");
  const update = database.prepare(`UPDATE artists SET bio=?,country=?,data=?,updated_at=?
    WHERE norm=? AND mbid IS ? AND data IS ? AND bio IS ? AND country IS ?`);

  function persist(row, result, token, at) {
    // Re-read AFTER the network round trip, in a short transaction. Never
    // overwrite a staff edit, owner claim, or identity correction made meanwhile.
    database.exec("SAVEPOINT artist_knowledge_apply");
    try {
      const current = read.get(row.norm), lease = check.get(row.norm);
      const mbid = artistBiographyIdentity(row.mbid);
      if (!current || artistBiographyIdentity(current.mbid) !== mbid
        || lease?.claim_token !== token || lease.mbid !== mbid) {
        database.exec("RELEASE artist_knowledge_apply");
        return { bios: 0, countries: 0, stale: true };
      }
      const data = objectData(current.data);
      let bios = 0, countries = 0, bio = current.bio, country = current.country;
      const staleBio = artistKnowledgeFieldIsStale(data, { mbid, field: "bio", value: bio });
      const staleCountry = artistKnowledgeFieldIsStale(data, { mbid, field: "country", value: country });
      // On identity correction, a partial new result must not detach the
      // remaining old fields from their provenance and reveal them again.
      // Retain one previous source record, but clear only proven stale imports.
      if (data && (staleBio || staleCountry)) {
        data.artistKnowledgePrevious = data.artistKnowledge;
        if (staleBio) { if (data.bio === bio) delete data.bio; bio = null; }
        if (staleCountry) { if (data.country === country) delete data.country; country = null; }
      }
      if (data && result && artistBiographyIdentity(result.mbid) === mbid
        && /^Q[1-9][0-9]*$/.test(result.wikidataId || "")
        && result.wikidataUrl === `https://www.wikidata.org/wiki/${result.wikidataId}`) {
        const previous = data.artistKnowledge?.mbid === mbid ? data.artistKnowledge : {};
        const knowledge = { ...previous, version: 1, mbid, wikidataId: result.wikidataId, wikidataUrl: result.wikidataUrl };
        const candidate = { ...knowledge, bio: result.bio, bioSource: result.bioSource };
        if (!current.profile_exists && blank(bio) && blank(data.bio)
          && typeof result.bio === "string" && result.bio.length <= 6000
          && projectArtistKnowledgeSource({ artistKnowledge: candidate }, { mbid, bio: result.bio })) {
          bio = result.bio; knowledge.bio = bio; knowledge.bioSource = result.bioSource;
          data.bio = bio; bios = 1;
        }
        if (blank(country) && blank(data.country) && typeof result.country === "string"
          && result.country.trim() && result.country.length <= 100
          && !/[\u0000-\u001f\u007f<>]/u.test(result.country)) {
          country = result.country.trim(); knowledge.country = country;
          data.country = country; countries = 1;
        }
        if (bios || countries) {
          data.artistKnowledge = knowledge;
        }
      }
      if (bios || countries || staleBio || staleCountry) {
        if (Number(update.run(bio, country, JSON.stringify(data), Math.max(at, Number(current.updated_at) + 1),
          current.norm, current.mbid, current.data, current.bio, current.country).changes) !== 1) {
          throw new Error("Artist enrichment changed concurrently");
        }
      }
      finish.run(bios || countries ? "filled" : result ? "skipped" : "no_match", at + 30 * DAY, 0, row.norm, mbid, token);
      database.exec("RELEASE artist_knowledge_apply");
      return { bios, countries, stale: false };
    } catch (error) {
      database.exec("ROLLBACK TO artist_knowledge_apply; RELEASE artist_knowledge_apply");
      throw error;
    }
  }

  let active = null;
  async function run({ limit = 10, signal, budgetMs = 45_000 } = {}) {
    const stats = { checked: 0, filled: 0, bios: 0, countries: 0, unmatched: 0, failed: 0, stale: 0,
      coolingDown: false, storagePaused: false, stoppedEarly: false };
    aborted(signal);
    if (!storageReady()) return { ...stats, storagePaused: true };
    if (Number(meta.get(COOLDOWN_KEY)?.value) > now()) return { ...stats, coolingDown: true };
    const deadline = AbortSignal.timeout(clamp(budgetMs, 45_000, 1000, 45_000));
    const workSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const rows = due.all(now(), clamp(limit, 10, 1, 10));
    for (const item of rows) {
      aborted(signal);
      if (deadline.aborted) { stats.stoppedEarly = true; break; }
      const row = read.get(item.norm), mbid = artistBiographyIdentity(row?.mbid);
      if (!row) continue;
      if (!mbid) {
        // Legacy malformed IDs must not permanently occupy the first slice.
        const token = randomUUID(), at = now(), invalid = String(row.mbid).toLowerCase();
        if (Number(claim.run(row.norm, invalid, at, at + 10 * MINUTE, token).changes) === 1) {
          finish.run("skipped", at + 30 * DAY, 0, row.norm, invalid, token);
        }
        continue;
      }
      const data = objectData(row.data);
      const staleBio = artistKnowledgeFieldIsStale(data, { mbid, field: "bio", value: row.bio });
      const staleCountry = artistKnowledgeFieldIsStale(data, { mbid, field: "country", value: row.country });
      const needBio = !!data && !row.profile_exists && (blank(row.bio) || staleBio)
        && (blank(data.bio) || (staleBio && data.bio === row.bio));
      const needCountry = !!data && (blank(row.country) || staleCountry)
        && (blank(data.country) || (staleCountry && data.country === row.country));
      const at = now(), token = randomUUID();
      if (Number(claim.run(row.norm, mbid, at, at + 10 * MINUTE, token).changes) !== 1) continue;
      if (!needBio && !needCountry) {
        finish.run("skipped", at + 30 * DAY, 0, row.norm, mbid, token); continue;
      }
      stats.checked += 1;
      let result;
      try {
        result = await fetchKnowledge({ mbid, needBio, needCountry, signal: workSignal });
        aborted(workSignal);
      } catch (error) {
        const failures = Math.min(10, Number(check.get(row.norm)?.failures || 0) + 1);
        const retryAt = Math.max(now() + Math.min(DAY, 30 * MINUTE * 2 ** (failures - 1)),
          Number.isFinite(Number(error?.retryAt)) ? Number(error.retryAt) : 0);
        finish.run("failed", retryAt, failures, row.norm, mbid, token);
        aborted(signal);
        if (deadline.aborted) { stats.stoppedEarly = true; break; }
        // An outage is provider-wide, not an artist miss. Pause the entire pass
        // durably so a deploy cannot restart a failing download loop.
        setMeta.run(COOLDOWN_KEY, String(retryAt)); stats.failed += 1; break;
      }
      const saved = persist(row, result, token, now());
      stats.bios += saved.bios; stats.countries += saved.countries;
      if (saved.bios || saved.countries) stats.filled += 1;
      else if (saved.stale) stats.stale += 1;
      else stats.unmatched += 1;
    }
    setMeta.run(SUMMARY_KEY, JSON.stringify({ ...stats, at: now() }));
    return stats;
  }
  return { runBatch(options) {
    if (!active) active = run(options || {}).finally(() => { active = null; });
    return active;
  } };
}

export function startArtistKnowledgeScheduler({
  database, directory, databasePath, env = process.env, logger = console,
  schedule = startPeriodicJob, coordinate = runBackgroundJob, service,
} = {}) {
  if (!backgroundJobEnabled(env, "ARTIST_KNOWLEDGE_ENABLED")) return null;
  const refresher = service || createArtistKnowledgeRefresher({ database,
    storageReady: () => artistKnowledgeStorageReady(directory, databasePath) });
  logger.log?.("[pit] artist knowledge enrichment on; exact identities, missing fields only, max 10 per 15m.");
  return schedule({
    initialDelayMs: 3 * MINUTE, intervalMs: 15 * MINUTE,
    run: ({ signal }) => coordinate(async () => {
      const stats = await refresher.runBatch({ signal, limit: clamp(env.ARTIST_KNOWLEDGE_BATCH, 10, 1, 10) });
      if (stats.checked || stats.storagePaused) logger.log?.(`[pit] artist knowledge: checked=${stats.checked} filled=${stats.filled} bios=${stats.bios} countries=${stats.countries} deferred=${stats.unmatched} providerFailures=${stats.failed} storagePaused=${stats.storagePaused}`);
    }),
    report: (error) => logger.error?.(`[pit] artist knowledge paused safely cause=${privateErrorLabel(error)}`),
  });
}
