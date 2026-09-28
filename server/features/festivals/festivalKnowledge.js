import { readBoundedJsonResponse } from "../../boundedJsonResponse.js";

// A festival's history from English Wikipedia (the intro, with attribution)
// and two facts from Wikidata: the year it started and its official site.
// One page per festival, refreshed monthly; nothing is written by AI.

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const USER_AGENT = "MshpitFestivals/1.0 (https://www.mshpit.com; support@mshpit.com)";
export const FESTIVAL_ABOUT_LIMIT = 1400;
const RESPONSE_LIMIT = 512 * 1024;
const QID = /^Q[1-9][0-9]{0,11}$/u;

function apiUrl(endpoint, parameters) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...parameters }).toString();
  return url;
}

async function readJson(url, { fetchImpl, signal, timeoutMs = 8000 }) {
  if (![WIKIPEDIA_API, WIKIDATA_API].includes(url.origin + url.pathname)) throw new Error("Unexpected knowledge endpoint.");
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url.href, {
    method: "GET", redirect: "manual", credentials: "omit", signal: combined,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (response.status >= 300 && response.status < 400) throw Object.assign(new Error("Knowledge source redirected."), { code: "festival_knowledge_redirect" });
  if (!response.ok) throw Object.assign(new Error("Knowledge source unavailable."), { code: `festival_knowledge_${response.status === 429 ? "rate_limited" : "unavailable"}` });
  const payload = await readBoundedJsonResponse(response, { maxBytes: RESPONSE_LIMIT, signal: combined });
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.error) {
    throw Object.assign(new Error("Knowledge source rejected the request."), { code: "festival_knowledge_response" });
  }
  return payload;
}

const cleanExtract = (value) => String(value || "")
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "")
  .replace(/\s+/gu, " ").trim();

// The Wikipedia intro, only when the page is a real article about a festival.
export function parseFestivalWikipedia(payload, { retrievedAt }) {
  const page = Array.isArray(payload?.query?.pages) && payload.query.pages.length === 1 ? payload.query.pages[0] : null;
  if (!page || page.ns !== 0 || Object.hasOwn(page, "missing") || Object.hasOwn(page, "invalid")) return null;
  if (Object.hasOwn(page.pageprops || {}, "disambiguation") || !Number.isSafeInteger(page.lastrevid) || page.lastrevid <= 0) return null;
  const title = cleanExtract(page.title);
  const text = cleanExtract(page.extract);
  if (!title || !text || /<\/?[a-z][^>]*>/iu.test(page.extract) || !/\bfestival\b/iu.test(text)) return null;
  const characters = [...text];
  const about = characters.length <= FESTIVAL_ABOUT_LIMIT ? text : `${characters.slice(0, FESTIVAL_ABOUT_LIMIT - 1).join("").trimEnd()}…`;
  const wikidataId = QID.test(String(page.pageprops?.wikibase_item || "")) ? page.pageprops.wikibase_item : null;
  return {
    about,
    wikidataId,
    source: {
      provider: "wikipedia",
      title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /gu, "_"))}`,
      revisionUrl: `https://en.wikipedia.org/w/index.php?oldid=${page.lastrevid}`,
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      retrievedAt,
    },
  };
}

// The first year (P571 inception) and official website (P856) from Wikidata.
export function parseFestivalWikidata(payload, wikidataId) {
  const entity = payload?.entities?.[wikidataId];
  if (!entity || entity.missing !== undefined) return { foundedYear: null, website: null };
  const values = (property) => (Array.isArray(entity.claims?.[property]) ? entity.claims[property] : [])
    .filter((claim) => claim?.rank !== "deprecated" && claim?.mainsnak?.snaktype === "value")
    .map((claim) => claim.mainsnak.datavalue?.value);
  const inception = values("P571").map((value) => /^[+]?(\d{4})-/u.exec(String(value?.time || ""))?.[1]).find(Boolean);
  const foundedYear = inception && Number(inception) >= 1900 && Number(inception) <= 2100 ? Number(inception) : null;
  let website = null;
  for (const value of values("P856")) {
    try {
      const url = new URL(String(value));
      if (url.protocol === "https:" && !url.username && !url.password && !url.port) { url.hash = ""; website = url.toString(); break; }
    } catch { /* architecture: allow-empty-catch -- a malformed website claim is skipped */ }
  }
  return { foundedYear, website };
}

export async function fetchFestivalKnowledge({ wikipediaTitle, fetchImpl = fetch, signal, now = Date.now }) {
  if (!wikipediaTitle) return null;
  const article = parseFestivalWikipedia(await readJson(apiUrl(WIKIPEDIA_API, {
    action: "query", titles: wikipediaTitle, prop: "extracts|pageprops|info", ppprop: "wikibase_item|disambiguation",
    redirects: "1", exintro: "1", explaintext: "1", exchars: String(FESTIVAL_ABOUT_LIMIT), exlimit: "1",
  }), { fetchImpl, signal }), { retrievedAt: Math.trunc(now()) });
  if (!article) return null;
  const facts = article.wikidataId
    ? parseFestivalWikidata(await readJson(apiUrl(WIKIDATA_API, {
      action: "wbgetentities", ids: article.wikidataId, props: "claims",
    }), { fetchImpl, signal }), article.wikidataId)
    : { foundedYear: null, website: null };
  return { ...article, ...facts };
}
