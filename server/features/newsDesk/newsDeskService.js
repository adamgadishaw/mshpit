import { randomUUID } from "node:crypto";
import { NEWS_SOURCES, newsSourceById } from "./newsSources.js";
import { parseNewsFeed } from "./newsFeedParser.js";
import { clusterReports, headlineTokens, independentGroups, isConfirmed, looksLikeNews, newsCategory, similarity, storyCategory } from "./newsStoryRules.js";
import { storyPrompt, worstCaseCostUsd } from "./newsSummarizer.js";
import { artistDiscoverPhotoUri, deezerImageUrl } from "../artistPhotos/discoverPhoto.js";

// The news desk: reads established music outlets, groups reports about the
// same event, and publishes a story from the news account only when
// independent outlets confirm it. Stories are ordinary status posts, so they
// appear in the feed, on the news profile and under comments like any post;
// the story record adds the headline and the list of sources.

const HOUR = 60 * 60 * 1000;
const REPORT_WINDOW_MS = 48 * HOUR;
const KEEP_REPORTS_MS = 14 * 24 * HOUR;
export const NEWS_DESK_HANDLE = "news_mod";
// A small community feed should not drown in news; the biggest stories go first.
export const DAILY_STORY_LIMIT = 8;
const STORIES_PER_PASS = 3;

export const newsDeskBudget = (env = process.env) => ({
  dailyUsd: positiveNumber(env.NEWS_DESK_DAILY_USD, 1),
  monthlyUsd: positiveNumber(env.NEWS_DESK_MONTHLY_USD, 9),
});
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
  CREATE TABLE IF NOT EXISTS news_desk_spend (day TEXT PRIMARY KEY, usd REAL NOT NULL DEFAULT 0);`);
}

const parseJson = (value, fallback) => { try { const parsed = JSON.parse(value); return parsed ?? fallback; } catch { return fallback; } };
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);

// Catalogue artists a headline names. Only artists with an audience take part,
// names must appear as whole words, and single-word names must be capitalised
// and at least four letters, so "Yes" or "Low" in a sentence do not count.
export function createArtistMatcher(database) {
  const byName = new Map();
  let longest = 1;
  for (const row of database.prepare("SELECT norm,name FROM artists WHERE COALESCE(popularity,0)>=35").iterate()) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const words = name.split(/\s+/u).length;
    if (words === 1 && name.length < 4) continue;
    byName.set(name.toLowerCase(), row.norm);
    longest = Math.max(longest, Math.min(words, 6));
  }
  return (text) => {
    const words = String(text || "").replace(/['’]s\b/gu, "").split(/[^\p{L}\p{N}&$!.+-]+/u).filter(Boolean);
    const found = new Set();
    for (let start = 0; start < words.length; start += 1) {
      for (let size = Math.min(longest, words.length - start); size >= 1; size -= 1) {
        const phrase = words.slice(start, start + size).join(" ");
        const key = byName.get(phrase.toLowerCase());
        if (!key) continue;
        if (size === 1 && !/^\p{Lu}/u.test(phrase)) continue;
        found.add(key);
        break;
      }
    }
    return [...found].slice(0, 6);
  };
}

export function createNewsDesk({ database, fetchText, summarize = null, now = Date.now, newId = randomUUID, env = process.env, log = console }) {
  ensureNewsDeskSchema(database);
  const budget = newsDeskBudget(env);

  function spentSince(fromDay) {
    return Number(database.prepare("SELECT COALESCE(SUM(usd),0) AS usd FROM news_desk_spend WHERE day>=?").get(fromDay)?.usd) || 0;
  }
  function budgetLeft(at) {
    const day = dayOf(at);
    return Math.min(budget.dailyUsd - spentSince(day), budget.monthlyUsd - spentSince(`${day.slice(0, 7)}-01`));
  }
  function recordSpend(at, usd) {
    if (!(usd > 0)) return;
    database.prepare("INSERT INTO news_desk_spend (day,usd) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET usd=usd+excluded.usd").run(dayOf(at), usd);
  }

  // 1. Read every outlet and keep new reports that look like news.
  async function ingest({ signal } = {}) {
    const at = now();
    const matchArtists = createArtistMatcher(database);
    const insert = database.prepare(`INSERT OR IGNORE INTO news_reports
      (url,source_id,title,description,category,artist_keys,published_at,fetched_at) VALUES (?,?,?,?,?,?,?,?)`);
    let added = 0;
    for (const source of NEWS_SOURCES) {
      if (signal?.aborted) break;
      let items = [];
      try { items = parseNewsFeed(await fetchText(source.url, { signal }), { sourceId: source.id }); }
      catch (error) { log.warn?.(`[news-desk] ${source.id} feed unavailable: ${String(error?.message || error).slice(0, 120)}`); continue; }
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
    return open.filter((report) => {
      for (const story of stories) {
        const members = storyReports.get(story.id);
        if (!members.some((member) => member.url !== report.url && report.artistKeys.some((key) => member.artistKeys.includes(key))
          && similarity(member.tokens, report.tokens) >= 0.2)) continue;
        database.prepare("UPDATE news_reports SET story_id=? WHERE url=? AND story_id IS NULL").run(story.id, report.url);
        const sources = parseJson(story.sources, []);
        if (!sources.some((item) => item.url === report.url)) {
          sources.push({ name: report.sourceName, url: report.url, title: report.title });
          database.prepare("UPDATE news_stories SET sources=?,updated_at=? WHERE id=?").run(JSON.stringify(sources.slice(0, 10)), at, story.id);
        }
        return false;
      }
      return true;
    });
  }

  function newsAccount() {
    return database.prepare("SELECT id FROM users WHERE lower(handle)=? AND COALESCE(is_banned,0)=0").get(NEWS_DESK_HANDLE) || null;
  }

  function publishStory({ reports, result, at, costUsd }) {
    const account = newsAccount();
    if (!account) throw new Error(`The @${NEWS_DESK_HANDLE} account does not exist.`);
    const id = newId();
    const postId = `news_${id}`;
    // Keep the independence rule even if Claude cites only same-company outlets.
    const supporting = isConfirmed(result.supporting) ? result.supporting : reports;
    const artistKeys = [...new Set(supporting.flatMap((report) => report.artistKeys))].slice(0, 6);
    const lead = artistKeys[0] ? database.prepare("SELECT norm,name FROM artists WHERE norm=?").get(artistKeys[0]) : null;
    const sources = supporting.map((report) => ({ name: report.sourceName, url: report.url, title: report.title }));
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`INSERT INTO posts (id,user_id,artist,artist_key,venue,city,date,overall,review,kind,created_at)
        VALUES (?,?,?,?,'','','',0,?,'status',?)`).run(postId, account.id, lead?.name || "", lead?.norm || null, result.summary, at);
      database.prepare(`INSERT INTO news_stories (id,status,headline,summary,category,artist_keys,sources,post_id,cost_usd,created_at,updated_at)
        VALUES (?,'published',?,?,?,?,?,?,?,?,?)`).run(id, result.headline, result.summary, result.category, JSON.stringify(artistKeys),
        JSON.stringify(sources), postId, costUsd, at, at);
      const mark = database.prepare("UPDATE news_reports SET story_id=? WHERE url=?");
      for (const report of reports) mark.run(id, report.url);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { id, postId };
  }

  function declineStory({ reports, result, at }) {
    const id = newId();
    database.prepare(`INSERT INTO news_stories (id,status,category,reason,cost_usd,created_at,updated_at) VALUES (?,'declined',?,?,?,?,?)`)
      .run(id, result.category || storyCategory(reports), result.reason || "", result.costUsd || 0, at, at);
    const mark = database.prepare("UPDATE news_reports SET story_id=? WHERE url=?");
    for (const report of reports) mark.run(id, report.url);
  }

  // 2. Group open reports, and write up to a few newly confirmed stories.
  async function publishPass({ signal } = {}) {
    const at = now();
    const outcome = { confirmed: 0, published: 0, declined: 0, skippedForBudget: 0 };
    if (!summarize || !newsAccount()) return outcome;
    const open = attachToPublished(database.prepare("SELECT * FROM news_reports WHERE story_id IS NULL AND published_at>=?")
      .all(at - REPORT_WINDOW_MS).map(reportRow), at);
    const publishedToday = Number(database.prepare("SELECT COUNT(*) AS n FROM news_stories WHERE status='published' AND created_at>=?")
      .get(Date.parse(`${dayOf(at)}T00:00:00Z`))?.n) || 0;
    const confirmed = clusterReports(open).filter(isConfirmed)
      // Big stories first: more independent outlets, then the most recent.
      .sort((left, right) => independentGroups(right) - independentGroups(left)
        || Math.max(...right.map((report) => report.publishedAt)) - Math.max(...left.map((report) => report.publishedAt)));
    outcome.confirmed = confirmed.length;
    for (const reports of confirmed.slice(0, Math.min(STORIES_PER_PASS, Math.max(0, DAILY_STORY_LIMIT - publishedToday)))) {
      if (signal?.aborted) break;
      if (budgetLeft(at) < worstCaseCostUsd(storyPrompt(reports).length)) { outcome.skippedForBudget += 1; break; }
      const result = await summarize(reports, { signal });
      recordSpend(at, result.costUsd);
      if (result.publish && result.headline && result.summary) {
        publishStory({ reports, result, at: now(), costUsd: result.costUsd });
        outcome.published += 1;
      } else {
        declineStory({ reports, result, at: now() });
        outcome.declined += 1;
      }
    }
    return outcome;
  }

  return { ingest, publishPass, budgetLeft: () => budgetLeft(now()) };
}

// Public reads: newest published stories whose post is still live.
export function createNewsDeskReader(database) {
  let ready = false;
  return {
    list({ limit = 20, before = null } = {}) {
      if (!ready) { ensureNewsDeskSchema(database); ready = true; }
      const bounded = Math.max(1, Math.min(50, Number(limit) || 20));
      const cursor = before && Number.isSafeInteger(before.createdAt) ? before : null;
      const rows = database.prepare(`SELECT s.id,s.headline,s.summary,s.category,s.artist_keys,s.sources,s.post_id,s.created_at
        FROM news_stories s JOIN posts p ON p.id=s.post_id
        WHERE s.status='published' AND p.removed=0 ${cursor ? "AND (s.created_at<? OR (s.created_at=? AND s.id<?))" : ""}
        ORDER BY s.created_at DESC,s.id DESC LIMIT ?`)
        .all(...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), bounded + 1);
      const artistLookup = database.prepare("SELECT norm,name,public_slug,photo,data FROM artists WHERE norm=?");
      const stories = rows.slice(0, bounded).map((row) => newsStoryJson(row, artistLookup));
      const last = rows.length > bounded ? rows[bounded - 1] : null;
      return { stories, nextCursor: last ? { createdAt: last.created_at, id: last.id } : null };
    },
    forPost(postId) {
      if (!ready) { ensureNewsDeskSchema(database); ready = true; }
      const row = database.prepare(`SELECT id,headline,summary,category,artist_keys,sources,post_id,created_at FROM news_stories
        WHERE post_id=? AND status='published'`).get(postId);
      return row ? newsStoryJson(row, database.prepare("SELECT norm,name,public_slug,photo,data FROM artists WHERE norm=?")) : null;
    },
  };
}

function newsStoryJson(row, artistLookup) {
  const artists = parseJson(row.artist_keys, []).map((key) => artistLookup.get(key)).filter(Boolean)
    .map((artist) => ({
      key: artist.norm, name: artist.name, publicSlug: artist.public_slug || null,
      // Only an image Discover may crop: Deezer, never Spotify artwork.
      photo: deezerImageUrl(artist.photo) || artistDiscoverPhotoUri(parseJson(artist.data, {})) || null,
    }));
  const sources = parseJson(row.sources, []).filter((source) => /^https:\/\//u.test(String(source?.url || "")))
    .map((source) => ({ name: String(source.name || ""), url: source.url }));
  return {
    id: row.id,
    postId: row.post_id,
    headline: row.headline,
    summary: row.summary,
    category: row.category,
    artists,
    sources,
    confirmedBy: new Set(sources.map((source) => source.name)).size,
    publishedAt: row.created_at,
  };
}
