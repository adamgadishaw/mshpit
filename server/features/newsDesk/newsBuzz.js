// Internet buzz for an artist: readers of their English Wikipedia article in
// the last two days compared with a normal day in the month before. Free,
// keyless, and a fair measure of "people are looking this up right now".
//
// The article is found through the artist's Wikidata id when the catalogue has
// one, otherwise by name, and only when Wikipedia describes a musician or a
// band: a name that leads to a disambiguation page or to something else
// ("Low", "Storm") has no buzz rather than the wrong buzz.

const DAY = 24 * 60 * 60 * 1000;
const TITLE_TTL_MS = 30 * DAY;
const MUSIC_DESCRIPTION = /\b(band|singer|rapper|musician|songwriter|group|duo|trio|dj|producer|composer|musical|hip hop|rock|pop|metal|jazz|country|r&b|orchestra|vocalist|guitarist|drummer|pianist)\b/iu;
// Below this many readers on a normal day the ratio says little.
const MIN_BASELINE_VIEWS = 100;

const ymd = (at) => new Date(at).toISOString().slice(0, 10).replaceAll("-", "");
const wikiPath = (title) => encodeURIComponent(String(title).replaceAll(" ", "_"));

export function ensureNewsBuzzSchema(database) {
  database.exec("CREATE TABLE IF NOT EXISTS news_artist_wiki (norm TEXT PRIMARY KEY, title TEXT, checked_at INTEGER NOT NULL)");
}

// fetchJson(url, { signal }) returns parsed JSON or throws.
export function createWikipediaBuzz({ database, fetchJson, now = Date.now }) {
  ensureNewsBuzzSchema(database);
  const cached = database.prepare("SELECT title,checked_at FROM news_artist_wiki WHERE norm=?");
  const store = database.prepare(`INSERT INTO news_artist_wiki (norm,title,checked_at) VALUES (?,?,?)
    ON CONFLICT(norm) DO UPDATE SET title=excluded.title,checked_at=excluded.checked_at`);

  async function lookUpTitle(artist, signal) {
    const wikidataId = /^Q\d{1,12}$/u.test(String(artist.wikidataId || "")) ? artist.wikidataId : null;
    if (wikidataId) {
      const entity = (await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`, { signal }))?.entities?.[wikidataId];
      const title = entity?.sitelinks?.enwiki?.title;
      if (typeof title === "string" && title) return title;
    }
    const summary = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${wikiPath(artist.name)}`, { signal });
    if (!summary || summary.type === "disambiguation" || !MUSIC_DESCRIPTION.test(String(summary.description || ""))) return null;
    return typeof summary.title === "string" && summary.title ? summary.title : null;
  }

  async function titleFor(artist, signal) {
    const row = cached.get(artist.key);
    if (row && now() - row.checked_at < TITLE_TTL_MS) return row.title || null;
    let title = null;
    try { title = await lookUpTitle(artist, signal); } catch { return row?.title || null; }
    store.run(artist.key, title, now());
    return title;
  }

  // { recent, baseline, ratio } or null when there is no reliable signal.
  async function spike(artist, { signal } = {}) {
    if (!artist?.key || !artist?.name) return null;
    const title = await titleFor(artist, signal);
    if (!title) return null;
    let items;
    try {
      const at = now();
      items = (await fetchJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${wikiPath(title)}/daily/${ymd(at - 31 * DAY)}/${ymd(at)}`, { signal }))?.items;
    } catch {
      // architecture: allow-ambiguous-result -- buzz is an optional ranking signal; an unreachable Wikipedia means no boost, not a failed pass
      return null;
    }
    const views = (Array.isArray(items) ? items : []).map((item) => Number(item?.views)).filter(Number.isFinite);
    if (views.length < 10) return null;
    const recent = Math.max(...views.slice(-2));
    const earlier = views.slice(0, -2).sort((left, right) => left - right);
    const baseline = earlier[Math.floor(earlier.length / 2)];
    if (!(baseline >= MIN_BASELINE_VIEWS)) return null;
    return { recent, baseline, ratio: Math.round((recent / baseline) * 10) / 10 };
  }

  return { spike };
}
