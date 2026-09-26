import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { privateErrorLabel } from "../../errors.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { createNewsDesk, newsDeskBudget } from "./newsDeskService.js";
import { createNewsSummarizer } from "./newsSummarizer.js";

const MINUTE = 60_000;
const FEED_MAX_BYTES = 2 * 1024 * 1024;

// Reads one feed with a timeout and a size cap; feeds are small XML files.
export async function fetchFeedText(url, { signal } = {}) {
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    headers: { "user-agent": "MshpitNewsDesk/1.0 (+https://www.mshpit.com)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return text.length > FEED_MAX_BYTES ? text.slice(0, FEED_MAX_BYTES) : text;
}

export const newsDeskConfigured = (env = process.env) => !!String(env.ANTHROPIC_API_KEY || "").trim();

// Every 20 minutes: read the outlets, then publish newly confirmed stories as
// @news_mod posts. Off unless NEWS_DESK_ENABLED is set and an Anthropic key is
// present; spending stops at NEWS_DESK_DAILY_USD / NEWS_DESK_MONTHLY_USD.
export function startNewsDeskScheduler({ database, env = process.env, now = Date.now, fetchText = fetchFeedText }) {
  if (!newsDeskConfigured(env) || !backgroundJobEnabled(env, "NEWS_DESK_ENABLED")) return null;
  const summarize = createNewsSummarizer({ apiKey: String(env.ANTHROPIC_API_KEY).trim() });
  const desk = createNewsDesk({ database, fetchText, summarize, now, env });
  const budget = newsDeskBudget(env);
  console.log(`[news-desk] on: $${budget.dailyUsd}/day, $${budget.monthlyUsd}/month`);
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
    report: (error) => console.error(`[news-desk] pass failed safely: ${privateErrorLabel(error)}`),
  });
}
