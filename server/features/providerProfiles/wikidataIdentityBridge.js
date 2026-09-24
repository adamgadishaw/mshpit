import { readBoundedJsonResponse } from "../../boundedJsonResponse.js";

// Turns what Ticketmaster says about a performer into a MusicBrainz ID the
// biography worker can use, without asking MusicBrainz. An ID is accepted only
// when Wikidata has exactly one item carrying it and that item's English name
// or one of its English aliases is the performer's name. A Wikipedia link is
// accepted the same way: its Wikidata item must carry exactly one MusicBrainz
// ID and be named like the performer.

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "MshpitArtistKnowledge/1.0 (https://www.mshpit.com; support@mshpit.com)";
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const QID = /^Q[1-9][0-9]{0,11}$/u;
const MIN_SPACING_MS = 1_100;

export function comparableName(value) {
  return String(value || "").normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
    .replace(/&/gu, " and ").replace(/^the\s+/u, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function wikipediaTitleFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== "en.wikipedia.org" || !url.pathname.startsWith("/wiki/")) return null;
    const title = decodeURIComponent(url.pathname.slice(6)).replace(/_/gu, " ").trim();
    return title && title.length <= 240 && !/[#<>[\]{}|]/u.test(title) ? title : null;
  } catch {
    return null;
  }
}

function entityNames(entity) {
  const names = [];
  if (typeof entity?.labels?.en?.value === "string") names.push(entity.labels.en.value);
  for (const alias of Array.isArray(entity?.aliases?.en) ? entity.aliases.en.slice(0, 50) : []) {
    if (typeof alias?.value === "string") names.push(alias.value);
  }
  return names.map(comparableName).filter(Boolean);
}

function entityMbids(entity) {
  const claims = Array.isArray(entity?.claims?.P434) ? entity.claims.P434.slice(0, 10) : [];
  return [...new Set(claims.filter((claim) => claim?.rank !== "deprecated")
    .map((claim) => String(claim?.mainsnak?.datavalue?.value || "").toLowerCase())
    .filter((value) => MBID.test(value)))];
}

export function createWikidataIdentityBridge({ fetchImpl = globalThis.fetch, clock = Date.now, wait } = {}) {
  let lastStarted = 0;
  let gate = Promise.resolve();
  const pause = wait || ((ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }));

  async function read(endpoint, parameters, signal) {
    const turn = gate.then(async () => {
      const remaining = lastStarted + MIN_SPACING_MS - clock();
      if (remaining > 0) await pause(remaining, signal);
      lastStarted = clock();
    });
    gate = turn.then(() => undefined, () => undefined);
    await turn;
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...parameters }).toString();
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
    const response = await fetchImpl(url.href, {
      method: "GET", redirect: "error", signal: requestSignal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!response.ok) {
      // architecture: allow-empty-catch -- the failed response's body is not needed
      await response.body?.cancel?.().catch(() => {});
      throw Object.assign(new Error("Wikidata is unavailable."), { code: response.status === 429 ? "wikidata_rate_limited" : "wikidata_unavailable" });
    }
    const payload = await readBoundedJsonResponse(response, { maxBytes: 512 * 1024, signal: requestSignal });
    if (payload?.error) throw Object.assign(new Error("Wikidata rejected the request."), { code: "wikidata_rejected" });
    return payload;
  }

  async function entity(qid, signal) {
    const payload = await read(WIKIDATA_API, {
      action: "wbgetentities", ids: qid, props: "labels|aliases|claims", languages: "en", languagefallback: "0",
    }, signal);
    const value = payload?.entities?.[qid];
    return value && value.id === qid && value.type === "item" && !Object.hasOwn(value, "missing") ? value : null;
  }

  // Returns { mbid, wikidataId, via } or null.
  return async function confirmIdentity({ name, mbid = null, wikipediaUrl = null, signal } = {}) {
    const wanted = comparableName(name);
    if (!wanted) return null;
    if (mbid && MBID.test(mbid)) {
      const search = await read(WIKIDATA_API, {
        action: "query", list: "search", srsearch: `haswbstatement:P434=${mbid}`, srnamespace: "0", srlimit: "2",
        srinfo: "totalhits", srprop: "",
      }, signal);
      const rows = Array.isArray(search?.query?.search) ? search.query.search : [];
      if (search?.query?.searchinfo?.totalhits === 1 && rows.length === 1 && QID.test(String(rows[0]?.title || ""))) {
        const item = await entity(rows[0].title, signal);
        if (item && entityMbids(item).length === 1 && entityMbids(item)[0] === mbid && entityNames(item).includes(wanted)) {
          return { mbid, wikidataId: item.id, via: "ticketmaster_musicbrainz" };
        }
      }
    }
    const title = wikipediaUrl ? wikipediaTitleFromUrl(wikipediaUrl) : null;
    if (!title) return null;
    const page = await read(WIKIPEDIA_API, {
      action: "query", titles: title, prop: "pageprops", ppprop: "wikibase_item|disambiguation", redirects: "1",
    }, signal);
    const pages = Array.isArray(page?.query?.pages) ? page.query.pages : [];
    const qid = pages.length === 1 && !Object.hasOwn(pages[0]?.pageprops || {}, "disambiguation")
      ? String(pages[0]?.pageprops?.wikibase_item || "") : "";
    if (!QID.test(qid)) return null;
    const item = await entity(qid, signal);
    const ids = item ? entityMbids(item) : [];
    if (ids.length !== 1 || !entityNames(item).includes(wanted)) return null;
    // A Ticketmaster MusicBrainz link that disagrees with Wikipedia's item is
    // a contradiction, not a second opinion.
    if (mbid && ids[0] !== mbid) return null;
    return { mbid: ids[0], wikidataId: qid, via: "ticketmaster_wikipedia" };
  };
}
