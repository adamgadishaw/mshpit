import { artistRow, artistStmts, db, normName, providerCacheStmts, ytStmts } from "./db.js";
import { providerGenreFields } from "../src/domain/genre.mjs";
import {
  legacyTrackOverrideIdentityKey,
  normalizeTrackIdentityText,
  trackOverrideIdentityKey,
} from "./trackIdentity.js";

const DEEZER_DISCOGRAPHY_TTL_MS = 24 * 60 * 60 * 1000;
const DEEZER_PREVIEW_MAX_TTL_MS = 5 * 60 * 1000;
const days = (n) => n * 24 * 60 * 60 * 1000;
const YOUTUBE_POLICY_MAX_AGE_MS = days(30);
// Non-authorized YouTube API data must be deleted or refreshed within 30 days.
// Positive matches are refreshed with the cheap videos.list endpoint before the
// policy deadline. Keeping a small gap between refresh and deletion gives PIT a
// bounded, still-compliant stale fallback during a transient provider outage.
const YOUTUBE_MATCH_REFRESH_TTL_MS = days(Math.max(1, Math.min(29,
  Number(process.env.YOUTUBE_MATCH_REFRESH_DAYS || process.env.YOUTUBE_MATCH_TTL_DAYS) || 14)));
// A miss is usually structural (no official upload exists), not transient, so
// retrying every 6 hours spent 4 searches a day per unmatched song for nothing.
// Configuration is still capped at the same 30-day policy ceiling.
const YOUTUBE_MISS_TTL_MS = days(Math.max(0.25, Math.min(30,
  Number(process.env.YOUTUBE_MISS_TTL_DAYS) || 3)));
const YOUTUBE_SCORE_MIN = 65;
// Bump this whenever a previously accepted recording becomes unsafe under new
// identity rules. The version is carried in both the cache key and positive
// metadata, so an older result must pass videos.list + the current scorer before
// it can be served again. This specifically retires v3 matches that allowed an
// unrelated uploader when its title merely started with "Artist - Song".
export const YOUTUBE_MATCH_CACHE_VERSION = 5;
// Since June 2026, search.list has a separate default bucket of 100 calls/day
// and costs one call from that bucket. Use the full default allocation; an
// approved Cloud Console increase remains configurable without code changes.
const configuredYouTubeSearchBudget = Number(process.env.YOUTUBE_SEARCH_DAILY_BUDGET);
const YOUTUBE_SEARCH_DAILY_BUDGET = Number.isFinite(configuredYouTubeSearchBudget) && configuredYouTubeSearchBudget > 0
  ? Math.max(1, Math.floor(configuredYouTubeSearchBudget))
  : 100;
// Search quota is charged per request, not per returned candidate. A wider first
// page raises the chance of finding the official upload without pagination.
const YOUTUBE_SEARCH_MAX_RESULTS = Math.max(10, Math.min(50,
  Math.floor(Number(process.env.YOUTUBE_SEARCH_MAX_RESULTS) || 25)));
const YOUTUBE_CATALOGUE_MAX_PAGES = Math.max(2, Math.min(20, Number(process.env.YOUTUBE_CATALOGUE_MAX_PAGES) || 12));
const previewCache = new Map();
const youtubeInflight = new Map();
const youtubeChannelInflight = new Map();
const youtubeCatalogueInflight = new Map();
const youtubeDemandCallbackScopes = new WeakMap();
let youtubeDemandCallbackSequence = 0;
const youtubeMetrics = {
  startedAt: Date.now(),
  searchCallsReserved: 0,
  searchBudgetRejected: 0,
  dataCalls: 0,
  trackCacheHits: 0,
  trackNegativeCacheHits: 0,
  staleFallbacks: 0,
  trackCoalesced: 0,
  channelCacheHits: 0,
  channelNegativeCacheHits: 0,
  channelCoalesced: 0,
  catalogueCacheHits: 0,
  catalogueCoalesced: 0,
  catalogueMatches: 0,
};
// Search and catalogue calls now have separate provider quota buckets. A search
// limit must not disable channels/playlistItems/videos calls that can still play
// already-known artists at budget zero.
const youtubeCircuits = {
  search: { until: 0, code: null },
  data: { until: 0, code: null },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ProviderError extends Error {
  constructor(provider, status, message, { retryable = true, code = "provider_error", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = Number(status) || 502;
    this.retryable = retryable;
    this.code = code;
  }
}

function pacificDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function youtubeSearchUsage() {
  const day = pacificDay();
  const key = `youtube_search_calls:${day}`;
  const used = Math.max(0, Number(db.prepare("SELECT value FROM app_meta WHERE key=?").get(key)?.value) || 0);
  return { day, key, used, limit: YOUTUBE_SEARCH_DAILY_BUDGET, remaining: Math.max(0, YOUTUBE_SEARCH_DAILY_BUDGET - used) };
}

function reserveYouTubeSearch() {
  const usage = youtubeSearchUsage();
  // One conditional SQLite upsert is safe even if two Node processes share the
  // database. The previous read-then-increment sequence could over-reserve at
  // the daily boundary under cross-process concurrency.
  const reserved = db.prepare(`INSERT INTO app_meta (key,value) VALUES (?,'1')
    ON CONFLICT(key) DO UPDATE SET value=MAX(0,CAST(app_meta.value AS INTEGER))+1
      WHERE MAX(0,CAST(app_meta.value AS INTEGER)) < ?
    RETURNING CAST(value AS INTEGER) AS used`).get(usage.key, usage.limit);
  if (!reserved) {
    youtubeMetrics.searchBudgetRejected += 1;
    throw new ProviderError("YouTube", 429, "Pit reserved the remaining YouTube search capacity for later.", {
      code: "search_budget_exhausted",
      retryable: true,
    });
  }
  youtubeMetrics.searchCallsReserved += 1;
  return { ...usage, used: reserved.used, remaining: Math.max(0, usage.limit - reserved.used) };
}

function releaseYouTubeSearch(reservation) {
  if (!reservation?.key) return;
  db.prepare(`UPDATE app_meta
    SET value=MAX(0,CAST(value AS INTEGER)-1)
    WHERE key=?`).run(reservation.key);
  youtubeMetrics.searchCallsReserved = Math.max(0, youtubeMetrics.searchCallsReserved - 1);
}

export function youtubeProviderStatus() {
  const usage = youtubeSearchUsage();
  const searchOpen = youtubeCircuits.search.until > Date.now();
  const dataOpen = youtubeCircuits.data.until > Date.now();
  return {
    search: usage,
    circuitOpen: searchOpen || dataOpen,
    circuitCode: searchOpen ? youtubeCircuits.search.code : dataOpen ? youtubeCircuits.data.code : null,
    retryAt: Math.max(searchOpen ? youtubeCircuits.search.until : 0, dataOpen ? youtubeCircuits.data.until : 0) || null,
    searchCircuitOpen: searchOpen,
    dataCircuitOpen: dataOpen,
    circuits: {
      search: { open: searchOpen, code: searchOpen ? youtubeCircuits.search.code : null, retryAt: searchOpen ? youtubeCircuits.search.until : null },
      data: { open: dataOpen, code: dataOpen ? youtubeCircuits.data.code : null, retryAt: dataOpen ? youtubeCircuits.data.until : null },
    },
    inFlight: youtubeInflight.size + youtubeChannelInflight.size + youtubeCatalogueInflight.size,
    inFlightByKind: {
      tracks: youtubeInflight.size,
      channels: youtubeChannelInflight.size,
      catalogues: youtubeCatalogueInflight.size,
    },
    efficiency: { ...youtubeMetrics },
  };
}

function providerPaused(error) {
  return error instanceof ProviderError && [
    "search_actor_budget_exhausted",
    "search_budget_exhausted",
    "provider_paused",
    "quota_or_forbidden",
    "rate_limited",
  ].includes(error.code);
}

export function normalizeMusicText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Cache identity should collapse harmless presentation differences without
// transliterating distinct songs into the same key. NFKC joins composed and
// decomposed Unicode, and the punctuation folding covers keyboard variants;
// letters/diacritics/symbols remain intact so "Si" and "Sí" never alias.
export function normalizeYouTubeCacheText(value) {
  return normalizeTrackIdentityText(value);
}

// Stable identity for one song across the override table, reports, and the
// resolver cache, so a pin set from one spelling matches every other spelling.
export function trackOverrideKey(title, artist) {
  return trackOverrideIdentityKey(title, artist);
}

export function legacyTrackOverrideKey(title, artist) {
  return legacyTrackOverrideIdentityKey(title, artist);
}

// Every provider recording accepted by playback/moderation receives its own
// resolver cache key. Proof policy is handled separately: Deezer can be checked
// live, while Spotify is trusted only when that exact track id already exists in
// PIT's local catalogue.
export function youtubeRecordingIdentity(sourceProvider, sourceId) {
  const provider = String(sourceProvider || "").trim().toLowerCase();
  const id = String(sourceId || "").trim();
  if (provider === "deezer" && /^\d{1,20}$/.test(id)) return `deezer:${id}`;
  if (provider === "spotify" && /^[A-Za-z0-9]{1,64}$/.test(id)) return `spotify:${id}`;
  return "";
}

export function trackSourceOverrideKey(sourceProvider, sourceId) {
  const provider = String(sourceProvider || "").trim().toLowerCase();
  const id = String(sourceId || "").trim();
  if (provider === "deezer" && /^\d{1,20}$/.test(id)) return `track:source:v1:deezer:${id}`;
  if (provider === "spotify" && /^[A-Za-z0-9]{1,64}$/.test(id)) return `track:source:v1:spotify:${id}`;
  return "";
}

// Accept the ways people actually paste a YouTube link (watch?v=, youtu.be,
// shorts, embed, music.youtube) plus a bare 11-char id. Anything else is null:
// never store a guess as a human-verified pin.
export function parseYouTubeVideoId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  let url;
  try { url = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch { return null; }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (!/^(youtube\.com|youtu\.be|music\.youtube\.com|youtube-nocookie\.com)$/.test(host)) return null;
  const candidate = host === "youtu.be"
    ? url.pathname.split("/").filter(Boolean)[0]
    : url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/)?.[1];
  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

function tokenSet(value) {
  return new Set(normalizeMusicText(value).split(" ").filter(Boolean));
}

function coverage(wanted, actual) {
  const need = tokenSet(wanted);
  const has = tokenSet(actual);
  if (!need.size) return 0;
  let matched = 0;
  for (const token of need) if (has.has(token)) matched++;
  return matched / need.size;
}

// YouTube titles and channel names are global. The catalogue-wide fuzzy
// normalizer above is intentionally ASCII-oriented, but using it as a playback
// identity made every non-Latin title collapse to an empty string. Preserve all
// Unicode letters/digits here so a trusted artist channel still has to contain
// the requested SONG, not merely any upload by that artist.
function normalizeYouTubeMatchText(value) {
  return String(value || "")
    // NFKC folds compatibility spellings without decomposing kana. Removing
    // combining marks here made semantically different Japanese titles such as
    // "がみ" and "かみ" compare equal (dakuten carries meaning, not styling).
    .normalize("NFKC")
    .replace(/&/g, " and ")
    .toLocaleLowerCase("en-US")
    // Marks are part of the grapheme in many scripts (for example the Devanagari
    // vowel sign in "कि"). Treating every mark as punctuation aliases distinct
    // song and artist names even after NFKC.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function youtubeMatchCoverage(wanted, actual) {
  const need = new Set(normalizeYouTubeMatchText(wanted).split(" ").filter(Boolean));
  const has = new Set(normalizeYouTubeMatchText(actual).split(" ").filter(Boolean));
  if (!need.size) return 0;
  let matched = 0;
  for (const token of need) if (has.has(token)) matched += 1;
  return matched / need.size;
}

function youtubeDecorationGroup(value) {
  const group = normalizeYouTubeMatchText(value);
  return /^(?:(?:official|original) )?(?:music )?(?:audio|video|visualizer)$/.test(group)
    || /^(?:official )?(?:lyric|lyrics)(?: video)?$/.test(group)
    || /^(?:official|original|hd|hq|4k|full|explicit)$/.test(group)
    || /^from .*(?:soundtrack|motion picture)$/.test(group);
}

function stripYouTubePresentationDecorations(value) {
  let raw = String(value || "");
  raw = raw.replace(/\(([^)]+)\)|\[([^\]]+)\]/g, (whole, round, square) => {
    const group = round || square || "";
    return youtubeDecorationGroup(group) ? " " : whole;
  });
  return raw.replace(/\s+[-|:]\s+(?:(?:official|original)\s+)?(?:music\s+)?(?:audio|video|visualizer|lyric(?:s)?(?:\s+video)?|official|original|hd|hq|4k|full|explicit)\s*$/i, " ");
}

// Remove only presentation/credit wrappers, never arbitrary words following the
// requested title. This is deliberately stricter than prefix matching: "One
// (Official Audio)" is One, while "One Tree Hill" remains a different song.
function canonicalYouTubeSongTitle(value, artist = "") {
  let raw = stripYouTubePresentationDecorations(value);
  raw = raw.replace(/\(([^)]+)\)|\[([^\]]+)\]/g, (whole, round, square) => {
    const group = round || square || "";
    return youtubeDecorationGroup(group) ? " " : ` ${group} `;
  });
  let normalized = normalizeYouTubeMatchText(raw);
  const artistIdentity = normalizeYouTubeMatchText(artist);
  if (artistIdentity && normalized.startsWith(`${artistIdentity} `)) {
    normalized = normalized.slice(artistIdentity.length + 1).trim();
  }
  normalized = normalized.trim();
  // Some legitimate catalogue titles are symbol-only. The word matcher has no
  // tokens for them, so retain an exact normalized-display identity rather than
  // treating every such title as empty/unresolvable.
  return normalized || normalizeYouTubeCacheText(raw);
}

function normalizeYouTubeCreditSet(value) {
  const parts = String(value || "")
    .split(/\s*(?:&|,|×)\s*|\s+(?:and|x)\s+/iu)
    .map((part) => normalizeYouTubeMatchText(part))
    .filter(Boolean);
  return [...new Set(parts)].sort().join("|");
}

function youtubeTitleCreditIdentity(value, artist = "") {
  const raw = stripYouTubePresentationDecorations(value).trim();
  const bracketed = /\s*[\[(]\s*(?:feat(?:uring)?|ft)\.?\s+([^\])]+)\s*[\])]\s*$/iu.exec(raw);
  const suffixed = bracketed ? null : /\s+(?:feat(?:uring)?|ft)\.?\s+(.+?)\s*$/iu.exec(raw);
  const match = bracketed || suffixed;
  const baseRaw = match ? raw.slice(0, match.index) : raw;
  return {
    base: canonicalYouTubeSongTitle(baseRaw, artist),
    credits: match ? normalizeYouTubeCreditSet(match[1]) : "",
  };
}

function youtubeTitleCreditCandidates(value, artist = "") {
  const raw = String(value || "");
  // An artist name at the start can be either an uploader prefix ("U2 - One")
  // or the song title itself (Black Sabbath's "Black Sabbath", Public Enemy's
  // "Public Enemy No. 1"). Retain both identities and let exact matching decide.
  const candidates = [youtubeTitleCreditIdentity(raw)];
  if (artist) candidates.push(youtubeTitleCreditIdentity(raw, artist));
  const separator = /\s+[-|:]\s+/.exec(raw);
  if (separator) candidates.push(youtubeTitleCreditIdentity(raw.slice(separator.index + separator[0].length)));
  return candidates.filter((entry, index, all) => entry.base
    && all.findIndex((other) => other.base === entry.base && other.credits === entry.credits) === index);
}

function sameYouTubeRecordingIdentity(requested, candidate) {
  return requested.base === candidate.base && requested.credits === candidate.credits;
}

function providerOmittedCreditMatch(title, rawTitle, artist, providerFeaturedCredits) {
  const allowedCredits = normalizeYouTubeCreditSet((providerFeaturedCredits || []).join(" & "));
  if (!allowedCredits) return false;
  const requested = youtubeTitleCreditCandidates(title);
  const candidates = youtubeTitleCreditCandidates(rawTitle, artist);
  return requested.some((wanted) => !wanted.credits && candidates.some((candidate) => (
    candidate.base === wanted.base && candidate.credits === allowedCredits
  )));
}

function canonicalYouTubeTitleCandidates(value, artist = "") {
  const raw = String(value || "");
  const candidates = new Set([canonicalYouTubeSongTitle(raw, artist)]);
  const separator = /\s+[-|:]\s+/.exec(raw);
  if (separator) {
    candidates.add(canonicalYouTubeSongTitle(raw.slice(separator.index + separator[0].length)));
  }
  candidates.delete("");
  return candidates;
}

function fanWeight(value) {
  return Math.min(20, Math.log10(Math.max(0, Number(value) || 0) + 1) * 3);
}

// Letters/digits only, diacritics folded, but NON-LATIN KEPT, so a stylized
// spelling stays comparable character by character ("KoЯn" -> "koяn").
function looseKey(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

// Rank only exact creator-channel identities. Most names use the compact
// letters/digits form; symbol-only acts such as the real band "!!!" need an
// exact normalized-display fallback or they collapse to an empty identity.
// The fallback intentionally enumerates suffixes rather than using contains(),
// so "!!! Fan Uploads" can never impersonate "!!! - Topic".
function creatorChannelRank(artist, channel) {
  const creatorKey = (value) => normalizeYouTubeMatchText(value).replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
  const wantedKey = creatorKey(artist);
  const channelKey = creatorKey(channel);
  if (wantedKey) {
    if (channelKey === `${wantedKey}topic`) return 100;
    if (channelKey === `${wantedKey}vevo`) return 90;
    if (channelKey === wantedKey) return 80;
    if ([`${wantedKey}official`, `official${wantedKey}`, `${wantedKey}music`].includes(channelKey)) return 70;
    return 0;
  }

  const wanted = normalizeYouTubeCacheText(artist);
  const candidate = normalizeYouTubeCacheText(channel);
  if (!wanted) return 0;
  if ([`${wanted} - topic`, `${wanted} topic`].includes(candidate)) return 100;
  if ([`${wanted}vevo`, `${wanted} vevo`].includes(candidate)) return 90;
  if (candidate === wanted) return 80;
  if ([`${wanted}official`, `${wanted} official`, `official${wanted}`, `official ${wanted}`, `${wanted} music`].includes(candidate)) return 70;
  return 0;
}

function creditedArtistParts(value) {
  return String(value || "")
    .split(/\s+(?:&|and|x|×|feat\.?|ft\.?|featuring)\s+|,\s*/iu)
    .map((part) => part.trim())
    .filter(Boolean);
}

function collaboratorChannelRank(artist, channel, rawTitle, licensed) {
  const direct = creatorChannelRank(artist, channel);
  if (direct >= 70 || !licensed) return direct;
  const parts = creditedArtistParts(artist);
  const separator = /\s+[-|:]\s+/.exec(String(rawTitle || ""));
  if (parts.length < 2 || !separator) return direct;
  const leadKey = normalizeYouTubeMatchText(String(rawTitle).slice(0, separator.index))
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
  for (const part of parts) {
    const rank = creatorChannelRank(part, channel);
    if (rank < 70) continue;
    const remainingCredited = parts
      .filter((other) => other !== part)
      .every((other) => leadKey.includes(normalizeYouTubeMatchText(other).replace(/[^\p{L}\p{N}\p{M}]+/gu, "")));
    if (remainingCredited) return rank;
  }
  return direct;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// Deezer can return multiple artists for one name, including impostors. Exact
// spelling alone is NOT sufficient and is actively dangerous: Deezer lists Korn
// as "KoЯn" (2.6M fans), whose tokens don't match "korn" at all, while two
// impostor accounts spelled exactly "Korn" (4,497 and 25 fans) do. The old
// exact-match-first rule therefore picked an impostor with two albums and the
// real band's page came up empty. Now every plausible spelling competes and the
// established act (audience size) wins. A verified Deezer ID still overrides.
export function selectDeezerArtist(name, candidates = [], preferredId = null, { hintId = null } = {}) {
  const valid = candidates.filter((item) => item?.id && item?.name);
  if (!valid.length) return null;
  // A listener's deliberate pick from the "wrong artist?" flow is authoritative.
  if (preferredId != null) {
    const preferred = valid.find((item) => String(item.id) === String(preferredId));
    if (preferred) return { artist: preferred, confidence: 1, reason: "stored-id" };
  }
  const wanted = normalizeMusicText(name);
  const wantedLoose = looseKey(name);
  const scored = valid.map((artist) => {
    const exact = normalizeMusicText(artist.name) === wanted;
    const tokenSim = Math.min(coverage(name, artist.name), coverage(artist.name, name));
    const loose = looseKey(artist.name);
    const charSim = !wantedLoose || !loose
      ? 0
      : 1 - levenshtein(wantedLoose, loose) / Math.max(wantedLoose.length, loose.length);
    return { artist, exact, similarity: Math.max(tokenSim, charSim), fans: Number(artist.nb_fan) || 0 };
  });
  const plausible = scored.filter((c) => c.exact || c.similarity >= 0.6);
  if (!plausible.length) return null;
  const byFans = (a, b) => b.fans - a.fans || b.similarity - a.similarity;
  const exacts = plausible.filter((c) => c.exact).sort(byFans);
  const nears = plausible.filter((c) => !c.exact).sort(byFans);
  const bestExact = exacts[0] || null;
  const bestNear = nears[0] || null;
  // An exact spelling normally wins. A near spelling only takes it when it is
  // overwhelmingly bigger, which is the stylized-name case (KoЯn has 580x the
  // impostor's audience) and never a genuine same-name collision like Jorn/Lorn.
  const stylizedWins = bestNear && (!bestExact || bestNear.fans >= Math.max(1000, bestExact.fans * 10));
  const top = stylizedWins ? bestNear : bestExact;
  if (!top) return null;
  // An auto-saved id from a previous lookup keeps continuity, but it must never
  // outrank an overwhelmingly bigger act. This is what un-sticks an artist that
  // was already mis-pinned to an impostor (Korn was pinned to a 4k-fan account).
  if (hintId != null) {
    const hinted = plausible.find((c) => String(c.artist.id) === String(hintId));
    if (hinted && !(top.fans >= Math.max(1000, hinted.fans * 10))) {
      return { artist: hinted.artist, confidence: 0.96, reason: "stored-id" };
    }
  }
  const reason = top.exact ? (exacts.length > 1 ? "exact-name-popularity" : "exact-name") : "stylized-name-popularity";
  const confidence = top.exact ? (exacts.length === 1 ? 0.98 : 0.94) : Math.min(0.9, 0.6 + top.similarity * 0.3);
  return { artist: top.artist, confidence, reason };
}

function providerMessage(provider, status) {
  if (status === 429) return `${provider} is rate-limiting Pit right now.`;
  if (status === 401 || status === 403) return `${provider} credentials or quota are unavailable.`;
  return `${provider} did not return a usable response.`;
}

export async function providerJson(provider, url, { timeoutMs = 10_000, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "PitConcertApp/1.0 (https://mshpit.com)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ProviderError(provider, 502, `${provider} could not be reached.`, { code: "network", cause: error });
  }
  if (!response.ok) {
    throw new ProviderError(provider, response.status, providerMessage(provider, response.status), {
      code: response.status === 429 ? "rate_limited" : response.status === 403 ? "quota_or_forbidden" : "http_error",
      retryable: response.status >= 500 || response.status === 429 || response.status === 403,
    });
  }
  let data;
  try { data = await response.json(); }
  catch (error) { throw new ProviderError(provider, 502, `${provider} returned unreadable data.`, { code: "invalid_json", cause: error }); }
  if (data?.error) {
    const code = Number(data.error.code) || 502;
    throw new ProviderError(provider, code, `${provider} rejected the request.`, { code: code === 4 ? "quota_or_forbidden" : "provider_payload_error" });
  }
  return data;
}

export async function findDeezerArtist(name, { preferredId = null, hintId = null, fetchImpl = fetch } = {}) {
  const data = await providerJson("Deezer", `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10`, { fetchImpl });
  return selectDeezerArtist(name, data?.data || [], preferredId, { hintId });
}

function storedDeezerId(name) {
  const row = artistStmts.byNorm.get(normName(name));
  if (!row?.data) return null;
  try { return JSON.parse(row.data)?.deezerId || null; } catch { return null; }
}

export function persistDeezerIdentity(name, deezerId, derivedGenre = null) {
  const existing = artistStmts.byNorm.get(normName(name));
  if (!existing || !deezerId) return;
  let data = {};
  try { data = JSON.parse(existing.data || "{}"); } catch {}
  // Deezer's album genre is a clean canonical label, so it corrects the noisy
  // MusicBrainz tag that got written into `genre` (e.g. Justin Bieber -> "Metal").
  const genre = derivedGenre && String(derivedGenre).trim() ? String(derivedGenre).trim() : null;
  const genreFields = providerGenreFields(data, existing.genre, genre);
  const priorProvider = Array.isArray(data.genreClaims)
    ? data.genreClaims.find((claim) => claim?.source === "provider")?.value || null
    : null;
  const idUnchanged = String(data.deezerId || "") === String(deezerId);
  const genreChanged = !!genre && genre !== priorProvider;
  if (idUnchanged && !genreChanged) return;
  const merged = {
    ...data,
    name: existing.name,
    ...genreFields,
    photo: existing.photo || data.photo || null,
    bio: existing.bio || data.bio || null,
    mbid: existing.mbid || data.mbid || null,
    country: existing.country || data.country || null,
    beginYear: existing.formed || data.beginYear || null,
    popularity: existing.popularity ?? data.popularity ?? null,
    rank_score: existing.rank_score,
    deezerId,
  };
  artistStmts.upsert.run(artistRow(existing.norm, merged, existing.source || "deezer"));
}

function readProviderCache(key) {
  const row = providerCacheStmts.get.get(key);
  if (!row) return null;
  try {
    return {
      data: JSON.parse(row.data),
      fresh: row.expires_at > Date.now(),
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }
  catch { return null; }
}

function writeProviderCache(key, data, ttlMs) {
  const at = Date.now();
  providerCacheStmts.set.run(key, JSON.stringify(data), at, at + ttlMs);
}

async function inBatches(items, size, mapper) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    const batch = await Promise.all(items.slice(index, index + size).map(mapper));
    out.push(...batch);
    if (index + size < items.length) await sleep(75);
  }
  return out;
}

// Deezer artist candidates for disambiguation: many acts share a name, so the
// UI can show fans/photo/album-count and let the listener pick the right one.
export async function findDeezerArtistCandidates(name, { fetchImpl = fetch, limit = 8 } = {}) {
  const data = await providerJson("Deezer", `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=${limit}`, { fetchImpl });
  return (data?.data || [])
    .filter((a) => a?.id && a?.name)
    .map((a) => ({ id: a.id, name: a.name, fans: Number(a.nb_fan) || 0, albums: Number(a.nb_album) || 0, photo: a.picture_medium || a.picture || null }));
}

export async function getDeezerDiscography(name, {
  fetchImpl = fetch,
  deezerId = null,
  ephemeralSelection = false,
} = {}) {
  if (deezerId && !ephemeralSelection) {
    throw new TypeError("A caller-selected Deezer identity must be request-scoped");
  }
  // v6 retires every discography resolved before the impostor fix below. Those
  // rows are served straight from cache for 24 hours, so without this bump the
  // wrong artist (Korn matched a 4.5k-fan impostor with one track) keeps being
  // served long after the selection was corrected.
  const key = `deezer:discography:v6:${normName(name)}`;
  const cached = readProviderCache(key);
  // A caller-supplied deezerId (the listener picked a specific same-named artist)
  // forces a fresh resolve and re-pins identity, even when one is already cached.
  if (cached?.fresh && !deezerId) return { ...cached.data, status: "cached", stale: false };
  try {
    // The listener's explicit pick overrides everything; a previously auto-saved
    // id is only a hint, so a bad one can be corrected instead of sticking.
    const identity = await findDeezerArtist(name, { preferredId: deezerId, hintId: storedDeezerId(name), fetchImpl });
    if (!identity) return cached ? { ...cached.data, status: "stale", stale: true } : { albums: [], status: "not_found", stale: false };
    const artist = identity.artist;
    if (!ephemeralSelection) persistDeezerIdentity(name, artist.id);
    // A deep popular-songs chart (up to 25) so the artist page isn't cut off at
    // ~10. Resolved live for ANY artist, not just ones the seeder pre-enriched.
    const topData = await providerJson("Deezer", `https://api.deezer.com/artist/${artist.id}/top?limit=25`, { fetchImpl });
    const topTracks = (topData?.data || []).map((t) => ({ id: t.id || null, title: t.title, album: t.album?.title || null, duration: t.duration || 0 }));
    // Full discography: albums AND EPs (not just the most recent LPs), newest
    // first, capped high enough to cover a deep back catalogue. Previously this
    // kept only `record_type === "album"` and sliced to 12, so earlier releases
    // and every EP silently vanished from the page.
    const albumData = await providerJson("Deezer", `https://api.deezer.com/artist/${artist.id}/albums?limit=300`, { fetchImpl });
    const seen = new Set();
    const picks = (albumData?.data || [])
      .filter((album) => (album.record_type === "album" || album.record_type === "ep") && album.title
        && !seen.has(normalizeMusicText(album.title)) && seen.add(normalizeMusicText(album.title)))
      .sort((a, b) => String(b.release_date || "").localeCompare(String(a.release_date || "")))
      .slice(0, 28);
    // Each album detail is fetched independently and RESILIENTLY: a single bad
    // album (rate limit, 403, a pulled release) used to reject the whole batch
    // and throw away the entire discography AND the song chart (this is why some
    // artists showed no songs at all). Now a failed album is just skipped.
    // Slightly wider batches with fewer albums also cut the artist-page load.
    const fullAlbums = (await inBatches(picks, 6, async (album) => {
      try {
        const full = await providerJson("Deezer", `https://api.deezer.com/album/${album.id}`, { fetchImpl });
        return {
          id: album.id,
          title: album.title,
          type: album.record_type === "ep" ? "ep" : "album",
          year: String(album.release_date || "").slice(0, 4),
          cover: album.cover_medium || album.cover || null,
          // Deezer's clean, canonical genre label for this release (used to
          // correct the artist's noisy catalog genre below).
          genre: full?.genres?.data?.[0]?.name || null,
          // Never persist Deezer's signed preview URL. It expires in minutes and
          // is resolved by getFreshDeezerPreview only when a listener presses play.
          tracks: (full?.tracks?.data || []).map((track) => ({ id: track.id || null, title: track.title, duration: track.duration || 0 })),
        };
      } catch { return null; }
    })).filter(Boolean);
    // The artist's canonical genre is the one most of their releases carry. This
    // corrects the wrong catalog genre (from MusicBrainz tags) the moment anyone
    // opens the artist, so Discover and Search stop showing nonsense over time.
    const genreCounts = {};
    for (const al of fullAlbums) { const g = al.genre && al.genre.trim(); if (g) genreCounts[g] = (genreCounts[g] || 0) + 1; }
    const derivedGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    if (derivedGenre && !ephemeralSelection) persistDeezerIdentity(name, artist.id, derivedGenre);
    const data = {
      artist: { id: artist.id, name: artist.name, fans: artist.nb_fan, photo: artist.picture_xl || artist.picture_big || null, genre: derivedGenre || null },
      albums: fullAlbums,
      topTracks,
      genre: derivedGenre || null,
      identity: { confidence: identity.confidence, reason: identity.reason },
    };
    // Empty/partial provider failures never replace a last-known-good catalogue.
    if (!ephemeralSelection && (data.albums.length || data.topTracks.length)) {
      writeProviderCache(key, data, DEEZER_DISCOGRAPHY_TTL_MS);
    }
    return { ...data, status: "fresh", stale: false };
  } catch (error) {
    if (cached) return { ...cached.data, status: "stale", stale: true };
    throw error;
  }
}

// Resolve a pasted YouTube link to a tagged song for a post: its stable video id,
// plus a title/author/thumbnail from YouTube's keyless oEmbed endpoint. Only
// YouTube links are accepted (parseYouTubeVideoId returns null otherwise); a
// thumbnail is always derivable from the id even if oEmbed metadata is missing.
export async function youtubeOEmbed(url, { fetchImpl = fetch } = {}) {
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) return null;
  const canonical = `https://www.youtube.com/watch?v=${videoId}`;
  const fallbackThumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  try {
    const data = await providerJson("YouTube", `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`, { fetchImpl, timeoutMs: 6_000 });
    return {
      videoId,
      url: canonical,
      title: data?.title ? String(data.title).slice(0, 200) : null,
      artist: data?.author_name ? String(data.author_name).slice(0, 120) : null,
      thumb: typeof data?.thumbnail_url === "string" && /^https:\/\//.test(data.thumbnail_url) ? data.thumbnail_url : fallbackThumb,
    };
  } catch {
    return { videoId, url: canonical, title: null, artist: null, thumb: fallbackThumb };
  }
}

function titleQualifierPenalty(requested, candidate) {
  const wanted = normalizeMusicText(requested);
  const found = normalizeMusicText(candidate);
  const qualifiers = ["remix", "live", "acoustic", "instrumental", "sped up", "slowed"];
  return qualifiers.some((word) => found.includes(word) && !wanted.includes(word)) ? 30 : 0;
}

export function selectDeezerTrack(title, artist, candidates = []) {
  const ranked = candidates.filter((track) => track?.title).map((track) => {
    const titleMatch = coverage(title, track.title);
    const artistMatch = artist ? coverage(artist, track.artist?.name) : 1;
    const exactTitle = normalizeMusicText(title) === normalizeMusicText(track.title);
    const exactArtist = !artist || normalizeMusicText(artist) === normalizeMusicText(track.artist?.name);
    const noisy = /\b(karaoke|tribute|cover)\b/i.test(track.title) && !/\b(karaoke|tribute|cover)\b/i.test(title);
    const score = titleMatch * 55 + artistMatch * 35 + (exactTitle ? 15 : 0) + (exactArtist ? 10 : 0)
      - titleQualifierPenalty(title, track.title) - (noisy ? 80 : 0) - (artist && artistMatch < 0.6 ? 100 : 0);
    return { track, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 70 ? ranked[0] : null;
}

export function playbackUrlExpiry(url, now = Date.now()) {
  if (!url) return now;
  const raw = String(url);
  let seconds = 0;
  try {
    const parsed = new URL(raw);
    seconds = Number(parsed.searchParams.get("exp")) || 0;
    // Deezer currently nests the expiry inside its signed `hdnea` token rather
    // than exposing it as a top-level query parameter:
    //   ?hdnea=exp=123~acl=/api/...*~data=...~hmac=...
    // URLSearchParams decodes the token for us, so read only a bounded numeric
    // `exp` field from that value. Without this, every fresh preview appeared
    // expired immediately and neither the server nor client could reuse it.
    if (!seconds) {
      const signedToken = parsed.searchParams.get("hdnea") || "";
      const signedExpiry = signedToken.match(/(?:^|[~&])exp=(\d{10,13})(?:[~&]|$)/i);
      seconds = Number(signedExpiry?.[1]) || 0;
    }
  } catch {}
  if (!seconds) {
    const match = raw.match(/(?:^|[?&~])exp(?:=|%3D)(\d{10,13})/i);
    seconds = Number(match?.[1]) || 0;
  }
  const providerExpiry = seconds > 1e12 ? seconds : seconds * 1000;
  const safeProviderExpiry = providerExpiry > now ? providerExpiry - 60_000 : now;
  return Math.min(now + DEEZER_PREVIEW_MAX_TTL_MS, safeProviderExpiry || now + DEEZER_PREVIEW_MAX_TTL_MS);
}

export async function getFreshDeezerPreview(title, artist, { fetchImpl = fetch } = {}) {
  const key = JSON.stringify([normName(artist), normName(title)]);
  const hit = previewCache.get(key);
  if (hit?.expiresAt > Date.now()) return { ...hit.data, status: "cached" };
  const exactQuery = `track:"${title}"${artist ? ` artist:"${artist}"` : ""}`;
  let data = await providerJson("Deezer", `https://api.deezer.com/search?q=${encodeURIComponent(exactQuery)}&limit=10`, { fetchImpl });
  let selected = selectDeezerTrack(title, artist, data?.data || []);
  if (!selected) {
    data = await providerJson("Deezer", `https://api.deezer.com/search?q=${encodeURIComponent(`${artist || ""} ${title}`.trim())}&limit=10`, { fetchImpl });
    selected = selectDeezerTrack(title, artist, data?.data || []);
  }
  const track = selected?.track;
  const result = {
    preview: track?.preview || null,
    url: track?.link || null,
    title: track?.title || null,
    artist: track?.artist?.name || null,
    confidence: selected ? Math.min(1, selected.score / 115) : 0,
  };
  const expiresAt = playbackUrlExpiry(result.preview);
  if (result.preview && expiresAt > Date.now()) previewCache.set(key, { data: result, expiresAt });
  return { ...result, status: result.preview ? "fresh" : "not_found", expiresAt: result.preview ? expiresAt : null };
}

export function spotifyCatalogueTrackProof({ sourceId, title, artist }) {
  const id = String(sourceId || "").trim();
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) return null;
  const requestedArtist = normalizeTrackIdentityText(artist);
  const requestedTitles = youtubeTitleCreditCandidates(title);
  if (!requestedArtist || !requestedTitles.length) return null;
  const compatible = [];
  for (const song of getSongIndex()) {
    if (String(song?.provider || "").toLowerCase() !== "spotify" || String(song?.sourceId || "") !== id) continue;
    if (normalizeTrackIdentityText(song.artist) !== requestedArtist) continue;
    const authoritativeTitles = youtubeTitleCreditCandidates(song.title, song.artist);
    const shared = authoritativeTitles.find((candidate) => requestedTitles.some((requested) => requested.base === candidate.base));
    if (!shared) continue;
    const explicitRequestedCredits = requestedTitles.filter((entry) => entry.credits).map((entry) => entry.credits);
    if (explicitRequestedCredits.length && !explicitRequestedCredits.includes(shared.credits)) continue;
    // The bundled Spotify catalogue carries exact track IDs and authoritative
    // titles, but currently no durations. Duration strengthens a proof when an
    // enriched row has one; its absence must not invalidate the exact source
    // identity shared by every production catalogue row.
    const durationSec = Math.max(0, Number(song.duration) || 0);
    compatible.push({
      titleBase: shared.base,
      credits: shared.credits,
      durationSec,
    });
  }
  const distinct = [...new Map(compatible.map((entry) => [JSON.stringify(entry), entry])).values()];
  if (distinct.length !== 1) return null;
  const match = distinct[0];
  return {
    verified: true,
    featuredCredits: match.credits ? match.credits.split("|") : [],
    durationSec: match.durationSec,
    provider: "spotify",
    sourceId: id,
  };
}

async function providerTrackCreditProof({ sourceProvider, sourceId, title, artist, fetchImpl }) {
  const provider = String(sourceProvider || "").toLowerCase();
  if (provider === "spotify") return spotifyCatalogueTrackProof({ sourceId, title, artist });
  if (provider !== "deezer" || !/^\d{1,20}$/.test(String(sourceId || ""))) return null;
  const key = `deezer:track-credit:v2:${sourceId}:${JSON.stringify([
    normalizeTrackIdentityText(artist),
    normalizeTrackIdentityText(title),
  ])}`;
  const cached = readProviderCache(key);
  if (cached?.fresh) return cached.data || null;
  let data;
  try {
    data = await providerJson("Deezer", `https://api.deezer.com/track/${sourceId}`, { fetchImpl, timeoutMs: 6_000 });
  } catch {
    return null;
  }
  const requestedBase = youtubeTitleCreditCandidates(title)[0]?.base || "";
  const providerBase = youtubeTitleCreditCandidates(data?.title || "")[0]?.base || "";
  const requestedArtist = normalizeTrackIdentityText(artist);
  const providerArtist = normalizeTrackIdentityText(data?.artist?.name);
  if (!requestedBase || requestedBase !== providerBase || !requestedArtist || requestedArtist !== providerArtist) return null;
  const featuredCredits = (Array.isArray(data?.contributors) ? data.contributors : [])
    .filter((entry) => String(entry?.role || "").toLowerCase() === "featured" && entry?.name)
    .map((entry) => String(entry.name));
  const proof = {
    verified: true,
    featuredCredits,
    durationSec: Math.max(0, Number(data?.duration) || 0),
    provider: "deezer",
    sourceId: String(sourceId),
  };
  writeProviderCache(key, proof, days(1));
  return proof;
}

export function parseIsoDuration(value) {
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
}

export function scoreYouTubeCandidate(candidate, {
  title,
  artist,
  expectedDurationSec = 0,
  trustedChannel = false,
  providerFeaturedCredits = [],
  requireDurationMatch = false,
} = {}) {
  const snippet = candidate?.snippet || {};
  const status = candidate?.status || {};
  const rawTitle = String(snippet.title || "");
  const channel = String(snippet.channelTitle || "");
  const requested = `${artist || ""} ${title || ""}`;
  const combined = `${rawTitle} ${channel}`;
  const reasons = [];
  const duration = parseIsoDuration(candidate?.contentDetails?.duration);
  if (status.madeForKids === true) {
    return { score: -Infinity, rejected: true, reasons: ["child-directed"] };
  }
  if (!candidate?.id || status.embeddable === false || (status.privacyStatus && status.privacyStatus !== "public")) {
    return { score: -Infinity, rejected: true, reasons: ["not-embeddable"] };
  }
  const hardNoise = /\b(karaoke|tribute|reaction|tutorial|how to play|nightcore|8d audio)\b/i;
  if (hardNoise.test(combined) && !hardNoise.test(requested)) return { score: -Infinity, rejected: true, reasons: ["low-quality-variant"] };
  // A requested studio song must never silently turn into a mashup, medley,
  // cover, remix, fan edit, or tempo-altered upload. Check the requested TITLE
  // (not the artist name) for an explicit variant request; an act called
  // "Remix" or "Cover Drive" is not consent to play a different recording.
  const candidateTitle = [...canonicalYouTubeTitleCandidates(rawTitle, artist)]
    .sort((left, right) => left.length - right.length)[0] || normalizeYouTubeMatchText(rawTitle);
  const candidateVersionText = canonicalYouTubeSongTitle(rawTitle, artist);
  const requestedTitle = canonicalYouTubeSongTitle(title);
  const variantRules = [
    ["mashup", /\b(?:mashup|mash up)\b/],
    ["medley", /\bmedley\b/],
    ["cover", /\bcover\b/],
    ["remix-variant", /\bremix\b/],
    ["remix-variant", /\brework\b/],
    ["remix-variant", /\bbootleg\b/],
    ["remix-variant", /\bflip\b/],
    ["remix-variant", /\bedit\b/],
    ["alternate-recording", /\binstrumental\b/],
    ["alternate-recording", /\bsped up\b/],
    ["alternate-recording", /\bslowed\b/],
    ["alternate-recording", /\breverb\b/],
    ["alternate-recording", /\blive\b/],
    ["alternate-recording", /\bacoustic\b/],
    ["alternate-recording", /\bdemo\b/],
    ["alternate-recording", /\bremaster(?:ed)?\b/],
    ["alternate-recording", /\bclean\b/],
  ];
  for (const [reason, pattern] of variantRules) {
    if (pattern.test(candidateVersionText) && !pattern.test(requestedTitle)) {
      return { score: -Infinity, rejected: true, reasons: [reason] };
    }
  }

  const artistCoverage = artist ? youtubeMatchCoverage(artist, channel) : 1;

  // Hard CREATOR gate. The old gate accepted a video if the artist name appeared
  // ANYWHERE in the title or channel, so "Tory Lanez - X (feat. Nelly Furtado)"
  // or a random channel that just name-drops the artist passed, which put the
  // wrong act's songs on artist pages. Instead the uploader must credibly BE the
  // artist: the channel itself must be the exact artist, their Topic/VEVO
  // channel, or a narrowly named official/music channel. A title that LEADS
  // with the artist is not creator proof: any unrelated uploader can write
  // "Artist - Song", which is how an HNM Magazine mashup was cached for J. Cole.
  // Everything else is rejected and playback falls back to the correct-artist
  // preview rather than guessing.
  let channelIsArtist = false;
  // The candidate came from the artist's OWN channel, so the creator is already
  // proven; only the song identity still has to be checked below.
  if (trustedChannel) {
    channelIsArtist = true;
  } else if (artist) {
    // One exact ranker handles short, Unicode, and symbol-only artist names;
    // title formatting alone is never creator proof.
    channelIsArtist = collaboratorChannelRank(
      artist,
      channel,
      rawTitle,
      !!candidate?.contentDetails?.licensedContent,
    ) >= 70;
    if (!channelIsArtist) {
      return { score: -Infinity, rejected: true, reasons: ["wrong-creator"] };
    }
  }

  // Hard title gate. Creator proof is not song proof: after stripping only
  // recognized presentation/credit wrappers, the title must be exact. This
  // prevents one-token songs such as U2's "One" from resolving to "One Tree
  // Hill" merely because the latter starts with the same word.
  let titleExact = true;
  if (title) {
    const requestedIdentities = youtubeTitleCreditCandidates(title);
    const candidateIdentities = youtubeTitleCreditCandidates(rawTitle, artist);
    titleExact = requestedIdentities.some((wanted) => candidateIdentities.some((found) => sameYouTubeRecordingIdentity(wanted, found)));
    if (!titleExact) {
      const providerProvesCredits = providerOmittedCreditMatch(title, rawTitle, artist, providerFeaturedCredits);
      const expected = Number(expectedDurationSec) || 0;
      const durationClose = expected > 0 && duration > 0 && Math.abs(duration - expected) / expected <= 0.12;
      if (!providerProvesCredits || !candidate?.contentDetails?.licensedContent || !durationClose) {
        return { score: -Infinity, rejected: true, reasons: ["title-mismatch"] };
      }
      titleExact = true;
      reasons.push("provider-omitted-feature-credit");
    }
  }

  const expected = Number(expectedDurationSec) || 0;
  if (requireDurationMatch && expected > 0
    && (!duration || Math.abs(duration - expected) / expected > 0.12)) {
    return { score: -Infinity, rejected: true, reasons: ["source-duration-mismatch"] };
  }

  let score = (titleExact ? 45 : 0) + artistCoverage * 28;
  // The uploader being the artist is the strongest correctness signal, so weight
  // it heavily above title-only matches.
  if (channelIsArtist) { score += 22; reasons.push("artist-channel"); }
  if (requestedTitle && candidateTitle.includes(requestedTitle)) { score += 18; reasons.push("title-match"); }
  if (/\bofficial (audio|music video|video|visualizer)\b/i.test(rawTitle)) { score += 24; reasons.push("official"); }
  if (/\bvevo\b/i.test(channel) || /\btopic\b/i.test(channel)) { score += 24; reasons.push("verified-channel-pattern"); }
  if (candidate?.contentDetails?.licensedContent) { score += 12; reasons.push("licensed"); }
  if (/\blyrics?\b/i.test(rawTitle)) {
    score -= 32;
    if (!candidate?.contentDetails?.licensedContent && !/\b(vevo|topic)\b/i.test(channel)) score -= 18;
    reasons.push("lyrics-penalty");
  }
  if (/\b(fan made|unofficial|sped up|slowed|reverb)\b/i.test(rawTitle)) { score -= 35; reasons.push("variant-penalty"); }
  score -= titleQualifierPenalty(title, rawTitle);

  if (expected > 0 && duration > 0) {
    const difference = Math.abs(duration - expected) / expected;
    if (difference <= 0.12) { score += 15; reasons.push("duration-close"); }
    else if (difference <= 0.3) score += 6;
    else if (difference > 0.55) { score -= 28; reasons.push("duration-mismatch"); }
  }
  const views = Number(candidate?.statistics?.viewCount) || 0;
  if (views > 0) score += Math.min(10, Math.log10(views + 1));
  return { score: Math.round(score * 10) / 10, rejected: score < YOUTUBE_SCORE_MIN, reasons, duration };
}

function rankedYouTubeCandidates(candidates, options) {
  return candidates
    .map((candidate) => ({ candidate, assessment: scoreYouTubeCandidate(candidate, options) }))
    .filter(({ assessment }) => !assessment.rejected)
    .sort((left, right) => right.assessment.score - left.assessment.score);
}

// A provider-scoped display title can omit recording credits. `null` already
// means "the candidates were inspected and none matched", so keep an unavailable
// source-identity proof distinct: it is a temporary inability to decide, never a
// structural YouTube miss that may be negative-cached for days.
const YOUTUBE_CREDIT_PROOF_UNAVAILABLE = Symbol("youtube-credit-proof-unavailable");

async function selectBestYouTubeCandidate(candidates, options, loadCreditProof, providerProofRequired = false) {
  const strict = rankedYouTubeCandidates(candidates, options);
  if (!providerProofRequired) return strict[0] || null;
  const proof = await loadCreditProof?.();
  if (!proof?.verified) return YOUTUBE_CREDIT_PROOF_UNAVAILABLE;
  const expectedCredits = normalizeYouTubeCreditSet((proof.featuredCredits || []).join(" & "));
  const requestedIdentities = youtubeTitleCreditCandidates(options.title);
  if (requestedIdentities.some((entry) => entry.credits)
    && !requestedIdentities.some((entry) => entry.credits === expectedCredits)) return null;
  const requestedBases = new Set(requestedIdentities.map((entry) => entry.base));
  const provedRecording = candidates.filter((candidate) => youtubeTitleCreditCandidates(
    candidate?.snippet?.title,
    options.artist,
  ).some((entry) => requestedBases.has(entry.base) && entry.credits === expectedCredits));
  const proofDuration = Math.max(0, Number(proof.durationSec) || 0);
  const expectedDurationSec = proofDuration || Math.max(0, Number(options.expectedDurationSec) || 0);
  return rankedYouTubeCandidates(provedRecording, {
    ...options,
    expectedDurationSec,
    providerFeaturedCredits: proof.featuredCredits,
    requireDurationMatch: expectedDurationSec > 0,
  })[0] || null;
}

async function selectSourceScopedTupleCandidate(candidate, options, loadCreditProof) {
  const proof = await loadCreditProof?.();
  if (!proof?.verified) return YOUTUBE_CREDIT_PROOF_UNAVAILABLE;
  const expectedCredits = normalizeYouTubeCreditSet((proof.featuredCredits || []).join(" & "));
  const requestedBases = new Set(youtubeTitleCreditCandidates(options.title).map((entry) => entry.base));
  const candidateMatchesSource = youtubeTitleCreditCandidates(candidate?.snippet?.title, options.artist)
    .some((entry) => requestedBases.has(entry.base) && entry.credits === expectedCredits);
  if (!candidateMatchesSource) return null;
  const proofDuration = Math.max(0, Number(proof.durationSec) || 0);
  const expectedDurationSec = proofDuration || Math.max(0, Number(options.expectedDurationSec) || 0);
  return rankedYouTubeCandidates([candidate], {
    ...options,
    expectedDurationSec,
    providerFeaturedCredits: proof.featuredCredits || [],
    requireDurationMatch: expectedDurationSec > 0,
  })[0] || null;
}

function creditProofUnavailable(selection) {
  return selection === YOUTUBE_CREDIT_PROOF_UNAVAILABLE;
}

function creditProofUnavailableResult() {
  // `provider_paused` is already a retryable client classification with a
  // short local TTL. Most importantly, this path never reaches setYouTubeCache.
  return { videoId: null, status: "provider_paused", retryable: true };
}

const YOUTUBE_CHANNEL_REFRESH_TTL_MS = days(14);
const YOUTUBE_CHANNEL_MISS_TTL_MS = days(Math.max(1, Math.min(30,
  Number(process.env.YOUTUBE_CHANNEL_MISS_TTL_DAYS) || 7)));

// Pick the artist's OWN channel out of channel search results. YouTube
// auto-generates an "<Artist> - Topic" channel that holds the official audio for
// their entire catalogue; VEVO and the plain verified channel come next. Ranked
// so an unrelated channel that merely contains the name can never win.
export function selectArtistChannel(artist, items = []) {
  if (!normalizeYouTubeCacheText(artist)) return null;
  let best = null;
  for (const item of items) {
    const channelId = item?.id?.channelId || item?.snippet?.channelId;
    const title = String(item?.snippet?.title || item?.snippet?.channelTitle || "");
    if (!channelId || !title) continue;
    const rank = creatorChannelRank(artist, title);
    if (rank && (!best || rank > best.rank)) best = { channelId, title, rank };
  }
  return best && best.rank >= 70 ? best : null;
}

// Channel identities are amortized across an artist, but API-derived mappings
// are refreshed within YouTube's 30-day storage window. Fruitless discoveries
// also expire so a newly-created Topic channel can eventually be found.
const YOUTUBE_CHANNEL_NEGATIVE_TTL_MS = YOUTUBE_POLICY_MAX_AGE_MS;

const channelSourceTrusted = (source) => source === "youtube_v4" || source === "wikidata_v4";
const channelSourceCurrent = (source) => channelSourceTrusted(source) || source === "youtube_unverified" || source === "wikidata_unverified";
const youtubeChannelCacheKey = (artist) => `yt:channel:v3:${normalizeYouTubeCacheText(artist)}`;

async function resolveArtistChannelUnshared(artist, apiKey, fetchImpl, {
  allowSearch = true,
  beforeSearch = null,
} = {}) {
  if (!artist) return null;
  const norm = normName(artist);
  const currentTime = Date.now();
  const row = artistStmts.byNorm.get(norm);
  const cacheKey = youtubeChannelCacheKey(artist);

  // Reuse a fresh stored mapping first. It survives catalogue reseeds, but is
  // never trusted forever: API-derived identity is refreshed within 30 days.
  // A bounded recorded miss prevents repeated cold requests while still
  // allowing newly-created channels to be discovered later.
  const stored = artistStmts.getChannel.get(norm);
  const storedAge = currentTime - Number(stored?.at || 0);
  if (stored?.channelId && storedAge < YOUTUBE_CHANNEL_REFRESH_TTL_MS && channelSourceCurrent(stored.source)) {
    youtubeMetrics.channelCacheHits += 1;
    return { channelId: stored.channelId, trusted: channelSourceTrusted(stored.source), source: stored.source || "legacy" };
  }
  if (!stored?.channelId && stored?.at && storedAge < YOUTUBE_CHANNEL_NEGATIVE_TTL_MS && channelSourceCurrent(stored.source)) {
    youtubeMetrics.channelNegativeCacheHits += 1;
    return null;
  }

  // Names outside PIT's seeded artist table still need durable reuse. The old
  // code wrote this provider cache but never read it on the happy path, spending
  // another channel search for every different track by the same unknown act.
  const providerCached = !stored?.channelId ? readProviderCache(cacheKey) : null;
  const providerCacheOperationallyFresh = providerCached?.fresh
    && (!providerCached.data?.refreshAt || Number(providerCached.data.refreshAt) > currentTime);
  if (providerCacheOperationallyFresh) {
    if (!providerCached.data?.channelId) {
      youtubeMetrics.channelNegativeCacheHits += 1;
      return null;
    }
    youtubeMetrics.channelCacheHits += 1;
    return {
      channelId: providerCached.data.channelId,
      trusted: Number(providerCached.data.rank) >= 80,
      source: "provider_cache",
    };
  }

  // Refresh a cached channel id with channels.list, not another search.list.
  // This matters for on-demand artists that have no row in PIT's seed table:
  // their identity still stays current without repeatedly spending the small
  // Search Queries bucket.
  if (!stored?.channelId && providerCached?.fresh && providerCached.data?.channelId) {
    try {
      const data = await youtubeJson("channels", {
        part: "snippet",
        id: providerCached.data.channelId,
        maxResults: "1",
      }, apiKey, fetchImpl);
      const item = data?.items?.[0];
      const ranked = item?.id === providerCached.data.channelId
        ? selectArtistChannel(artist, [{ id: { channelId: item.id }, snippet: item.snippet }])
        : null;
      if (ranked?.channelId) {
        const refreshed = {
          channelId: ranked.channelId,
          title: ranked.title,
          rank: Number(ranked.rank) || 0,
          refreshAt: Date.now() + YOUTUBE_CHANNEL_REFRESH_TTL_MS,
        };
        writeProviderCache(cacheKey, refreshed, YOUTUBE_POLICY_MAX_AGE_MS);
        return {
          channelId: refreshed.channelId,
          trusted: refreshed.rank >= 80,
          source: "provider_cache_refreshed",
        };
      }
    } catch (error) {
      if (error instanceof ProviderError && error.retryable) {
        youtubeMetrics.staleFallbacks += 1;
        return {
          channelId: providerCached.data.channelId,
          trusted: Number(providerCached.data.rank) >= 80,
          source: "provider_cache_stale",
        };
      }
    }
  }

  // Refresh old mappings with a cheap channels.list call. A Wikidata identity
  // is CC0 rather than YouTube API data, so it can remain a pointer during a
  // transient outage, but it stays untrusted unless the channel title agrees.
  if (stored?.channelId) {
    try {
      const data = await youtubeJson("channels", { part: "snippet", id: stored.channelId, maxResults: "1" }, apiKey, fetchImpl);
      const item = data?.items?.[0];
      if (item?.id === stored.channelId) {
        const ranked = selectArtistChannel(artist, [{ id: { channelId: item.id }, snippet: item.snippet }]);
        const trusted = Number(ranked?.rank) >= 80;
        if (String(stored.source || "").startsWith("wikidata")) {
          artistStmts.setWikidataChannel.run(stored.channelId, currentTime, trusted ? "wikidata_v4" : "wikidata_unverified", norm);
          return { channelId: stored.channelId, trusted, source: trusted ? "wikidata_v4" : "wikidata_unverified" };
        }
        if (trusted) {
          artistStmts.setChannel.run(stored.channelId, currentTime, "youtube_v4", norm);
          return { channelId: stored.channelId, trusted: true, source: "youtube_v4" };
        }
        // The current channel title no longer agrees with this artist. Clear
        // the stale search/legacy mapping and continue through discovery rather
        // than perpetuating a poisoned channel because it was once stored.
        artistStmts.clearChannel.run(norm);
      } else {
        artistStmts.clearChannel.run(norm);
      }
    } catch (error) {
      if (String(stored.source || "").startsWith("wikidata")) {
        // The Wikidata channel pointer is CC0 and can remain, but a YouTube title
        // validation older than the 30-day API-data window is no longer trusted.
        const withinPolicy = storedAge < YOUTUBE_POLICY_MAX_AGE_MS;
        if (withinPolicy) youtubeMetrics.staleFallbacks += 1;
        return {
          channelId: stored.channelId,
          trusted: withinPolicy && stored.source === "wikidata_v4",
          source: withinPolicy ? stored.source : "wikidata_unverified",
        };
      }
      if (error instanceof ProviderError && error.retryable && storedAge < YOUTUBE_POLICY_MAX_AGE_MS) {
        youtubeMetrics.staleFallbacks += 1;
        return { channelId: stored.channelId, trusted: channelSourceTrusted(stored.source), source: `${stored.source || "legacy"}_stale` };
      }
      artistStmts.clearChannel.run(norm);
      if (providerPaused(error)) throw error;
    }
  }

  // Before spending a search, try Wikidata for free. Every catalogue artist and
  // every on-demand artist created from MusicBrainz carries an mbid, and
  // Wikidata maps mbid -> YouTube channel. This is what lets a deep cut that was
  // never in the catalogue (the ones that preview most) resolve without touching
  // the tiny daily search budget. Dynamic import avoids a static import cycle
  // (wikidataChannels imports youtubeJson from here).
  if (row?.mbid) {
    try {
      const { lookupChannelByMbid } = await import("./wikidataChannels.js");
      const fromWikidata = await lookupChannelByMbid(row.mbid, { artist, apiKey, fetchImpl });
      if (fromWikidata?.channelId) {
        const source = fromWikidata.validated ? "wikidata_v4" : "wikidata_unverified";
        artistStmts.setWikidataChannel.run(fromWikidata.channelId, Date.now(), source, norm);
        return { channelId: fromWikidata.channelId, trusted: !!fromWikidata.validated, source };
      }
    } catch { /* fall through to the search below */ }
  }

  // Normal cache warming must not consume the scarce interactive search bucket.
  if (!allowSearch) return null;

  try {
    const data = await youtubeSearchJson({
      part: "snippet", type: "channel", maxResults: String(YOUTUBE_SEARCH_MAX_RESULTS), q: `${artist} - Topic`,
    }, apiKey, fetchImpl, beforeSearch);
    const best = selectArtistChannel(artist, data?.items || []);
    // Persist to the artist row when we know this artist; the provider cache is
    // still written as a fallback for names not in the catalogue.
    const trusted = Number(best?.rank) >= 80;
    if (artistStmts.byNorm.get(norm)) {
      artistStmts.setChannel.run(best?.channelId || null, Date.now(), best?.channelId && !trusted ? "youtube_unverified" : "youtube_v4", norm);
    }
    writeProviderCache(cacheKey, {
      channelId: best?.channelId || null,
      title: best?.title || null,
      rank: Number(best?.rank) || 0,
      refreshAt: best ? Date.now() + YOUTUBE_CHANNEL_REFRESH_TTL_MS : null,
    },
      best ? YOUTUBE_POLICY_MAX_AGE_MS : YOUTUBE_CHANNEL_MISS_TTL_MS);
    return best?.channelId
      ? { channelId: best.channelId, trusted, source: trusted ? "youtube_v4" : "youtube_unverified" }
      : null;
  } catch (error) {
    if (providerPaused(error)) throw error;
    // Fall back to any provider-cache hit for artists not in the catalogue.
    const fallback = readProviderCache(cacheKey);
    return fallback?.fresh && fallback.data?.channelId
      ? { channelId: fallback.data.channelId, trusted: Number(fallback.data.rank) >= 80, source: "provider_cache" }
      : null;
  }
}

function resolveArtistChannel(artist, apiKey, fetchImpl, options = {}) {
  const key = JSON.stringify([
    normalizeYouTubeCacheText(artist),
    options.allowSearch === false ? "catalogue-only" : "interactive",
  ]);
  const existing = youtubeChannelInflight.get(key);
  if (existing) {
    youtubeMetrics.channelCoalesced += 1;
    return existing;
  }
  const pending = resolveArtistChannelUnshared(artist, apiKey, fetchImpl, options)
    .finally(() => { if (youtubeChannelInflight.get(key) === pending) youtubeChannelInflight.delete(key); });
  youtubeChannelInflight.set(key, pending);
  return pending;
}

const YOUTUBE_CATALOGUE_TTL_MS = days(7);
const YOUTUBE_CATALOGUE_MISS_TTL_MS = days(1);

// Match a requested song against the artist's own upload catalogue, locally and
// for free. Topic uploads are titled exactly the song name; official channels
// add "(Official Video)" and friends, so those words are stripped before
// comparing. Live/remix/karaoke variants are pushed down, never silently used.
export function selectCatalogueTrack(title, catalogue = []) {
  const wanted = youtubeTitleCreditCandidates(title);
  if (!wanted.length) return null;
  let best = null;
  for (const item of catalogue) {
    const raw = String(item?.title || "");
    const videoId = item?.videoId;
    if (!raw || !videoId) continue;
    const found = youtubeTitleCreditCandidates(raw);
    const score = wanted.some((requested) => found.some((candidate) => sameYouTubeRecordingIdentity(requested, candidate)))
      ? 100
      : Number.NEGATIVE_INFINITY;
    const adjusted = score - titleQualifierPenalty(title, raw)
      - (/\b(karaoke|cover|reaction|instrumental|tribute)\b/i.test(raw) ? 100 : 0);
    if (!best || adjusted > best.score) best = { videoId, title: raw, score: Math.round(adjusted * 10) / 10 };
  }
  return best && best.score >= 70 ? best : null;
}

function catalogueCreditFallbackTracks(title, catalogue = []) {
  const wanted = youtubeTitleCreditCandidates(title);
  if (!wanted.length || wanted.some((entry) => entry.credits)) return [];
  return catalogue.filter((item) => {
    if (!item?.videoId || !item?.title) return false;
    return youtubeTitleCreditCandidates(item.title).some((candidate) => (
      !!candidate.credits && wanted.some((requested) => requested.base === candidate.base)
    ));
  }).slice(0, 10);
}

// The artist's entire upload catalogue, fetched with the CHEAP endpoints:
// channels.list + playlistItems.list draw from the general API quota bucket;
// search.list has its own small call bucket. This preserves interactive search
// capacity and stops songs dropping back to a 30-second preview.
// Returns { items, complete }. `complete` means we walked the whole uploads
// playlist within the page cap, so the local scan has seen every video the
// Topic channel holds — and a subsequent in-channel API search would be pure
// wasted quota. Only a truncated catalogue (a very prolific artist past the
// page cap) can justify spending a search to look deeper.
async function getArtistCatalogueUnshared(artist, channelId, apiKey, fetchImpl) {
  // A channel id already is the canonical identity. Keying by the artist's
  // display spelling forked one uploads playlist into multiple cache rows.
  const key = `yt:catalogue:v3:${channelId}`;
  const currentTime = Date.now();
  const cached = readProviderCache(key);
  const cachedWithinPolicy = !!cached
    && cached.expiresAt > currentTime
    && currentTime - Number(cached.updatedAt) < YOUTUBE_POLICY_MAX_AGE_MS;
  const freshUntil = Number(cached?.data?.freshUntil)
    || (Number(cached?.updatedAt) + YOUTUBE_CATALOGUE_TTL_MS);
  if (cachedWithinPolicy && freshUntil > currentTime) {
    youtubeMetrics.catalogueCacheHits += 1;
    return { items: cached.data?.items || [], complete: cached.data?.complete !== false };
  }
  try {
    const channelData = await youtubeJson("channels", {
      part: "contentDetails", id: channelId,
    }, apiKey, fetchImpl);
    const uploads = channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    // No readable uploads playlist means we learned nothing about the channel's
    // contents, which is NOT the same as a complete catalogue missing the song.
    // Mark it incomplete so the in-channel search still runs as the fallback.
    if (!uploads) {
      writeProviderCache(key, {
        items: [],
        complete: false,
        freshUntil: Date.now() + YOUTUBE_CATALOGUE_MISS_TTL_MS,
      }, YOUTUBE_POLICY_MAX_AGE_MS);
      return { items: [], complete: false };
    }
    const items = [];
    let pageToken = "";
    let complete = true;
    for (let page = 0; page < YOUTUBE_CATALOGUE_MAX_PAGES; page++) {
      const params = { part: "snippet", playlistId: uploads, maxResults: "50" };
      if (pageToken) params.pageToken = pageToken;
      const data = await youtubeJson("playlistItems", params, apiKey, fetchImpl);
      for (const item of data?.items || []) {
        const videoId = item?.snippet?.resourceId?.videoId;
        const videoTitle = item?.snippet?.title;
        if (videoId && videoTitle) items.push({ videoId, title: videoTitle });
      }
      pageToken = data?.nextPageToken || "";
      if (!pageToken) break;
      // More pages remained when we hit the cap: the catalogue is truncated.
      if (page === YOUTUBE_CATALOGUE_MAX_PAGES - 1) complete = false;
    }
    // Empty catalogues are useful negative data too. Retain every successful
    // scan until the policy deadline, but refresh it operationally after seven
    // days (one day when empty) so removed/new uploads do not stay invisible.
    writeProviderCache(key, {
      items,
      complete,
      freshUntil: Date.now() + (items.length ? YOUTUBE_CATALOGUE_TTL_MS : YOUTUBE_CATALOGUE_MISS_TTL_MS),
    }, YOUTUBE_POLICY_MAX_AGE_MS);
    return { items, complete };
  } catch {
    if (cachedWithinPolicy) {
      youtubeMetrics.staleFallbacks += 1;
      return { items: cached?.data?.items || [], complete: cached?.data?.complete !== false };
    }
    return { items: [], complete: false };
  }
}

function getArtistCatalogue(artist, channelId, apiKey, fetchImpl) {
  const key = String(channelId || "");
  const existing = youtubeCatalogueInflight.get(key);
  if (existing) {
    youtubeMetrics.catalogueCoalesced += 1;
    return existing;
  }
  const pending = getArtistCatalogueUnshared(artist, channelId, apiKey, fetchImpl)
    .finally(() => { if (youtubeCatalogueInflight.get(key) === pending) youtubeCatalogueInflight.delete(key); });
  youtubeCatalogueInflight.set(key, pending);
  return pending;
}

// A JSON tuple keeps artist/title boundaries unambiguous. The earlier delimiter
// key collided for pairs such as (artist="a|b", title="c") and
// (artist="a", title="b|c"), which could replay another song's cached id.
export function youtubeCacheKey(title, artist, recordingIdentity = "") {
  const tuple = [
    normalizeYouTubeCacheText(artist),
    normalizeYouTubeCacheText(title),
  ];
  if (recordingIdentity) tuple.push(String(recordingIdentity));
  return `yt:v${YOUTUBE_MATCH_CACHE_VERSION}:${JSON.stringify(tuple)}`;
}

function versionedYouTubeCacheKey(version, title, artist, recordingIdentity = "") {
  const tuple = [
    normalizeYouTubeCacheText(artist),
    normalizeYouTubeCacheText(title),
  ];
  if (recordingIdentity) tuple.push(String(recordingIdentity));
  return `yt:v${version}:${JSON.stringify(tuple)}`;
}

function legacyYouTubeCacheKey(title, artist) {
  const normalizedArtist = normalizeYouTubeCacheText(artist);
  const normalizedTitle = normalizeYouTubeCacheText(title);
  if (normalizedArtist.includes("|") || normalizedTitle.includes("|")) return null;
  return `yt:v2:${normalizedArtist}|${normalizedTitle}`;
}

// Move prior resolver rows under the current identity without extending their
// retention. Their metadata deliberately has no current matchVersion, so a
// positive v2/v3 ID is NOT a cache hit or stale fallback: videos.list and the
// current scorer must validate it first. Ambiguous delimiter rows remain
// ignored and age out through the normal prune.
function readYouTubeCache(title, artist, recordingIdentity = "") {
  const key = youtubeCacheKey(title, artist, recordingIdentity);
  const current = ytStmts.get.get(key);
  if (current) return { key, hit: current };
  const legacyKeys = recordingIdentity ? [] : [
      versionedYouTubeCacheKey(YOUTUBE_MATCH_CACHE_VERSION - 1, title, artist),
      versionedYouTubeCacheKey(YOUTUBE_MATCH_CACHE_VERSION - 2, title, artist),
      legacyYouTubeCacheKey(title, artist),
    ].filter(Boolean);
  let legacyKey = null;
  let legacy = null;
  for (const candidateKey of legacyKeys) {
    const candidate = ytStmts.get.get(candidateKey);
    if (candidate) {
      legacyKey = candidateKey;
      legacy = candidate;
      break;
    }
  }
  if (!legacy || !legacyKey) return { key, hit: null };
  // A miss is meaningful only under the matcher version that produced it.
  // Promoting an older NULL row made songs rejected by the previous Unicode or
  // recording policy remain unavailable without ever reaching the corrected
  // catalogue/search path. Positives are retained solely for videos.list plus
  // current-policy validation below; old negatives are retired immediately.
  if (!legacy.video_id) {
    db.prepare("DELETE FROM yt_cache WHERE key=?").run(legacyKey);
    return { key, hit: null };
  }
  ytStmts.set.run({
    key,
    video_id: legacy.video_id,
    updated_at: legacy.updated_at,
    metadata: legacy.metadata,
    score: legacy.score,
    expires_at: legacy.expires_at,
    rejected_ids: legacy.rejected_ids || "[]",
  });
  db.prepare("DELETE FROM yt_cache WHERE key=?").run(legacyKey);
  return { key, hit: ytStmts.get.get(key) };
}

function rejectedSet(row) {
  try { return new Set(JSON.parse(row?.rejected_ids || "[]").filter((id) => typeof id === "string")); }
  catch { return new Set(); }
}

function setYouTubeCache({ key, videoId, metadata = null, score = null, expiresAt, rejected = [] }) {
  const versionedMetadata = metadata
    ? { ...metadata, matchVersion: YOUTUBE_MATCH_CACHE_VERSION }
    : null;
  ytStmts.set.run({
    key,
    video_id: videoId || null,
    updated_at: Date.now(),
    metadata: versionedMetadata ? JSON.stringify(versionedMetadata) : null,
    score: Number.isFinite(score) ? score : null,
    expires_at: expiresAt,
    rejected_ids: JSON.stringify([...rejected].slice(-25)),
  });
}

// When a retired cache row fails the current scorer, retain its ID only as a
// bounded exclusion and preserve the original timestamps. The public route
// first attempts a catalogue-only resolution and then, for a verified user, an
// interactive search; persisting here prevents those two phases from spending
// two videos.list calls validating the same known-bad recording.
function rememberRejectedCachedMatch(key, row, rejected) {
  if (!row?.video_id) return;
  const updatedAt = Number(row.updated_at) || Date.now();
  ytStmts.set.run({
    key,
    video_id: row.video_id,
    updated_at: updatedAt,
    metadata: row.metadata || null,
    score: Number.isFinite(row.score) ? row.score : null,
    expires_at: Number(row.expires_at) || (updatedAt + YOUTUBE_POLICY_MAX_AGE_MS),
    rejected_ids: JSON.stringify([...rejected].slice(-25)),
  });
}

let lastProviderPruneAt = 0;
export function pruneExpiredProviderData(at = Date.now(), { force = false } = {}) {
  if (!force && at - lastProviderPruneAt < 60 * 60 * 1000) {
    return {
      youtube: 0,
      provider: 0,
      artistChannels: 0,
      artistValidations: 0,
      wikidataValidations: 0,
      playbackFailures: 0,
      skipped: true,
    };
  }
  lastProviderPruneAt = at;
  const youtube = ytStmts.deleteExpired.run(at, at - days(30)).changes;
  const provider = providerCacheStmts.deleteExpired.run(at).changes;
  // Artist rows are another API-data cache. Clear both positive mappings and
  // recorded misses after 30 days when their provenance is YouTube/legacy.
  const artistChannels = db.prepare(`UPDATE artists
    SET youtube_channel_id=NULL,youtube_channel_at=0,youtube_channel_source=NULL
    WHERE youtube_channel_at > 0 AND youtube_channel_at <= ?
      AND COALESCE(youtube_channel_source,'') NOT LIKE 'wikidata%'`).run(at - YOUTUBE_POLICY_MAX_AGE_MS).changes;
  // A Wikidata channel pointer is CC0 and may remain, but `source='wikidata'`
  // means PIT validated its title/existence with YouTube API data. Downgrade
  // that dormant trust marker and erase its validation timestamp at 30 days.
  const artistValidations = db.prepare(`UPDATE artists
    SET youtube_channel_at=0,youtube_channel_source='wikidata_unverified'
    WHERE youtube_channel_id IS NOT NULL
      AND youtube_channel_at > 0 AND youtube_channel_at <= ?
      AND youtube_channel_source LIKE 'wikidata%'`).run(at - YOUTUBE_POLICY_MAX_AGE_MS).changes;
  // The shared MBID cache carries the same YouTube-derived validation bit.
  // Preserve its CC0 MBID -> channel pointer, but persistently erase trust and
  // age so the next access performs a fresh provider check.
  const wikidataValidations = db.prepare(`UPDATE wikidata_channel_checks
    SET validated=0,checked_at=0
    WHERE checked_at > 0 AND checked_at <= ?`).run(at - YOUTUBE_POLICY_MAX_AGE_MS).changes;
  const playbackFailures = db.prepare("DELETE FROM youtube_playback_failures WHERE created_at <= ?")
    .run(at - YOUTUBE_POLICY_MAX_AGE_MS).changes;
  return {
    youtube,
    provider,
    artistChannels,
    artistValidations,
    wikidataValidations,
    playbackFailures,
    skipped: false,
  };
}

// A restart is an inexpensive opportunity to remove dormant expired API data;
// the daily warmer also calls this for long-running processes.
pruneExpiredProviderData(Date.now(), { force: true });

function youtubeUrl(path, params, apiKey) {
  const query = new URLSearchParams({ ...params, key: apiKey });
  return `https://www.googleapis.com/youtube/v3/${path}?${query.toString()}`;
}

export async function youtubeJson(path, params, apiKey, fetchImpl, timeoutMs = 8_000, { beforeRequest = null } = {}) {
  const bucket = path === "search" ? "search" : "data";
  const circuit = youtubeCircuits[bucket];
  if (circuit.until > Date.now()) {
    throw new ProviderError("YouTube", 503, `${bucket === "search" ? "YouTube search" : "YouTube catalogue lookups"} are cooling down after a provider limit.`, {
      code: "provider_paused",
      retryable: true,
    });
  }
  if (path === "search") {
    // Reserve shared provider capacity before charging an actor. If their
    // account/IP permit is denied, release the shared reservation because no
    // request can reach YouTube. This ordering also guarantees that an open
    // circuit or exhausted global bucket never burns a listener's allowance.
    const reservation = reserveYouTubeSearch();
    try {
      if (typeof beforeRequest === "function") await beforeRequest();
    } catch (error) {
      releaseYouTubeSearch(reservation);
      throw error;
    }
  } else youtubeMetrics.dataCalls += 1;
  try {
    return await providerJson("YouTube", youtubeUrl(path, params, apiKey), { fetchImpl, timeoutMs });
  } catch (error) {
    if (error instanceof ProviderError && ["quota_or_forbidden", "rate_limited"].includes(error.code)) {
      circuit.until = Date.now() + (error.code === "rate_limited" ? 60_000 : 15 * 60_000);
      circuit.code = error.code;
    }
    throw error;
  }
}

async function youtubeSearchJson(params, apiKey, fetchImpl, beforeSearch = null) {
  // The route can attach an account/IP demand permit. It is evaluated lazily so
  // cached, catalogue, Wikidata, and coalesced requests consume no user budget.
  if (youtubeCircuits.data.until > Date.now()) {
    throw new ProviderError("YouTube", 503, "YouTube catalogue validation is cooling down after a provider limit.", {
      code: "provider_paused",
      retryable: true,
    });
  }
  return youtubeJson("search", params, apiKey, fetchImpl, 8_000, { beforeRequest: beforeSearch });
}

async function youtubeVideos(ids, apiKey, fetchImpl) {
  if (!ids.length) return [];
  const data = await youtubeJson("videos", {
    part: "snippet,contentDetails,status,statistics",
    id: ids.join(","),
  }, apiKey, fetchImpl);
  return data?.items || [];
}

function resolveYouTubeTrackReadOnly(title, artist, {
  excludedVideoIds = [],
  sourceProvider = "",
  sourceId = "",
} = {}) {
  const currentTime = Date.now();
  const recordingIdentity = youtubeRecordingIdentity(sourceProvider, sourceId);
  // Spotify has no public data endpoint in this service. Its exact local
  // catalogue row is therefore the only recording proof. Unknown IDs must not
  // inherit a same-display tuple cache entry (for example, a feature recording
  // masquerading as the solo), even on the read-only phase.
  if (recordingIdentity.startsWith("spotify:")
    && !spotifyCatalogueTrackProof({ sourceId, title, artist })?.verified) {
    return { videoId: null, status: "search_deferred" };
  }
  const key = youtubeCacheKey(title, artist, recordingIdentity);
  const hit = ytStmts.get.get(key);
  const excluded = new Set((excludedVideoIds || [])
    .map(String)
    .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)));
  let metadata = null;
  try { metadata = hit?.metadata ? JSON.parse(hit.metadata) : null; }
  catch { metadata = null; }
  const updatedAt = Number(hit?.updated_at) || 0;
  const configuredDeadline = Number(hit?.expires_at) || (updatedAt + YOUTUBE_POLICY_MAX_AGE_MS);
  const policyDeadline = Math.min(configuredDeadline, updatedAt + YOUTUBE_POLICY_MAX_AGE_MS);
  const withinPolicy = !!hit && updatedAt > 0 && currentTime < policyDeadline;
  const rejected = rejectedSet(hit);
  if (hit?.video_id
    && withinPolicy
    && metadata?.matchVersion === YOUTUBE_MATCH_CACHE_VERSION
    && !metadata?.invalidated
    && !excluded.has(hit.video_id)
    && !rejected.has(hit.video_id)) {
    const operationallyFresh = currentTime < updatedAt + YOUTUBE_MATCH_REFRESH_TTL_MS;
    return operationallyFresh
      ? { videoId: hit.video_id, status: "cached", confidence: hit.score ?? null }
      : { videoId: hit.video_id, status: "stale", stale: true, confidence: hit.score ?? null };
  }
  if (hit && !hit.video_id && withinPolicy && !metadata?.invalidated) {
    return { videoId: null, status: "not_found" };
  }

  // Source-scoped identities need provider credit proof, which belongs on the
  // explicit POST phase. A plain tuple can still use a fresh local catalogue
  // from a currently trusted artist channel without network or persistence.
  if (!recordingIdentity && artist) {
    const norm = normName(artist);
    const stored = artistStmts.getChannel.get(norm);
    const storedCurrent = stored?.channelId
      && channelSourceTrusted(stored.source)
      && currentTime - Number(stored.at || 0) < YOUTUBE_CHANNEL_REFRESH_TTL_MS;
    const providerChannel = !storedCurrent ? readProviderCache(youtubeChannelCacheKey(artist)) : null;
    const providerCurrent = providerChannel?.fresh
      && providerChannel.data?.channelId
      && Number(providerChannel.data.rank) >= 80
      && (!providerChannel.data.refreshAt || Number(providerChannel.data.refreshAt) > currentTime);
    const channelId = storedCurrent ? stored.channelId : providerCurrent ? providerChannel.data.channelId : null;
    if (channelId) {
      const catalogue = readProviderCache(`yt:catalogue:v3:${channelId}`);
      const catalogueCurrent = catalogue?.fresh
        && Number(catalogue.data?.freshUntil || 0) > currentTime;
      if (catalogueCurrent) {
        const picked = selectCatalogueTrack(title, catalogue.data?.items || []);
        if (picked?.videoId
          && /^[A-Za-z0-9_-]{11}$/.test(picked.videoId)
          && !excluded.has(picked.videoId)) {
          return { videoId: picked.videoId, status: "artist_catalogue_cached", confidence: picked.score };
        }
      }
    }
  }
  return { videoId: null, status: "search_deferred" };
}

async function resolveYouTubeTrackUnshared(title, artist, {
  expectedDurationSec = 0,
  fetchImpl = fetch,
  apiKey = process.env.YOUTUBE_API_KEY,
  allowSearch = true,
  readOnly = false,
  beforeSearch = null,
  excludedVideoIds = [],
  sourceProvider = "",
  sourceId = "",
} = {}) {
  if (readOnly) {
    return resolveYouTubeTrackReadOnly(title, artist, {
      excludedVideoIds,
      sourceProvider,
      sourceId,
    });
  }
  const currentTime = Date.now();
  pruneExpiredProviderData(currentTime);
  const recordingIdentity = youtubeRecordingIdentity(sourceProvider, sourceId);
  const spotifyProof = recordingIdentity.startsWith("spotify:")
    ? spotifyCatalogueTrackProof({ sourceId, title, artist })
    : null;
  // A caller-provided Spotify ID is never proof by itself. Fail closed before
  // any cache read so an unknown/ambiguous ID cannot observe, promote, or write
  // a tuple-level positive for a different recording.
  if (recordingIdentity.startsWith("spotify:") && !spotifyProof?.verified) {
    return { videoId: null, status: "search_deferred" };
  }
  const providerProofRequired = recordingIdentity.startsWith("spotify:")
    || (!!recordingIdentity && youtubeTitleCreditCandidates(title).every((entry) => !entry.credits));
  const cacheRead = readYouTubeCache(title, artist, recordingIdentity);
  const { key } = cacheRead;
  let hit = cacheRead.hit;
  let creditProofPromise = spotifyProof ? Promise.resolve(spotifyProof) : null;
  const loadCreditProof = () => {
    if (!recordingIdentity) return Promise.resolve(null);
    if (!creditProofPromise) {
      creditProofPromise = providerTrackCreditProof({ sourceProvider, sourceId, title, artist, fetchImpl });
    }
    return creditProofPromise;
  };
  const positiveExpiry = (assessment) => currentTime + (
    assessment?.reasons?.includes("provider-omitted-feature-credit") ? days(1) : YOUTUBE_POLICY_MAX_AGE_MS
  );
  const actorExcluded = new Set();
  for (const id of excludedVideoIds) {
    if (/^[A-Za-z0-9_-]{11}$/.test(String(id || ""))) actorExcluded.add(String(id));
  }

  // Source-scoped provider identities were introduced after the tuple cache had
  // already accumulated safe v5 positives. Do not make those tracks cold again:
  // a current tuple positive may seed the exact recording key only after a fresh
  // videos.list read passes today's scorer and the source-specific recording
  // proof. Tuple negatives are never promoted, and a feature/solo mismatch
  // simply falls through to exact catalogue/search resolution.
  if (!hit && recordingIdentity && apiKey && !actorExcluded.size) {
    const tupleHit = ytStmts.get.get(youtubeCacheKey(title, artist));
    let tupleMetadata = null;
    try { tupleMetadata = tupleHit?.metadata ? JSON.parse(tupleHit.metadata) : null; }
    catch { tupleMetadata = null; }
    const tupleUpdatedAt = Number(tupleHit?.updated_at) || 0;
    const tupleConfiguredDeadline = Number(tupleHit?.expires_at) || (tupleUpdatedAt + YOUTUBE_POLICY_MAX_AGE_MS);
    const tuplePolicyDeadline = Math.min(tupleConfiguredDeadline, tupleUpdatedAt + YOUTUBE_POLICY_MAX_AGE_MS);
    const tupleRejected = rejectedSet(tupleHit);
    const tuplePositiveIsCurrent = !!tupleHit?.video_id
      && tupleMetadata?.matchVersion === YOUTUBE_MATCH_CACHE_VERSION
      && !tupleMetadata?.invalidated
      && tupleUpdatedAt > 0
      && currentTime < tuplePolicyDeadline
      && !tupleRejected.has(tupleHit.video_id);
    if (tuplePositiveIsCurrent) {
      try {
        const candidate = (await youtubeVideos([tupleHit.video_id], apiKey, fetchImpl))[0];
        const selected = candidate ? await selectSourceScopedTupleCandidate(
          candidate,
          { title, artist, expectedDurationSec },
          loadCreditProof,
        ) : null;
        if (creditProofUnavailable(selected)) return creditProofUnavailableResult();
        if (selected?.assessment) {
          const assessment = selected.assessment;
          setYouTubeCache({
            key,
            videoId: selected.candidate.id,
            metadata: {
              title: selected.candidate.snippet?.title || null,
              channel: selected.candidate.snippet?.channelTitle || null,
              reasons: [...assessment.reasons, "tuple-positive-promoted"],
              duration: assessment.duration,
            },
            score: assessment.score,
            expiresAt: positiveExpiry(assessment),
            rejected: [],
          });
          hit = ytStmts.get.get(key);
        }
      } catch (error) {
        // A tuple is only an optimization. Provider/data failures must not turn
        // it into source authority; continue through the exact resolver paths.
        if (providerPaused(error)) throw error;
      }
    }
  }
  let cachedMetadata = null;
  try { cachedMetadata = hit?.metadata ? JSON.parse(hit.metadata) : null; }
  catch { cachedMetadata = null; }
  const updatedAt = Number(hit?.updated_at) || 0;
  const configuredDeadline = Number(hit?.expires_at) || (updatedAt + YOUTUBE_POLICY_MAX_AGE_MS);
  const policyDeadline = Math.min(configuredDeadline, updatedAt + YOUTUBE_POLICY_MAX_AGE_MS);
  const withinPolicy = !!hit && updatedAt > 0 && currentTime < policyDeadline;
  const globalRejected = withinPolicy ? rejectedSet(hit) : new Set();
  const rejected = new Set([...globalRejected, ...actorExcluded]);
  // Actor exclusions originate in an untrusted client report. They may shape
  // only this listener's response; persisting any positive, negative, or
  // rejected-id result would let one account rewrite global playback state.
  const cacheResult = (value) => {
    if (!actorExcluded.size) setYouTubeCache(value);
  };
  const usableCachedMatch = !!hit?.video_id
    && !!cachedMetadata
    && cachedMetadata.matchVersion === YOUTUBE_MATCH_CACHE_VERSION
    && !cachedMetadata.invalidated
    && !rejected.has(hit.video_id)
    && withinPolicy;
  const cachedMatchFresh = usableCachedMatch
    && currentTime < updatedAt + YOUTUBE_MATCH_REFRESH_TTL_MS;
  if (cachedMatchFresh) {
    youtubeMetrics.trackCacheHits += 1;
    return { videoId: hit.video_id, status: "cached", confidence: hit.score ?? null };
  }
  if (!hit?.video_id && hit && withinPolicy && !cachedMetadata?.invalidated) {
    youtubeMetrics.trackNegativeCacheHits += 1;
    return { videoId: null, status: "not_found" };
  }
  const staleResult = () => {
    youtubeMetrics.staleFallbacks += 1;
    return { videoId: hit.video_id, status: "stale", stale: true, confidence: hit.score ?? null };
  };
  if (!apiKey) return usableCachedMatch ? staleResult() : { videoId: null, status: "unconfigured" };

  // A single listener resolution may spend at most one search.list request.
  // All cache, source-proof, Wikidata, channel-validation and catalogue work is
  // data-only. Once those paths are exhausted, the resolver deliberately picks
  // either a known channel search or a global search, never both.
  let searchUsed = false;
  const searchOnce = async (params) => {
    if (searchUsed) {
      throw new ProviderError("YouTube", 429, "This track already used its one YouTube search attempt.", {
        code: "search_resolution_budget_exhausted",
        retryable: false,
      });
    }
    searchUsed = true;
    return youtubeSearchJson(params, apiKey, fetchImpl, beforeSearch);
  };

  // Validate legacy cache rows cheaply with videos.list before trusting them.
  // Good IDs cost one quota unit to migrate; only a bad result burns a search.
  if (hit?.video_id && !rejected.has(hit.video_id)) {
    let legacy;
    try {
      legacy = (await youtubeVideos([hit.video_id], apiKey, fetchImpl))[0];
    } catch (error) {
      if (usableCachedMatch && error instanceof ProviderError && error.retryable) return staleResult();
      throw error;
    }
    if (legacy) {
      const selected = await selectBestYouTubeCandidate(
        [legacy],
        { title, artist, expectedDurationSec },
        loadCreditProof,
        providerProofRequired,
      );
      if (creditProofUnavailable(selected)) return creditProofUnavailableResult();
      const assessment = selected?.assessment || null;
      if (selected && assessment) {
        const metadata = { title: legacy.snippet?.title || null, channel: legacy.snippet?.channelTitle || null, reasons: assessment.reasons, duration: assessment.duration };
        cacheResult({ key, videoId: legacy.id, metadata, score: assessment.score, expiresAt: positiveExpiry(assessment), rejected });
        return { videoId: legacy.id, status: "validated", confidence: assessment.score };
      }
      globalRejected.add(hit.video_id);
      rejected.add(hit.video_id);
      rememberRejectedCachedMatch(key, hit, globalRejected);
    } else {
      globalRejected.add(hit.video_id);
      rejected.add(hit.video_id);
      rememberRejectedCachedMatch(key, hit, globalRejected);
    }
  }

  // PRIMARY PATH: inspect the mapped artist channel. A verified Topic/official
  // channel is the strongest identity signal; an unverified Wikidata mapping
  // still uses normal artist/title scoring so a bad public-data claim cannot
  // silently become a trusted wrong recording.
  // auto-generated "<Artist> - Topic" channel holds the official audio for their
  // whole catalogue, so a hit here cannot be a reaction video, a cover, or a
  // different act's song. This is what a blind keyword search could never
  // guarantee. Falls through to the global search when the artist has no
  // resolvable channel.
  if (artist) {
    // Channel discovery used to consume one search before the actual song
    // lookup and could turn one click into two or three actor charges. Only
    // cached/Wikidata/data-validated channel identities participate here; an
    // unmapped artist proceeds to the one global video search below.
    const channel = await resolveArtistChannel(artist, apiKey, fetchImpl, { allowSearch: false });
    if (channel?.channelId) {
      const channelId = channel.channelId;
      // Cheapest and most accurate: match against the artist's own catalogue,
      // pulled once per artist for ~5 quota units and reused for every song.
      let catalogueComplete = true;
      try {
        const { items: catalogue, complete } = await getArtistCatalogue(artist, channelId, apiKey, fetchImpl);
        catalogueComplete = complete;
        const availableCatalogue = catalogue.filter((item) => !rejected.has(item.videoId));
        const picked = selectCatalogueTrack(title, availableCatalogue);
        const possible = [...new Map([
          ...(picked ? [picked] : []),
          ...catalogueCreditFallbackTracks(title, availableCatalogue),
        ].map((entry) => [entry.videoId, entry])).values()];
        if (possible.length) {
          const verified = await youtubeVideos(possible.map((entry) => entry.videoId), apiKey, fetchImpl);
          const bestCatalogue = await selectBestYouTubeCandidate(
            verified,
            { title, artist, expectedDurationSec, trustedChannel: channel.trusted },
            loadCreditProof,
            providerProofRequired,
          );
          if (creditProofUnavailable(bestCatalogue)) return creditProofUnavailableResult();
          const assessment = bestCatalogue?.assessment || null;
          if (bestCatalogue && assessment) {
            youtubeMetrics.catalogueMatches += 1;
            const metadata = {
              title: bestCatalogue.candidate.snippet?.title || null,
              channel: bestCatalogue.candidate.snippet?.channelTitle || null,
              reasons: [...assessment.reasons, "artist-catalogue"],
              duration: assessment.duration,
            };
            cacheResult({ key, videoId: bestCatalogue.candidate.id, metadata, score: assessment.score, expiresAt: positiveExpiry(assessment), rejected });
            return { videoId: bestCatalogue.candidate.id, status: "artist_catalogue", confidence: assessment.score };
          }
        }
      } catch { /* fall through to the channel search below */ }

      // Only spend a search inside the channel if the local catalogue was
      // truncated and might be hiding the song. A complete catalogue that did
      // not contain it means the Topic channel does not have it, so the global
      // search below is the right next step, not a redundant in-channel one.
      if (allowSearch && !catalogueComplete) {
        const inChannel = await searchOnce({
          part: "snippet",
          type: "video",
          channelId,
          videoEmbeddable: "true",
          videoSyndicated: "true",
          maxResults: String(YOUTUBE_SEARCH_MAX_RESULTS),
          q: title,
        });
        const channelIds = (inChannel?.items || []).map((item) => item?.id?.videoId).filter((id) => id && !rejected.has(id));
        const bestInChannel = await selectBestYouTubeCandidate(
          await youtubeVideos(channelIds, apiKey, fetchImpl),
          { title, artist, expectedDurationSec, trustedChannel: channel.trusted },
          loadCreditProof,
          providerProofRequired,
        );
        if (creditProofUnavailable(bestInChannel)) return creditProofUnavailableResult();
        if (bestInChannel) {
          const metadata = {
            title: bestInChannel.candidate.snippet?.title || null,
            channel: bestInChannel.candidate.snippet?.channelTitle || null,
            reasons: bestInChannel.assessment.reasons,
            duration: bestInChannel.assessment.duration,
          };
          cacheResult({ key, videoId: bestInChannel.candidate.id, metadata, score: bestInChannel.assessment.score, expiresAt: positiveExpiry(bestInChannel.assessment), rejected });
          return { videoId: bestInChannel.candidate.id, status: "artist_channel", confidence: bestInChannel.assessment.score };
        }
        cacheResult({ key, videoId: null, expiresAt: currentTime + YOUTUBE_MISS_TTL_MS, rejected });
        return { videoId: null, status: "low_confidence" };
      }
    }
  }

  if (!allowSearch) return { videoId: null, status: "search_deferred" };

  const query = `${artist ? `${artist} ` : ""}${title} official audio -karaoke -cover -reaction -nightcore`;
  // A wider candidate pool (search quota is flat regardless of maxResults, and
  // videos.list is one cheap unit per batch) so the correct official upload is
  // in the set even when it ranks below noise on YouTube's own relevance sort.
  const search = await searchOnce({
    part: "snippet",
    type: "video",
    videoCategoryId: "10",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    maxResults: String(YOUTUBE_SEARCH_MAX_RESULTS),
    q: query,
  });
  const ids = (search?.items || []).map((item) => item?.id?.videoId).filter((id) => id && !rejected.has(id));
  const candidates = await youtubeVideos(ids, apiKey, fetchImpl);
  const best = await selectBestYouTubeCandidate(
    candidates,
    { title, artist, expectedDurationSec },
    loadCreditProof,
    providerProofRequired,
  );
  if (creditProofUnavailable(best)) return creditProofUnavailableResult();
  if (!best) {
    cacheResult({ key, videoId: null, expiresAt: currentTime + YOUTUBE_MISS_TTL_MS, rejected });
    return { videoId: null, status: "low_confidence" };
  }
  const metadata = {
    title: best.candidate.snippet?.title || null,
    channel: best.candidate.snippet?.channelTitle || null,
    reasons: best.assessment.reasons,
    duration: best.assessment.duration,
  };
  cacheResult({ key, videoId: best.candidate.id, metadata, score: best.assessment.score, expiresAt: positiveExpiry(best.assessment), rejected });
  return { videoId: best.candidate.id, status: "resolved", confidence: best.assessment.score };
}

// Collapse a cold-start stampede for the same song into one provider request.
// The database cache handles later requests and this map handles the vulnerable
// gap while the first request is still in flight.
export function resolveYouTubeTrack(title, artist, options = {}) {
  const durationBucket = Math.round((Number(options.expectedDurationSec) || 0) / 5) * 5;
  const excluded = [...new Set((options.excludedVideoIds || []).map(String))].sort().join(",");
  const recordingIdentity = youtubeRecordingIdentity(options.sourceProvider, options.sourceId);
  let demandScope = "shared";
  if (typeof options.beforeSearch === "function") {
    demandScope = String(options.demandScope || "").trim().slice(0, 120);
    if (!demandScope) {
      demandScope = youtubeDemandCallbackScopes.get(options.beforeSearch) || "";
      if (!demandScope) {
        youtubeDemandCallbackSequence += 1;
        demandScope = `callback-${youtubeDemandCallbackSequence}`;
        youtubeDemandCallbackScopes.set(options.beforeSearch, demandScope);
      }
    }
  }
  // Actor/IP denials are local demand decisions, not track facts. Partition
  // interactive in-flight work by the opaque demand scope so a capped leader
  // cannot make an eligible listener inherit its rejection. Calls without an
  // actor gate retain the existing same-track stampede protection.
  const resolutionMode = options.readOnly
    ? "read-only"
    : options.allowSearch === false ? "catalogue-only" : "interactive";
  const key = `${youtubeCacheKey(title, artist, recordingIdentity)}|${durationBucket}|${resolutionMode}|${excluded}|${demandScope}`;
  const existing = youtubeInflight.get(key);
  if (existing) {
    youtubeMetrics.trackCoalesced += 1;
    return existing;
  }
  const pending = resolveYouTubeTrackUnshared(title, artist, options)
    .finally(() => { if (youtubeInflight.get(key) === pending) youtubeInflight.delete(key); });
  youtubeInflight.set(key, pending);
  return pending;
}

export function invalidateYouTubeTrack(title, artist, videoId, {
  sourceProvider = "",
  sourceId = "",
} = {}) {
  const recordingIdentity = youtubeRecordingIdentity(sourceProvider, sourceId);
  const { key, hit: row } = readYouTubeCache(title, artist, recordingIdentity);
  const rejected = rejectedSet(row);
  if (videoId) rejected.add(String(videoId));
  const now = Date.now();
  ytStmts.invalidate.run(now, now + YOUTUBE_POLICY_MAX_AGE_MS, JSON.stringify([...rejected].slice(-25)), key);
  return { ok: true, invalidated: !!row, rejected: rejected.size };
}

// Trusted moderation writes do not need a rejection tombstone: the override is
// the new authority, and removing it must immediately hand control back to a
// fresh resolver pass. Delete every compatible tuple generation so an older
// row cannot be promoted after a staff correction; provider identities never
// had legacy cache formats and therefore clear only their exact current key.
export function clearYouTubeTrackCache(title, artist, {
  sourceProvider = "",
  sourceId = "",
} = {}) {
  const recordingIdentity = youtubeRecordingIdentity(sourceProvider, sourceId);
  const keys = [youtubeCacheKey(title, artist, recordingIdentity)];
  if (!recordingIdentity) {
    keys.push(
      versionedYouTubeCacheKey(YOUTUBE_MATCH_CACHE_VERSION - 1, title, artist),
      versionedYouTubeCacheKey(YOUTUBE_MATCH_CACHE_VERSION - 2, title, artist),
      legacyYouTubeCacheKey(title, artist),
    );
  }
  let cleared = 0;
  for (const key of new Set(keys.filter(Boolean))) cleared += ytStmts.delete.run(key).changes;
  return { ok: true, cleared };
}

// Song search for the app's search box, so someone who remembers a song but not
// the act can still find it. Deezer's search is keyless and costs no YouTube
// quota, which matters because YouTube search has a small separate daily call
// bucket; a video is only resolved later, if and when the song is played.
export async function searchDeezerTracks(query, { limit = 12, fetchImpl = fetch } = {}) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  const key = `dz:tracksearch:v1:${q.toLowerCase()}:${limit}`;
  const cached = readProviderCache(key);
  if (cached?.fresh) return cached.data?.items || [];

  // Two queries, because Deezer's plain relevance search drops the recording
  // most people mean: `q=bohemian rhapsody` returns 36 rows without Queen in
  // them at all, while the field-qualified `track:"bohemian rhapsody"` returns
  // Queen with the highest rank of any result. Plain search gives recall
  // (partial titles, artist names); the qualified one guarantees the canonical
  // version is in the pool. Both are keyless, and the result is cached.
  const urls = [
    `https://api.deezer.com/search?q=${encodeURIComponent(`track:"${q}"`)}&limit=25`,
    `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=25`,
  ];
  const responses = await Promise.allSettled(urls.map((url) => providerJson("Deezer", url, { fetchImpl })));
  const rows = responses.flatMap((r) => (r.status === "fulfilled" ? r.value?.data || [] : []));
  if (!rows.length) return [];

  const seen = new Map();
  const items = [];
  for (const t of rows) {
    const title = t?.title_short || t?.title;
    const artist = t?.artist?.name;
    if (!title || !artist) continue;
    // One row per recording: Deezer lists the same song across many
    // compilations, which would otherwise fill the results with itself. When a
    // recording appears more than once, keep the highest-ranked copy rather
    // than the first seen — Nirvana's "Smells Like Teen Spirit" comes back at
    // both rank 636,897 and 349,751, and keeping the weaker copy pushed the
    // original below covers that outranked it.
    const identity = `${normalizeMusicText(artist)}|${normalizeMusicText(title)}`;
    const candidate = {
      title,
      artist,
      id: t.id ? String(t.id) : null,
      sourceId: t.id ? String(t.id) : null,
      provider: "deezer",
      album: t?.album?.title || null,
      art: t?.album?.cover_medium || t?.album?.cover || null,
      duration: Number(t.duration) || null,
      // Not stored: preview URLs expire, so they are fetched at play time.
      rank: Number(t.rank) || 0,
    };
    const existing = seen.get(identity);
    if (existing) {
      if (candidate.rank > existing.rank) Object.assign(existing, candidate);
      continue;
    }
    seen.set(identity, candidate);
    items.push(candidate);
  }
  // Rank alone is not enough. Deezer's `rank` tracks *current* streaming, so a
  // trending cover outranks the record everyone actually means: Shaka Ponk's
  // "Smells Like Teen Spirit" scores 729k against Nirvana's 637k. Our own
  // catalogue knows which acts are real touring artists — Nirvana and Queen are
  // in it with popularity 88 and 89, the cover acts are not in it at all — so a
  // catalogue hit breaks the tie in favour of the original.
  const known = db.prepare("SELECT popularity FROM artists WHERE norm = ?");
  for (const item of items) {
    let popularity = 0;
    try { popularity = Number(known.get(normName(item.artist))?.popularity) || 0; } catch { popularity = 0; }
    item.catalogPopularity = popularity;
    // Popularity is 0-100, so this lifts a catalogue artist by up to ~2x rank
    // without letting an obscure catalogue entry leapfrog a genuine hit.
    item.score = item.rank * (1 + popularity / 100);
  }
  // Sort BEFORE truncating: truncating first kept whatever order Deezer
  // returned, and "bohemian rhapsody" came back without Queen in it at all.
  items.sort((a, b) => b.score - a.score);
  items.length = Math.min(items.length, limit);
  writeProviderCache(key, { items }, DEEZER_DISCOGRAPHY_TTL_MS);
  return items;
}

// ---- catalogue song index -------------------------------------------------
// The catalogue already holds ~2,500 songs on artists we know are real touring
// acts. Searching those in memory answers instantly, works with no network, and
// costs nothing, so it runs before the provider call rather than after it.
//
// Rebuilt lazily: the catalogue only changes when a seed or enrichment run
// writes, which is rare compared to how often people search.
let songIndex = null;
let songIndexBuiltAt = 0;
const SONG_INDEX_TTL_MS = 10 * 60 * 1000;

function buildSongIndex() {
  const out = [];
  for (const row of db.prepare("SELECT name, popularity, data FROM artists").all()) {
    let data = {};
    try { data = JSON.parse(row.data || "{}"); } catch { continue; }
    const art = data.photo || null;
    for (const t of data.topTracks || []) {
      if (!t?.title) continue;
      const spotifyId = String(t.url || "").match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/i)?.[1] || null;
      const sourceId = t.sourceId ? String(t.sourceId) : spotifyId || (t.id ? String(t.id) : null);
      const provider = t.provider || (spotifyId ? "spotify" : null);
      out.push({
        title: t.title,
        artist: row.name,
        id: t.id ? String(t.id) : null,
        sourceId,
        provider,
        album: t.album || null,
        art: t.art || art,
        duration: Number(t.duration) || null,
        popularity: Number(row.popularity) || 0,
      });
    }
  }
  return out;
}

function getSongIndex() {
  if (!songIndex || Date.now() - songIndexBuiltAt > SONG_INDEX_TTL_MS) {
    songIndex = buildSongIndex();
    songIndexBuiltAt = Date.now();
  }
  return songIndex;
}

export function invalidateSongIndex() { songIndex = null; }

// Title matches rank above artist matches: someone typing a song title wants
// that song, not everything by a band whose name contains the words.
export function searchCatalogSongs(query, { limit = 12 } = {}) {
  const q = normalizeMusicText(query);
  if (q.length < 2) return [];
  const hits = [];
  for (const song of getSongIndex()) {
    const title = normalizeMusicText(song.title);
    const artist = normalizeMusicText(song.artist);
    let weight = 0;
    if (title === q) weight = 4;
    else if (title.startsWith(q)) weight = 3;
    else if (title.includes(q)) weight = 2;
    else if (artist.includes(q)) weight = 1;
    else continue;
    hits.push({ ...song, source: "catalog", weight });
  }
  hits.sort((a, b) => b.weight - a.weight || b.popularity - a.popularity || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}
