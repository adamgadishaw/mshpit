import { fetchNewsText } from "./newsPublicFetch.js";
export { allowedRedirect, publicAddress, assertPublicHost } from "./newsPublicFetch.js";
import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { anthropicMonthlyCeilingMicroUsd } from "../../claudeSpendCeiling.js";
import { anthropicErrorSummary } from "../../anthropicErrors.js";
import { privateErrorLabel } from "../../errors.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { runBackgroundJob } from "../../backgroundJobCoordinator.js";
import { artistKnowledgeMemoryReady } from "../../artistKnowledgeRefresh.js";
import { applyOnce, createNewsDesk, newsDeskBudget, repairStoryArtists, withdrawNewsStories } from "./newsDeskService.js";
import { createNewsSummarizer } from "./newsSummarizer.js";
import { createWikipediaBuzz } from "./newsBuzz.js";
import { recordNewsDeskFailure, recordNewsDeskPass } from "./newsDeskStatus.js";
import { ensureNewsLiveSchema, liveEventRunning } from "./newsLive.js";

const MINUTE = 60_000;
const FEED_MAX_BYTES = 2 * 1024 * 1024;
const ARTICLE_MAX_BYTES = 3 * 1024 * 1024;

// One feed, with a timeout and a size cap; feeds are small XML files.
export const fetchFeedText = (url, { signal } = {}) => fetchNewsText(url, {
  signal, timeoutMs: 20_000, maxBytes: FEED_MAX_BYTES,
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
});

// Wikipedia and Wikidata JSON for the buzz signal: small, public, keyless.
export const fetchPublicJson = async (url, { signal } = {}) => JSON.parse(await fetchNewsText(url, {
  signal, timeoutMs: 10_000, maxBytes: 1024 * 1024, accept: "application/json",
}));

// One article page, only for a story that is about to be written up.
export const fetchArticleText = (url, { signal } = {}) => fetchNewsText(url, {
  signal, timeoutMs: 15_000, maxBytes: ARTICLE_MAX_BYTES, accept: "text/html",
});

export const newsDeskConfigured = (env = process.env) => !!String(env.ANTHROPIC_API_KEY || "").trim();

export const NEWS_DESK_PASS_BUDGET_MS = 3 * MINUTE;

// Share one maintenance slot with catalogue work. Bound the whole pass (not
// just individual HTTP calls), and yield before publication if uploads need
// the memory. Feed rotation and durable receipts make a later pass resumable.
// `record` saves what the pass did for the Moderation panel (newsDeskStatus.js).
export function runNewsDeskPass({ desk, signal, coordinate = runBackgroundJob,
  memoryReady = artistKnowledgeMemoryReady, logger = console, budgetMs = NEWS_DESK_PASS_BUDGET_MS,
  record = () => {}, now = Date.now, publish = true }) {
  return coordinate(async () => {
    if (signal?.aborted) return false;
    if (!memoryReady()) {
      record({ at: now(), reason: "yielded_for_memory" });
      return false;
    }
    const publisher = publish ? desk.publisherStatus?.() : null;
    if (publisher && !publisher.ok) {
      logger.warn?.(`[news-desk] publishing paused: ${publisher.reason}. ${publisher.message}`);
      record({ at: now(), reason: "publisher_paused", publisherReason: publisher.reason });
      return false;
    }
    const timeout = Number.isFinite(budgetMs) ? Math.max(1000, Math.min(NEWS_DESK_PASS_BUDGET_MS, budgetMs)) : NEWS_DESK_PASS_BUDGET_MS;
    const deadline = AbortSignal.timeout(timeout);
    const workSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const added = await desk.ingest({ signal: workSignal });
    if (workSignal.aborted || !memoryReady()) {
      record({ at: now(), reason: workSignal.aborted ? "time_limit" : "yielded_for_memory", reportsAdded: added });
      return false;
    }
    if (!publish) return true;
    const result = await desk.publishPass({ signal: workSignal });
    record({ at: now(), reportsAdded: added, result });
    if (result.publisherReason) {
      logger.warn?.(`[news-desk] publishing paused: ${result.publisherReason}. ${result.publisherMessage}`);
      return false;
    }
    if (result.published || result.declined || result.skippedForBudget) {
      logger.log?.(`[news-desk] reports=${added} confirmed=${result.confirmed} published=${result.published} declined=${result.declined} budgetStop=${result.skippedForBudget} left=$${desk.budgetLeft().toFixed(2)}`);
    }
    for (const pick of result.picked) {
      const s = pick.signals;
      logger.log?.(`[news-desk] published "${pick.headline.slice(0, 90)}" slot=${result.slot} score=${pick.score} outlets=${s.groups} wikipedia=x${s.wikiRatio ?? "-"} popularity=${s.popularity} fans=${s.fans}`);
    }
    return true;
  });
}

// Every 20 minutes: read the outlets, then publish newly confirmed stories as
// @news_mod posts. Off unless NEWS_DESK_ENABLED is set and an Anthropic key is
// present; spending stops at NEWS_DESK_DAILY_USD / NEWS_DESK_MONTHLY_USD and
// at the monthly ceiling all Claude features share (ANTHROPIC_MONTHLY_USD).
export function startNewsDeskScheduler({ database, env = process.env, now = Date.now, fetchText = fetchFeedText, fetchArticle = fetchArticleText, fetchJson = fetchPublicJson }) {
  if (!newsDeskConfigured(env) || !backgroundJobEnabled(env, "NEWS_DESK_ENABLED")) return null;
  const summarize = createNewsSummarizer({ apiKey: String(env.ANTHROPIC_API_KEY).trim() });
  const buzz = createWikipediaBuzz({ database, fetchJson, now });
  const desk = createNewsDesk({ database, fetchText, fetchArticle, summarize, buzz, now, env });
  const repaired = repairStoryArtists(database);
  if (repaired) console.log(`[news-desk] tidied artist tags on ${repaired} earlier stories`);
  // 2026-09-26: the owner took down four stories the old rules published that
  // do not meet the editorial bar: a second copy of the New York festival
  // cancellations, and three with only two independent outlets (Ween's box
  // set, Olivia Rodrigo's tour opener, the Jingle Ball lineups).
  const withdrawn = applyOnce(database, "news-desk:withdraw:2026-09-26", () => withdrawNewsStories(database, [
    "news_bcaff4e2-7076-41dd-b99e-23dc4fba37e0",
    "news_e65f4c84-932e-49b1-8ec2-bb356a79670b",
    "news_278bf539-6f3f-485e-85ad-6231fd9e58d8",
    "news_a88f7651-4fc7-429b-b960-5488ef250e31",
  ], "withdrawn by the owner: below the editorial bar"));
  if (withdrawn) console.log(`[news-desk] withdrew ${withdrawn} stories below the editorial bar`);
  // While live coverage runs (newsLive.js), read the outlets every 5 minutes
  // so its timeline keeps up; reading feeds costs nothing.
  ensureNewsLiveSchema(database);
  return startNewsDeskTimers({ database, desk, env, now });
}

// Both timers belong to one lifetime. A live-only ingest uses the same
// cancellation, deadline and memory admission as ordinary news maintenance.
export function startNewsDeskTimers({ database, desk, env = process.env, now = Date.now,
  startJob = startPeriodicJob, coordinate = runBackgroundJob, memoryReady = artistKnowledgeMemoryReady } = {}) {
  const live = startJob({
    initialDelayMs: 5 * MINUTE,
    intervalMs: 5 * MINUTE,
    run: async ({ signal }) => {
      if (!liveEventRunning(database, now())) return true;
      return runNewsDeskPass({ desk, signal, now, coordinate, memoryReady, publish: false });
    },
    report: (error) => console.error(`[news-desk] live refresh failed safely: ${privateErrorLabel(error)}`),
  });
  const budget = newsDeskBudget(env);
  console.log(`[news-desk] on: $${budget.dailyUsd}/day, $${budget.monthlyUsd}/month, shared Claude ceiling $${anthropicMonthlyCeilingMicroUsd(env) / 1_000_000}/month`);
  const regular = startJob({
    initialDelayMs: 4 * MINUTE,
    intervalMs: 20 * MINUTE,
    run: ({ signal }) => runNewsDeskPass({ desk, signal, now, coordinate, memoryReady, record: (entry) => recordNewsDeskPass(database, entry) }),
    // An Anthropic error says what to fix (401: the key; 400: the request or
    // the account); the summary is safe to log and to show staff.
    report: (error) => {
      const label = privateErrorLabel(error);
      const detail = anthropicErrorSummary(error);
      recordNewsDeskFailure(database, { at: now(), label, detail });
      console.error(`[news-desk] pass failed safely: ${label} ${detail}`.trim());
    },
  });
  return Object.freeze({
    trigger: regular.trigger,
    stop: (options = {}) => Promise.all([live.stop(options), regular.stop(options)]),
  });
}
