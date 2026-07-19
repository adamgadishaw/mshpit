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

// Letters/digits only, diacritics folded, but NON-LATIN KEPT, so a stylized
// spelling stays comparable character by character ("KoЯn" -> "koяn").
function looseKey(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
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

function persistDeezerIdentity(name, deezerId, derivedGenre = null) {
  const existing = artistStmts.byNorm.get(normName(name));
  if (!existing || !deezerId) return;
  let data = {};
  try { data = JSON.parse(existing.data || "{}"); } catch {}
  // Deezer's album genre is a clean canonical label, so it corrects the noisy
  // MusicBrainz tag that got written into `genre` (e.g. Justin Bieber -> "Metal").
  const genre = derivedGenre && String(derivedGenre).trim() ? String(derivedGenre).trim() : null;
  const idUnchanged = String(data.deezerId || "") === String(deezerId);
  const genreChanged = genre && genre !== existing.genre;
  if (idUnchanged && !genreChanged) return;
  const merged = {
    ...data,
    name: existing.name,
    genre: genre || existing.genre || data.genre || null,
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

// Deezer artist candidates for disambiguation: many acts share a name, so the
// UI can show fans/photo/album-count and let the listener pick the right one.
export async function findDeezerArtistCandidates(name, { fetchImpl = fetch, limit = 8 } = {}) {
  const data = await providerJson("Deezer", `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=${limit}`, { fetchImpl });
  return (data?.data || [])
    .filter((a) => a?.id && a?.name)
    .map((a) => ({ id: a.id, name: a.name, fans: Number(a.nb_fan) || 0, albums: Number(a.nb_album) || 0, photo: a.picture_medium || a.picture || null }));
}

export async function getDeezerDiscography(name, { fetchImpl = fetch, deezerId = null } = {}) {
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
    persistDeezerIdentity(name, artist.id);
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
    if (derivedGenre) persistDeezerIdentity(name, artist.id, derivedGenre);
    const data = {
      artist: { id: artist.id, name: artist.name, fans: artist.nb_fan, photo: artist.picture_xl || artist.picture_big || null, genre: derivedGenre || null },
      albums: fullAlbums,
      topTracks,
      genre: derivedGenre || null,
      identity: { confidence: identity.confidence, reason: identity.reason },
    };
    // Empty/partial provider failures never replace a last-known-good catalogue.
    if (data.albums.length || data.topTracks.length) writeProviderCache(key, data, DEEZER_DISCOGRAPHY_TTL_MS);
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

export function scoreYouTubeCandidate(candidate, { title, artist, expectedDurationSec = 0, trustedChannel = false } = {}) {
  const snippet = candidate?.snippet || {};
  const status = candidate?.status || {};
  const rawTitle = String(snippet.title || "");
  const channel = String(snippet.channelTitle || "");
  const requested = `${artist || ""} ${title || ""}`;
  const combined = `${rawTitle} ${channel}`;
  const reasons = [];
  if (status.madeForKids === true) {
    return { score: -Infinity, rejected: true, reasons: ["child-directed"] };
  }
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

  // Hard CREATOR gate. The old gate accepted a video if the artist name appeared
  // ANYWHERE in the title or channel, so "Tory Lanez - X (feat. Nelly Furtado)"
  // or a random channel that just name-drops the artist passed, which put the
  // wrong act's songs on artist pages. Instead the uploader must credibly BE the
  // artist: either the channel carries their name (official / "Artist - Topic" /
  // VEVO all contain the name spaceless), or the title LEADS with their name
  // (the standard "Artist - Song" official format). Everything else is rejected
  // and playback falls back to the 30s preview, which is correct-artist audio.
  let channelIsArtist = false;
  // The candidate came from the artist's OWN channel, so the creator is already
  // proven; only the song identity still has to be checked below.
  if (trustedChannel) {
    channelIsArtist = true;
    reasons.push("artist-channel");
  } else if (artist) {
    const artistKey = normalizeMusicText(artist).replace(/ /g, "");
    const channelKey = normalizeMusicText(channel).replace(/ /g, "");
    const titleNorm = normalizeMusicText(rawTitle);
    // Only gate on the creator when the name is long enough to match reliably.
    // Very short or non-latin names (normalize to <3 chars) can't be gated
    // without rejecting everything, so they fall through to the title gate and
    // scoring instead.
    if (artistKey.length >= 3) {
      channelIsArtist = channelKey.includes(artistKey)
        || (artistKey.length >= 6 && channelKey.length >= 4 && artistKey.includes(channelKey));
      const titleLeadsWithArtist = titleNorm.startsWith(normalizeMusicText(artist));
      if (!channelIsArtist && !titleLeadsWithArtist) {
        return { score: -Infinity, rejected: true, reasons: ["wrong-creator"] };
      }
    }
  }

  // Hard title gate. The requested song's words must actually be in the video
  // title; a completely different song by the right artist is still the wrong
  // result. `titleIncluded` rescues exact matches whose token ratio dips only
  // because the official title carries extra words (feat., remaster years).
  if (title) {
    const titleIncluded = normalizeMusicText(rawTitle).includes(normalizeMusicText(title));
    if (titleCoverage < 0.5 && !titleIncluded) return { score: -Infinity, rejected: true, reasons: ["title-mismatch"] };
  }

  let score = titleCoverage * 45 + artistCoverage * 28;
  // The uploader being the artist is the strongest correctness signal, so weight
  // it heavily above title-only matches.
  if (channelIsArtist) { score += 22; reasons.push("artist-channel"); }
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

const YOUTUBE_CHANNEL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const YOUTUBE_CHANNEL_MISS_TTL_MS = 24 * 60 * 60 * 1000;

// Pick the artist's OWN channel out of channel search results. YouTube
// auto-generates an "<Artist> - Topic" channel that holds the official audio for
// their entire catalogue; VEVO and the plain verified channel come next. Ranked
// so an unrelated channel that merely contains the name can never win.
export function selectArtistChannel(artist, items = []) {
  const wanted = normalizeMusicText(artist);
  const wantedKey = wanted.replace(/ /g, "");
  if (!wantedKey) return null;
  let best = null;
  for (const item of items) {
    const channelId = item?.id?.channelId || item?.snippet?.channelId;
    const title = String(item?.snippet?.title || item?.snippet?.channelTitle || "");
    if (!channelId || !title) continue;
    const norm = normalizeMusicText(title);
    const key = norm.replace(/ /g, "");
    let rank = 0;
    if (norm === `${wanted} topic`) rank = 100;
    else if (key === `${wantedKey}vevo`) rank = 90;
    else if (norm === wanted) rank = 80;
    else if (key.startsWith(wantedKey) && key.length - wantedKey.length <= 6) rank = 60;
    else if (key.includes(wantedKey)) rank = 40;
    if (rank && (!best || rank > best.rank)) best = { channelId, title, rank };
  }
  return best && best.rank >= 40 ? best : null;
}

// One cheap, long-lived lookup per artist. Channels do not move, so this is
// cached for a month and amortized across every song on the artist's page.
async function resolveArtistChannelId(artist, apiKey, fetchImpl) {
  if (!artist) return null;
  const key = `yt:channel:v1:${normName(artist)}`;
  const cached = readProviderCache(key);
  if (cached?.fresh) return cached.data?.channelId || null;
  try {
    const data = await providerJson("YouTube", youtubeUrl("search", {
      part: "snippet", type: "channel", maxResults: "5", q: `${artist} - Topic`,
    }, apiKey), { fetchImpl, timeoutMs: 8_000 });
    const best = selectArtistChannel(artist, data?.items || []);
    writeProviderCache(key, { channelId: best?.channelId || null, title: best?.title || null },
      best ? YOUTUBE_CHANNEL_TTL_MS : YOUTUBE_CHANNEL_MISS_TTL_MS);
    return best?.channelId || null;
  } catch {
    return cached?.data?.channelId || null;
  }
}

const YOUTUBE_CATALOGUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Match a requested song against the artist's own upload catalogue, locally and
// for free. Topic uploads are titled exactly the song name; official channels
// add "(Official Video)" and friends, so those words are stripped before
// comparing. Live/remix/karaoke variants are pushed down, never silently used.
export function selectCatalogueTrack(title, catalogue = []) {
  const wanted = normalizeMusicText(title);
  if (!wanted) return null;
  const DECOR = /\b(official|music|video|audio|lyric|lyrics|visualizer|hd|hq|remaster|remastered|explicit|version|full)\b/g;
  let best = null;
  for (const item of catalogue) {
    const raw = String(item?.title || "");
    const videoId = item?.videoId;
    if (!raw || !videoId) continue;
    const norm = normalizeMusicText(raw);
    const stripped = norm.replace(DECOR, " ").replace(/\s+/g, " ").trim();
    let score;
    if (norm === wanted || stripped === wanted) score = 100;
    else if (stripped.startsWith(`${wanted} `) || stripped === wanted) score = 88;
    else if (norm.startsWith(`${wanted} `)) score = 84;
    else score = Math.min(coverage(title, raw), coverage(raw, title)) * 80;
    score -= titleQualifierPenalty(title, raw);
    if (/\b(karaoke|cover|reaction|instrumental|tribute)\b/i.test(raw)) score -= 100;
    if (!best || score > best.score) best = { videoId, title: raw, score: Math.round(score * 10) / 10 };
  }
  return best && best.score >= 70 ? best : null;
}

// The artist's entire upload catalogue, fetched with the CHEAP endpoints:
// channels.list + playlistItems.list cost 1 unit per call (50 videos each),
// versus 100 units for a single keyword search. This is what stops the daily
// quota running out and dropping every song back to a 30 second preview.
async function getArtistCatalogue(artist, channelId, apiKey, fetchImpl) {
  const key = `yt:catalogue:v1:${normName(artist)}`;
  const cached = readProviderCache(key);
  if (cached?.fresh) return cached.data?.items || [];
  try {
    const channelData = await providerJson("YouTube", youtubeUrl("channels", {
      part: "contentDetails", id: channelId,
    }, apiKey), { fetchImpl, timeoutMs: 8_000 });
    const uploads = channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const items = [];
    let pageToken = "";
    for (let page = 0; page < 4; page++) {
      const params = { part: "snippet", playlistId: uploads, maxResults: "50" };
      if (pageToken) params.pageToken = pageToken;
      const data = await providerJson("YouTube", youtubeUrl("playlistItems", params, apiKey), { fetchImpl, timeoutMs: 8_000 });
      for (const item of data?.items || []) {
        const videoId = item?.snippet?.resourceId?.videoId;
        const videoTitle = item?.snippet?.title;
        if (videoId && videoTitle) items.push({ videoId, title: videoTitle });
      }
      pageToken = data?.nextPageToken || "";
      if (!pageToken) break;
    }
    if (items.length) writeProviderCache(key, { items }, YOUTUBE_CATALOGUE_TTL_MS);
    return items;
  } catch {
    return cached?.data?.items || [];
  }
}

// v2 deliberately invalidates every match resolved by the old blind keyword
// search. Those rows are served straight from cache for 14 days without
// re-scoring, so without this bump the previously chosen wrong videos (reaction
// uploads, other acts' songs) would keep playing long after the fix shipped.
function youtubeCacheKey(title, artist) {
  return (`yt:v2:${artist || ""}|${title}`).toLowerCase().slice(0, 300);
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

  // PRIMARY PATH: search inside the artist's OWN channel. YouTube's
  // auto-generated "<Artist> - Topic" channel holds the official audio for their
  // whole catalogue, so a hit here cannot be a reaction video, a cover, or a
  // different act's song. This is what a blind keyword search could never
  // guarantee. Falls through to the global search when the artist has no
  // resolvable channel.
  if (artist) {
    const channelId = await resolveArtistChannelId(artist, apiKey, fetchImpl);
    if (channelId) {
      // Cheapest and most accurate: match against the artist's own catalogue,
      // pulled once per artist for ~5 quota units and reused for every song.
      try {
        const catalogue = await getArtistCatalogue(artist, channelId, apiKey, fetchImpl);
        const picked = selectCatalogueTrack(title, catalogue.filter((item) => !rejected.has(item.videoId)));
        if (picked) {
          const verified = (await youtubeVideos([picked.videoId], apiKey, fetchImpl))[0];
          const assessment = verified
            ? scoreYouTubeCandidate(verified, { title, artist, expectedDurationSec, trustedChannel: true })
            : null;
          if (verified && assessment && !assessment.rejected) {
            const metadata = {
              title: verified.snippet?.title || null,
              channel: verified.snippet?.channelTitle || null,
              reasons: [...assessment.reasons, "artist-catalogue"],
              duration: assessment.duration,
            };
            setYouTubeCache({ key, videoId: verified.id, metadata, score: assessment.score, expiresAt: currentTime + YOUTUBE_MATCH_TTL_MS, rejected });
            return { videoId: verified.id, status: "artist_catalogue", confidence: assessment.score };
          }
        }
      } catch { /* fall through to the channel search below */ }

      try {
        const inChannel = await providerJson("YouTube", youtubeUrl("search", {
          part: "snippet",
          type: "video",
          channelId,
          videoEmbeddable: "true",
          videoSyndicated: "true",
          maxResults: "10",
          q: title,
        }, apiKey), { fetchImpl, timeoutMs: 8_000 });
        const channelIds = (inChannel?.items || []).map((item) => item?.id?.videoId).filter((id) => id && !rejected.has(id));
        const channelRanked = (await youtubeVideos(channelIds, apiKey, fetchImpl))
          .map((candidate) => ({ candidate, assessment: scoreYouTubeCandidate(candidate, { title, artist, expectedDurationSec, trustedChannel: true }) }))
          .filter(({ assessment }) => !assessment.rejected)
          .sort((a, b) => b.assessment.score - a.assessment.score);
        const bestInChannel = channelRanked[0];
        if (bestInChannel) {
          const metadata = {
            title: bestInChannel.candidate.snippet?.title || null,
            channel: bestInChannel.candidate.snippet?.channelTitle || null,
            reasons: bestInChannel.assessment.reasons,
            duration: bestInChannel.assessment.duration,
          };
          setYouTubeCache({ key, videoId: bestInChannel.candidate.id, metadata, score: bestInChannel.assessment.score, expiresAt: currentTime + YOUTUBE_MATCH_TTL_MS, rejected });
          return { videoId: bestInChannel.candidate.id, status: "artist_channel", confidence: bestInChannel.assessment.score };
        }
      } catch { /* fall through to the global search below */ }
    }
  }

  const query = `${artist ? `${artist} ` : ""}${title} official audio -karaoke -cover -reaction -nightcore`;
  // A wider candidate pool (search quota is flat regardless of maxResults, and
  // videos.list is one cheap unit per batch) so the correct official upload is
  // in the set even when it ranks below noise on YouTube's own relevance sort.
  const search = await providerJson("YouTube", youtubeUrl("search", {
    part: "snippet",
    type: "video",
    videoCategoryId: "10",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    maxResults: "10",
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
