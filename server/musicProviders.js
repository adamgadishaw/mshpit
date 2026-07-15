import { artistRow, artistStmts, normName, providerCacheStmts, ytStmts } from "./db.js";

const DEEZER_DISCOGRAPHY_TTL_MS = 24 * 60 * 60 * 1000;
const DEEZER_PREVIEW_MAX_TTL_MS = 5 * 60 * 1000;
const YOUTUBE_MATCH_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const YOUTUBE_MISS_TTL_MS = 6 * 60 * 60 * 1000;
const YOUTUBE_SCORE_MIN = 65;
const previewCache = new Map();

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

// Stable identity for one song across the override table, reports, and the
// resolver cache, so a pin set from one spelling matches every other spelling.
export function trackOverrideKey(title, artist) {
  return `${normalizeMusicText(artist)}|${normalizeMusicText(title)}`;
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

function fanWeight(value) {
  return Math.min(20, Math.log10(Math.max(0, Number(value) || 0) + 1) * 3);
}

// Deezer can return multiple exact-name artists (Drake is a real production
// example). Exact spelling alone is therefore insufficient; among exact matches
// the established artist with the strongest audience signal wins. A previously
// verified Deezer ID remains authoritative on later requests.
export function selectDeezerArtist(name, candidates = [], preferredId = null) {
  const valid = candidates.filter((item) => item?.id && item?.name);
  if (!valid.length) return null;
  if (preferredId != null) {
    const preferred = valid.find((item) => String(item.id) === String(preferredId));
    if (preferred) return { artist: preferred, confidence: 1, reason: "stored-id" };
  }
  const wanted = normalizeMusicText(name);
  const exact = valid.filter((item) => normalizeMusicText(item.name) === wanted);
  if (exact.length) {
    const artist = exact.sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0))[0];
    return { artist, confidence: exact.length === 1 ? 0.98 : 0.94, reason: exact.length === 1 ? "exact-name" : "exact-name-popularity" };
  }
  const ranked = valid.map((artist) => {
    const similarity = Math.min(coverage(name, artist.name), coverage(artist.name, name));
    return { artist, similarity, score: similarity * 100 + fanWeight(artist.nb_fan) };
  }).sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].similarity < 0.8) return null;
  return { artist: ranked[0].artist, confidence: ranked[0].similarity * 0.85, reason: "near-name" };
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

export async function findDeezerArtist(name, { preferredId = null, fetchImpl = fetch } = {}) {
  const data = await providerJson("Deezer", `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10`, { fetchImpl });
  return selectDeezerArtist(name, data?.data || [], preferredId);
}

function storedDeezerId(name) {
  const row = artistStmts.byNorm.get(normName(name));
  if (!row?.data) return null;
  try { return JSON.parse(row.data)?.deezerId || null; } catch { return null; }
}

function persistDeezerIdentity(name, deezerId) {
  const existing = artistStmts.byNorm.get(normName(name));
  if (!existing || !deezerId) return;
  let data = {};
  try { data = JSON.parse(existing.data || "{}"); } catch {}
  if (String(data.deezerId || "") === String(deezerId)) return;
  const merged = {
    ...data,
    name: existing.name,
    genre: existing.genre || data.genre || null,
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
  try { return { data: JSON.parse(row.data), fresh: row.expires_at > Date.now(), updatedAt: row.updated_at }; }
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

export async function getDeezerDiscography(name, { fetchImpl = fetch } = {}) {
  const key = `deezer:discography:v2:${normName(name)}`;
  const cached = readProviderCache(key);
  if (cached?.fresh) return { ...cached.data, status: "cached", stale: false };
  try {
    const identity = await findDeezerArtist(name, { preferredId: storedDeezerId(name), fetchImpl });
    if (!identity) return cached ? { ...cached.data, status: "stale", stale: true } : { albums: [], status: "not_found", stale: false };
    const artist = identity.artist;
    persistDeezerIdentity(name, artist.id);
    const albumData = await providerJson("Deezer", `https://api.deezer.com/artist/${artist.id}/albums?limit=100`, { fetchImpl });
    const seen = new Set();
    const picks = (albumData?.data || [])
      .filter((album) => album.record_type === "album" && album.title && !seen.has(normalizeMusicText(album.title)) && seen.add(normalizeMusicText(album.title)))
      .sort((a, b) => String(b.release_date || "").localeCompare(String(a.release_date || "")))
      .slice(0, 12);
    const fullAlbums = await inBatches(picks, 3, async (album) => {
      const full = await providerJson("Deezer", `https://api.deezer.com/album/${album.id}`, { fetchImpl });
      return {
        id: album.id,
        title: album.title,
        year: String(album.release_date || "").slice(0, 4),
        cover: album.cover_medium || album.cover || null,
        // Never persist Deezer's signed preview URL. It expires in minutes and is
        // resolved by getFreshDeezerPreview only when a listener presses play.
        tracks: (full?.tracks?.data || []).map((track) => ({ id: track.id || null, title: track.title, duration: track.duration || 0 })),
      };
    });
    const data = {
      artist: { id: artist.id, name: artist.name, fans: artist.nb_fan, photo: artist.picture_xl || artist.picture_big || null },
      albums: fullAlbums,
      identity: { confidence: identity.confidence, reason: identity.reason },
    };
    // Empty/partial provider failures never replace a last-known-good catalogue.
    if (data.albums.length) writeProviderCache(key, data, DEEZER_DISCOGRAPHY_TTL_MS);
    return { ...data, status: "fresh", stale: false };
  } catch (error) {
    if (cached) return { ...cached.data, status: "stale", stale: true };
    throw error;
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
  const key = `${normName(artist)}|${normName(title)}`;
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

export function parseIsoDuration(value) {
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
}

export function scoreYouTubeCandidate(candidate, { title, artist, expectedDurationSec = 0 } = {}) {
  const snippet = candidate?.snippet || {};
  const status = candidate?.status || {};
  const rawTitle = String(snippet.title || "");
  const channel = String(snippet.channelTitle || "");
  const requested = `${artist || ""} ${title || ""}`;
  const combined = `${rawTitle} ${channel}`;
  const reasons = [];
  if (!candidate?.id || status.embeddable === false || (status.privacyStatus && status.privacyStatus !== "public")) {
    return { score: -Infinity, rejected: true, reasons: ["not-embeddable"] };
  }
  const hardNoise = /\b(karaoke|tribute|reaction|tutorial|how to play|nightcore|8d audio)\b/i;
  if (hardNoise.test(combined) && !hardNoise.test(requested)) return { score: -Infinity, rejected: true, reasons: ["low-quality-variant"] };
  if (/\bcover\b/i.test(rawTitle) && !/\bcover\b/i.test(title || "") && !/\bcover\b/i.test(artist || "")) {
    return { score: -Infinity, rejected: true, reasons: ["cover"] };
  }

  const titleCoverage = coverage(title, rawTitle);
  const artistCoverage = artist ? coverage(artist, combined) : 1;
  let score = titleCoverage * 45 + artistCoverage * 28;
  if (normalizeMusicText(rawTitle).includes(normalizeMusicText(title))) { score += 18; reasons.push("title-match"); }
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

  const duration = parseIsoDuration(candidate?.contentDetails?.duration);
  const expected = Number(expectedDurationSec) || 0;
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

function youtubeCacheKey(title, artist) {
  return (`yt:${artist || ""}|${title}`).toLowerCase().slice(0, 300);
}

function rejectedSet(row) {
  try { return new Set(JSON.parse(row?.rejected_ids || "[]").filter((id) => typeof id === "string")); }
  catch { return new Set(); }
}

function setYouTubeCache({ key, videoId, metadata = null, score = null, expiresAt, rejected = [] }) {
  ytStmts.set.run({
    key,
    video_id: videoId || null,
    updated_at: Date.now(),
    metadata: metadata ? JSON.stringify(metadata) : null,
    score: Number.isFinite(score) ? score : null,
    expires_at: expiresAt,
    rejected_ids: JSON.stringify([...rejected].slice(-25)),
  });
}

function youtubeUrl(path, params, apiKey) {
  const query = new URLSearchParams({ ...params, key: apiKey });
  return `https://www.googleapis.com/youtube/v3/${path}?${query.toString()}`;
}

async function youtubeVideos(ids, apiKey, fetchImpl) {
  if (!ids.length) return [];
  const data = await providerJson("YouTube", youtubeUrl("videos", {
    part: "snippet,contentDetails,status,statistics",
    id: ids.join(","),
  }, apiKey), { fetchImpl, timeoutMs: 8_000 });
  return data?.items || [];
}

export async function resolveYouTubeTrack(title, artist, { expectedDurationSec = 0, fetchImpl = fetch, apiKey = process.env.YOUTUBE_API_KEY } = {}) {
  const key = youtubeCacheKey(title, artist);
  const hit = ytStmts.get.get(key);
  const rejected = rejectedSet(hit);
  const currentTime = Date.now();
  if (hit?.video_id && hit.metadata && Number(hit.expires_at) > currentTime) {
    return { videoId: hit.video_id, status: "cached", confidence: hit.score ?? null };
  }
  if (!hit?.video_id && hit && Number(hit.expires_at) > currentTime) return { videoId: null, status: "not_found" };
  if (!apiKey) return { videoId: null, status: "unconfigured" };

  // Validate legacy cache rows cheaply with videos.list before trusting them.
  // Good IDs cost one quota unit to migrate; only a bad result burns a search.
  if (hit?.video_id && !rejected.has(hit.video_id)) {
    const legacy = (await youtubeVideos([hit.video_id], apiKey, fetchImpl))[0];
    if (legacy) {
      const assessment = scoreYouTubeCandidate(legacy, { title, artist, expectedDurationSec });
      if (!assessment.rejected) {
        const metadata = { title: legacy.snippet?.title || null, channel: legacy.snippet?.channelTitle || null, reasons: assessment.reasons, duration: assessment.duration };
        setYouTubeCache({ key, videoId: legacy.id, metadata, score: assessment.score, expiresAt: currentTime + YOUTUBE_MATCH_TTL_MS, rejected });
        return { videoId: legacy.id, status: "validated", confidence: assessment.score };
      }
      rejected.add(hit.video_id);
    } else rejected.add(hit.video_id);
  }

  const query = `${artist ? `${artist} ` : ""}${title} official audio -karaoke -cover -reaction -nightcore`;
  const search = await providerJson("YouTube", youtubeUrl("search", {
    part: "snippet",
    type: "video",
    videoCategoryId: "10",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    maxResults: "5",
    q: query,
  }, apiKey), { fetchImpl, timeoutMs: 8_000 });
  const ids = (search?.items || []).map((item) => item?.id?.videoId).filter((id) => id && !rejected.has(id));
  const candidates = await youtubeVideos(ids, apiKey, fetchImpl);
  const ranked = candidates.map((candidate) => ({ candidate, assessment: scoreYouTubeCandidate(candidate, { title, artist, expectedDurationSec }) }))
    .filter(({ assessment }) => !assessment.rejected)
    .sort((a, b) => b.assessment.score - a.assessment.score);
  const best = ranked[0];
  if (!best) {
    setYouTubeCache({ key, videoId: null, expiresAt: currentTime + YOUTUBE_MISS_TTL_MS, rejected });
    return { videoId: null, status: "low_confidence" };
  }
  const metadata = {
    title: best.candidate.snippet?.title || null,
    channel: best.candidate.snippet?.channelTitle || null,
    reasons: best.assessment.reasons,
    duration: best.assessment.duration,
  };
  setYouTubeCache({ key, videoId: best.candidate.id, metadata, score: best.assessment.score, expiresAt: currentTime + YOUTUBE_MATCH_TTL_MS, rejected });
  return { videoId: best.candidate.id, status: "resolved", confidence: best.assessment.score };
}

export function invalidateYouTubeTrack(title, artist, videoId) {
  const key = youtubeCacheKey(title, artist);
  const row = ytStmts.get.get(key);
  const rejected = rejectedSet(row);
  if (videoId) rejected.add(String(videoId));
  ytStmts.invalidate.run(JSON.stringify([...rejected].slice(-25)), key);
  return { ok: true, invalidated: !!row, rejected: rejected.size };
}
