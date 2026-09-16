// Additive catalogue enrichment, never a dependency of an HTTP read. The
// durable ledger contains public artist keys only, not member search history.
import { randomUUID } from "node:crypto";
import { statfsSync, statSync } from "node:fs";
import { artistBiographyIdentity } from "../src/domain/artistBiography.mjs";
import { artistKnowledgeFieldIsStale, projectArtistKnowledgeSource } from "../src/domain/artistKnowledge.mjs";
import { fetchArtistKnowledge, ARTIST_KNOWLEDGE_BIO_LIMIT } from "./artistKnowledgeProvider.js";
import { backgroundJobEnabled } from "./backgroundJobs.js";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";
import { startPeriodicJob } from "./periodicJobScheduler.js";
import { privateErrorLabel } from "./errors.js";
import { memoryWorkSnapshot } from "./memoryAdmission.js";
import { discoverArtistPriorityKeys, interleaveDiscoverPriority } from "./discoverArtistPriority.js";
import { ensureCatalogKnowledgeControl, readCatalogKnowledgeControl, reserveCatalogKnowledgeBudget,
  reserveCatalogKnowledgePass, catalogKnowledgeGrowthReady, completeCatalogKnowledgeSweep } from "./catalogKnowledgeControl.js";

const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const COOLDOWN_KEY = "artist-knowledge:v1:cooldown";
const SUMMARY_KEY = "artist-knowledge:v1:last-pass";
const providerFailureCategory = (error) => {
  const code = typeof error?.code === "string" ? error.code : "";
  return code === "knowledge_busy"
    || /^(?:wikidata|wikipedia)_(?:rate_limited|unavailable|maxlag|timeout|network|response|rejected|redirect)$/.test(code)
    ? code : "provider_error";
};
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
      && available >= Math.max(512 * 1024 * 1024, (bytes + walBytes) * 2);
  } catch { return false; }
}

export function artistKnowledgeDatabaseBytes(databasePath, { stat = statSync } = {}) {
  try {
    let bytes = Number(stat(databasePath).size);
    try { bytes += Number(stat(`${databasePath}-wal`).size); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
  } catch { return null; }
}

export function artistKnowledgeMemoryReady({ snapshot = memoryWorkSnapshot } = {}) {
  try {
    const state = snapshot();
    return Number.isFinite(state.limitBytes) && state.limitBytes > 0
      && Number.isFinite(state.usedBytes) && Number.isFinite(state.reservedBytes)
      && state.usedBytes + state.reservedBytes + 192 * 1024 ** 2 < state.limitBytes
      && !(state.queued > 0) && !(state.activeKinds || []).some((kind) => kind !== "background");
  } catch { return false; }
}

export function createArtistKnowledgeRefresher({
  database, fetchKnowledge = fetchArtistKnowledge, now = Date.now, storageReady = () => true,
  memoryReady = () => true, databaseBytes = () => 0, env = process.env,
} = {}) {
  ensureArtistKnowledgeSchema(database);
  ensureCatalogKnowledgeControl(database, { env, at: now() });
  const meta = database.prepare("SELECT value FROM app_meta WHERE key=?");
  const setMeta = database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const read = database.prepare(`SELECT a.*,p.artist_key AS profile_exists
    FROM artists a LEFT JOIN artist_profiles p ON p.artist_key=a.norm WHERE a.norm=?`);
  const dueSql = `SELECT a.norm FROM artists a
    LEFT JOIN artist_profiles p ON p.artist_key=a.norm
    LEFT JOIN artist_knowledge_checks c ON c.artist_key=a.norm
    WHERE length(a.mbid)=36
      AND ((trim(COALESCE(a.bio,''))='' AND p.artist_key IS NULL) OR trim(COALESCE(a.country,''))=''
        OR c.mbid<>lower(a.mbid) OR c.status IN ('failed','leased'))
      AND (c.artist_key IS NULL OR c.mbid<>lower(a.mbid) OR c.next_attempt_at<=?)`;
  // Finish interrupted checks before starting another whole catalogue slice.
  // Otherwise thousands of never-checked rows evict every small provider
  // checkpoint before its owner gets a turn, wasting the request allowance.
  const dueOrder = " ORDER BY CASE WHEN c.status='leased' THEN 0 ELSE 1 END,COALESCE(c.attempted_at,0),a.rank_score DESC,a.norm LIMIT ?";
  const priorityDue = database.prepare(`${dueSql} AND a.norm IN (SELECT value FROM json_each(?))${dueOrder}`);
  const regularDue = database.prepare(`${dueSql} AND a.norm NOT IN (SELECT value FROM json_each(?))${dueOrder}`);
  const claim = database.prepare(`INSERT INTO artist_knowledge_checks
    (artist_key,mbid,status,attempted_at,next_attempt_at,failures,claim_token)
    VALUES (?,?,'leased',?,?,0,?) ON CONFLICT(artist_key) DO UPDATE SET
    mbid=excluded.mbid,status='leased',attempted_at=excluded.attempted_at,
    next_attempt_at=excluded.next_attempt_at,claim_token=excluded.claim_token,
    failures=CASE WHEN artist_knowledge_checks.mbid=excluded.mbid THEN artist_knowledge_checks.failures ELSE 0 END
    WHERE artist_knowledge_checks.next_attempt_at<=excluded.attempted_at OR artist_knowledge_checks.mbid<>excluded.mbid`);
  const finish = database.prepare(`UPDATE artist_knowledge_checks SET status=?,next_attempt_at=?,failures=?,claim_token=NULL
    WHERE artist_key=? AND mbid=? AND claim_token=?`);
  const defer = database.prepare(`UPDATE artist_knowledge_checks SET status='leased',next_attempt_at=?,claim_token=NULL
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
          && typeof result.bio === "string" && [...result.bio].length <= ARTIST_KNOWLEDGE_BIO_LIMIT
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
  async function run({ limit, signal, budgetMs = 45_000, respectCadence = false } = {}) {
    const control = readCatalogKnowledgeControl(database, { env, at: now() });
    const stats = { checked: 0, prioritized: 0, filled: 0, bios: 0, countries: 0, unmatched: 0, failed: 0, stale: 0, deferred: 0,
      failureCategory: null, cooldownUntil: null,
      coolingDown: false, storagePaused: false, stoppedEarly: false,
      memoryPaused: false, budgetPaused: false, capPaused: false, modePaused: false,
      lanes: control?.limits.lanes || 1 };
    const recordPass = (result) => {
      setMeta.run(SUMMARY_KEY, JSON.stringify({ ...result, at: now() }));
      return result;
    };
    const safeToContinue = () => {
      const liveControl = readCatalogKnowledgeControl(database, { env, at: now() });
      if (!liveControl || ["paused", "disabled"].includes(liveControl.effectiveMode)) stats.modePaused = true;
      if (!storageReady()) stats.storagePaused = true;
      if (!memoryReady()) stats.memoryPaused = true;
      if (!stats.storagePaused && !catalogKnowledgeGrowthReady(database, databaseBytes())) stats.capPaused = true;
      return !(stats.modePaused || stats.storagePaused || stats.memoryPaused || stats.capPaused || stats.budgetPaused);
    };
    aborted(signal);
    if (!control || ["paused", "disabled"].includes(control.effectiveMode)) return recordPass({ ...stats, modePaused: true });
    // Normal ticks preserve prior evidence while waiting for the durable due
    // time; admin pause/resume and process restarts cannot accelerate the loop.
    if (respectCadence && !reserveCatalogKnowledgePass(database, { env, at: now() })) return { ...stats, waiting: true };
    if (!safeToContinue()) return recordPass(stats);
    const cooldownUntil = Number(meta.get(COOLDOWN_KEY)?.value);
    if (Number.isSafeInteger(cooldownUntil) && cooldownUntil > now()) {
      return recordPass({ ...stats, coolingDown: true, cooldownUntil });
    }
    const deadline = AbortSignal.timeout(clamp(budgetMs, 45_000, 1000, 45_000));
    const stop = new AbortController();
    const workSignal = AbortSignal.any([deadline, stop.signal, ...(signal ? [signal] : [])]);
    const selectionAt = now();
    const passLimit = clamp(limit, control.limits.maxArtistsPerPass, 1, control.limits.maxArtistsPerPass);
    const priorityKeys = new Set(discoverArtistPriorityKeys(database, selectionAt));
    const priorityJson = JSON.stringify([...priorityKeys]);
    const rows = interleaveDiscoverPriority(
      priorityKeys.size ? priorityDue.all(selectionAt, priorityJson, passLimit) : [],
      regularDue.all(selectionAt, priorityJson, passLimit), passLimit);
    let cursor = 0;
    const pauseError = () => Object.assign(new Error("Optional catalog work paused"), { code: "CATALOG_PAUSED" });
    const deferClaim = (row, mbid, token) => {
      const at = now();
      const nextPassAt = readCatalogKnowledgeControl(database, { env, at })?.nextPassAt;
      const dueAt = Math.max(at + 1000,
        nextPassAt > at ? nextPassAt : at + control.limits.intervalMinutes * MINUTE);
      // A normal time slice, shutdown, quota/resource pause or peer cancellation
      // is not an artist/provider failure. Keep prior real failures unchanged,
      // release ownership, and let the ordinary next pass reclaim this row.
      if (Number(defer.run(dueAt, row.norm, mbid, token).changes) === 1) stats.deferred += 1;
    };
    const beforeRequest = () => {
      if (!safeToContinue()) throw pauseError();
      if (Number(meta.get(COOLDOWN_KEY)?.value) > now()) { stats.coolingDown = true; throw pauseError(); }
      if (!reserveCatalogKnowledgeBudget(database, "requests", { env, at: now() })) {
        stats.budgetPaused = true; throw pauseError();
      }
    };
    async function lane() {
      while (cursor < rows.length) {
        aborted(signal);
        if (workSignal.aborted) { stats.stoppedEarly = true; return; }
        if (!safeToContinue()) return;
        const item = rows[cursor++];
        const row = read.get(item.norm), mbid = artistBiographyIdentity(row?.mbid);
        if (!row) continue;
        if (!mbid) {
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
        if (!reserveCatalogKnowledgeBudget(database, "attempts", { env, at })) {
          // A budget pause is not a factual no-match or provider failure.
          deferClaim(row, mbid, token);
          stats.budgetPaused = true; return;
        }
        stats.checked += 1;
        if (priorityKeys.has(row.norm)) stats.prioritized += 1;
        let result;
        try {
          result = await fetchKnowledge({ mbid, needBio, needCountry, signal: workSignal, beforeRequest, now });
          aborted(workSignal);
          if (!safeToContinue()) throw pauseError();
        } catch (error) {
          if (signal?.aborted || deadline.aborted || stop.signal.aborted || error?.code === "CATALOG_PAUSED") {
            deferClaim(row, mbid, token);
            if (deadline.aborted || stop.signal.aborted) stats.stoppedEarly = true;
            aborted(signal);
            return;
          }
          const failures = Math.min(10, Number(check.get(row.norm)?.failures || 0) + 1);
          const retryAt = Math.max(now() + Math.min(DAY, 30 * MINUTE * 2 ** (failures - 1)),
            Number.isFinite(Number(error?.retryAt)) ? Number(error.retryAt) : 0);
          finish.run("failed", retryAt, failures, row.norm, mbid, token);
          setMeta.run(COOLDOWN_KEY, String(retryAt)); stats.failed += 1;
          stats.failureCategory = providerFailureCategory(error);
          stats.cooldownUntil = retryAt;
          stop.abort(new DOMException("Provider cooldown", "AbortError"));
          return;
        }
        // Synchronous, short savepoint: lanes never hold a write transaction
        // across a network await, and current identity/profile edits win.
        const saved = persist(row, result, token, now());
        stats.bios += saved.bios; stats.countries += saved.countries;
        if (saved.bios || saved.countries) stats.filled += 1;
        else if (saved.stale) stats.stale += 1;
        else stats.unmatched += 1;
      }
    }
    const outcomes = await Promise.allSettled(Array.from({ length: control.limits.lanes }, () => lane()));
    const failedLane = outcomes.find((outcome) => outcome.status === "rejected");
    if (failedLane) throw failedLane.reason;
    if (!stats.failed && !stats.stoppedEarly && safeToContinue()) completeCatalogKnowledgeSweep(database, { at: now() });
    return recordPass(stats);
  }
  return { runBatch(options) {
    if (!active) active = run(options || {}).finally(() => { active = null; });
    return active;
  } };
}

export function startArtistKnowledgeScheduler({
  database, directory, databasePath, env = process.env, logger = console,
  schedule = startPeriodicJob, coordinate = runBackgroundJob, service, now = Date.now,
} = {}) {
  if (!backgroundJobEnabled(env, "ARTIST_KNOWLEDGE_ENABLED")) return null;
  const startupReadyAt = now() + 3 * MINUTE;
  const refresher = service || createArtistKnowledgeRefresher({ database, env, now,
    storageReady: () => artistKnowledgeStorageReady(directory, databasePath),
    databaseBytes: () => artistKnowledgeDatabaseBytes(databasePath),
    memoryReady: () => artistKnowledgeMemoryReady() });
  logger.log?.("[pit] artist knowledge enrichment on; bounded catch-up/maintenance, shared provider gate and durable budgets.");
  return schedule({
    initialDelayMs: 3 * MINUTE, intervalMs: MINUTE,
    run: ({ signal }) => {
      // The scheduler's interval ticks independently of initialDelayMs. Keep
      // every early/manual tick out of the shared queue during cold start.
      if (now() < startupReadyAt) return false;
      const control = database ? readCatalogKnowledgeControl(database, { env, at: now() }) : null;
      if (control && (control.mode === "paused" || control.nextPassAt > now())) return false;
      return coordinate(async () => {
        const stats = await refresher.runBatch({ signal, respectCadence: true });
        if (!stats.waiting) logger.log?.(`[pit] artist knowledge: lanes=${stats.lanes || 1} checked=${stats.checked} filled=${stats.filled} bios=${stats.bios} countries=${stats.countries} noMatch=${stats.unmatched} deferred=${stats.deferred || 0} providerFailures=${stats.failed} failureCategory=${stats.failureCategory || "none"} cooldownUntil=${stats.cooldownUntil || 0} coolingDown=${stats.coolingDown} stoppedEarly=${stats.stoppedEarly} modePaused=${stats.modePaused} storagePaused=${stats.storagePaused} memoryPaused=${stats.memoryPaused} budgetPaused=${stats.budgetPaused} capPaused=${stats.capPaused}`);
      });
    },
    report: (error) => logger.error?.(`[pit] artist knowledge paused safely cause=${privateErrorLabel(error)}`),
  });
}
