import { randomUUID } from "node:crypto";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { runBackgroundJob } from "../../backgroundJobCoordinator.js";
import { createSearchConsoleClient, searchConsoleConfiguration } from "./searchConsoleClient.js";

const DAY = 86_400_000, RETRY = 6 * 3_600_000, LEASE = 90_000;
export const SEARCH_GROWTH_LIMITS = Object.freeze({ maxPages: 1000, maxPrioritiesPerDay: 10, retentionDays: 90 });
const MODES = new Set(["paused", "monitor", "prioritize"]);
const ERROR_CODES = new Set(["missing_property", "invalid_property", "missing_credentials", "invalid_credentials", "configuration", "invalid_window",
  "oauth_unavailable", "oauth_rejected", "oauth_invalid_response", "query_unavailable", "query_rejected", "query_invalid_response",
  "response_too_large", "request_timeout", "request_aborted", "run_revoked", "priority_delivery_failed"]);
export const searchGrowthEnabled = (env = process.env) => /^(true|1|yes|on)$/iu.test(String(env.SEARCH_GROWTH_ENABLED || "").trim());
const fault = code => Object.assign(new Error("Search growth import did not complete."), { code });
const day = at => new Date(at).toISOString().slice(0, 10);
const parse = value => { try { return JSON.parse(value || "null"); } catch { return null; } };

function ensureSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS search_growth_state (
    id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL CHECK(mode IN ('paused','monitor','prioritize')),
    revision INTEGER NOT NULL DEFAULT 0,next_run_at INTEGER NOT NULL DEFAULT 0,last_success_at INTEGER,last_error_code TEXT,
    lease_token TEXT,lease_expires_at INTEGER NOT NULL DEFAULT 0,snapshot_property TEXT,
    window_start TEXT,window_end TEXT,previous_start TEXT,previous_end TEXT,current_totals TEXT,previous_totals TEXT,
    truncated INTEGER NOT NULL DEFAULT 0,priority_day TEXT,priority_count INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO search_growth_state(id,mode) VALUES (1,'monitor');
    CREATE TABLE IF NOT EXISTS search_growth_pages (
      window_key TEXT NOT NULL CHECK(window_key IN ('current','previous')),path TEXT NOT NULL,
      clicks REAL NOT NULL,impressions REAL NOT NULL,ctr REAL NOT NULL,position REAL NOT NULL,PRIMARY KEY(window_key,path));
    CREATE TABLE IF NOT EXISTS search_growth_opportunities (
      path TEXT PRIMARY KEY,clicks REAL NOT NULL,impressions REAL NOT NULL,ctr REAL NOT NULL,position REAL NOT NULL,
      previous_ctr REAL,score REAL NOT NULL,reason TEXT NOT NULL CHECK(reason IN ('ctr_opportunity','content_visibility')));
    CREATE TABLE IF NOT EXISTS search_growth_runs (id TEXT PRIMARY KEY,at INTEGER NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('success','failed','aborted')),opportunities INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_search_growth_runs_at ON search_growth_runs(at,id);`);
}

// A pure allowlist, not a URL fetcher. Reject dot-segment normalization and
// encoded separators before URL parsing can hide them. Store no query strings.
export function searchGrowthPublicPath(value) {
  if (typeof value !== "string" || value.length > 700 || /[\u0000-\u0020\u007f\\?#]/u.test(value)) return null;
  const match = /^https:\/\/(?:www\.)?mshpit\.com(\/[^?#]*)$/u.exec(value);
  if (!match) return null;
  const path = match[1];
  const parts = path.slice(1).split("/");
  if (!(["artist", "venue", "event"].includes(parts[0]) && parts.length === 2)
    && !(["city", "venues"].includes(parts[0]) && parts.length === 3 && /^[a-z]{2}$/u.test(parts[1]))) return null;
  try {
    for (const part of parts) {
      const decoded = decodeURIComponent(part);
      if (!decoded || decoded.length > 200 || decoded === "." || decoded === ".." || /[\u0000-\u001f\u007f/?#\\:%]/u.test(decoded)) return null;
    }
    return path;
  } catch { return null; }
}

export function searchGrowthWindows(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(at)).map(part => [part.type, part.value]));
  const today = Date.parse(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  return { window: { startDate: day(today - 30 * DAY), endDate: day(today - 3 * DAY) },
    previousWindow: { startDate: day(today - 58 * DAY), endDate: day(today - 31 * DAY) } };
}

function metrics(value) {
  if (!value || ["clicks", "impressions", "position"].some(key => typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0)
    || value.clicks > value.impressions || value.impressions > 1e12 || value.position > 1000) return null;
  return { clicks: value.clicks, impressions: value.impressions, ctr: value.impressions ? value.clicks / value.impressions : 0, position: value.position };
}
function normalizeWindow(value) {
  const totals = metrics(value?.totals);
  if (!totals || !Array.isArray(value?.pages)) throw fault("query_invalid_response");
  const pages = new Map();
  const rawPages = new Set();
  for (const row of value.pages.slice(0, SEARCH_GROWTH_LIMITS.maxPages)) {
    const path = searchGrowthPublicPath(row?.page), aggregate = metrics(row);
    if (!path || !aggregate) continue;
    if (rawPages.has(row.page)) throw fault("query_invalid_response");
    rawPages.add(row.page);
    const previous = pages.get(path);
    if (!previous) { pages.set(path, { path, ...aggregate }); continue; }
    // A domain property may contain both apex and www URLs after canonical
    // changes. Preserve both observations instead of silently losing one.
    const impressions = previous.impressions + aggregate.impressions;
    const combined = metrics({ clicks: previous.clicks + aggregate.clicks, impressions,
      position: impressions ? (previous.position * previous.impressions + aggregate.position * aggregate.impressions) / impressions : 0 });
    if (!combined) throw fault("query_invalid_response");
    pages.set(path, { path, ...combined });
  }
  return { totals, pages: [...pages.values()], truncated: value.truncated === true || value.pages.length > SEARCH_GROWTH_LIMITS.maxPages };
}
function opportunities(current, previous) {
  const earlier = new Map(previous.map(row => [row.path, row]));
  return current.flatMap(row => {
    if (row.impressions < 50 || row.position < 4 || row.position > 20) return [];
    const prior = earlier.get(row.path);
    const referenceCtr = row.position <= 6 ? 0.05 : row.position <= 10 ? 0.03 : 0.01;
    const lowCtr = row.ctr < referenceCtr;
    const lostVisibility = prior?.impressions >= 50 && (row.impressions < prior.impressions * 0.7 || row.position > prior.position + 3);
    if (!lowCtr && !lostVisibility) return [];
    const score = Math.round(Math.min(100, Math.log2(row.impressions + 1) * (lowCtr ? 1 - row.ctr / referenceCtr : 0.5)) * 100) / 100;
    return [{ ...row, previousCtr: prior?.ctr ?? null, score, reason: lowCtr ? "ctr_opportunity" : "content_visibility" }];
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 200);
}

export function readSearchGrowthPriorityState({ database, env = process.env, at = Date.now() } = {}) {
  const disabled = { enabled: false, mode: "paused", updatedAt: null, expiresAt: null };
  if (!database?.prepare || !searchGrowthEnabled(env)) return disabled;
  try {
    const state = database.prepare("SELECT mode,last_success_at,snapshot_property FROM search_growth_state WHERE id=1").get();
    const config = searchConsoleConfiguration(env);
    const expiresAt = state?.last_success_at ? state.last_success_at + 2 * DAY : null;
    return { enabled: !!(config.configured && state?.mode === "prioritize" && state.snapshot_property === config.property
      && state.last_success_at <= at && expiresAt > at), mode: state?.mode || "paused", updatedAt: state?.last_success_at || null, expiresAt };
  } catch {
    // architecture: allow-ambiguous-result -- optional priority hints fail closed in uninitialized/older worker fixtures; no schema is created by a read.
    return disabled;
  }
}

function abortable(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(fault(signal.reason?.code === "request_timeout" ? "request_timeout" : "request_aborted"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function createSearchGrowthService({ database, env = process.env, now = Date.now, client, onPriorities } = {}) {
  ensureSchema(database); // Called once at server boot, never from a route handler.
  const read = database.prepare("SELECT * FROM search_growth_state WHERE id=1");
  let active = null, controller = null, ownedToken = null, stopped = false;
  const config = () => searchConsoleConfiguration(env);
  const prune = at => {
    database.prepare("DELETE FROM search_growth_runs WHERE at<? OR id NOT IN (SELECT id FROM search_growth_runs ORDER BY at DESC,id DESC LIMIT 100)").run(at - 90 * DAY);
  };
  function collectStatus() {
    const state = read.get(), connection = config();
    const sameProperty = state.snapshot_property === connection.property;
    const hasSnapshot = sameProperty && !!state.last_success_at;
    return { enabled: searchGrowthEnabled(env), configured: connection.configured, mode: state.mode,
      connection: { state: !connection.configured ? connection.reason : !searchGrowthEnabled(env) ? "disabled"
        : state.last_error_code ? "error" : hasSnapshot ? "connected" : "awaiting_import", property: connection.property },
      lastSuccessAt: hasSnapshot ? state.last_success_at : null, nextRunAt: state.next_run_at || null,
      lastErrorCode: state.last_error_code || null, running: !!state.lease_token && state.lease_expires_at > now(),
      window: hasSnapshot ? { startDate: state.window_start, endDate: state.window_end } : null,
      previousWindow: hasSnapshot ? { startDate: state.previous_start, endDate: state.previous_end } : null,
      totals: { current: hasSnapshot ? parse(state.current_totals) : null, previous: hasSnapshot ? parse(state.previous_totals) : null },
      truncated: hasSnapshot && !!state.truncated,
      opportunities: hasSnapshot ? database.prepare(`SELECT path,clicks,impressions,ctr,position,previous_ctr AS previousCtr,score,reason
        FROM search_growth_opportunities ORDER BY score DESC,path LIMIT 200`).all().map(row => ({ ...row })) : [],
      limits: SEARCH_GROWTH_LIMITS,
      history: database.prepare("SELECT at,outcome,opportunities FROM search_growth_runs ORDER BY at DESC,id DESC LIMIT 100").all().map(row => ({ ...row })),
      measurement: { state: "not_connected" } };
  }
  function setMode(mode) {
    if (!MODES.has(mode)) throw new TypeError("Unknown search growth mode.");
    database.prepare(`UPDATE search_growth_state SET mode=?,revision=revision+1,
      next_run_at=CASE WHEN lease_token IS NOT NULL THEN MAX(next_run_at,?) ELSE next_run_at END,
      lease_token=NULL,lease_expires_at=0 WHERE id=1 AND mode<>?`).run(mode, now() + RETRY, mode);
    return collectStatus();
  }
  function authority(token, signal, property) {
    if (signal.aborted) throw fault(signal.reason?.code === "request_timeout" ? "request_timeout" : "request_aborted");
    const state = read.get(), current = config();
    if (stopped || !searchGrowthEnabled(env) || !current.configured || current.property !== property
      || state.mode === "paused" || state.lease_token !== token || state.lease_expires_at <= now()) throw fault("run_revoked");
    return state;
  }
  async function execute(signal) {
    const initial = read.get(), connection = config(), at = now();
    if (stopped || !searchGrowthEnabled(env)) return { outcome: "disabled" };
    if (!connection.configured) return { outcome: "not_configured" };
    if (initial.mode === "paused") return { outcome: "paused" };
    if (signal.aborted) return { outcome: "aborted" };
    const token = randomUUID();
    const claimed = database.prepare(`UPDATE search_growth_state SET lease_token=?,lease_expires_at=? WHERE id=1
      AND mode<>'paused' AND next_run_at<=? AND (lease_token IS NULL OR lease_expires_at<=?)`).run(token, at + LEASE, at, at);
    if (!claimed.changes) return { outcome: "not_due" };
    ownedToken = token;
    try {
      const windows = searchGrowthWindows(at), reader = client || createSearchConsoleClient({ env });
      const current = normalizeWindow(await abortable(() => reader.readWindow({ ...windows.window, signal }), signal));
      authority(token, signal, connection.property);
      const previous = normalizeWindow(await abortable(() => reader.readWindow({ ...windows.previousWindow, signal }), signal));
      const candidates = opportunities(current.pages, previous.pages);
      let delivery = [];
      database.exec("BEGIN IMMEDIATE");
      try {
        const state = authority(token, signal, connection.property), committedAt = now();
        database.exec("DELETE FROM search_growth_pages; DELETE FROM search_growth_opportunities;");
        const insertPage = database.prepare("INSERT INTO search_growth_pages VALUES (?,?,?,?,?,?)");
        for (const [key, data] of [["current", current], ["previous", previous]]) {
          for (const row of data.pages) insertPage.run(key, row.path, row.clicks, row.impressions, row.ctr, row.position);
        }
        const insertOpportunity = database.prepare("INSERT INTO search_growth_opportunities VALUES (?,?,?,?,?,?,?,?)");
        for (const row of candidates) insertOpportunity.run(row.path, row.clicks, row.impressions, row.ctr, row.position, row.previousCtr, row.score, row.reason);
        const priorityDay = day(committedAt), used = state.priority_day === priorityDay ? state.priority_count : 0;
        if (state.mode === "prioritize" && typeof onPriorities === "function") {
          // City/collection pages stay visible for review, but cannot consume
          // the entity worker's small daily allowance without a usable binding.
          delivery = candidates.filter(({ path }) => path.length <= 512 && /^\/(?:artist|venue|event)\/[A-Za-z0-9_-]+$/u.test(path))
            .slice(0, Math.max(0, 10 - used)).map(({ path, score }) => ({ path, score }));
        }
        database.prepare(`UPDATE search_growth_state SET snapshot_property=?,window_start=?,window_end=?,previous_start=?,previous_end=?,
          current_totals=?,previous_totals=?,truncated=?,last_success_at=?,next_run_at=?,last_error_code=NULL,priority_day=?,priority_count=? WHERE id=1 AND lease_token=?`)
          .run(connection.property, windows.window.startDate, windows.window.endDate, windows.previousWindow.startDate, windows.previousWindow.endDate,
            JSON.stringify(current.totals), JSON.stringify(previous.totals), Number(current.truncated || previous.truncated), committedAt, committedAt + DAY, priorityDay, used + delivery.length, token);
        database.prepare("INSERT INTO search_growth_runs VALUES (?,?,?,?)").run(randomUUID(), committedAt, "success", candidates.length);
        prune(committedAt);
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
      if (delivery.length) {
        const state = authority(token, signal, connection.property);
        if (state.mode === "prioritize") {
          try { await abortable(() => { authority(token, signal, connection.property); return onPriorities({ pages: delivery, at: now() }); }, signal); }
          catch (error) { throw ERROR_CODES.has(error?.code) ? error : fault("priority_delivery_failed"); }
        }
      }
      database.prepare("UPDATE search_growth_state SET lease_token=NULL,lease_expires_at=0 WHERE id=1 AND lease_token=?").run(token);
      return { outcome: "success", opportunities: candidates.length, prioritized: delivery.length };
    } catch (error) {
      const code = ERROR_CODES.has(error?.code) ? error.code : "query_unavailable";
      const outcome = ["request_aborted", "run_revoked"].includes(code) ? "aborted" : "failed";
      database.exec("BEGIN IMMEDIATE");
      try {
        const changed = database.prepare(`UPDATE search_growth_state SET lease_token=NULL,lease_expires_at=0,next_run_at=?,last_error_code=? WHERE id=1 AND lease_token=?`)
          .run(now() + RETRY, code, token);
        if (changed.changes) { database.prepare("INSERT INTO search_growth_runs VALUES (?,?,?,0)").run(randomUUID(), now(), outcome); prune(now()); }
        database.exec("COMMIT");
      } catch (failure) { database.exec("ROLLBACK"); throw failure; }
      return { outcome, code };
    } finally { if (ownedToken === token) ownedToken = null; }
  }
  function runOnce({ signal } = {}) {
    if (active) return active;
    controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(fault("request_timeout")), 60_000);
    timer.unref?.();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    active = execute(combined).finally(() => { clearTimeout(timer); controller = null; active = null; });
    return active;
  }
  function stop({ abortActive = false } = {}) {
    stopped = true;
    if (abortActive) {
      controller?.abort(fault("request_aborted"));
      if (ownedToken) database.prepare(`UPDATE search_growth_state SET lease_token=NULL,lease_expires_at=0,next_run_at=MAX(next_run_at,?) WHERE id=1 AND lease_token=?`)
        .run(now() + RETRY, ownedToken);
    }
    return active || Promise.resolve();
  }
  return Object.freeze({ collectStatus, setMode, runOnce, stop });
}

export function startSearchGrowthScheduler({ service, coordinate = runBackgroundJob, logger = console, ...timers } = {}) {
  const job = startPeriodicJob({ ...timers, initialDelayMs: 3 * 60_000, intervalMs: 60 * 60_000,
    run: ({ signal }) => coordinate(() => service.runOnce({ signal })),
    report: () => logger.warn?.("[search-growth] background import could not run; moderation status remains available.") });
  return Object.freeze({ trigger: job.trigger, stop: async (options = {}) => { const pending = job.stop(options); await service.stop(options); await pending; } });
}
