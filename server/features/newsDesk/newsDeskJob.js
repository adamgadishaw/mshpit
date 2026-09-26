import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { anthropicMonthlyCeilingMicroUsd } from "../../claudeSpendCeiling.js";
import { privateErrorLabel } from "../../errors.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { createNewsDesk, newsDeskBudget } from "./newsDeskService.js";
import { createNewsSummarizer } from "./newsSummarizer.js";

const MINUTE = 60_000;
const FEED_MAX_BYTES = 2 * 1024 * 1024;
const ARTICLE_MAX_BYTES = 3 * 1024 * 1024;
const USER_AGENT = "MshpitNewsDesk/1.0 (+https://www.mshpit.com/news)";

// Reads at most maxBytes of a response body, then stops downloading.
async function boundedText(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(0, maxBytes).toString("utf8");
}

async function fetchBounded(url, { signal, timeoutMs, accept, maxBytes }) {
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": USER_AGENT, accept },
    redirect: "follow",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP ${response.status}`);
  }
  return boundedText(response, maxBytes);
}

// One feed, with a timeout and a size cap; feeds are small XML files.
export const fetchFeedText = (url, { signal } = {}) => fetchBounded(url, {
  signal, timeoutMs: 20_000, maxBytes: FEED_MAX_BYTES,
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
});

// One article page, only for a story that is about to be written up.
export const fetchArticleText = (url, { signal } = {}) => fetchBounded(url, {
  signal, timeoutMs: 15_000, maxBytes: ARTICLE_MAX_BYTES, accept: "text/html",
});

export const newsDeskConfigured = (env = process.env) => !!String(env.ANTHROPIC_API_KEY || "").trim();

// Every 20 minutes: read the outlets, then publish newly confirmed stories as
// @news_mod posts. Off unless NEWS_DESK_ENABLED is set and an Anthropic key is
// present; spending stops at NEWS_DESK_DAILY_USD / NEWS_DESK_MONTHLY_USD and
// at the monthly ceiling all Claude features share (ANTHROPIC_MONTHLY_USD).
export function startNewsDeskScheduler({ database, env = process.env, now = Date.now, fetchText = fetchFeedText, fetchArticle = fetchArticleText }) {
  if (!newsDeskConfigured(env) || !backgroundJobEnabled(env, "NEWS_DESK_ENABLED")) return null;
  const summarize = createNewsSummarizer({ apiKey: String(env.ANTHROPIC_API_KEY).trim() });
  const desk = createNewsDesk({ database, fetchText, fetchArticle, summarize, now, env });
  const budget = newsDeskBudget(env);
  console.log(`[news-desk] on: $${budget.dailyUsd}/day, $${budget.monthlyUsd}/month, shared Claude ceiling $${anthropicMonthlyCeilingMicroUsd(env) / 1_000_000}/month`);
  return startPeriodicJob({
    initialDelayMs: 4 * MINUTE,
    intervalMs: 20 * MINUTE,
    run: async ({ signal }) => {
      const added = await desk.ingest({ signal });
      const result = await desk.publishPass({ signal });
      if (added || result.confirmed || result.published || result.declined || result.skippedForBudget) {
        console.log(`[news-desk] reports=${added} confirmed=${result.confirmed} published=${result.published} declined=${result.declined} budgetStop=${result.skippedForBudget} left=$${desk.budgetLeft().toFixed(2)}`);
      }
      return true;
    },
    // An Anthropic error carries its HTTP status (401: the key was rejected,
    // 400: often no credit left), which is safe to log and says what to fix.
    report: (error) => console.error(`[news-desk] pass failed safely: ${privateErrorLabel(error)}${Number.isInteger(error?.status) ? ` status=${error.status}` : ""}`),
  });
}
