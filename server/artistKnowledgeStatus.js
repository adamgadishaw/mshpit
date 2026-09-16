// Read-only, aggregate operational evidence. Never fetch providers, create a
// schema, or return artist/member identities from a health request.
import { backgroundJobEnabled } from "./backgroundJobs.js";
import { readCatalogKnowledgeControl } from "./catalogKnowledgeControl.js";

const MINUTE = 60_000;
const LAST_PASS = "artist-knowledge:v1:last-pass";
const COOLDOWN = "artist-knowledge:v1:cooldown";
const COUNTS = ["checked", "filled", "bios", "countries", "unmatched", "failed", "stale"];
const FLAGS = ["coolingDown", "storagePaused", "stoppedEarly"];
const OPTIONAL_FLAGS = ["memoryPaused", "budgetPaused", "capPaused", "modePaused"];
const STATES = ["filled", "no_match", "skipped", "failed", "leased"];
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const ledgerCache = new WeakMap();

function parsePass(text, at) {
  if (typeof text !== "string" || text.length > 4096) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || Array.isArray(parsed) || timestamp(parsed.at) === null || parsed.at > at
    || COUNTS.some((key) => count(parsed[key]) === null)
    || (parsed.deferred !== undefined && count(parsed.deferred) === null)
    || (parsed.prioritized !== undefined && (count(parsed.prioritized) === null || parsed.prioritized > parsed.checked))
    || FLAGS.some((key) => typeof parsed[key] !== "boolean")
    || OPTIONAL_FLAGS.some((key) => parsed[key] !== undefined && typeof parsed[key] !== "boolean")) return null;
  return Object.freeze({ at: parsed.at,
    ...Object.fromEntries(COUNTS.map((key) => [key, parsed[key]])),
    deferred: parsed.deferred ?? null,
    prioritized: parsed.prioritized ?? null,
    ...Object.fromEntries(FLAGS.map((key) => [key, parsed[key]])),
    ...Object.fromEntries(OPTIONAL_FLAGS.map((key) => [key, parsed[key] === true])),
    lanes: Number.isInteger(parsed.lanes) && parsed.lanes >= 1 && parsed.lanes <= 3 ? parsed.lanes : 1,
  });
}

function readLedger(database, at) {
  const cached = ledgerCache.get(database);
  if (cached && at >= cached.at && at - cached.at < MINUTE) return cached.value;
  const totals = { filled: 0, no_match: 0, skipped: 0, failed: 0, leased: 0 };
  const rows = database.prepare(`SELECT status,COUNT(*) total FROM artist_knowledge_checks
    WHERE status IN ('filled','no_match','skipped','failed','leased') GROUP BY status`).all();
  for (const row of rows) {
    if (!STATES.includes(row.status) || count(row.total) === null) throw new TypeError("Invalid knowledge ledger aggregate");
    totals[row.status] = row.total;
  }
  const value = Object.freeze({ tracked: Object.values(totals).reduce((sum, value) => sum + value, 0), ...totals });
  ledgerCache.set(database, { at, value });
  return value;
}

export function collectArtistKnowledgeStatus(database, { env = process.env, at = Date.now() } = {}) {
  const checkedAt = timestamp(at);
  const enabled = backgroundJobEnabled(env, "ARTIST_KNOWLEDGE_ENABLED");
  const rawBatch = Number(env?.ARTIST_KNOWLEDGE_BATCH);
  const batch = Number.isFinite(rawBatch) ? Math.max(1, Math.min(10, Math.floor(rawBatch))) : 10;
  const limits = Object.freeze({ maxArtistsPerPass: batch, intervalMinutes: 15, maxAttemptsPerDay: batch * 96 });
  const base = { enabled, checkedAt, limits, lastPass: null, lastPassAgeMinutes: null, cooldownUntil: null, ledger: null };
  if (checkedAt === null) return Object.freeze({ ...base, state: "unavailable" });
  try {
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='artist_knowledge_checks'").get();
    if (!table) return Object.freeze({ ...base, state: enabled ? "awaiting_first_pass" : "disabled" });
    const meta = database.prepare("SELECT value FROM app_meta WHERE key=?");
    const rawPass = meta.get(LAST_PASS)?.value;
    const lastPass = parsePass(rawPass, at);
    const rawCooldown = meta.get(COOLDOWN)?.value;
    const cooldownUntil = rawCooldown == null ? null : timestamp(Number(rawCooldown));
    const lastPassAgeMinutes = lastPass ? Math.floor((at - lastPass.at) / MINUTE) : null;
    const control = readCatalogKnowledgeControl(database, { env, at });
    const state = !enabled ? "disabled"
      : (rawPass != null && !lastPass) || (rawCooldown != null && cooldownUntil === null) ? "unavailable"
      : control?.mode === "paused" || lastPass?.modePaused ? "paused"
      : cooldownUntil > at ? "cooling_down"
      : !lastPass ? "awaiting_first_pass"
      : lastPassAgeMinutes > 45 ? "stale"
      : lastPass.storagePaused ? "storage_paused"
      : lastPass.memoryPaused ? "memory_paused"
      : lastPass.capPaused ? "growth_paused"
      : lastPass.budgetPaused ? "budget_paused"
      : lastPass.stoppedEarly || lastPass.failed > 0 ? "deferred"
      : lastPass.checked === 0 ? "idle" : "recent";
    return Object.freeze({ ...base, limits: control?.limits || limits, mode: control?.mode || "maintenance",
      state, lastPass, lastPassAgeMinutes, cooldownUntil, ledger: readLedger(database, at) });
  } catch {
    // No database paths, SQL, provider errors, or private data enter diagnostics.
    return Object.freeze({ ...base, state: enabled ? "unavailable" : "disabled" });
  }
}

export function artistKnowledgeWatchCodes(status) {
  if (!status?.enabled) return [];
  return ({ unavailable: ["artist_knowledge_status_unavailable"], stale: ["artist_knowledge_stale"],
    awaiting_first_pass: ["artist_knowledge_unverified"],
    storage_paused: ["artist_knowledge_storage_paused"], cooling_down: ["artist_knowledge_provider_cooldown"],
    growth_paused: ["artist_knowledge_growth_paused"], memory_paused: ["artist_knowledge_memory_paused"],
  })[status.state] || [];
}

export function formatArtistKnowledgeStatus(status) {
  const pass = status.lastPass;
  const ledger = status.ledger;
  return `Artist knowledge: scheduled ${status.enabled ? "yes" : "no"}; evidence ${status.state}; latest pass age ${status.lastPassAgeMinutes === null ? "unavailable" : `${status.lastPassAgeMinutes}m`};`
    + ` last pass checked ${pass?.checked ?? "unavailable"}, filled ${pass?.filled ?? "unavailable"};`
    + ` tracked artists ${ledger?.tracked ?? "unavailable"}, latest-result filled ${ledger?.filled ?? "unavailable"}, no match ${ledger?.no_match ?? "unavailable"}, retrying ${ledger?.failed ?? "unavailable"};`
    + ` limit ${status.limits.maxArtistsPerPass}/${status.limits.intervalMinutes}m. Counts are artist field checks, not complete artist/venue/event pages.`;
}
