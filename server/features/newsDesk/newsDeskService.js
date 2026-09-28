import { randomUUID } from "node:crypto";
import { admitClaudeSpend, claudeCeilingLeftMicroUsd, claudeRequestDefinitelyRejected } from "../../claudeSpendCeiling.js";
import { activeAccountSql } from "../../accountVisibility.js";
import { resolveNewsPublisher } from "./newsPublisherIdentity.js";
import { NEWS_SOURCES, newsSourceById, sourceOwnsUrl } from "./newsSources.js";
import { articleLead, parseNewsFeed } from "./newsFeedParser.js";
import { clusterReports, headlineTokens, independentGroups, isConfirmed, looksLikeNews, newsCategory, SENSITIVE_CATEGORIES, similarity, storyCategory, validatedSupportingReports } from "./newsStoryRules.js";
import { EDITORIAL, publishingSlot, storyScore, topStoryScore, twoPublisherFallbackAllowed } from "./newsEditorial.js";
import { MAX_REPORTS, storyPrompt, worstCaseCostUsd } from "./newsSummarizer.js";
import { artistDiscoverPhotoUri, deezerImageUrl } from "../artistPhotos/discoverPhoto.js";

// The news desk: reads established music outlets, groups reports about the
// same event, and publishes a story from the news account only when
// independent outlets confirm it. Stories are ordinary status posts, so they
// appear in the feed, on the news profile and under comments like any post;
// the story record adds the headline and the list of sources.

const HOUR = 60 * 60 * 1000;
const REPORT_WINDOW_MS = 48 * HOUR;
const KEEP_REPORTS_MS = 14 * 24 * HOUR;
const FEED_CURSOR_KEY = "news-desk:feed-cursor:v1";
// Bound the quadratic grouping pass even if feeds suddenly flood the desk.
export const MAX_OPEN_REPORTS_PER_PASS = 1200;
export const NEWS_DESK_HANDLE = "news_mod";

// A story costs about 2 cents, so $0.30 a day covers the daily story limit.
// The desk also stops when all Claude features together reach the shared
// monthly ceiling (server/claudeSpendCeiling.js).
export const newsDeskBudget = (env = process.env) => ({
  dailyUsd: positiveNumber(env.NEWS_DESK_DAILY_USD, 0.3),
  monthlyUsd: positiveNumber(env.NEWS_DESK_MONTHLY_USD, 6),
});
// Articles read per story: one per publisher group, so the write-up has more
// than headlines to go on.
const ARTICLES_PER_STORY = 4;
function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function ensureNewsDeskSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS news_reports (
    url TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    artist_keys TEXT NOT NULL DEFAULT '[]',
    published_at INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    story_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_news_reports_open ON news_reports(story_id, published_at);
  CREATE TABLE IF NOT EXISTS news_stories (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('published','declined')),
    headline TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    artist_keys TEXT NOT NULL DEFAULT '[]',
    sources TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    post_id TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_news_stories_recent ON news_stories(status, created_at DESC, id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_news_stories_post ON news_stories(post_id) WHERE post_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS news_desk_spend (day TEXT PRIMARY KEY, usd REAL NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS news_desk_receipts (
    token TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    reserved_usd REAL NOT NULL,
    charged_usd REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('reserved','settled','uncertain')),
    created_at INTEGER NOT NULL,
    settled_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_news_desk_receipts_day ON news_desk_receipts(day);`);
  // Columns added after the first release: the full write-up, and the
  // editorial score with the signals behind it.
  const columns = new Set(database.prepare("PRAGMA table_info(news_stories)").all().map((column) => column.name));
  if (!columns.has("body")) database.exec("ALTER TABLE news_stories ADD COLUMN body TEXT NOT NULL DEFAULT ''");
  if (!columns.has("score")) database.exec("ALTER TABLE news_stories ADD COLUMN score REAL NOT NULL DEFAULT 0");
  if (!columns.has("signals")) database.exec("ALTER TABLE news_stories ADD COLUMN signals TEXT NOT NULL DEFAULT '{}'");
}

const ignoreMissingTable = (read) => {
  try { return read(); }
  catch (error) { if (/no such (table|column)/iu.test(String(error?.message))) return 0; throw error; }
};

// How many Mshpit members care about an artist: people who follow them, are in
// their fan club, reviewed one of their shows in the last six months, or
// played them in the last three.
export function mshpitFans(database, artist, at = Date.now()) {
  const name = String(artist?.name || "").trim();
  if (!name || !artist?.key) return 0;
  const count = (sql, ...args) => ignoreMissingTable(() => Number(database.prepare(sql).get(...args)?.n) || 0);
  return count(`SELECT COUNT(*) AS n FROM users u, json_each(CASE WHEN json_valid(u.favorite_artists) THEN u.favorite_artists ELSE '[]' END) j
      WHERE u.favorite_artists LIKE ? AND lower(trim(j.value))=lower(?)`, `%${name.replace(/[%_]/gu, "")}%`, name)
    + count("SELECT COUNT(*) AS n FROM fan_club_members WHERE lower(artist)=lower(?)", name)
    + count("SELECT COUNT(DISTINCT user_id) AS n FROM posts WHERE artist_key=? AND removed=0 AND created_at>=?", artist.key, at - 180 * 24 * HOUR)
    + count("SELECT COUNT(DISTINCT user_id) AS n FROM plays WHERE lower(artist)=lower(?) AND created_at>=?", name, at - 90 * 24 * HOUR);
}

const parseJson = (value, fallback) => { try { const parsed = JSON.parse(value); return parsed ?? fallback; } catch { return fallback; } };
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);

// Catalogue artists a headline names. Only artists with an audience take part,
// names must appear as whole words, and single-word names must be capitalised
// and at least four letters, so "Yes" or "Low" in a sentence do not count.
// Shorter names count only when they look like nothing else: a digit or all
// capitals, written exactly that way ("U2", "BTS", "SZA").
const distinctShortName = (name) => /\d/u.test(name) || (/\p{Lu}/u.test(name) && name === name.toUpperCase());
export function createArtistMatcher(database) {
  const byName = new Map();
  const shortNames = new Map();
  let longest = 1;
  for (const row of database.prepare("SELECT norm,name FROM artists WHERE COALESCE(popularity,0)>=35").iterate()) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const words = name.split(/\s+/u).length;
    if (words === 1 && name.length < 4) {
      if (name.length >= 2 && distinctShortName(name)) shortNames.set(name, row.norm);
      continue;
    }
    byName.set(name.toLowerCase(), row.norm);
    longest = Math.max(longest, Math.min(words, 6));
  }
  return (text) => {
    const words = String(text || "").replace(/['’]s\b/gu, "").split(/[^\p{L}\p{N}&$!.+-]+/u).filter(Boolean);
    const found = new Set();
    for (let start = 0; start < words.length; start += 1) {
      for (let size = Math.min(longest, words.length - start); size >= 1; size -= 1) {
        const phrase = words.slice(start, start + size).join(" ");
        const key = byName.get(phrase.toLowerCase()) || (size === 1 ? shortNames.get(phrase) : null);
        if (!key) continue;
        if (size === 1 && !/^\p{Lu}/u.test(phrase)) continue;
        found.add(key);
        break;
      }
    }
    return [...found].slice(0, 6);
  };
}

const artistNameKey = (name) => String(name || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Stories published before artists were checked against Claude's list could
// carry a headline word that happens to be an act ("Storm" in "due to storm")
// or a passing mention. Keep only the artists the story's own headline names;
// a story whose headline names none keeps what it has. Runs once.
const ARTIST_REPAIR_KEY = "news-desk:artist-repair:v1";
export function repairStoryArtists(database) {
  ensureNewsDeskSchema(database);
  if (database.prepare("SELECT 1 FROM app_meta WHERE key=?").get(ARTIST_REPAIR_KEY)) return 0;
  const matchArtists = createArtistMatcher(database);
  let repaired = 0;
  for (const story of database.prepare("SELECT id,headline,artist_keys,post_id FROM news_stories WHERE status='published'").all()) {
    const stored = parseJson(story.artist_keys, []);
    const named = new Set(matchArtists(story.headline));
    const kept = stored.filter((key) => named.has(key));
    if (!kept.length || kept.length === stored.length) continue;
    database.prepare("UPDATE news_stories SET artist_keys=?,updated_at=updated_at WHERE id=?").run(JSON.stringify(kept), story.id);
    repaired += 1;
  }
  database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING").run(ARTIST_REPAIR_KEY, String(repaired));
  return repaired;
}

// `buzz` (see newsBuzz.js) adds internet buzz to the ranking; without it
// stories rank on coverage, artist size and Mshpit fans. `editorial` is the
// policy in newsEditorial.js; tests may open its slots.
// Takes published stories down: the post is hidden (removed=1, its text kept,
// so it can be restored) and the story is marked declined with the reason.
// Only @news_mod posts are touched. Returns how many were withdrawn.
export function withdrawNewsStories(database, postIds, reason) {
  ensureNewsDeskSchema(database);
  let withdrawn = 0;
  for (const postId of postIds) {
    const story = database.prepare(`SELECT s.id FROM news_stories s JOIN posts p ON p.id=s.post_id JOIN users u ON u.id=p.user_id
      WHERE s.post_id=? AND s.status='published' AND lower(u.handle)=?`).get(String(postId), NEWS_DESK_HANDLE);
    if (!story) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("UPDATE posts SET removed=1 WHERE id=?").run(String(postId));
      database.prepare("UPDATE news_stories SET status='declined',reason=?,updated_at=? WHERE id=?").run(String(reason).slice(0, 200), Date.now(), story.id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    withdrawn += 1;
  }
  return withdrawn;
}

// A one-off change the owner asked for, applied once (recorded in app_meta).
export function applyOnce(database, key, change) {
  if (database.prepare("SELECT 1 FROM app_meta WHERE key=?").get(key)) return null;
  const result = change();
  database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING").run(key, JSON.stringify({ at: Date.now(), result }));
  return result;
}

export function createNewsDesk({ database, fetchText, fetchArticle = null, summarize = null, buzz = null, editorial = EDITORIAL, now = Date.now, newId = randomUUID, env = process.env, log = console }) {
  ensureNewsDeskSchema(database);
  const budget = newsDeskBudget(env);

  // Every Claude call reserves its worst-case price before it is sent, in the
  // same synchronous step as the budget check, so catalog research running at
  // the same moment sees it; it settles to the actual cost afterwards. A call
  // that fails once it may have been sent keeps its reservation: an
  // unconfirmed charge is counted, never forgotten. `news_desk_spend` holds the
  // totals recorded before receipts existed.
  function spentSince(fromDay) {
    const legacy = Number(database.prepare("SELECT COALESCE(SUM(usd),0) AS usd FROM news_desk_spend WHERE day>=?").get(fromDay)?.usd) || 0;
    const receipts = Number(database.prepare("SELECT COALESCE(SUM(charged_usd),0) AS usd FROM news_desk_receipts WHERE day>=?").get(fromDay)?.usd) || 0;
    return legacy + receipts;
  }
  function reserveSpend(at, usd) {
    const token = randomUUID();
    database.prepare(`INSERT INTO news_desk_receipts (token,day,reserved_usd,charged_usd,status,created_at)
      VALUES (?,?,?,?,'reserved',?)`).run(token, dayOf(at), usd, usd, at);
    return token;
  }
  function settleSpend(token, usd, at) {
    const charged = Number.isFinite(usd) && usd >= 0 ? usd : null;
    if (charged === null) return markUncertain(token, at);
    database.prepare("UPDATE news_desk_receipts SET status='settled',charged_usd=?,settled_at=? WHERE token=? AND status='reserved'").run(charged, at, token);
  }
  function markUncertain(token, at) {
    database.prepare("UPDATE news_desk_receipts SET status='uncertain',settled_at=? WHERE token=? AND status='reserved'").run(at, token);
  }
  function budgetLeft(at) {
    const day = dayOf(at);
    return Math.min(budget.dailyUsd - spentSince(day), budget.monthlyUsd - spentSince(`${day.slice(0, 7)}-01`),
      claudeCeilingLeftMicroUsd(database, { env, at }) / 1_000_000);
  }
  // Reserves one call's worst case against the news budgets and the shared
  // ceiling in one synchronous step; the receipt token, or null when it
  // does not fit. Used by owner-chosen drafts (newsDeskEditor.js).
  function admitCall(worstCase) {
    const admittedAt = now();
    const day = dayOf(admittedAt);
    const admission = admitClaudeSpend(database, {
      env, at: admittedAt, reserveMicroUsd: Math.ceil(worstCase * 1_000_000),
      dailyCapMicroUsd: Math.floor(budget.dailyUsd * 1_000_000), monthlyCapMicroUsd: Math.floor(budget.monthlyUsd * 1_000_000),
      readDailySpendMicroUsd: () => Math.ceil(spentSince(day) * 1_000_000),
      readMonthlySpendMicroUsd: () => Math.ceil(spentSince(`${day.slice(0, 7)}-01`) * 1_000_000),
      reserve: () => reserveSpend(admittedAt, worstCase),
    });
    return admission.ok ? admission.value : null;
  }

  // The opening paragraphs of up to four articles, one per publisher group,
  // fetched only from each outlet's own site. A page that fails to load just
  // leaves that report with its headline and teaser.
  async function withArticleLeads(reports, signal) {
    if (!fetchArticle) return reports;
    const groups = new Set();
    const chosen = new Set();
    for (const report of reports) {
      if (chosen.size >= ARTICLES_PER_STORY || groups.has(report.group)) continue;
      if (!sourceOwnsUrl(newsSourceById(report.sourceId), report.url)) continue;
      groups.add(report.group);
      chosen.add(report.url);
    }
    return Promise.all(reports.map(async (report) => {
      if (!chosen.has(report.url)) return report;
      try { return { ...report, lead: articleLead(await fetchArticle(report.url, { signal })) }; }
      catch { return report; }
    }));
  }

  // 1. Read every outlet and keep new reports that look like news.
  async function ingest({ signal } = {}) {
    const at = now();
    const matchArtists = createArtistMatcher(database);
    const insert = database.prepare(`INSERT OR IGNORE INTO news_reports
      (url,source_id,title,description,category,artist_keys,published_at,fetched_at) VALUES (?,?,?,?,?,?,?,?)`);
    let added = 0;
    const savedCursor = Number(database.prepare("SELECT value FROM app_meta WHERE key=?").get(FEED_CURSOR_KEY)?.value);
    const start = Number.isSafeInteger(savedCursor) && savedCursor >= 0 ? savedCursor % NEWS_SOURCES.length : 0;
    const saveCursor = database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    for (let offset = 0; offset < NEWS_SOURCES.length; offset += 1) {
      if (signal?.aborted) break;
      const index = (start + offset) % NEWS_SOURCES.length;
      const source = NEWS_SOURCES[index];
      // Persist before awaiting: a timeout, abort or restart advances to the
      // next outlet instead of starving the end of the list on every pass.
      saveCursor.run(FEED_CURSOR_KEY, String((index + 1) % NEWS_SOURCES.length));
      let items = [];
      try { items = parseNewsFeed(await fetchText(source.url, { signal }), { sourceId: source.id }); }
      catch (error) { log.warn?.(`[news-desk] ${source.id} feed unavailable: ${String(error?.message || error).slice(0, 120)}`); continue; }
      if (signal?.aborted) break;
      for (const item of items) {
        if (at - item.publishedAt > REPORT_WINDOW_MS || item.publishedAt > at + HOUR || !looksLikeNews(item.title)) continue;
        const text = `${item.title} ${item.description}`;
        const titleArtists = matchArtists(item.title);
        const category = newsCategory(item.title) === "other" ? newsCategory(text) : newsCategory(item.title);
        added += insert.run(item.url, source.id, item.title, item.description, category,
          JSON.stringify(titleArtists.length ? titleArtists : matchArtists(item.description)), item.publishedAt, at).changes;
      }
    }
    database.prepare("DELETE FROM news_reports WHERE fetched_at<?").run(at - KEEP_REPORTS_MS);
    return added;
  }

  const reportRow = (row) => {
    const source = newsSourceById(row.source_id);
    return {
      url: row.url, sourceId: row.source_id, sourceName: source?.name || row.source_id, group: source?.group || row.source_id,
      title: row.title, description: row.description, category: row.category, publishedAt: row.published_at,
      artistKeys: parseJson(row.artist_keys, []), tokens: headlineTokens(row.title), storyId: row.story_id,
    };
  };

  // Late reports about a story already written join its source list.
  function attachToPublished(open, at) {
    const stories = database.prepare(`SELECT s.id,s.sources,s.artist_keys FROM news_stories s
      WHERE s.status='published' AND s.created_at>=?`).all(at - 3 * 24 * HOUR);
    if (!stories.length) return open;
    const storyReports = new Map(stories.map((story) => [story.id, database.prepare("SELECT * FROM news_reports WHERE story_id=?").all(story.id).map(reportRow)]));
    // Sources accumulate per story across the whole pass and are written once,
    // together with the report assignments, so no late outlet is lost.
    const sourcesByStory = new Map(stories.map((story) => [story.id, parseJson(story.sources, [])]));
    const assigned = [];
    const remaining = open.filter((report) => {
      for (const story of stories) {
        const members = storyReports.get(story.id);
        // Same artist and a loose headline overlap; or, for stories about no
        // catalogue artist (a festival called off), a clear headline overlap,
        // so a second outlet's take is not published as a new story.
        if (!members.some((member) => member.url !== report.url && (
          (report.artistKeys.some((key) => member.artistKeys.includes(key)) && similarity(member.tokens, report.tokens) >= 0.2)
          || (!report.artistKeys.length && !member.artistKeys.length && similarity(member.tokens, report.tokens) >= 0.3)))) continue;
        assigned.push([story.id, report.url]);
        members.push(report);
        const sources = sourcesByStory.get(story.id);
        if (!sources.some((item) => item.url === report.url)) sources.push({ name: report.sourceName, url: report.url, title: report.title });
        return false;
      }
      return true;
    });
    if (assigned.length) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const mark = database.prepare("UPDATE news_reports SET story_id=? WHERE url=? AND story_id IS NULL");
        for (const [storyId, url] of assigned) mark.run(storyId, url);
        const update = database.prepare("UPDATE news_stories SET sources=?,updated_at=? WHERE id=?");
        for (const storyId of new Set(assigned.map(([storyId]) => storyId))) {
          update.run(JSON.stringify(sourcesByStory.get(storyId).slice(0, 10)), at, storyId);
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
    return remaining;
  }

  function newsAccount() {
    const identity = resolveNewsPublisher(database, { env, at: now() });
    return identity.ok ? { id: identity.accountId } : null;
  }

  function publicationTimes(at) {
    // Withdrawing a post does not undo the fact that a publishing slot was used.
    return database.prepare("SELECT created_at FROM news_stories WHERE post_id IS NOT NULL AND created_at>=?")
      .all(at - 36 * HOUR).map((row) => Number(row.created_at));
  }

  // A paid result may finish after another automatic pass or reviewed draft
  // claims its reports. Check ownership while holding the publication lock.
  function reportsAvailable(reports, manual = false) {
    const current = database.prepare("SELECT r.story_id,s.status FROM news_reports r LEFT JOIN news_stories s ON s.id=r.story_id WHERE r.url=?");
    return reports.every(report => {
      const row = current.get(report.url);
      return row ? row.story_id === null || (manual && row.status === "declined") : manual;
    });
  }

  // `manual`: the owner reviewed this draft and chose to publish it now, so
  // the publishing slots do not apply. Everything else still does.
  function publishStory({ reports, result, at, costUsd, minPublishers = 3, score = 0, signals = {}, manual = false, onPublished = null }) {
    const id = newId();
    const postId = `news_${id}`;
    // A model may select fewer sources than the cluster contains. Never turn
    // unselected reports into evidence, or trust a supplied ownership group.
    const supporting = validatedSupportingReports(reports, result.supporting);
    const sensitive = SENSITIVE_CATEGORIES.has(result.category) || SENSITIVE_CATEGORIES.has(storyCategory(reports));
    if (!isConfirmed(supporting, { minPublishers: sensitive ? 3 : minPublishers })) return null;
    // Headline matches, kept only when Claude names them as who the story is
    // about: a headline word can be an unrelated act ("Storm"), and a passing
    // mention ("Paul McCartney's drummer") is not the story.
    const claimed = new Set((Array.isArray(result.artists) ? result.artists : []).map(artistNameKey).filter(Boolean));
    const artistName = database.prepare("SELECT name FROM artists WHERE norm=?");
    const artistKeys = [...new Set(supporting.flatMap((report) => report.artistKeys))]
      .filter((key) => claimed.has(artistNameKey(artistName.get(key)?.name))).slice(0, 6);
    const lead = artistKeys[0] ? database.prepare("SELECT norm,name FROM artists WHERE norm=?").get(artistKeys[0]) : null;
    const sources = supporting.map((report) => ({ name: report.sourceName, sourceId: report.sourceId, group: report.group, url: report.url, title: report.title }));
    database.exec("BEGIN IMMEDIATE");
    try {
      // Network work may have crossed a slot boundary, or another publisher
      // may have won the slot. Recheck current authorization and policy here.
      const account = newsAccount();
      const published = publicationTimes(at);
      if (!account || !reportsAvailable(reports, manual) || (!manual && (!publishingSlot({ at, published, editorial }).open
        || (minPublishers === 2 && !twoPublisherFallbackAllowed({ at, published, editorial }))))) {
        database.exec("ROLLBACK");
        return null;
      }
      database.prepare(`INSERT INTO posts (id,user_id,artist,artist_key,venue,city,date,overall,review,kind,created_at)
        VALUES (?,?,?,?,'','','',0,?,'status',?)`).run(postId, account.id, lead?.name || "", lead?.norm || null, result.summary, at);
      database.prepare(`INSERT INTO news_stories (id,status,headline,summary,body,category,artist_keys,sources,post_id,cost_usd,score,signals,created_at,updated_at)
        VALUES (?,'published',?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, result.headline, result.summary, result.body || "", result.category, JSON.stringify(artistKeys),
        JSON.stringify(sources), postId, costUsd, score, JSON.stringify(signals), at, at);
      const mark = database.prepare("UPDATE news_reports SET story_id=? WHERE url=?");
      // Pasted reports need the same durable ownership as feed reports, or a
      // second saved draft could publish the exact same links again.
      if (manual) {
        const remember = database.prepare("INSERT OR IGNORE INTO news_reports(url,source_id,title,description,category,artist_keys,published_at,fetched_at) VALUES (?,?,?,?,?,?,?,?)");
        for (const report of reports) remember.run(report.url, report.sourceId, report.title, report.description || "", report.category || "other",
          JSON.stringify(report.artistKeys || []), report.publishedAt, at);
      }
      for (const report of reports) mark.run(id, report.url);
      onPublished?.({ id, postId });
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { id, postId };
  }

  function declineStory({ reports, result, at, score = 0, signals = {} }) {
    const id = newId();
    database.exec("BEGIN IMMEDIATE");
    try {
      if (!reportsAvailable(reports)) { database.exec("ROLLBACK"); return false; }
      database.prepare(`INSERT INTO news_stories (id,status,category,reason,cost_usd,score,signals,created_at,updated_at) VALUES (?,'declined',?,?,?,?,?,?,?)`)
        .run(id, result.category || storyCategory(reports), result.reason || "", result.costUsd || 0, score, JSON.stringify(signals), at, at);
      const mark = database.prepare("UPDATE news_reports SET story_id=? WHERE url=? AND story_id IS NULL");
      for (const report of reports) mark.run(id, report.url);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  // Every confirmed story's editorial score, best first. Coverage, artist size
  // and Mshpit fans are read for all of them; Wikipedia buzz only for the
  // leaders, to keep lookups few.
  async function rankCandidates(candidates, at, signal, { lookups = editorial.buzzLookups } = {}) {
    const artistRow = database.prepare("SELECT norm,name,popularity,data FROM artists WHERE norm=?");
    const ranked = candidates.map((cluster) => {
      const artists = [...new Set(cluster.flatMap((report) => report.artistKeys))].map((key) => artistRow.get(key)).filter(Boolean)
        .sort((left, right) => (Number(right.popularity) || 0) - (Number(left.popularity) || 0));
      const lead = artists[0] ? { key: artists[0].norm, name: artists[0].name, wikidataId: parseJson(artists[0].data, {})?.wikidataId || null } : null;
      const signals = {
        groups: independentGroups(cluster),
        outlets: new Set(cluster.map((report) => report.sourceId)).size,
        popularity: Number(artists[0]?.popularity) || 0,
        fans: lead ? mshpitFans(database, lead, at) : 0,
        ageHours: Math.round((at - Math.min(...cluster.map((report) => report.publishedAt))) / HOUR * 10) / 10,
        lead: lead?.name || null,
        wikiRatio: null,
      };
      return { cluster, lead, signals, score: storyScore(signals) };
    }).sort((left, right) => right.score - left.score);
    if (buzz) {
      for (const candidate of ranked.slice(0, lookups)) {
        if (!candidate.lead || signal?.aborted) continue;
        const spike = await buzz.spike(candidate.lead, { signal }).catch(() => null);
        // architecture: allow-ambiguous-result -- buzz only boosts the ranking; a failed lookup ranks on other signals
        if (!spike) continue;
        candidate.signals.wikiRatio = spike.ratio;
        candidate.score = storyScore(candidate.signals);
      }
      ranked.sort((left, right) => right.score - left.score);
    }
    return ranked;
  }

  // 2. Rank the confirmed stories and write the best one, if a publishing
  // slot is open (see newsEditorial.js).
  async function publishPass({ signal } = {}) {
    const at = now();
    const outcome = { confirmed: 0, published: 0, declined: 0, skippedForBudget: 0, waiting: 0, slot: null, picked: [] };
    if (!summarize) return outcome;
    const identity = resolveNewsPublisher(database, { env, at });
    if (!identity.ok) return { ...outcome, publisherReason: identity.reason, publisherMessage: identity.message };
    // Late attribution remains current even when today's publishing slot is full.
    const open = attachToPublished(database.prepare(`SELECT * FROM news_reports WHERE story_id IS NULL AND published_at>=?
      ORDER BY published_at DESC,url ASC LIMIT ?`).all(at - REPORT_WINDOW_MS, MAX_OPEN_REPORTS_PER_PASS).map(reportRow), at);
    const published = publicationTimes(at);
    const slot = publishingSlot({ at, published, editorial });
    outcome.slot = slot.open ? "open" : slot.reason;
    if (!slot.open) {
      outcome.waiting = 1;
      return outcome;
    }
    const clusters = clusterReports(open)
      .filter((cluster) => at - Math.min(...cluster.map((report) => report.publishedAt)) <= editorial.maxAgeMs);
    const candidates = clusters.filter((cluster) => isConfirmed(cluster));
    outcome.confirmed = candidates.length;
    const fallback = twoPublisherFallbackAllowed({ at, published, editorial })
      ? clusters.filter((cluster) => !SENSITIVE_CATEGORIES.has(storyCategory(cluster)) && independentGroups(cluster) === 2) : [];
    let calls = 0;
    // Try normal confirmation first. If every attempted normal candidate is
    // declined, a viable fallback may still use the remaining call budget.
    for (const { tier, minPublishers } of [{ tier: candidates, minPublishers: 3 }, { tier: fallback, minPublishers: 2 }]) {
      if (signal?.aborted || calls >= editorial.callsPerPass || outcome.published || outcome.waiting || outcome.skippedForBudget) break;
      if (!tier.length || (minPublishers === 2 && !twoPublisherFallbackAllowed({ at: now(), published: publicationTimes(now()), editorial }))) continue;
      const ranked = await rankCandidates(tier, now(), signal);
      for (const { cluster, score, signals } of ranked) {
        if (signal?.aborted || calls >= editorial.callsPerPass) break;
        // Present different owners first; a flood from one publisher must not
        // push independent confirmation beyond the prompt's six-report limit.
        const groups = new Set();
        const first = [], rest = [];
        for (const report of cluster) {
          if (groups.has(report.group)) rest.push(report);
          else { first.push(report); groups.add(report.group); }
        }
        const shown = [...first, ...rest].slice(0, MAX_REPORTS);
        const promptOptions = { minIndependentPublishers: minPublishers };
        if (budgetLeft(at) < worstCaseCostUsd(storyPrompt(shown, promptOptions))) { outcome.skippedForBudget += 1; break; }
        const reports = await withArticleLeads(shown, signal);
        if (signal?.aborted) break;
        const worstCase = worstCaseCostUsd(storyPrompt(reports, promptOptions));
        const admittedAt = now();
        const day = dayOf(admittedAt);
        const admission = admitClaudeSpend(database, {
          env, at: admittedAt, reserveMicroUsd: Math.ceil(worstCase * 1_000_000),
          dailyCapMicroUsd: Math.floor(budget.dailyUsd * 1_000_000), monthlyCapMicroUsd: Math.floor(budget.monthlyUsd * 1_000_000),
          readDailySpendMicroUsd: () => Math.ceil(spentSince(day) * 1_000_000),
          readMonthlySpendMicroUsd: () => Math.ceil(spentSince(`${day.slice(0, 7)}-01`) * 1_000_000),
          reserve: () => reserveSpend(admittedAt, worstCase),
        });
        if (!admission.ok) { outcome.skippedForBudget += 1; break; }
        const receipt = admission.value;
        calls += 1;
        let result;
        try {
          result = await summarize(reports, { signal, ...promptOptions });
        } catch (error) {
          if (claudeRequestDefinitelyRejected(error)) settleSpend(receipt, 0, now());
          else markUncertain(receipt, now());
          throw error;
        }
        settleSpend(receipt, result.costUsd, now());
        if (signal?.aborted) break;
        if (result.publish && result.headline && result.summary) {
          const sensitive = SENSITIVE_CATEGORIES.has(result.category) || SENSITIVE_CATEGORIES.has(storyCategory(cluster));
          const supporting = validatedSupportingReports(reports, result.supporting);
          if (isConfirmed(supporting, { minPublishers: sensitive ? 3 : minPublishers })) {
            const written = publishStory({ reports: cluster, result: { ...result, supporting }, at: now(), minPublishers, costUsd: result.costUsd, score, signals });
            if (written) {
              outcome.published += 1;
              outcome.picked.push({ headline: result.headline, score, signals });
            } else outcome.waiting += 1;
            break;
          }
          result = { ...result, publish: false, reason: "insufficient_independent_support" };
        }
        if (declineStory({ reports: cluster, result, at: now(), score, signals })) outcome.declined += 1;
        else { outcome.waiting += 1; break; }
      }
    }
    return outcome;
  }

  return { ingest, publishPass, budgetLeft: () => budgetLeft(now()),
    publisherStatus: () => resolveNewsPublisher(database, { env, at: now() }),
    // For owner-chosen stories (newsDeskEditor.js): the same report shape,
    // article leads, spending receipts and publication rules as the desk.
    editorTools: { reportRow, withArticleLeads, admitCall, settleSpend, markUncertain, publishStory, rankCandidates, budget } };
}

// Public reads: newest published stories whose post is still live.
// `ensureSchema: false` is for read-only connections such as the sitemap
// snapshot; a missing table there simply means no stories yet.
const missingTable = (error) => /no such (table|column)/iu.test(String(error?.message));
export function createNewsDeskReader(database, { ensureSchema = true } = {}) {
  let ready = !ensureSchema;
  return {
    list(options = {}) {
      if (!ready) { ensureNewsDeskSchema(database); ready = true; }
      try { return listStories(database, options); }
      catch (error) { if (missingTable(error)) return { stories: [], nextCursor: null }; throw error; }
    },
    forPost(postId, options = {}) { return readOne("post_id", postId, options); },
    // A story whose post is live and whose author is an active public account:
    // the share export and the link-preview image.
    forLivePost(postId, options = {}) { return readOne("post_id", postId, { ...options, live: true }); },
    get(id, options = {}) { return readOne("id", id, { ...options, live: true }); },
  };
  function readOne(column, value, { live = false, viewerId = null } = {}) {
    if (!ready) { ensureNewsDeskSchema(database); ready = true; }
    try {
      const row = database.prepare(`SELECT s.id,s.headline,s.summary,s.body,s.category,s.artist_keys,s.sources,s.post_id,s.created_at,s.updated_at,
          p.user_id AS author_id,u.name AS author_name,u.handle AS author_handle
        FROM news_stories s JOIN posts p ON p.id=s.post_id JOIN users u ON u.id=p.user_id
        WHERE s.${column === "id" ? "id" : "post_id"}=? AND s.status='published'
          ${live ? `AND p.removed=0 AND ${activeAccountSql("u")}` : ""} ${readerBlockSql(viewerId)}`)
        .get(String(value || ""), ...readerBlockParams(viewerId));
      return row ? newsStoryJson(row, database.prepare("SELECT norm,name,public_slug,photo,data FROM artists WHERE norm=?"), database, viewerId) : null;
    } catch (error) {
      if (missingTable(error)) return null;
      throw error;
    }
  }
}

// "Top stories": the last three days, ranked by editorial score plus how
// Mshpit members engage with each post (see topStoryScore).
// A page size: a whole number from 1 to 50, whatever the query says.
const pageSize = (limit) => Math.max(1, Math.min(50, Math.floor(Number(limit)) || 20));
// Author identity comes from the post, never the current holder of @news_mod.
const readerBlockSql = (viewerId) => viewerId ? `AND NOT EXISTS (SELECT 1 FROM blocks b
  WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))` : "";
const readerBlockParams = (viewerId) => viewerId ? [String(viewerId), String(viewerId)] : [];

function listTopStories(database, { limit = 20, at = Date.now(), viewerId = null } = {}) {
  const bounded = pageSize(limit);
  const rows = database.prepare(`SELECT s.id,s.headline,s.summary,s.body,s.category,s.artist_keys,s.sources,s.post_id,s.created_at,s.updated_at,s.score,
      p.user_id AS author_id,u.name AS author_name,u.handle AS author_handle
    FROM news_stories s JOIN posts p ON p.id=s.post_id JOIN users u ON u.id=p.user_id
    WHERE s.status='published' AND p.removed=0 AND ${activeAccountSql("u")} AND s.created_at>=? ${readerBlockSql(viewerId)}
    ORDER BY s.created_at DESC,s.id DESC LIMIT 150`).all(at - 72 * HOUR, ...readerBlockParams(viewerId));
  const engagement = (sql, postId) => ignoreMissingTable(() => Number(database.prepare(sql).get(postId)?.n) || 0);
  const artistLookup = database.prepare("SELECT norm,name,public_slug,photo,data FROM artists WHERE norm=?");
  return {
    stories: rows.map((row) => ({ row, top: topStoryScore({
      score: row.score,
      likes: engagement("SELECT COUNT(*) AS n FROM likes WHERE post_id=?", row.post_id),
      comments: engagement("SELECT COUNT(*) AS n FROM comments WHERE post_id=? AND removed=0", row.post_id),
      views: engagement("SELECT view_count AS n FROM post_impression_totals WHERE post_id=?", row.post_id),
      ageHours: (at - row.created_at) / HOUR,
    }) })).sort((left, right) => right.top - left.top || right.row.created_at - left.row.created_at)
      .slice(0, bounded).map(({ row }) => newsStoryJson(row, artistLookup, database, viewerId)),
    nextCursor: null,
  };
}

// `artist` narrows the list to stories about one catalogue artist (its key).
// `sort: "top"` returns top stories instead of the newest.
function listStories(database, { limit = 20, before = null, artist = null, sort = "latest", at = Date.now(), viewerId = null } = {}) {
  if (sort === "top" && !artist) return listTopStories(database, { limit, at, viewerId });
  const bounded = pageSize(limit);
  const cursor = before && Number.isSafeInteger(before.createdAt) ? before : null;
  const artistKey = typeof artist === "string" && artist.trim() ? artist.trim().slice(0, 200) : null;
  const rows = database.prepare(`SELECT s.id,s.headline,s.summary,s.body,s.category,s.artist_keys,s.sources,s.post_id,s.created_at,s.updated_at,
      p.user_id AS author_id,u.name AS author_name,u.handle AS author_handle
    FROM news_stories s JOIN posts p ON p.id=s.post_id JOIN users u ON u.id=p.user_id
    WHERE s.status='published' AND p.removed=0 AND ${activeAccountSql("u")}
      ${readerBlockSql(viewerId)}
      ${artistKey ? "AND EXISTS (SELECT 1 FROM json_each(s.artist_keys) j WHERE j.value=?)" : ""}
      ${cursor ? "AND (s.created_at<? OR (s.created_at=? AND s.id<?))" : ""}
    ORDER BY s.created_at DESC,s.id DESC LIMIT ?`)
    .all(...readerBlockParams(viewerId), ...(artistKey ? [artistKey] : []), ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), bounded + 1);
  const artistLookup = database.prepare("SELECT norm,name,public_slug,photo,data FROM artists WHERE norm=?");
  const stories = rows.slice(0, bounded).map((row) => newsStoryJson(row, artistLookup, database, viewerId));
  const last = rows.length > bounded ? rows[bounded - 1] : null;
  return { stories, nextCursor: last ? { createdAt: last.created_at, id: last.id } : null };
}

function newsStoryJson(row, artistLookup, database, viewerId = null) {
  const artists = parseJson(row.artist_keys, []).map((key) => artistLookup.get(key)).filter(Boolean)
    .map((artist) => ({
      key: artist.norm, name: artist.name, publicSlug: artist.public_slug || null,
      // Only an image Discover may crop: Deezer, never Spotify artwork.
      photo: deezerImageUrl(artist.photo) || artistDiscoverPhotoUri(parseJson(artist.data, {})) || null,
    }));
  const sources = parseJson(row.sources, []).filter((source) => /^https:\/\//u.test(String(source?.url || "")))
    .map((source) => ({ name: String(source.name || ""), url: source.url }));
  const count = (sql, ...args) => ignoreMissingTable(() => Number(database.prepare(sql).get(...args)?.n) || 0);
  return {
    id: row.id,
    postId: row.post_id,
    author: { id: row.author_id, name: row.author_name || "", handle: row.author_handle || "" },
    likes: count("SELECT COUNT(*) AS n FROM likes WHERE post_id=?", row.post_id),
    likedByMe: !!viewerId && count("SELECT COUNT(*) AS n FROM likes WHERE post_id=? AND user_id=?", row.post_id, String(viewerId)) > 0,
    commentCount: count("SELECT COUNT(*) AS n FROM comments WHERE post_id=? AND removed=0", row.post_id),
    viewCount: count("SELECT view_count AS n FROM post_impression_totals WHERE post_id=?", row.post_id),
    headline: row.headline,
    summary: row.summary,
    body: row.body || "",
    category: row.category,
    artists,
    sources,
    confirmedBy: new Set(sources.map((source) => source.name)).size,
    publishedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
