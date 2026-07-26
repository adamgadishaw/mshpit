// Free YouTube channel discovery via Wikidata.
//
// The whole preview problem is discovery cost. Finding an artist's YouTube
// channel through the Data API costs a `search` (100 units against a ~90/day
// cap), so a cold catalogue of thousands of artists takes weeks to warm and a
// listener playing deep cuts outruns the budget every day — every un-discovered
// artist previews.
//
// But every artist in the catalogue carries a MusicBrainz id, and Wikidata links
// MusicBrainz artist (P434) to YouTube channel (P2397). Wikidata is keyless and
// free, so this resolves channels for the whole catalogue at ZERO search quota.
// Once `youtube_channel_id` is stored, `resolveArtistChannelId` returns it
// without a search and the song resolves from the channel's uploads for ~1 unit.
//
// This does not replace the search-based warmer: Wikidata does not have every
// artist, and the long tail still needs a discovery search. It removes that cost
// for the large, notable slice it does cover — which is most of what people play.

import { db, normName, artistStmts } from "./db.js";
import { youtubeJson } from "./musicProviders.js";

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
// Wikidata asks for a descriptive User-Agent that identifies the app and a
// contact, and will block generic ones.
const UA = "mshpit-catalog/1.0 (https://www.mshpit.com; adamgadishaw@gmail.com)";
const PROGRESS_KEY = "warm:wikidata:done";

// --- pure helpers (tested) --------------------------------------------------

// One SPARQL query for a batch of MusicBrainz ids. VALUES keeps it a single
// round trip; OPTIONAL so an mbid with no channel still returns (and is recorded
// as processed rather than retried forever).
export function buildSparql(mbids) {
  const values = mbids.map((id) => `"${String(id).replace(/[^0-9a-fA-F-]/g, "")}"`).join(" ");
  return `SELECT ?mbid ?yt WHERE {
  VALUES ?mbid { ${values} }
  ?artist wdt:P434 ?mbid .
  ?artist wdt:P2397 ?yt .
}`;
}

// Wikidata's JSON results -> Map(mbid -> [channelId, ...]). An artist can carry
// several (official, VEVO, Topic); order preserved so selection can prefer.
export function parseWikidataChannels(json) {
  const out = new Map();
  for (const row of json?.results?.bindings || []) {
    const mbid = row?.mbid?.value;
    const yt = row?.yt?.value;
    if (!mbid || !yt || !/^UC[\w-]{20,}$/.test(yt)) continue;
    if (!out.has(mbid)) out.set(mbid, []);
    const list = out.get(mbid);
    if (!list.includes(yt)) list.push(yt);
  }
  return out;
}

// Pick the best channel for resolution. A "<Artist> - Topic" channel holds the
// official audio for the WHOLE discography, so it is preferred when titles are
// known; otherwise the first (Wikidata ranks the primary channel first). Titles
// come from a cheap channels.list (1 unit, not a search) and are optional.
export function pickChannel(channelIds, titlesById = {}) {
  if (!channelIds?.length) return null;
  const topic = channelIds.find((id) => / - Topic$/i.test(titlesById[id] || ""));
  return topic || channelIds[0];
}

// --- IO ---------------------------------------------------------------------

// Resolve ONE artist's channel from Wikidata, for the live resolver to try
// before it spends a search. Free, so an on-demand artist (played but never in
// the catalogue — the deep cuts that preview most) still avoids the search.
// Returns a channel id or null; never throws (a Wikidata hiccup just falls
// through to the search path).
export async function lookupChannelByMbid(mbid, { apiKey = process.env.YOUTUBE_API_KEY, fetchImpl = fetch } = {}) {
  if (!mbid || !/^[0-9a-fA-F-]{36}$/.test(String(mbid))) return null;
  try {
    const channels = await wikidataBatch([mbid], fetchImpl);
    const ids = channels.get(mbid);
    if (!ids?.length) return null;
    const titles = ids.length > 1 ? await channelTitles(ids, apiKey, fetchImpl) : {};
    return pickChannel(ids, titles);
  } catch {
    return null;
  }
}


const readProgress = () => {
  try {
    const row = db.prepare("SELECT value FROM app_meta WHERE key=?").get(PROGRESS_KEY);
    return new Set(row ? JSON.parse(row.value) : []);
  } catch { return new Set(); }
};
const writeProgress = (set) => {
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(PROGRESS_KEY, JSON.stringify([...set]));
};

async function wikidataBatch(mbids, fetchImpl) {
  const res = await fetchImpl(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(buildSparql(mbids))}&format=json`, {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  return parseWikidataChannels(await res.json());
}

// Batch channels.list to learn titles so we can prefer Topic channels. Cheap
// (1 unit per 50 ids) and NOT a search, so it never touches the daily budget.
async function channelTitles(ids, apiKey, fetchImpl) {
  const titles = {};
  if (!apiKey || !ids.length) return titles;
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const data = await youtubeJson("channels", { part: "snippet", id: ids.slice(i, i + 50).join(","), maxResults: "50" }, apiKey, fetchImpl);
      for (const item of data?.items || []) if (item?.id) titles[item.id] = item?.snippet?.title || "";
    } catch { /* titles are an optimisation; a miss just falls back to first */ }
  }
  return titles;
}

/**
 * Backfill youtube_channel_id from Wikidata for catalogue artists that have an
 * mbid but no discovered channel yet. Zero search quota.
 */
export async function backfillChannelsFromWikidata({
  limit = 4000,
  batchSize = 100,
  apiKey = process.env.YOUTUBE_API_KEY,
  fetchImpl = fetch,
  onProgress = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const done = readProgress();
  // Only artists we have not resolved a channel for and have not already tried
  // against Wikidata, so re-runs are cheap and resumable.
  const rows = db.prepare(`
    SELECT norm, name, mbid FROM artists
    WHERE mbid IS NOT NULL AND (youtube_channel_id IS NULL OR youtube_channel_id = '')
    ORDER BY COALESCE(popularity, 0) DESC, rank_score DESC
    LIMIT ?
  `).all(limit).filter((r) => !done.has(r.mbid));

  const stats = { considered: rows.length, matched: 0, stored: 0, batches: 0 };
  const byMbid = new Map(rows.map((r) => [r.mbid, r]));

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const mbids = batch.map((r) => r.mbid);
    let channels;
    try {
      channels = await wikidataBatch(mbids, fetchImpl);
    } catch (error) {
      // A batch failure is transient (Wikidata rate limit / timeout). Skip it;
      // the mbids stay unmarked and a later run retries them.
      onProgress?.({ ...stats, error: String(error?.message || error) });
      await sleep(2000);
      continue;
    }
    stats.batches++;

    // Disambiguate to a Topic channel where a key lets us, once per batch.
    const allIds = [...new Set([...channels.values()].flat())];
    const titles = await channelTitles(allIds, apiKey, fetchImpl);

    const now = Date.now();
    db.exec("BEGIN");
    try {
      for (const mbid of mbids) {
        done.add(mbid); // processed, even on a Wikidata miss, so we don't re-ask
        const ids = channels.get(mbid);
        if (!ids?.length) continue;
        stats.matched++;
        const chosen = pickChannel(ids, titles);
        const row = byMbid.get(mbid);
        if (chosen && row && artistStmts.byNorm.get(row.norm)) {
          artistStmts.setChannel.run(chosen, now, row.norm);
          stats.stored++;
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    writeProgress(done);
    onProgress?.(stats);
    // Be a good Wikidata citizen between batches.
    await sleep(1200);
  }
  return stats;
}
