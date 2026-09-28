// Owner-chosen stories. When the feed feels stale, the owner can pick one of
// the stories the outlets are covering, search the coverage for a topic, or
// paste links, then have Claude write a draft to review before publishing.
//
// Cost: listing and searching read only the saved outlet reports (no Claude).
// A draft is one Claude call, reserved against the same news budgets and
// shared monthly ceiling as the automatic desk, and at most DRAFTS_PER_DAY a
// day. Publishing a reviewed draft costs nothing and skips the publishing
// slots; the sourcing rules do not change: two independent outlets, three for
// deaths and legal news, each from the outlets the desk reads.
import { randomUUID } from "node:crypto";
import { claudeRequestDefinitelyRejected } from "../../claudeSpendCeiling.js";
import { createArtistMatcher, createNewsDesk } from "./newsDeskService.js";
import { fetchArticleText, newsDeskConfigured } from "./newsDeskJob.js";
import { articleLead, plainText } from "./newsFeedParser.js";
import { NEWS_SOURCES, sourceOwnsUrl } from "./newsSources.js";
import { clusterReports, headlineTokens, independentGroups, newsCategory, SENSITIVE_CATEGORIES, storyCategory } from "./newsStoryRules.js";
import { createNewsSummarizer, MAX_REPORTS, storyPrompt, worstCaseCostUsd } from "./newsSummarizer.js";

const HOUR = 60 * 60 * 1000;
const OPEN_WINDOW_MS = 48 * HOUR;
const SEARCH_WINDOW_MS = 7 * 24 * HOUR;
const DRAFT_TTL_MS = 24 * HOUR;
export const DRAFTS_PER_DAY = 10;
const MAX_LINKS = 3;
const CANDIDATES = 8;

// `code` is an existing ERROR_CATALOG code; the message is shown to the owner.
export class NewsEditorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NewsEditorError";
    this.code = code;
  }
}
const fail = (code, message) => { throw new NewsEditorError(code, message); };

export function ensureNewsDraftSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS news_drafts (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('draft','declined','published','discarded')),
    reports TEXT NOT NULL,
    result TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_by TEXT,
    story_post_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_news_drafts_created ON news_drafts(created_at);`);
}

// Different owners first, so a flood from one publisher cannot push
// independent confirmation past the six reports Claude reads.
function differentOwnersFirst(reports) {
  const groups = new Set();
  const first = [];
  const rest = [];
  for (const report of reports) {
    if (groups.has(report.group)) rest.push(report);
    else { first.push(report); groups.add(report.group); }
  }
  return [...first, ...rest].slice(0, MAX_REPORTS);
}

const outletsNeeded = (reports) => (SENSITIVE_CATEGORIES.has(storyCategory(reports)) ? 3 : 2);

function candidateJson({ cluster, score, signals }, at) {
  const shown = differentOwnersFirst(cluster);
  const newest = [...cluster].sort((left, right) => right.publishedAt - left.publishedAt)[0];
  const groups = independentGroups(cluster);
  const needed = outletsNeeded(cluster);
  return {
    headline: newest.title,
    reportUrls: shown.map((report) => report.url),
    outlets: shown.map((report) => ({ name: report.sourceName, url: report.url, title: report.title })),
    groups,
    needed,
    ready: groups >= needed,
    category: storyCategory(cluster),
    ageHours: Math.max(0, Math.round((at - Math.min(...cluster.map((report) => report.publishedAt))) / HOUR)),
    lead: signals?.lead || null,
    score,
  };
}

// The page's own headline: og:title, else <title>.
export function articleTitle(html) {
  const text = String(html || "");
  const og = text.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/iu)?.[1]
    || text.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/iu)?.[1];
  const title = og || text.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] || "";
  return plainText(title, 300).replace(/\s+/gu, " ").trim();
}

function draftJson(row, at) {
  const result = JSON.parse(row.result);
  const reports = JSON.parse(row.reports);
  const supporting = new Set((result.supporting || []).map((item) => item.url));
  return {
    id: row.id,
    status: row.status,
    expired: row.status === "draft" && at - row.created_at > DRAFT_TTL_MS,
    headline: result.headline || "",
    summary: result.summary || "",
    body: result.body || "",
    category: result.category || null,
    reason: row.status === "declined" ? result.reason || "not publishable" : null,
    costUsd: Number(row.cost_usd) || 0,
    sources: reports.map((report) => ({ name: report.sourceName, url: report.url, used: supporting.has(report.url) })),
    postId: row.story_post_id || null,
    createdAt: row.created_at,
  };
}

export function createNewsDeskEditor({ database, env = process.env, now = Date.now, newId = randomUUID,
  summarize = newsDeskConfigured(env) ? createNewsSummarizer({ apiKey: String(env.ANTHROPIC_API_KEY).trim() }) : null,
  fetchArticle = fetchArticleText, draftsPerDay = DRAFTS_PER_DAY } = {}) {
  ensureNewsDraftSchema(database);
  const desk = createNewsDesk({ database, fetchText: async () => "", fetchArticle, summarize, env, now, newId });
  const tools = desk.editorTools;
  let writing = false;

  const draftsToday = (at) => Number(database.prepare("SELECT COUNT(*) AS n FROM news_drafts WHERE created_at>=?").get(at - 24 * HOUR).n) || 0;

  async function ranked(reports, at) {
    if (!reports.length) return [];
    return (await tools.rankCandidates(clusterReports(reports), at, null, { lookups: 0 }))
      .sort((left, right) => Number(independentGroups(right.cluster) >= outletsNeeded(right.cluster))
        - Number(independentGroups(left.cluster) >= outletsNeeded(left.cluster)) || right.score - left.score);
  }

  // Stories the outlets are covering that the desk has not written up.
  async function candidates(at = now()) {
    const rows = database.prepare(`SELECT * FROM news_reports WHERE story_id IS NULL AND published_at>=?
      ORDER BY published_at DESC,url ASC LIMIT 1200`).all(at - OPEN_WINDOW_MS);
    return (await ranked(rows.map(tools.reportRow), at)).slice(0, CANDIDATES).map((item) => candidateJson(item, at));
  }

  // The week's coverage of an artist or topic, grouped into stories. Reports
  // already in a published story are left out; ones Claude declined are not.
  async function search(query, at = now()) {
    const text = String(query || "").replace(/\s+/gu, " ").trim().slice(0, 120);
    if (text.length < 2) return [];
    const words = headlineTokens(text);
    const artists = new Set(createArtistMatcher(database)(text));
    if (!words.size && !artists.size) return [];
    const rows = database.prepare(`SELECT r.* FROM news_reports r LEFT JOIN news_stories s ON s.id=r.story_id
      WHERE r.published_at>=? AND (r.story_id IS NULL OR s.status='declined')
      ORDER BY r.published_at DESC,r.url ASC LIMIT 3000`).all(at - SEARCH_WINDOW_MS);
    const matches = rows.map(tools.reportRow).filter((report) => {
      if (report.artistKeys.some((key) => artists.has(key))) return true;
      const tokens = headlineTokens(`${report.title} ${report.description || ""}`);
      let shared = 0;
      for (const word of words) if (tokens.has(word)) shared += 1;
      return words.size > 0 && shared / words.size >= (words.size <= 2 ? 1 : 0.6);
    });
    return (await ranked(matches, at)).slice(0, 5).map((item) => candidateJson(item, at));
  }

  async function linkReport(value, at, matchArtists, signal) {
    let url;
    try { url = new URL(String(value || "").trim()); }
    catch { fail("VALIDATION_FAILED", "One of the links is not a web address."); }
    const source = NEWS_SOURCES.find((item) => sourceOwnsUrl(item, url.href));
    if (!source) {
      fail("ACTION_REQUIRED", `Links have to come from the outlets the desk reads: ${NEWS_SOURCES.map((item) => item.name).join(", ")}.`);
    }
    let html;
    try { html = await fetchArticle(url.href, { signal }); }
    catch { fail("ACTION_REQUIRED", `The ${source.name} page could not be read. Try another link.`); }
    const title = articleTitle(html);
    if (!title) fail("ACTION_REQUIRED", `The ${source.name} page has no headline to work from. Try another link.`);
    return { url: url.href, sourceId: source.id, sourceName: source.name, group: source.group, title, description: "",
      lead: articleLead(html), category: newsCategory(title), publishedAt: at, artistKeys: matchArtists(title), tokens: headlineTokens(title) };
  }

  const urlList = (value, max, label) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 2000)) {
      fail("VALIDATION_FAILED", `Choose at most ${max} ${label}.`);
    }
    return [...new Set(value.map((item) => item.trim()))];
  };

  // One Claude call. The draft is saved whether Claude writes it up or turns
  // it down, so the owner sees what was spent and why.
  async function draft({ reportUrls, links, actorId = null, signal } = {}) {
    if (!summarize) fail("ACTION_REQUIRED", "Add ANTHROPIC_API_KEY in Render before writing drafts.");
    const chosen = urlList(reportUrls, MAX_REPORTS, "reports");
    const pasted = urlList(links, MAX_LINKS, "links").filter((url) => !chosen.includes(url));
    if (!chosen.length && !pasted.length) fail("VALIDATION_FAILED", "Pick a story or paste a link first.");
    const at = now();
    const used = draftsToday(at);
    if (used >= draftsPerDay) fail("RATE_LIMITED", `That is ${used} drafts in the last 24 hours, the most allowed. Publish or wait for tomorrow's allowance.`);
    if (writing) fail("CONFLICT", "A draft is already being written. Wait for it to finish.");
    writing = true;
    try {
      const find = database.prepare(`SELECT r.*, s.status AS story_status FROM news_reports r LEFT JOIN news_stories s ON s.id=r.story_id WHERE r.url=?`);
      const rows = chosen.map((url) => find.get(url));
      if (rows.some((row) => !row)) fail("CONFLICT", "One of those reports is no longer on file. Refresh and pick again.");
      if (rows.some((row) => row.story_status === "published")) fail("CONFLICT", "That story has already been published.");
      const matchArtists = pasted.length ? createArtistMatcher(database) : () => [];
      const linked = [];
      for (const url of pasted) linked.push(await linkReport(url, at, matchArtists, signal));
      const fromFeeds = await tools.withArticleLeads(rows.map(tools.reportRow), signal);
      const seen = new Set();
      const reports = differentOwnersFirst([...fromFeeds, ...linked].filter((report) => !seen.has(report.url) && seen.add(report.url)));
      const needed = outletsNeeded(reports);
      const groups = independentGroups(reports);
      if (groups < needed) {
        fail("ACTION_REQUIRED", needed === 3
          ? `Deaths and legal news need three independent outlets; this has ${groups}. Paste links from more outlets.`
          : `A story needs two independent outlets; this has ${groups}. Paste a link from another outlet that covers it.`);
      }
      const worstCase = worstCaseCostUsd(storyPrompt(reports, { minIndependentPublishers: 2 }));
      const receipt = tools.admitCall(worstCase);
      if (!receipt) {
        fail("RATE_LIMITED", `The news budget cannot cover a draft right now (up to $${worstCase.toFixed(2)}; $${Math.max(0, desk.budgetLeft()).toFixed(2)} left today). It resets tomorrow, or raise NEWS_DESK_DAILY_USD in Render.`);
      }
      let result;
      try {
        result = await summarize(reports, { signal, minIndependentPublishers: 2 });
      } catch (error) {
        if (claudeRequestDefinitelyRejected(error)) tools.settleSpend(receipt, 0, now());
        else tools.markUncertain(receipt, now());
        throw Object.assign(new NewsEditorError("PROVIDER_UNAVAILABLE", "Claude could not write the draft. Try again in a few minutes."), { cause: error });
      }
      tools.settleSpend(receipt, result.costUsd, now());
      const id = newId();
      const written = result.publish && result.headline && result.summary;
      const stored = {
        headline: result.headline || "", summary: result.summary || "", body: result.body || "", category: result.category,
        artists: result.artists || [], reason: result.reason || "", costUsd: result.costUsd,
        supporting: (result.supporting || []).map((report) => ({ sourceId: report.sourceId, url: report.url })),
      };
      const saved = reports.map(({ tokens: _tokens, storyId: _storyId, ...report }) => report);
      database.prepare(`INSERT INTO news_drafts (id,status,reports,result,cost_usd,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, written ? "draft" : "declined", JSON.stringify(saved), JSON.stringify(stored), Number(result.costUsd) || 0, actorId, at, now());
      return draftJson(database.prepare("SELECT * FROM news_drafts WHERE id=?").get(id), now());
    } finally {
      writing = false;
    }
  }

  function readDraft(id) {
    const row = typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/u.test(id) ? database.prepare("SELECT * FROM news_drafts WHERE id=?").get(id) : null;
    if (!row) fail("NOT_FOUND", "That draft no longer exists.");
    return row;
  }

  // Synchronous from start to finish, so one draft can never publish twice.
  function publish(id) {
    const row = readDraft(id);
    if (row.status !== "draft") fail("CONFLICT", row.status === "published" ? "That draft is already published." : "That draft cannot be published.");
    if (now() - row.created_at > DRAFT_TTL_MS) fail("CONFLICT", "That draft is more than a day old. Write a fresh one so the facts are current.");
    const reports = JSON.parse(row.reports).map((report) => ({ ...report, tokens: headlineTokens(report.title) }));
    const result = JSON.parse(row.result);
    const written = tools.publishStory({ reports, result, at: now(), costUsd: result.costUsd, minPublishers: 2, manual: true,
      signals: { manual: true } });
    if (!written) fail("CONFLICT", "It could not be published: the news account needs review, or the draft's sources no longer qualify.");
    database.prepare("UPDATE news_drafts SET status='published',story_post_id=?,updated_at=? WHERE id=? AND status='draft'").run(written.postId, now(), row.id);
    return { draft: draftJson(readDraft(row.id), now()), postId: written.postId };
  }

  function discard(id) {
    const row = readDraft(id);
    if (row.status === "published") fail("CONFLICT", "A published story is taken down from its post, not from the draft.");
    database.prepare("UPDATE news_drafts SET status='discarded',updated_at=? WHERE id=? AND status IN ('draft','declined')").run(now(), row.id);
    return draftJson(readDraft(row.id), now());
  }

  async function overview({ query = null } = {}) {
    const at = now();
    const recent = database.prepare(`SELECT * FROM news_drafts WHERE status<>'discarded' AND created_at>=?
      ORDER BY created_at DESC,id DESC LIMIT 10`).all(at - 3 * 24 * HOUR);
    const typical = Number(database.prepare(`SELECT AVG(cost_usd) AS usd FROM (SELECT cost_usd FROM news_drafts
      WHERE cost_usd>0 ORDER BY created_at DESC LIMIT 10)`).get()?.usd) || 0.02;
    return {
      configured: !!summarize,
      publisherReady: desk.publisherStatus().ok === true,
      budget: { leftTodayUsd: Math.max(0, Math.round(desk.budgetLeft() * 100) / 100), dailyUsd: tools.budget.dailyUsd,
        monthlyUsd: tools.budget.monthlyUsd, typicalDraftUsd: Math.round(typical * 1000) / 1000 },
      drafts: { last24h: draftsToday(at), limit: draftsPerDay, recent: recent.map((row) => draftJson(row, at)) },
      candidates: await candidates(at),
      ...(query ? { query: String(query).slice(0, 120), matches: await search(query, at) } : {}),
    };
  }

  return { overview, candidates, search, draft, publish, discard };
}
