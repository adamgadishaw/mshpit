import { readBoundedJsonResponse } from "./boundedJsonResponse.js";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "MshpitArtistKnowledge/1.0 (https://www.mshpit.com; support@mshpit.com)";
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const QID = /^Q[1-9][0-9]{0,11}$/u;
export const ARTIST_KNOWLEDGE_BIO_LIMIT = 1200;
export const ARTIST_KNOWLEDGE_RESPONSE_LIMIT = 512 * 1024;

export class ArtistKnowledgeProviderError extends Error {
  constructor(message, { code = "knowledge_response", status = 0, retryAt = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ArtistKnowledgeProviderError";
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

const exactMbid = (value) => typeof value === "string" && MBID.test(value.toLowerCase()) ? value.toLowerCase() : null;
const exactQid = (value) => typeof value === "string" && QID.test(value) ? value : null;
const own = (value, key) => !!value && Object.hasOwn(value, key);
const plainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const aborted = (signal) => { if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError"); };
const responseError = (provider) => new ArtistKnowledgeProviderError(`${provider} returned an invalid response.`, { code: `${provider}_response` });

function titleText(value) {
  return typeof value === "string" && value.trim() && [...value].length <= 240
    && !/[\u0000-\u001f\u007f<>\[\]{}|#]/u.test(value) ? value.trim() : null;
}

function claims(entity, property) {
  const values = entity?.claims?.[property];
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > 100) return null;
  return values.filter((claim) => claim?.rank !== "deprecated").map((claim) =>
    claim?.mainsnak?.snaktype === "value" && claim.mainsnak.property === property ? claim.mainsnak.datavalue?.value : null);
}

// Statement search is an exact external-ID lookup, never a name similarity
// search. Two results (or a continuation) suffice to reject an ambiguous ID.
export function parseArtistKnowledgeSearch(payload) {
  const rows = payload?.query?.search;
  const total = payload?.query?.searchinfo?.totalhits;
  if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0 || rows.length > 2) throw responseError("wikidata");
  if (rows.length > total || (total > 0 && rows.length === 0)) throw responseError("wikidata");
  if (total === 0 && rows.length === 0) return null;
  if (total !== 1 || rows.length !== 1 || payload.continue) return null;
  return rows[0]?.ns === 0 ? exactQid(rows[0].title) : null;
}

export function parseArtistKnowledgeEntity(payload, { mbid, wikidataId }) {
  if (!plainObject(payload?.entities)) throw responseError("wikidata");
  const entity = payload.entities[wikidataId];
  if (!entity || own(entity, "missing") || entity.type !== "item" || entity.id !== wikidataId) return null;
  const idClaims = claims(entity, "P434")?.map(exactMbid);
  if (!idClaims || idClaims.some((id) => !id)) return null;
  const ids = new Set(idClaims);
  if (!exactMbid(mbid) || !exactQid(wikidataId) || ids.size !== 1 || !ids.has(exactMbid(mbid))) return null;
  const origins = claims(entity, "P495"), citizenships = claims(entity, "P27");
  const countryIds = origins && citizenships ? [...origins, ...citizenships].map((value) => exactQid(value?.id)) : null;
  // Unknown or malformed active claims make the country uncertain too; do not
  // silently discard them and turn the remaining value into false certainty.
  const countries = countryIds && countryIds.every(Boolean) ? new Set(countryIds) : new Set();
  return {
    wikidataId,
    wikipediaTitle: entity.sitelinks?.enwiki?.site === "enwiki" ? titleText(entity.sitelinks.enwiki.title) : null,
    countryId: countries.size === 1 ? [...countries][0] : null,
  };
}

export function parseArtistKnowledgeCountry(payload, countryId) {
  if (!plainObject(payload?.entities)) throw responseError("wikidata");
  const entity = exactQid(countryId) ? payload.entities[countryId] : null;
  if (!entity || own(entity, "missing") || entity.id !== countryId || entity.type !== "item") return null;
  const label = entity.labels?.en;
  if (label?.language !== "en" || typeof label.value !== "string") return null;
  const country = label.value.trim();
  return country && [...country].length <= 80 && !/[\u0000-\u001f\u007f<>]/u.test(country) ? country : null;
}

export function parseArtistKnowledgeWikipedia(payload, { mbid, wikidataId, retrievedAt }) {
  if (!Array.isArray(payload?.query?.pages)) throw responseError("wikipedia");
  if (payload.query.pages.length !== 1) return null;
  const page = payload.query.pages[0];
  const title = titleText(page?.title);
  if (!title || page.ns !== 0 || own(page, "missing") || own(page, "invalid")
    || own(page?.pageprops, "disambiguation") || page?.pageprops?.wikibase_item !== wikidataId
    || !Number.isSafeInteger(page.lastrevid) || page.lastrevid <= 0
    || !exactMbid(mbid) || !exactQid(wikidataId)
    || !Number.isSafeInteger(retrievedAt) || retrievedAt < 0) return null;
  if (typeof page.extract !== "string" || /<\/?[a-z][^>]*>/iu.test(page.extract)) return null;
  const cleaned = page.extract.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
  if (!cleaned) return null;
  const characters = [...cleaned];
  const bio = characters.length <= ARTIST_KNOWLEDGE_BIO_LIMIT ? cleaned
    : characters.slice(0, ARTIST_KNOWLEDGE_BIO_LIMIT - 1).join("").trimEnd() + "…";
  // Construct attribution links from validated page metadata. Never follow or
  // retain fullurl/sitelink URLs supplied by a remote response.
  return { bio, bioSource: {
    provider: "wikipedia",
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /gu, "_"))}`,
    revisionUrl: `https://en.wikipedia.org/w/index.php?oldid=${page.lastrevid}`,
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    modified: true,
    mbid, wikidataId, retrievedAt,
  } };
}

function actionUrl(endpoint, parameters) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...parameters }).toString();
  return url;
}

export function artistKnowledgeRetryAt(response, at) {
  const value = response?.headers?.get?.("retry-after")?.trim();
  const seconds = value && /^\d+(?:\.\d+)?$/u.test(value) ? Number(value) : NaN;
  const result = Number.isFinite(seconds) ? at + Math.ceil(seconds * 1000) : value ? Date.parse(value) : NaN;
  return Number.isSafeInteger(result) && result > at ? result : at + 60_000;
}

function awaitWithAbort(promise, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener("abort", cancel); reject(signal.reason || new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

function pause(ms, { signal } = {}) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(signal.reason || new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function dispose(response) {
  try { await response?.body?.cancel?.(); }
  catch { /* architecture: allow-empty-catch -- failed response disposal must not replace the original provider error. */ }
}

// Bounded lookups may overlap slow responses, but ONE request-start gate
// covers both Wikimedia hosts, including the country-label request. Tests can
// inject a clock/wait without weakening the production minimum spacing.
export function createArtistKnowledgeProvider({ clock = Date.now, wait = pause, timeoutMs = 8000, minimumIntervalMs = 1100, maxPending = 4 } = {}) {
  const interval = Math.max(1100, Number(minimumIntervalMs) || 1100);
  const timeout = Math.max(10, Math.min(8000, Number(timeoutMs) || 8000));
  const capacity = Math.max(1, Math.min(8, Math.trunc(Number(maxPending) || 4)));
  let startGate = Promise.resolve(), pending = 0, lastStarted = null, cooldown = null;

  async function requestJson(url, { provider, signal, fetchImpl, now, beforeRequest }) {
    aborted(signal);
    if (![WIKIDATA_API, WIKIPEDIA_API].includes(url.origin + url.pathname) || url.username || url.password || url.hash) throw responseError(provider);
    const admission = startGate.then(async () => {
      aborted(signal);
      if (lastStarted != null) {
        let remaining = lastStarted + interval - clock();
        while (remaining > 0) { await wait(remaining, { signal }); aborted(signal); remaining = lastStarted + interval - clock(); }
      }
      if (cooldown?.retryAt > now()) throw new ArtistKnowledgeProviderError("Artist knowledge requests are cooling down.", cooldown);
      // Counts are reserved durably BEFORE every outbound request, not per
      // complete lookup. A paused/capped lane cannot continue downloading.
      await beforeRequest?.();
      aborted(signal);
      lastStarted = clock();
    });
    startGate = admission.then(() => undefined, () => undefined);
    await admission;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Knowledge request timed out", "TimeoutError")), timeout);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let response;
    try {
      response = await awaitWithAbort(fetchImpl(url.href, {
        method: "GET", redirect: "manual", credentials: "omit", signal: combined,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      }), combined);
      if (response.redirected || (response.status >= 300 && response.status < 400)
        || (response.url && new URL(response.url).origin + new URL(response.url).pathname !== url.origin + url.pathname)) {
        throw new ArtistKnowledgeProviderError(`${provider} returned a redirect.`, { code: `${provider}_redirect`, status: response.status });
      }
      if (!response.ok) throw new ArtistKnowledgeProviderError(`${provider} is unavailable.`, {
        code: `${provider}_${response.status === 429 ? "rate_limited" : response.status >= 500 ? "unavailable" : "rejected"}`,
        status: response.status, retryAt: artistKnowledgeRetryAt(response, now()),
      });
      const payload = await awaitWithAbort(readBoundedJsonResponse(response, { maxBytes: ARTIST_KNOWLEDGE_RESPONSE_LIMIT, signal: combined }), combined);
      if (!plainObject(payload)) throw responseError(provider);
      if (payload.error) throw new ArtistKnowledgeProviderError(`${provider} rejected the request.`, {
        code: `${provider}_${payload.error.code === "maxlag" ? "maxlag" : payload.error.code === "ratelimited" ? "rate_limited" : "response"}`,
        status: response.status, retryAt: artistKnowledgeRetryAt(response, now()),
      });
      return payload;
    } catch (error) {
      void dispose(response);
      aborted(signal);
      if (error instanceof ArtistKnowledgeProviderError) {
        if (error.retryAt) cooldown = { code: error.code, status: error.status, retryAt: error.retryAt };
        throw error;
      }
      throw new ArtistKnowledgeProviderError(`${provider} could not complete the request.`, {
        code: `${provider}_${controller.signal.aborted ? "timeout" : error?.name === "BoundedJsonResponseError" ? "response" : "network"}`,
        retryAt: now() + 60_000, cause: error,
      });
    } finally { clearTimeout(timer); }
  }

  async function lookup({ mbid, needBio = true, needCountry = true, signal, fetchImpl = fetch, now = Date.now, beforeRequest }) {
    aborted(signal);
    const exact = exactMbid(mbid);
    if (!exact) throw new TypeError("Artist knowledge requires one valid MusicBrainz ID.");
    if (!needBio && !needCountry) return null;
    if (cooldown?.retryAt > now()) throw new ArtistKnowledgeProviderError("Artist knowledge requests are cooling down.", cooldown);
    const read = (endpoint, parameters, provider = "wikidata") => requestJson(actionUrl(endpoint, parameters), { provider, signal, fetchImpl, now, beforeRequest });
    const match = parseArtistKnowledgeSearch(await read(WIKIDATA_API, {
      action: "query", list: "search", srsearch: `haswbstatement:P434=${exact}`, srnamespace: "0", srlimit: "2", srinfo: "totalhits", srprop: "",
    }));
    if (!match) return null;
    const identity = parseArtistKnowledgeEntity(await read(WIKIDATA_API, {
      action: "wbgetentities", ids: match, props: "claims|sitelinks", sitefilter: "enwiki",
    }), { mbid: exact, wikidataId: match });
    if (!identity) return null;
    const result = { mbid: exact, wikidataId: match, wikidataUrl: `https://www.wikidata.org/wiki/${match}` };
    if (needBio && identity.wikipediaTitle) {
      const biography = parseArtistKnowledgeWikipedia(await read(WIKIPEDIA_API, {
        action: "query", titles: identity.wikipediaTitle, prop: "extracts|pageprops|info", ppprop: "wikibase_item|disambiguation",
        inprop: "url", redirects: "1", exintro: "1", explaintext: "1", exchars: String(ARTIST_KNOWLEDGE_BIO_LIMIT), exlimit: "1",
      }, "wikipedia"), { mbid: exact, wikidataId: match, retrievedAt: Math.trunc(now()) });
      if (biography) Object.assign(result, biography);
    }
    if (needCountry && identity.countryId) {
      const country = parseArtistKnowledgeCountry(await read(WIKIDATA_API, {
        action: "wbgetentities", ids: identity.countryId, props: "labels", languages: "en", languagefallback: "0",
      }), identity.countryId);
      if (country) result.country = country;
    }
    return result;
  }

  return function fetchKnowledge(options) {
    try { aborted(options?.signal); } catch (error) { return Promise.reject(error); }
    if (pending >= capacity) return Promise.reject(new ArtistKnowledgeProviderError("Artist knowledge queue is full.", { code: "knowledge_busy", retryAt: (options?.now || Date.now)() + 60_000 }));
    pending++;
    const result = Promise.resolve().then(() => lookup(options)).catch((error) => {
      if (error instanceof ArtistKnowledgeProviderError && error.retryAt) cooldown = { code: error.code, status: error.status, retryAt: error.retryAt };
      throw error;
    }).finally(() => { pending--; });
    return options?.signal ? awaitWithAbort(result, options.signal) : result;
  };
}

export const fetchArtistKnowledge = createArtistKnowledgeProvider();
