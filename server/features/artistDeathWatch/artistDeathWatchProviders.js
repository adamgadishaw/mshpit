import {
  canonicalArtistMbid,
  canonicalDeathDate,
  canonicalWikidataId,
} from "../../../src/domain/artistDeathWatch.mjs";
import { runMusicBrainzRequest } from "../../musicBrainzRequestThrottle.js";

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2/artist";
const HUMAN_QID = "Q5";
const WIKIDATA_BATCH_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 8_000;
const USER_AGENT = process.env.ARTIST_DEATH_WATCH_USER_AGENT
  || "mshpit-memorial-watch/1.0 (https://www.mshpit.com; support@mshpit.com)";

export class ArtistDeathWatchProviderError extends Error {
  constructor(message, { code = "provider_error", status = 0, retryAt = null } = {}) {
    super(message);
    this.name = "ArtistDeathWatchProviderError";
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

function rankedClaims(entity, property) {
  const claims = Array.isArray(entity?.claims?.[property]) ? entity.claims[property] : [];
  const eligible = claims.filter((claim) => claim?.rank !== "deprecated"
    && claim?.mainsnak?.snaktype === "value"
    && claim?.mainsnak?.datavalue?.value != null);
  const preferred = eligible.filter((claim) => claim.rank === "preferred");
  return preferred.length ? preferred : eligible;
}

function itemIds(entity, property) {
  return new Set(rankedClaims(entity, property)
    .map((claim) => canonicalWikidataId(claim?.mainsnak?.datavalue?.value?.id))
    .filter(Boolean));
}

function textValues(entity, property) {
  return new Set(rankedClaims(entity, property)
    .map((claim) => String(claim?.mainsnak?.datavalue?.value || "").trim().toLowerCase())
    .filter(Boolean));
}

function fullDeathDates(entity, at) {
  const values = new Set();
  for (const claim of rankedClaims(entity, "P570")) {
    const value = claim?.mainsnak?.datavalue?.value;
    // Wikibase precision 11 means an exact calendar day. Lower precision cannot
    // satisfy the memorial form's exact-date requirement and must remain a
    // manual research task instead of being silently rounded.
    if (Number(value?.precision) !== 11 || typeof value?.time !== "string") continue;
    const match = /^\+(\d{4}-\d{2}-\d{2})T00:00:00Z$/u.exec(value.time);
    const date = match ? canonicalDeathDate(match[1], { at }) : null;
    if (date) values.add(date);
  }
  return values;
}

export function parseWikidataDeathSignals(payload, artists, { at = Date.now() } = {}) {
  const entities = payload?.entities && typeof payload.entities === "object" ? payload.entities : {};
  const signals = new Map();
  for (const artist of Array.isArray(artists) ? artists : []) {
    const wikidataId = canonicalWikidataId(artist?.wikidataId);
    const artistMbid = canonicalArtistMbid(artist?.artistMbid);
    const entity = wikidataId ? entities[wikidataId] : null;
    if (!entity || entity.missing != null || canonicalWikidataId(entity.id) !== wikidataId || !artistMbid) continue;
    if (!itemIds(entity, "P31").has(HUMAN_QID)) continue;
    if (!textValues(entity, "P434").has(artistMbid)) continue;
    const dates = fullDeathDates(entity, at);
    if (dates.size !== 1) continue;
    signals.set(artist.artistKey, Object.freeze({
      artistKey: artist.artistKey,
      artistName: artist.artistName,
      artistMbid,
      wikidataId,
      deathDate: [...dates][0],
    }));
  }
  return signals;
}

function providerRetryAt(response, at) {
  const raw = response?.headers?.get?.("retry-after");
  if (raw && /^\d+$/u.test(raw.trim())) return at + Number(raw) * 1000;
  const absolute = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(absolute) && absolute > at ? absolute : at + 60_000;
}

async function providerJson(url, { fetchImpl, timeoutMs, provider, at }) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ArtistDeathWatchProviderError(`${provider} could not be reached.`, {
      code: error?.name === "TimeoutError" || error?.name === "AbortError"
        ? `${provider.toLowerCase()}_timeout` : `${provider.toLowerCase()}_network`,
    });
  }
  if (response.status === 429) {
    throw new ArtistDeathWatchProviderError(`${provider} asked Mshpit to slow down.`, {
      code: `${provider.toLowerCase()}_rate_limited`,
      status: 429,
      retryAt: providerRetryAt(response, at),
    });
  }
  if (!response.ok) {
    throw new ArtistDeathWatchProviderError(`${provider} returned ${response.status}.`, {
      code: response.status >= 500 ? `${provider.toLowerCase()}_unavailable` : `${provider.toLowerCase()}_rejected`,
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new ArtistDeathWatchProviderError(`${provider} returned unreadable data.`, {
      code: `${provider.toLowerCase()}_response`,
    });
  }
}

export async function readWikidataDeathSignals(artists, {
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  at = Date.now(),
} = {}) {
  const exact = (Array.isArray(artists) ? artists : [])
    .filter((artist) => canonicalArtistMbid(artist?.artistMbid))
    .slice(0, WIKIDATA_BATCH_LIMIT);
  if (!exact.length) return new Map();
  const url = new URL(WIKIDATA_SPARQL);
  url.searchParams.set("query", buildWikidataDeathSignalsQuery(exact));
  url.searchParams.set("format", "json");
  const payload = await providerJson(url, {
    fetchImpl,
    timeoutMs: Math.max(1_000, Math.min(15_000, Math.trunc(Number(timeoutMs) || DEFAULT_TIMEOUT_MS))),
    provider: "Wikidata",
    at,
  });
  return parseWikidataDeathSignalRows(payload, exact, { at });
}

export function buildWikidataDeathSignalsQuery(artists) {
  const mbids = [...new Set((Array.isArray(artists) ? artists : [])
    .map((artist) => canonicalArtistMbid(artist?.artistMbid))
    .filter(Boolean))]
    .slice(0, WIKIDATA_BATCH_LIMIT);
  if (!mbids.length) throw new TypeError("Historical death lookup requires exact MusicBrainz IDs");
  const values = mbids.map((mbid) => `"${mbid}"`).join(" ");
  return `SELECT ?item ?mbid ?death ?precision WHERE {
  VALUES ?mbid { ${values} }
  ?item wdt:P31 wd:Q5 ; wdt:P434 ?mbid ; p:P570 ?deathStatement .
  ?deathStatement a wikibase:BestRank ; ps:P570 ?death ; psv:P570 ?deathValue .
  ?deathValue wikibase:timeValue ?deathValueTime ; wikibase:timePrecision ?precision .
  FILTER(?precision = 11 && ?death = ?deathValueTime)
}
ORDER BY ?mbid ?item ?death
LIMIT ${Math.min(200, mbids.length * 4)}`;
}

export function parseWikidataDeathSignalRows(payload, artists, { at = Date.now() } = {}) {
  const byMbid = new Map((Array.isArray(artists) ? artists : [])
    .map((artist) => [canonicalArtistMbid(artist?.artistMbid), artist])
    .filter(([mbid, artist]) => mbid && artist?.artistKey));
  const signals = new Map();
  for (const signal of parseRecentWikidataDeaths(payload, { at })) {
    const artist = byMbid.get(signal.artistMbid);
    if (!artist) continue;
    signals.set(artist.artistKey, Object.freeze({
      artistKey: artist.artistKey,
      artistName: artist.artistName,
      artistMbid: signal.artistMbid,
      wikidataId: signal.wikidataId,
      deathDate: signal.deathDate,
    }));
  }
  return signals;
}

export function buildRecentWikidataDeathsQuery({ since, limit = 100, at = Date.now() } = {}) {
  const date = canonicalDeathDate(since, { at });
  if (!date) throw new TypeError("Recent death lookup requires a valid start date");
  const take = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 100)));
  return `SELECT ?item ?mbid ?death ?precision WHERE {
  ?item wdt:P31 wd:Q5 ; wdt:P434 ?mbid ; p:P570 ?deathStatement .
  ?deathStatement a wikibase:BestRank ; ps:P570 ?death ; psv:P570 ?deathValue .
  ?deathValue wikibase:timeValue ?deathValueTime ; wikibase:timePrecision ?precision .
  FILTER(?precision = 11 && ?death = ?deathValueTime && ?death >= "${date}T00:00:00Z"^^xsd:dateTime)
}
ORDER BY DESC(?death) ?item ?mbid
LIMIT ${take}`;
}

export function parseRecentWikidataDeaths(payload, { at = Date.now() } = {}) {
  const unique = new Map();
  for (const row of payload?.results?.bindings || []) {
    if (Number(row?.precision?.value) !== 11) continue;
    const artistMbid = canonicalArtistMbid(row?.mbid?.value);
    const item = String(row?.item?.value || "");
    const qidMatch = /\/entity\/(Q[1-9][0-9]*)$/u.exec(item);
    const wikidataId = canonicalWikidataId(qidMatch?.[1]);
    const rawDate = String(row?.death?.value || "").slice(0, 10);
    const deathDate = canonicalDeathDate(rawDate, { at });
    if (!artistMbid || !wikidataId || !deathDate) continue;
    if (unique.has(artistMbid)) {
      const existing = unique.get(artistMbid);
      if (!existing || existing.wikidataId !== wikidataId || existing.deathDate !== deathDate) {
        unique.set(artistMbid, null);
      }
      continue;
    }
    unique.set(artistMbid, Object.freeze({ artistMbid, wikidataId, deathDate }));
  }
  return [...unique.values()].filter(Boolean);
}

export async function readRecentWikidataDeaths({
  since,
  limit = 100,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  at = Date.now(),
} = {}) {
  const url = new URL(WIKIDATA_SPARQL);
  url.searchParams.set("query", buildRecentWikidataDeathsQuery({ since, limit, at }));
  url.searchParams.set("format", "json");
  const payload = await providerJson(url, {
    fetchImpl,
    timeoutMs: Math.max(1_000, Math.min(15_000, Math.trunc(Number(timeoutMs) || DEFAULT_TIMEOUT_MS))),
    provider: "Wikidata",
    at,
  });
  return parseRecentWikidataDeaths(payload, { at });
}

export function parseMusicBrainzDeathSignal(payload, expected, { at = Date.now() } = {}) {
  const artistMbid = canonicalArtistMbid(expected?.artistMbid);
  const deathDate = canonicalDeathDate(expected?.deathDate, { at });
  if (!artistMbid || !deathDate || canonicalArtistMbid(payload?.id) !== artistMbid) return null;
  if (String(payload?.type || "").trim().toLowerCase() !== "person") return null;
  const lifespan = payload?.["life-span"];
  if (lifespan?.ended !== true) return null;
  const providerDeathDate = canonicalDeathDate(lifespan?.end, { at });
  return providerDeathDate === deathDate ? Object.freeze({ artistMbid, deathDate, artistType: "Person" }) : null;
}

export async function confirmMusicBrainzDeathSignal(expected, {
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  at = Date.now(),
  signal = null,
  requestGate = runMusicBrainzRequest,
} = {}) {
  const artistMbid = canonicalArtistMbid(expected?.artistMbid);
  if (!artistMbid) return null;
  const url = new URL(`${MUSICBRAINZ_API}/${artistMbid}`);
  url.searchParams.set("fmt", "json");
  const payload = await requestGate(() => providerJson(url, {
    fetchImpl,
    timeoutMs: Math.max(1_000, Math.min(15_000, Math.trunc(Number(timeoutMs) || DEFAULT_TIMEOUT_MS))),
    provider: "MusicBrainz",
    at,
  }), { signal });
  return parseMusicBrainzDeathSignal(payload, expected, { at });
}
