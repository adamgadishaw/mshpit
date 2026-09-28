import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
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

const MAX_REDIRECTS = 3;
// The registrable site: the last two labels, or three under a two-letter
// country domain such as co.uk, so bbc.co.uk never widens to all of co.uk.
const siteOf = (hostname) => {
  const labels = hostname.toLowerCase().split(".");
  const secondLevel = labels.length > 2 && labels.at(-1).length === 2 && labels.at(-2).length <= 3;
  return labels.slice(secondLevel ? -3 : -2).join(".");
};

// A redirect may only move within the same site over https (www.nme.com to
// nme.com, en.wikipedia.org to its mobile host): never to another host, a
// bare IP address, a port or embedded credentials.
export function allowedRedirect(from, to) {
  const host = to.hostname.toLowerCase();
  return to.protocol === "https:" && !to.username && !to.password && !to.port
    && !/^[\d.]+$/u.test(host) && !host.includes(":")
    && (host === siteOf(from.hostname) || host.endsWith(`.${siteOf(from.hostname)}`));
}

// Addresses a publisher's own hostname must never resolve to: private,
// loopback, link-local, carrier NAT, multicast, reserved and documentation
// ranges, and the NAT64 form that could hide one of them.
const NON_PUBLIC = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) NON_PUBLIC.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) NON_PUBLIC.addSubnet(address, prefix, "ipv6");

// BlockList also matches IPv4 addresses against IPv4-mapped IPv6 rules, so a
// mapped answer (::ffff:10.0.0.1) is unwrapped and checked as IPv4 instead.
export function publicAddress(address) {
  const value = String(address || "").toLowerCase();
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  if (mapped) return publicAddress(mapped);
  const family = isIP(value);
  if (family === 6 && value.startsWith("::ffff:")) return false;
  return family !== 0 && !NON_PUBLIC.check(value, family === 6 ? "ipv6" : "ipv4");
}

// Every hop's hostname must resolve only to public addresses. This checks the
// answer the resolver gives now; fetch resolves again when it connects, so a
// publisher whose DNS is under an attacker's control could still race it. The
// same-site redirect rule above limits that to a publisher's own domain.
export async function assertPublicHost(hostname, { resolve = lookup } = {}) {
  const answers = await resolve(hostname, { all: true, verbatim: true });
  if (!answers?.length || !answers.every(({ address }) => publicAddress(address))) {
    throw new Error("publisher host does not resolve to a public address");
  }
}

async function fetchBounded(url, { signal, timeoutMs, accept, maxBytes, resolve = lookup }) {
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const first = new URL(url);
  let current = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current.hostname, { resolve });
    const response = await fetch(current, { signal: deadline, headers: { "user-agent": USER_AGENT, accept }, redirect: "manual" });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location) {
      await response.body?.cancel().catch(() => undefined);
      const next = new URL(location, current);
      if (!allowedRedirect(first, next)) throw new Error("redirect off the publisher's site refused");
      current = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${response.status}`);
    }
    return boundedText(response, maxBytes);
  }
  throw new Error("too many redirects");
}

// One feed, with a timeout and a size cap; feeds are small XML files.
export const fetchFeedText = (url, { signal } = {}) => fetchBounded(url, {
  signal, timeoutMs: 20_000, maxBytes: FEED_MAX_BYTES,
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
});

// Wikipedia and Wikidata JSON for the buzz signal: small, public, keyless.
export const fetchPublicJson = async (url, { signal } = {}) => JSON.parse(await fetchBounded(url, {
  signal, timeoutMs: 10_000, maxBytes: 1024 * 1024, accept: "application/json",
}));

// One article page, only for a story that is about to be written up.
export const fetchArticleText = (url, { signal } = {}) => fetchBounded(url, {
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
  record = () => {}, now = Date.now }) {
  return coordinate(async () => {
    if (signal?.aborted) return false;
    if (!memoryReady()) {
      record({ at: now(), reason: "yielded_for_memory" });
      return false;
    }
    const publisher = desk.publisherStatus?.();
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
  startPeriodicJob({
    initialDelayMs: 5 * MINUTE,
    intervalMs: 5 * MINUTE,
    run: async ({ signal }) => {
      if (!liveEventRunning(database, now())) return true;
      await runBackgroundJob(() => desk.ingest({ signal }));
      return true;
    },
    report: (error) => console.error(`[news-desk] live refresh failed safely: ${privateErrorLabel(error)}`),
  });
  const budget = newsDeskBudget(env);
  console.log(`[news-desk] on: $${budget.dailyUsd}/day, $${budget.monthlyUsd}/month, shared Claude ceiling $${anthropicMonthlyCeilingMicroUsd(env) / 1_000_000}/month`);
  return startPeriodicJob({
    initialDelayMs: 4 * MINUTE,
    intervalMs: 20 * MINUTE,
    run: ({ signal }) => runNewsDeskPass({ desk, signal, now, record: (entry) => recordNewsDeskPass(database, entry) }),
    // An Anthropic error says what to fix (401: the key; 400: the request or
    // the account); the summary is safe to log and to show staff.
    report: (error) => {
      const label = privateErrorLabel(error);
      const detail = anthropicErrorSummary(error);
      recordNewsDeskFailure(database, { at: now(), label, detail });
      console.error(`[news-desk] pass failed safely: ${label} ${detail}`.trim());
    },
  });
}
