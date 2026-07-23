// API routes. Conventions that keep this hard to crash and easy to fix:
// - every route: authenticate -> rate-limit -> validate (shape) -> act -> respond
// - all handlers are wrapped by the server's try/catch; throwing ApiError(status,
//   message, stableCode) is the ONLY sanctioned way to fail; anything else is a
//   clean INTERNAL_ERROR with a request ID and no internal details
// - responses only ever contain public projections (publicUser), never raw rows
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mailConfigured, sendEmail } from "./mailer.js";
import { db, q, publicUser, artistStmts, publicArtist, artistRow, normName } from "./db.js";
import { genreClaim, resolveGenre, storedClaims, upsertClaim, withoutSource } from "../src/domain/genre.mjs";
import { hashPassword, verifyPassword, createSession, destroySession, rateLimit } from "./auth.js";
import { startCatalogSeed, catalogSeedStatus, stopCatalogSeed, deezerEnrich } from "./catalogSeed.js";
import { clean, cleanEmail, isEmail, cleanName, isName, cleanHandle, isPassword, clampRating, cleanStringArray, cleanDate, shape, LIMITS } from "./validate.js";
import { ApiError } from "./errors.js";
import { createMediaPresign, mediaConfigured } from "./media.js";
import { discoverySidebar } from "./discovery.js";
import { resolveEntity } from "./seo.js";
import { userRewards } from "./rewards.js";
import {
  ProviderError,
  findDeezerArtistCandidates,
  getDeezerDiscography,
  getFreshDeezerPreview,
  invalidateYouTubeTrack,
  normalizeMusicText,
  parseYouTubeVideoId,
  resolveYouTubeTrack,
  searchCatalogSongs,
  searchDeezerTracks,
  trackOverrideKey,
  youtubeOEmbed,
  youtubeProviderStatus,
} from "./musicProviders.js";

export { ApiError } from "./errors.js";

const now = () => Date.now();
const uid = (p) => `${p}_${randomUUID().slice(0, 12)}`;
const PROFILE_EXTRAS_MAX_BYTES = 8000;

function serializeProfileExtras(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || Buffer.byteLength(encoded, "utf8") > PROFILE_EXTRAS_MAX_BYTES) return null;
    return encoded;
  } catch {
    return null;
  }
}

function parseStoredProfileExtras(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Advance a timestamp by N business days (skip Sat/Sun), for the @handle cooldown.
function addBusinessDays(ts, n) {
  const d = new Date(ts);
  let added = 0;
  while (added < n) { d.setUTCDate(d.getUTCDate() + 1); const day = d.getUTCDay(); if (day !== 0 && day !== 6) added++; }
  return d.getTime();
}
const HANDLE_COOLDOWN_DAYS = 10; // business days between username changes
const ANALYTICS_RETENTION_DAYS = Math.max(30, Math.min(730, Number(process.env.ANALYTICS_RETENTION_DAYS) || 180));
let lastAnalyticsPruneAt = 0;
const ANALYTICS_EVENT_PROPS = Object.freeze({
  view_artist: ["artist", "genre"],
  view_venue: ["venue"],
  search: ["q"],
  play: ["artist", "title"],
  login: [],
  signup: ["city"],
  post: ["kind", "artist", "venue"],
  follow: [],
  block: [],
  like: [],
  join_fanclub: ["artist"],
});

function privacySafeSearchTerm(value) {
  const term = clean(value, { max: 80 }).toLowerCase();
  if (!term || /(?:https?:\/\/|www\.|\S+@\S+|@\w+)/i.test(term)) return null;
  const safe = term.replace(/[^\p{L}\p{N}'&+ -]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return safe.length >= 2 ? safe : null;
}

function jsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
// Staff must carry their role in their @ (moderator → "mod", admin → "admin").
function handleAllowedForRole(handle, role) {
  if (role === "admin") return handle.includes("admin");
  if (role === "moderator") return handle.includes("mod");
  return true;
}

function requireSessionUser(ctx) {
  if (!ctx.user) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED");
  return ctx.user;
}
function requireUser(ctx) {
  const user = requireSessionUser(ctx);
  if (user.is_banned) throw new ApiError(403, "This account is banned.", "FORBIDDEN");
  if (user.suspended_until && user.suspended_until > now()) throw new ApiError(403, "This account is suspended.", "FORBIDDEN");
  return user;
}
function requireAdmin(ctx) {
  const u = requireUser(ctx);
  if (u.role !== "admin") throw new ApiError(403, "Admins only.", "FORBIDDEN");
  return u;
}
function requireModerator(ctx) {
  const u = requireUser(ctx);
  if (u.role !== "admin" && u.role !== "moderator") throw new ApiError(403, "Moderators only.", "FORBIDDEN");
  return u;
}
function limit(ctx, name, max, windowMs) {
  // Authenticated activity is primarily limited per account so users behind the
  // same carrier/proxy do not consume one shared posting or messaging bucket.
  const actor = ctx.user?.id ? `user:${ctx.user.id}` : `ip:${ctx.ip}`;
  if (!rateLimit(`${name}:${actor}`, max, windowMs)) throw new ApiError(429, "Too many requests, slow down and try again.", "RATE_LIMITED");
}

function desiredState(body, field, current) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, field)) return !current;
  if (typeof body[field] !== "boolean") throw new ApiError(400, `${field} must be true or false.`, "VALIDATION_FAILED");
  return body[field];
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.created_at, row.id]), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!Number.isSafeInteger(createdAt) || createdAt < 0 || typeof id !== "string" || !id || id.length > 100) throw new Error();
    return { createdAt, id };
  } catch {
    throw new ApiError(400, "That page link is invalid. Refresh and try again.", "VALIDATION_FAILED");
  }
}

function pageRequest(ctx, defaultLimit, maxLimit) {
  const requested = Number(ctx.query?.limit);
  const limit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, maxLimit) : defaultLimit;
  return { cursor: decodeCursor(ctx.query?.before), limit };
}

function finishPage(rows, limit) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, nextCursor: hasMore && page.length ? encodeCursor(page.at(-1)) : null };
}

// An account "owns" the artist page whose name matches theirs; admins own all.
function ownsArtist(u, key) {
  if (!u) return false;
  if (u.role === "admin") return true;
  return u.role === "artist" && (u.artist_name || "").trim().toLowerCase() === key;
}

// Ensure a unique handle derived from a base string.
function uniqueHandle(base) {
  let h = cleanHandle(base) || "fan";
  if (h.length < 3) h = (h + "fan").slice(0, 20);
  let candidate = h, i = 1;
  while (q.userByHandle.get(candidate)) candidate = (h.slice(0, 17) + i++).slice(0, 20);
  return candidate;
}

const POST_RATING_DIM_KEYS = ["performance", "setlist", "sound", "venue", "crowd", "experience"];
function cleanPostRatingDims(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  for (const key of POST_RATING_DIM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const numeric = Number(value[key]);
    if (!Number.isFinite(numeric)) return undefined;
    out[key] = clampRating(numeric);
  }
  return out;
}

const postRow = db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,band,room,dims,review,photos,photos_public,setlist,tour,tags,kind,song,playlist,artist_key,artist_mbid,venue_key,created_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

// A review binds to a catalog entity, not to whatever the user typed. The client
// sends the key it picked from the suggestion list; the server only accepts it
// when it resolves to a real artist AND still matches the submitted name, so a
// stale or forged key cannot silently attach a review to the wrong act. Free
// text stays allowed, it just does not earn an entity binding.
function resolveArtistBinding(name, claimedKey) {
  const key = normName(clean(claimedKey, { max: 120 }) || name);
  if (!key) return { artist_key: null, artist_mbid: null };
  const row = artistStmts.byNorm.get(key);
  if (!row || normName(row.name) !== normName(name)) return { artist_key: null, artist_mbid: null };
  return { artist_key: row.norm, artist_mbid: row.mbid || null };
}

// Venues live in the bundled catalog rather than a table, so the normalized name
// is the stable key. Recording it means a same-named room in another city is a
// different venue the moment the catalog can tell them apart.
const venueBinding = (name) => normName(clean(name, { max: LIMITS.venue })) || null;

// A tagged YouTube video on a post. Only the canonical video id is authoritative.
// Build the thumbnail URL ourselves so a post cannot persist an arbitrary remote
// image URL while still preserving the provider-supplied title/channel metadata.
function cleanSong(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const videoId = parseYouTubeVideoId(value.videoId || value.url || "");
  if (!videoId) return undefined;
  const str = (v, max) => { const s = clean(String(v ?? ""), { max }); return s || null; };
  const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: str(value.title, 200), artist: str(value.artist, 120), thumb };
}

const PLAYLIST_VISIBILITIES = new Set(["public", "unlisted", "private"]);
function cleanPlaylistVisibility(value, fallback = "public") {
  const visibility = clean(value, { max: 20 });
  return PLAYLIST_VISIBILITIES.has(visibility) ? visibility : fallback;
}
function cleanPlaylistTracks(value, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 100) return undefined;
  const tracks = [];
  const seen = new Set();
  for (const raw of value.slice(0, 100)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const title = clean(raw.title, { max: 200 });
    if (!title) continue;
    const artist = clean(raw.artist, { max: 120 }) || null;
    const url = clean(raw.url, { max: 400 }) || null;
    // Fall back to the link so a track that only carries a watch URL still
    // records its exact video id. A playlist snapshot is supposed to replay the
    // same recording later, and a bare URL is weaker evidence than the id.
    const videoId = parseYouTubeVideoId(raw.videoId || "") || parseYouTubeVideoId(url || "") || null;
    const sourceId = clean(String(raw.sourceId ?? raw.id ?? ""), { max: 120 }) || null;
    const provider = clean(raw.provider, { max: 40 })?.toLowerCase() || null;
    const art = typeof raw.art === "string" && /^https?:\/\//i.test(raw.art) ? raw.art.slice(0, 500) : null;
    const durationValue = Number(raw.duration);
    const duration = Number.isFinite(durationValue) && durationValue > 0 ? Math.min(Math.round(durationValue), 86_400) : null;
    const identity = videoId
      ? `youtube:${videoId}`
      : sourceId
        ? `source:${provider || "unknown"}:${sourceId.toLowerCase()}`
        : url
          ? `url:${url.toLowerCase()}`
          : `text:${(artist || "").toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    tracks.push({ title, artist, url, videoId, provider, sourceId, art, duration });
  }
  if (!allowEmpty && !tracks.length) return undefined;
  return tracks;
}
function playlistProjection(row) {
  if (!row) return null;
  let stored = [];
  try { stored = JSON.parse(row.tracks || "[]"); } catch {}
  const tracks = cleanPlaylistTracks(stored) || [];
  return {
    id: row.id,
    ownerId: row.user_id,
    owner: row.u_name ? { id: row.user_id, name: row.u_name, handle: row.u_handle } : undefined,
    name: row.name,
    tracks,
    visibility: cleanPlaylistVisibility(row.visibility),
    at: row.created_at,
    updatedAt: row.updated_at || null,
  };
}
const ownedPlaylistForPost = db.prepare(`SELECT p.*, u.name AS u_name, u.handle AS u_handle
  FROM playlists p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.user_id=?`);
function playlistSnapshotForPost(user, playlistId, currentSnapshot = null) {
  if (playlistId == null || playlistId === "") return null;
  if (typeof playlistId !== "string" || playlistId.length > 100) throw new ApiError(400, "That playlist could not be attached.", "VALIDATION_FAILED");
  // An old post keeps its immutable snapshot even if its source playlist was
  // later edited or deleted. Re-saving unrelated text must not rewrite the songs.
  if (currentSnapshot?.id === playlistId) return currentSnapshot;
  const row = ownedPlaylistForPost.get(playlistId, user.id);
  if (!row) throw new ApiError(404, "That playlist left the set. Refresh and choose another.", "NOT_FOUND");
  const playlist = playlistProjection(row);
  if (playlist.visibility === "private") throw new ApiError(400, "Make this playlist public or unlisted before sharing it.", "VALIDATION_FAILED");
  if (!playlist.tracks.length) throw new ApiError(400, "Add at least one song before sharing this playlist.", "VALIDATION_FAILED");
  return {
    id: playlist.id,
    name: playlist.name,
    tracks: playlist.tracks,
    owner: playlist.owner,
    publishedAt: now(),
  };
}
function playlistPostProjection(value) {
  if (!value) return null;
  let playlist = value;
  if (typeof value === "string") {
    try { playlist = JSON.parse(value); } catch { return null; }
  }
  if (!playlist || typeof playlist !== "object" || Array.isArray(playlist)) return null;
  const tracks = cleanPlaylistTracks(Array.isArray(playlist.tracks) ? playlist.tracks : []) || [];
  return {
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner,
    trackCount: tracks.length,
    duration: tracks.reduce((total, track) => total + (track.duration || 0), 0) || null,
    tracks: tracks.slice(0, 4),
    publishedAt: playlist.publishedAt || null,
  };
}
// How many times the author has logged this artist up to and including this
// post: powers the "3rd time in the pit" marker on the card.
const SEEN_ORDINAL_SQL = `(SELECT COUNT(*) FROM posts s
    WHERE s.user_id = p.user_id AND LOWER(s.artist) = LOWER(p.artist) AND s.removed = 0
      AND (s.created_at < p.created_at OR (s.created_at = p.created_at AND s.id <= p.id))) AS seen_ordinal`;
const feedPostById = db.prepare(`
  SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.removed = 0) AS comment_count,
    ${SEEN_ORDINAL_SQL}
  FROM posts p JOIN users u ON u.id = p.user_id
  WHERE p.id = ?`);
// Short word-art descriptors on a review ("RAW", "wall of sound"). Word-ish
// only, capped hard, so they can't become a second review or a slur vector for
// markup injection.
function cleanPostTags(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const raw of value.slice(0, 12)) {
    const tag = clean(String(raw ?? ""), { max: 24 }).replace(/[^\p{L}\p{N} '&.!-]/gu, "").replace(/\s+/g, " ").trim();
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= 5) break;
  }
  return out;
}
// Insert a notification for a recipient (never notify yourself).
const notifRow = db.prepare("INSERT INTO notifications (id,user_id,actor_id,type,post_id,artist,text,created_at) VALUES (?,?,?,?,?,?,?,?)");
function addNotif(recipientId, actorId, type, extra = {}) {
  if (!recipientId || recipientId === actorId) return;
  if (actorId && blockedEitherWay(recipientId, actorId)) return; // no pings across a block
  notifRow.run(uid("n"), recipientId, actorId, type, extra.postId ?? null, extra.artist ?? null, extra.text ?? null, now());
}

// True when either user has blocked the other (blocks act both ways).
const blockCheck = db.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)");
function blockedEitherWay(a, b) {
  if (!a || !b) return false;
  return !!blockCheck.get(a, b, b, a);
}
// Ids hidden from a viewer's feed (people they blocked or who blocked them).
const blockedIdsStmt = db.prepare("SELECT blocked_id id FROM blocks WHERE blocker_id=? UNION SELECT blocker_id id FROM blocks WHERE blocked_id=?");
function blockedIdSet(userId) {
  if (!userId) return new Set();
  return new Set(blockedIdsStmt.all(userId, userId).map((r) => r.id));
}

const MODERATABLE_CONTENT = {
  post: "posts",
  comment: "comments",
  fan_message: "fan_club_messages",
  lounge_message: "lounge_messages",
  venue_review: "venue_reviews",
};
function moderationRecord(ctx, action, targetType, targetId, reason = "", prior = {}, next = {}) {
  db.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    uid("ma"), ctx.user?.id || null, action, targetType, targetId,
    clean(reason, { max: LIMITS.note }) || "", JSON.stringify(prior), JSON.stringify(next), ctx.requestId || null, now()
  );
}
function setContentRemoved(ctx, targetType, targetId, removed, reason = "") {
  const table = MODERATABLE_CONTENT[targetType];
  if (!table) throw new ApiError(400, "That content type cannot be moderated here.", "VALIDATION_FAILED");
  const current = db.prepare(`SELECT removed FROM ${table} WHERE id=?`).get(targetId);
  if (!current) throw new ApiError(404, "That content is no longer available.", "NOT_FOUND");
  const next = removed ? 1 : 0;
  db.prepare(`UPDATE ${table} SET removed=? WHERE id=?`).run(next, targetId);
  moderationRecord(ctx, removed ? "remove" : "restore", targetType, targetId, reason, { removed: !!current.removed }, { removed: !!next });
  return { ok: true, removed: !!next };
}

function postJson(p, viewerId) {
  return {
    id: p.id,
    userId: p.user_id,
    kind: p.kind || "review",
    user: { name: p.u_name, handle: p.u_handle, initials: p.u_initials, avatarUri: p.u_avatar, avatarColor: p.u_color },
    artist: p.artist, venue: p.venue, city: p.city, date: p.date,
    artistKey: p.artist_key || null, artistMbid: p.artist_mbid || null, venueKey: p.venue_key || null,
    overall: p.overall, band: p.band, room: p.room, dims: JSON.parse(p.dims || "{}"), review: p.review,
    photos: JSON.parse(p.photos || "[]"), photosPublic: !!p.photos_public,
    setlist: JSON.parse(p.setlist || "[]"),
    tour: p.tour || null,
    tags: JSON.parse(p.tags || "[]"),
    song: p.song ? (() => { try { return JSON.parse(p.song); } catch { return null; } })() : null,
    // Feed pages receive a bounded preview. The full immutable song list is
    // loaded only when somebody presses Play, keeping 50-card feeds lightweight.
    playlist: playlistPostProjection(p.playlist),
    seen: p.seen_ordinal ?? null,
    ...(p.open_reports != null ? { flags: p.open_reports } : {}),
    likes: p.like_count ?? 0, comments: p.comment_count ?? 0,
    liked: viewerId ? !!db.prepare("SELECT 1 FROM likes WHERE post_id=? AND user_id=?").get(p.id, viewerId) : false,
    createdAt: p.created_at,
    editedAt: p.updated_at || null,
    version: p.updated_at || p.created_at,
  };
}

// Resolve an artist by name from MusicBrainz (CC0, keyless). One request per
// lookup (their policy needs a real User-Agent); returns the catalog shape.
async function resolveFromMusicBrainz(name) {
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&fmt=json&limit=5`;
  let d;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Pit/1.0 (https://mshpit.com)" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    d = await r.json();
  } catch { return null; }
  const items = d?.artists || [];
  if (!items.length) return null;
  const lower = name.toLowerCase();
  const a = items.find((x) => (x.name || "").toLowerCase() === lower) || items[0];
  const tags = (a.tags || []).slice().sort((x, y) => (y.count || 0) - (x.count || 0));
  const genre = tags[0]?.name ? tags[0].name.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  return {
    name: a.name,
    mbid: a.id,
    genre,
    country: a.area?.name || a.country || null,
    beginYear: (a["life-span"]?.begin || "").slice(0, 4) || null,
    rank_score: a.score ? Number(a.score) : 1,
  };
}

// --- Genre canonicalization: collapse the messy raw tags (case/format variants +
// a few obvious synonyms) into one clean label per genre, so Discover's charts and
// pie reflect the RIGHT genre per artist instead of "Hip-Hop / hip hop / Hip Hop"
// as three separate slices. Deliberately conservative: it does NOT merge distinct
// subgenres (Death Metal stays Death Metal). ---
const GENRE_ALIAS = {
  "hip hop": "Hip-Hop", "hiphop": "Hip-Hop", "hip-hop": "Hip-Hop", "rap": "Hip-Hop", "trap": "Hip-Hop", "conscious hip hop": "Hip-Hop",
  "r&b": "R&B", "rnb": "R&B", "r & b": "R&B", "contemporary r&b": "R&B", "rhythm and blues": "R&B", "rhythm & blues": "R&B",
  "drum and bass": "Drum & Bass", "drum & bass": "Drum & Bass", "dnb": "Drum & Bass", "d&b": "Drum & Bass",
  "k-pop": "K-Pop", "k pop": "K-Pop", "kpop": "K-Pop", "j-pop": "J-Pop", "j pop": "J-Pop", "jpop": "J-Pop",
  "edm": "EDM", "idm": "Electronic", "electronica": "Electronic", "dance": "Electronic",
  "singer-songwriter": "Singer-Songwriter", "singer songwriter": "Singer-Songwriter",
  "afrobeats": "Afrobeat", "alt rock": "Alternative Rock", "alt-rock": "Alternative Rock",
  "indie": "Indie", "indie rock": "Indie", "indie pop": "Indie",
  // Deezer's compound genre labels (from the enrichment pass).
  "rap/hip hop": "Hip-Hop", "soul & funk": "Soul", "latin music": "Latin", "electro": "Electronic",
};
function canonGenre(g) {
  if (!g) return null;
  const s = String(g).trim().toLowerCase();
  if (!s) return null;
  if (GENRE_ALIAS[s]) return GENRE_ALIAS[s];
  return s.replace(/\band\b/g, "&").replace(/\b\w/g, (c) => c.toUpperCase());
}
// Map a canonical genre back to every raw DB genre that collapses to it, so a
// genre filter can use a plain `genre IN (...)` on the indexed column.
let _rawGenreCache = { at: 0, map: null };
function rawGenresFor(canon) {
  if (!canon) return [];
  if (Date.now() - _rawGenreCache.at > 5 * 60 * 1000 || !_rawGenreCache.map) {
    const rows = db.prepare("SELECT DISTINCT genre FROM artists WHERE genre IS NOT NULL").all();
    const map = {};
    for (const r of rows) { const c = canonGenre(r.genre); if (!c) continue; (map[c] ||= []).push(r.genre); }
    _rawGenreCache = { at: Date.now(), map };
  }
  return _rawGenreCache.map[canon] || [];
}
// Chart row: typed columns + a lead "top track" pulled from the artist's data blob.
function chartRow(name, a, rank, extra = {}) {
  let top = null;
  if (a?.data) { try { const d = JSON.parse(a.data); const t = (d.topTracks || [])[0]; if (t?.title) top = { title: t.title, url: t.url || null }; } catch {} }
  return { rank, name: a?.name || name, genre: canonGenre(a?.genre) || null, popularity: a?.popularity ?? null, followers: (() => { try { return a?.data ? JSON.parse(a.data).followers ?? null : null; } catch { return null; } })(), photo: a?.photo || null, topTrack: top, ...extra };
}

// Enrich a (usually thin) catalog artist from Deezer: photo, popularity, top
// tracks, and a genre if it has none. Uses the shared exact-name-preferred matcher
// so we don't attach a same-named act's photo/songs. Upserts so the page fills in.
// Returns true if Deezer had a match.
async function enrichArtistFromDeezer(name) {
  const e = await deezerEnrich(name);
  if (!e) return false;
  const existing = artistStmts.byNorm.get(normName(name));
  let data = {};
  try { data = existing?.data ? JSON.parse(existing.data) : {}; } catch {}
  const merged = {
    ...data,
    name: existing?.name || name,
    genre: existing?.genre || e.genre || null,
    photo: e.photo || data.photo || null,
    mbid: existing?.mbid || null, country: existing?.country || null, beginYear: existing?.formed || null,
    popularity: e.popularity, followers: e.followers, topTracks: e.topTracks, deezerId: e.deezerId,
  };
  artistStmts.upsert.run(artistRow(normName(name), merged, "deezer"));
  return true;
}

// A likeable media URL: real https, sane length, no credentials, hash dropped
// (the URL is the reaction's primary key, so it has to be canonical).
function cleanMediaReactionUrl(value) {
  const raw = clean(value, { max: 600 });
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch { return null; }
}

// route table: "METHOD /path" -> handler(ctx) ; :params exposed as ctx.params
export const routes = {
  // ---- health ---- (youtube config flag is a safe diagnostic, no secrets)
  "GET /api/health": () => {
    let database = false;
    try { database = db.prepare("SELECT 1 AS ok").get()?.ok === 1; } catch {}
    return {
      ok: database,
      ts: now(),
      youtube: !!process.env.YOUTUBE_API_KEY,
      services: {
        database,
        youtubeConfigured: !!process.env.YOUTUBE_API_KEY,
        youtubeLookup: youtubeProviderStatus(),
        tourProviderConfigured: !!(process.env.TICKETMASTER_KEY || process.env.BANDSINTOWN_APP_ID),
        tourDates: db.prepare("SELECT COUNT(*) c FROM tour_dates").get().c,
        mailConfigured: mailConfigured(),
        mediaStorageConfigured: mediaConfigured(),
      },
    };
  },

  // Direct-to-object-storage photo uploads. The application server signs a
  // short-lived, user-owned key; the image bytes never pass through SQLite or
  // this JSON server. Persist `publicUrl` only after the PUT succeeds.
  "POST /api/media/presign": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "media-presign", 30, 10 * 60 * 1000);
    return createMediaPresign({ userId: u.id, body: ctx.body });
  },

  // ---- per-photo reactions (the full-screen media viewer) ----
  // Keyed by the media URL itself: unique per upload, so likes survive post
  // edits/reordering and follow the photo into artist galleries.
  "POST /api/media/react": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "media-react", 120, 10 * 60 * 1000);
    const url = cleanMediaReactionUrl(ctx.body?.url);
    if (!url) throw new ApiError(400, "That photo can't be liked.", "VALIDATION_FAILED");
    const postId = clean(ctx.body?.postId, { max: 60 }) || null;
    const existing = db.prepare("SELECT 1 FROM media_reactions WHERE media_url=? AND user_id=?").get(url, u.id);
    if (existing) db.prepare("DELETE FROM media_reactions WHERE media_url=? AND user_id=?").run(url, u.id);
    else db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)").run(url, u.id, postId, now());
    const count = db.prepare("SELECT COUNT(*) c FROM media_reactions WHERE media_url=?").get(url).c;
    return { liked: !existing, count };
  },

  // Batch counts for a photo set (one call when the viewer opens). Public read;
  // `mine` is filled only for a signed-in viewer.
  "POST /api/media/reactions": (ctx) => {
    limit(ctx, "media-react-read", 240, 10 * 60 * 1000);
    const urls = (Array.isArray(ctx.body?.urls) ? ctx.body.urls : []).map(cleanMediaReactionUrl).filter(Boolean).slice(0, 24);
    const out = {};
    for (const url of urls) {
      const count = db.prepare("SELECT COUNT(*) c FROM media_reactions WHERE media_url=?").get(url).c;
      const mine = ctx.user ? !!db.prepare("SELECT 1 FROM media_reactions WHERE media_url=? AND user_id=?").get(url, ctx.user.id) : false;
      out[url] = { count, mine };
    }
    return { reactions: out };
  },

  // ---- server clock ---- authoritative time so the calendar + scheduling don't
  // trust the device clock. Returns epoch ms, ISO, the server's IANA timezone and
  // its current UTC offset (minutes), so the client can render "today" correctly.
  "GET /api/time": () => {
    const d = new Date();
    let tz = "UTC";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch {}
    return { now: d.getTime(), iso: d.toISOString(), tz, offsetMinutes: -d.getTimezoneOffset() };
  },

  // ---- artist catalog (DB-backed; scales past the bundled JSON) ----
  // Search the catalog. Empty query → the top artists by rank. Notable artists
  // surface first (rank_score); exact name matches float to the top.
  "GET /api/artists": (ctx) => {
    const term = clean(ctx.query.q, { max: 80 }).toLowerCase();
    const lim = Math.min(40, Math.max(1, Number(ctx.query.limit) || 20));
    const rows = term.length >= 1
      ? artistStmts.search.all(`%${term.replace(/[%_\\]/g, "")}%`, term, lim)
      : artistStmts.top.all(lim);
    return { artists: rows.map(publicArtist), total: artistStmts.count.get().c };
  },

  // Resolve a public URL to the thing it names, so the client router can open
  // /turnstile without shipping the whole catalogue to guess with. Uses the same
  // lookup as the page metadata, so a shared link and a crawler agree.
  "GET /api/resolve": (ctx) => {
    const path = clean(ctx.query.path, { max: 300 });
    if (!path.startsWith("/")) throw new ApiError(400, "Missing path.");
    return { entity: resolveEntity(path) };
  },

  // Song search, so the search box works for someone who remembers the song but
  // not who made it. Deliberately Deezer-backed: it is keyless, so this costs no
  // YouTube quota. A playable video is resolved later, only if the song is
  // actually played.
  "GET /api/songs/search": async (ctx) => {
    const term = clean(ctx.query.q, { max: 80 });
    if (term.length < 2) return { songs: [] };
    limit(ctx, "song-search", 120, 10 * 60 * 1000);
    const want = Math.min(20, Math.max(1, Number(ctx.query.limit) || 12));

    // The catalogue answers first: it is in memory, needs no network, and only
    // contains acts we already know are real, so results appear instantly and
    // still work when a provider is down.
    const catalog = searchCatalogSongs(term, { limit: want });
    const seen = new Set(catalog.map((s) => `${normalizeMusicText(s.artist)}|${normalizeMusicText(s.title)}`));

    let remote = [];
    try {
      remote = await searchDeezerTracks(term, { limit: want });
    } catch {
      // A provider outage must not take the whole search box down. The
      // catalogue results above still stand, and the other sections (people,
      // artists, venues, events) are unaffected.
      remote = [];
    }

    const merged = [...catalog];
    for (const song of remote) {
      const identity = `${normalizeMusicText(song.artist)}|${normalizeMusicText(song.title)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push({ ...song, source: "provider" });
    }

    // Match quality outranks where the result came from. Listing the whole
    // catalogue first put its partial match ("This Photograph Is Proof") above
    // the songs actually called "Photograph", which is not what someone typing
    // that word wants. The catalogue only breaks ties, where it is preferred
    // because it is instant and already known to be a real touring act.
    const q = normalizeMusicText(term);
    const quality = (song) => {
      const title = normalizeMusicText(song.title);
      if (title === q) return 4;
      if (title.startsWith(q)) return 3;
      if (title.includes(q)) return 2;
      return 1;
    };
    merged.sort((a, b) =>
      quality(b) - quality(a)
      || (a.source === b.source ? 0 : a.source === "catalog" ? -1 : 1)
      || (Number(b.popularity) || 0) - (Number(a.popularity) || 0)
    );
    return { songs: merged.slice(0, want) };
  },

  // Resolve one artist by name. If it's not in the catalog yet, fetch it live from
  // MusicBrainz and insert it, so NO artist is ever "missing": the first person
  // to look one up creates it. Enrichment (photo/tracks) happens later.
  "GET /api/artists/resolve": async (ctx) => {
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    const existing = artistStmts.byNorm.get(normName(name));
    if (existing) { artistStmts.bumpSearches.run(normName(name)); return { artist: publicArtist(existing), created: false }; }
    limit(ctx, "resolve", 90, 10 * 60 * 1000); // cap outbound MB lookups per client
    const mb = await resolveFromMusicBrainz(name);
    if (!mb) {
      // Nothing found: log it for the admin catalog queue instead of a blind dump.
      artistStmts.recordMissing.run(normName(name), name, Date.now());
      return { artist: null, created: false };
    }
    artistStmts.upsert.run(artistRow(mb.name, mb, "musicbrainz"));
    artistStmts.bumpSearches.run(normName(mb.name));
    return { artist: publicArtist(artistStmts.byNorm.get(normName(mb.name))), created: true };
  },

  // Full discography metadata from Deezer. The durable cache intentionally omits
  // signed preview URLs; a fresh preview is resolved only when Play is pressed.
  // An optional deezerId (from the "pick the right artist" flow) re-pins identity
  // for same-named acts and refreshes the page to that artist's catalogue.
  "GET /api/artists/discography": async (ctx) => {
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    const deezerId = /^\d{1,15}$/.test(String(ctx.query.deezerId || "")) ? Number(ctx.query.deezerId) : null;
    limit(ctx, "discography", 40, 10 * 60 * 1000);
    try { return await getDeezerDiscography(name, { deezerId }); }
    catch (error) {
      if (error instanceof ProviderError) throw new ApiError(502, "The discography source missed its cue. Try again shortly.", "PROVIDER_UNAVAILABLE", error);
      throw error;
    }
  },

  // Same-named artists disambiguation: a short list of Deezer candidates (fans,
  // photo, album count) so a listener can pick the one they actually mean and
  // re-pin this name to that artist via the discography endpoint's deezerId.
  "GET /api/artists/candidates": async (ctx) => {
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    limit(ctx, "artist-candidates", 60, 10 * 60 * 1000);
    try { return { candidates: await findDeezerArtistCandidates(name) }; }
    catch (error) {
      if (error instanceof ProviderError) return { candidates: [] };
      throw error;
    }
  },

  // Resolve a fresh, identity-checked Deezer preview. These signed links expire
  // within minutes and are therefore cached only briefly in memory, never in DB.
  "GET /api/deezer/track": async (ctx) => {
    const title = clean(ctx.query.title, { max: 200 });
    const artist = clean(ctx.query.artist, { max: 120 });
    if (!title) throw new ApiError(400, "Missing title.");
    limit(ctx, "deezer-track", 180, 10 * 60 * 1000);
    try { return await getFreshDeezerPreview(title, artist); }
    catch (error) {
      if (error instanceof ProviderError) throw new ApiError(502, "The preview source missed its cue. Try again shortly.", "PROVIDER_UNAVAILABLE", error);
      throw error;
    }
  },

  // Resolve a track title (+ artist) to a YouTube video ID, so the in-app player
  // streams the full song/video. Candidate metadata, embeddability, artist/title,
  // duration, official-channel patterns, and known bad variants are scored before
  // a finite-lived cache entry is accepted.
  // Every public fan photo posted for this artist, newest first, with the
  // poster's name. The artist page's rolling gallery reads THIS instead of the
  // viewer's transient feed cache, so photos never vanish just because the post
  // scrolled off the first feed page.
  "GET /api/artists/photos": (ctx) => {
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    const rows = db.prepare(`SELECT p.id, p.photos, p.created_at, u.name AS by FROM posts p JOIN users u ON u.id = p.user_id
      WHERE LOWER(p.artist) = LOWER(?) AND p.removed = 0 AND p.photos_public = 1 AND p.photos != '[]'
      ORDER BY p.created_at DESC LIMIT 40`).all(name);
    const photos = [];
    for (const r of rows) {
      let list = []; try { list = JSON.parse(r.photos || "[]"); } catch {}
      for (const uri of list) {
        if (typeof uri === "string" && /^https?:\/\//i.test(uri)) photos.push({ uri, by: r.by, postId: r.id, at: r.created_at });
        if (photos.length >= 30) break;
      }
      if (photos.length >= 30) break;
    }
    return { photos };
  },

  // How many times the signed-in user has logged this artist ("you've been in
  // the pit with them N times" on the artist profile).
  "GET /api/artists/seen": (ctx) => {
    const u = requireUser(ctx);
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    const row = db.prepare("SELECT COUNT(*) c, MAX(date) last FROM posts WHERE user_id=? AND LOWER(artist)=LOWER(?) AND removed=0").get(u.id, name);
    return { count: row?.c || 0, last: row?.last || null };
  },

  "GET /api/youtube/track": async (ctx) => {
    const title = clean(ctx.query.title, { max: 200 });
    const artist = clean(ctx.query.artist, { max: 120 });
    if (!title) throw new ApiError(400, "Missing title.");
    limit(ctx, "yt", 120, 10 * 60 * 1000);
    // A human-pinned link always beats the search resolver. video_id NULL is an
    // admin-confirmed "no correct video exists": tell the player honestly so it
    // uses the preview instead of guessing a wrong version.
    const pinned = db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(trackOverrideKey(title, artist));
    if (pinned) return { videoId: pinned.video_id || null, status: pinned.video_id ? "pinned" : "confirmed_unavailable" };
    const duration = Math.max(0, Math.min(24 * 60 * 60, Number(ctx.query.duration) || 0));
    try { return await resolveYouTubeTrack(title, artist, { expectedDurationSec: duration }); }
    catch (error) {
      if (error instanceof ProviderError) return { videoId: null, status: error.code, retryable: error.retryable };
      throw error;
    }
  },

  // Turn a pasted YouTube link into a safe post attachment. The provider call is
  // keyless and only receives a canonical youtube.com URL derived from the video
  // id, so arbitrary user URLs are never fetched by the server.
  "GET /api/youtube/oembed": async (ctx) => {
    requireUser(ctx);
    limit(ctx, "yt-oembed", 60, 10 * 60 * 1000);
    const url = clean(ctx.query.url, { max: 500 });
    if (!url) throw new ApiError(400, "Paste a YouTube link to attach a video.", "VALIDATION_FAILED");
    const song = await youtubeOEmbed(url);
    if (!song) throw new ApiError(400, "That link is not a playable YouTube video.", "VALIDATION_FAILED");
    return { song };
  },

  // IFrame errors 100/101/150 mean a cached video is gone or cannot be embedded.
  // Remember the failed ID and re-resolve next time instead of replaying it.
  "POST /api/youtube/invalidate": (ctx) => {
    requireUser(ctx);
    limit(ctx, "yt-invalidate", 60, 60 * 60 * 1000);
    const title = clean(ctx.body?.title, { max: 200 });
    const artist = clean(ctx.body?.artist, { max: 120 });
    const videoId = clean(ctx.body?.videoId, { max: 32 });
    if (!title || !videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new ApiError(400, "That failed video could not be identified.", "VALIDATION_FAILED");
    return invalidateYouTubeTrack(title, artist, videoId);
  },

  // ---- Discover: DB-backed charts, genre share, explore-by-genre ----
  // Live from the whole catalog (not the bundled snapshot), so it reflects real
  // growth and re-ranks as popularity/plays change (new artists can take top spots).
  // `by=popularity` = the Deezer-tracked chart; `by=plays` = what Pit users actually
  // play. Optional genre + country filters power the interactive pie + explore.
  "GET /api/discover/chart": (ctx) => {
    const by = ctx.query.by === "plays" ? "plays" : "popularity";
    const n = Math.min(60, Math.max(3, Number(ctx.query.limit) || 24));
    const genre = clean(ctx.query.genre, { max: 60 });
    const country = clean(ctx.query.country, { max: 60 });
    if (by === "plays") {
      const rows = db.prepare("SELECT artist AS name, COUNT(*) AS plays FROM plays WHERE artist IS NOT NULL GROUP BY LOWER(artist) ORDER BY plays DESC, MAX(created_at) DESC LIMIT ?").all(n);
      return { source: "plays", label: "Most played on Pit", live: true, rows: rows.map((r, i) => chartRow(r.name, artistStmts.byNorm.get(normName(r.name)), i + 1, { plays: r.plays })) };
    }
    let sql = "SELECT * FROM artists WHERE popularity IS NOT NULL";
    const params = [];
    if (country && country !== "Worldwide") { sql += " AND country = ?"; params.push(country); }
    if (genre) { const raw = rawGenresFor(genre); if (!raw.length) return { source: "popularity", label: "By popularity", live: true, rows: [] }; sql += ` AND genre IN (${raw.map(() => "?").join(",")})`; params.push(...raw); }
    sql += " ORDER BY popularity DESC, rank_score DESC, name LIMIT ?"; params.push(n);
    const rows = db.prepare(sql).all(...params);
    return { source: "popularity", label: "By popularity", live: true, rows: rows.map((r, i) => chartRow(r.name, r, i + 1)) };
  },
  // Genre distribution for the pie, canonicalized (optionally scoped to a country).
  "GET /api/discover/genres": (ctx) => {
    const country = clean(ctx.query.country, { max: 60 });
    const n = Math.min(12, Math.max(4, Number(ctx.query.n) || 8));
    const rows = country && country !== "Worldwide"
      ? db.prepare("SELECT genre FROM artists WHERE genre IS NOT NULL AND country = ?").all(country)
      : db.prepare("SELECT genre FROM artists WHERE genre IS NOT NULL").all();
    const counts = {};
    for (const r of rows) { const c = canonGenre(r.genre); if (c) counts[c] = (counts[c] || 0) + 1; }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = rows.length || 1;
    const out = sorted.slice(0, n).map(([genre, count]) => ({ genre, count, pct: count / total }));
    const rest = sorted.slice(n).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) out.push({ genre: "Other", count: rest, pct: rest / total });
    // `total` counts artists; `distinctGenres` counts genres. Discover's stat
    // tile used to display the length of the charted slice, so a catalogue
    // spanning dozens of genres advertised "8 GENRES" -- the chart's own limit,
    // reported as a fact about the catalogue.
    return { total: rows.length, distinctGenres: sorted.length, catalogTotal: artistStmts.count.get().c, genres: out };
  },
  // Country distribution for the region chips (biggest scenes first).
  "GET /api/discover/countries": (ctx) => {
    const min = Math.max(1, Number(ctx.query.min) || 5);
    const rows = db.prepare("SELECT country, COUNT(*) c FROM artists WHERE country IS NOT NULL GROUP BY country HAVING c >= ? ORDER BY c DESC LIMIT 40").all(min);
    return { countries: rows.map((r) => ({ country: r.country, count: r.c })) };
  },

  // ---- Listening: cross-device play history + "friends listening" ----
  "POST /api/plays": (ctx) => {
    const u = requireUser(ctx);
    const title = clean(ctx.body?.title, { max: 200 });
    if (!title) return { ok: false };
    limit(ctx, "play", 300, 60 * 60 * 1000);
    const id = uid("play");
    const createdAt = now();
    const videoId = parseYouTubeVideoId(ctx.body?.videoId || "") || null;
    db.prepare("INSERT INTO plays (id,user_id,title,artist,url,video_id,art,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, u.id, title, clean(ctx.body?.artist, { max: 120 }) || null, clean(ctx.body?.url, { max: 400 }) || null, videoId, clean(ctx.body?.art, { max: 500 }) || null, createdAt);
    db.prepare("DELETE FROM plays WHERE user_id=? AND id NOT IN (SELECT id FROM plays WHERE user_id=? ORDER BY created_at DESC LIMIT 300)").run(u.id, u.id);
    return { ok: true, play: { id, title, artist: clean(ctx.body?.artist, { max: 120 }) || null, url: clean(ctx.body?.url, { max: 400 }) || null, videoId, art: clean(ctx.body?.art, { max: 500 }) || null, at: createdAt } };
  },
  "GET /api/me/plays": (ctx) => {
    const u = requireUser(ctx);
    const { cursor, limit: pageSize } = pageRequest(ctx, 50, 100);
    const cursorSql = cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : "";
    const args = cursor ? [u.id, cursor.createdAt, cursor.createdAt, cursor.id, pageSize + 1] : [u.id, pageSize + 1];
    const found = db.prepare(`SELECT id,title,artist,url,video_id,art,created_at FROM plays WHERE user_id=? ${cursorSql} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, pageSize);
    return { plays: rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist, url: r.url, videoId: r.video_id, art: r.art, at: r.created_at })), nextCursor };
  },
  // The latest track from each person you follow, most recent first.
  "GET /api/plays/friends": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare(`
      SELECT p.user_id, p.title, p.artist, p.url, p.art, p.created_at,
        us.name u_name, us.handle u_handle, us.initials u_initials, us.avatar_uri u_avatar, us.avatar_color u_color, us.verified u_verified, us.role u_role
      FROM plays p JOIN users us ON us.id = p.user_id
      WHERE p.user_id IN (SELECT followee_id FROM follows WHERE follower_id=?)
      ORDER BY p.created_at DESC LIMIT 200`).all(u.id);
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      out.push({ user: { id: r.user_id, name: r.u_name, handle: r.u_handle, initials: r.u_initials, avatarUri: r.u_avatar, avatarColor: r.u_color, verified: !!r.u_verified, role: r.u_role }, track: { title: r.title, artist: r.artist, url: r.url, art: r.art, at: r.created_at } });
      if (out.length >= 30) break;
    }
    return { listening: out };
  },

  // ---- Playlists (saved sessions, shareable, on the profile) ----
  "POST /api/playlists": (ctx) => {
    const u = requireUser(ctx);
    const name = clean(ctx.body?.name, { max: 80 }) || "Untitled";
    const tracks = cleanPlaylistTracks(ctx.body?.tracks, { allowEmpty: false });
    if (!tracks) throw new ApiError(400, "A playlist needs at least one song.", "VALIDATION_FAILED");
    const visibility = cleanPlaylistVisibility(ctx.body?.visibility);
    const id = uid("pls");
    const createdAt = now();
    db.prepare("INSERT INTO playlists (id,user_id,name,tracks,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, u.id, name, JSON.stringify(tracks), visibility, createdAt, createdAt);
    return playlistProjection({ id, user_id: u.id, u_name: u.name, u_handle: u.handle, name, tracks: JSON.stringify(tracks), visibility, created_at: createdAt, updated_at: createdAt });
  },
  "GET /api/users/:id/playlists": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const self = ctx.user?.id === ctx.params.id;
    const rows = db.prepare(`SELECT p.*, u.name AS u_name, u.handle AS u_handle FROM playlists p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=? ${self ? "" : "AND p.visibility='public'"} ORDER BY COALESCE(p.updated_at,p.created_at) DESC, p.id DESC LIMIT 50`).all(ctx.params.id);
    return { playlists: rows.map(playlistProjection) };
  },
  "GET /api/playlists/:id": (ctx) => {
    const row = db.prepare(`SELECT p.*, u.name AS u_name, u.handle AS u_handle FROM playlists p JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(ctx.params.id);
    if (!row || blockedEitherWay(ctx.user?.id, row.user_id)) throw new ApiError(404, "That playlist isn't available.", "NOT_FOUND");
    if (row.visibility === "private" && ctx.user?.id !== row.user_id) throw new ApiError(404, "That playlist isn't available.", "NOT_FOUND");
    return { playlist: playlistProjection(row) };
  },
  // Add tracks to (and/or rename) an existing playlist. Lets people build a
  // playlist one song at a time instead of only snapshotting a whole session.
  "PATCH /api/playlists/:id": (ctx) => {
    const u = requireUser(ctx);
    const row = db.prepare("SELECT * FROM playlists WHERE id=? AND user_id=?").get(ctx.params.id, u.id);
    if (!row) throw new ApiError(404, "That playlist left the set.", "NOT_FOUND");
    let storedTracks = [];
    try { storedTracks = JSON.parse(row.tracks || "[]"); } catch {}
    let tracks = cleanPlaylistTracks(storedTracks) || [];
    if (Object.prototype.hasOwnProperty.call(ctx.body || {}, "tracks")) {
      const replacement = cleanPlaylistTracks(ctx.body.tracks);
      if (!replacement) throw new ApiError(400, "Those playlist songs are invalid.", "VALIDATION_FAILED");
      tracks = replacement;
    }
    const incoming = Array.isArray(ctx.body?.add) ? ctx.body.add : (ctx.body?.track ? [ctx.body.track] : []);
    const add = cleanPlaylistTracks(incoming);
    if (!add) throw new ApiError(400, "A playlist can hold up to 100 valid songs.", "VALIDATION_FAILED");
    for (const t of add) {
      const key = t.videoId ? `youtube:${t.videoId}` : t.sourceId ? `source:${t.provider || "unknown"}:${t.sourceId.toLowerCase()}` : t.url ? `url:${t.url.toLowerCase()}` : `text:${(t.artist || "").toLowerCase()}|${t.title.toLowerCase()}`;
      const exists = cleanPlaylistTracks(tracks)?.some((x) => {
        const existingKey = x.videoId ? `youtube:${x.videoId}` : x.sourceId ? `source:${x.provider || "unknown"}:${x.sourceId.toLowerCase()}` : x.url ? `url:${x.url.toLowerCase()}` : `text:${(x.artist || "").toLowerCase()}|${x.title.toLowerCase()}`;
        return existingKey === key;
      });
      if (!exists) tracks.push(t);
    }
    if (tracks.length > 100) throw new ApiError(400, "This playlist is full at 100 songs.", "VALIDATION_FAILED");
    const name = Object.prototype.hasOwnProperty.call(ctx.body || {}, "name") ? clean(ctx.body.name, { max: 80 }) : row.name;
    if (!name) throw new ApiError(400, "Give this playlist a name.", "VALIDATION_FAILED");
    let visibility = row.visibility || "public";
    if (Object.prototype.hasOwnProperty.call(ctx.body || {}, "visibility")) {
      const requested = clean(ctx.body.visibility, { max: 20 });
      if (!PLAYLIST_VISIBILITIES.has(requested)) throw new ApiError(400, "Choose public, unlisted, or private.", "VALIDATION_FAILED");
      visibility = requested;
    }
    const updatedAt = now();
    db.prepare("UPDATE playlists SET tracks=?, name=?, visibility=?, updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(tracks), name, visibility, updatedAt, ctx.params.id, u.id);
    return { playlist: playlistProjection({ ...row, name, tracks: JSON.stringify(tracks), visibility, updated_at: updatedAt, u_name: u.name, u_handle: u.handle }) };
  },
  "DELETE /api/playlists/:id": (ctx) => {
    const u = requireUser(ctx);
    const result = db.prepare("DELETE FROM playlists WHERE id=? AND user_id=?").run(ctx.params.id, u.id);
    if (!result.changes) throw new ApiError(404, "That playlist already left the set.", "NOT_FOUND");
    return { ok: true };
  },

  // ---- auth ----
  "POST /api/signup": (ctx) => {
    limit(ctx, "signup", 5, 15 * 60 * 1000);
    const [errs, v] = shape(ctx.body, {
      name: { required: true, parse: (x) => (isName(x) ? cleanName(x) : undefined) },
      email: { required: true, parse: (x) => (isEmail(x) ? cleanEmail(x) : undefined) },
      password: { required: true, parse: (x) => (isPassword(x) ? x : undefined) },
      city: { required: false, parse: (x) => clean(x, { max: LIMITS.city }) || undefined },
      lat: { required: false, parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      lng: { required: false, parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    if (q.userByEmail.get(v.email)) throw new ApiError(409, "That email is already registered.");
    const id = uid("u");
    const initials = (v.name.match(/\p{L}|\p{N}/gu) || ["?"]).slice(0, 2).join("").toUpperCase();
    const colors = ["#F2A65A", "#E0457B", "#5B8DEF", "#6FCF97", "#B98AE0", "#E8B65A"];
    q.insertUser.run(id, v.email, v.name, uniqueHandle(v.email.split("@")[0]), hashPassword(v.password),
      "fan", v.city ?? null, v.lat ?? null, v.lng ?? null, initials, colors[Math.floor(Math.random() * colors.length)], now());
    const sess = createSession(id, ctx.ip, ctx.ua);
    ctx.setSession(sess);
    return { user: publicUser(q.userById.get(id), { self: true }) };
  },

  "POST /api/login": (ctx) => {
    limit(ctx, "login", 10, 10 * 60 * 1000);
    const [errs, v] = shape(ctx.body, {
      email: { required: true, parse: (x) => cleanEmail(x) || undefined },
      password: { required: true, parse: (x) => (typeof x === "string" ? x.slice(0, 100) : undefined) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const u = q.userByEmail.get(v.email);
    // same error either way, never reveal which part was wrong
    if (!u || !verifyPassword(v.password, u.pass_hash)) throw new ApiError(401, "Wrong email or password.", "AUTH_INVALID");
    if (u.is_banned) throw new ApiError(403, "This account is banned.");
    const sess = createSession(u.id, ctx.ip, ctx.ua);
    ctx.setSession(sess);
    return { user: publicUser(u, { self: true }) };
  },

  "POST /api/logout": (ctx) => {
    destroySession(ctx.token);
    ctx.clearSession();
    return { ok: true };
  },

  // Forgot password — email a one-hour reset link. Always responds the same way so
  // it never reveals which emails have accounts. Reset secrets are never logged.
  "POST /api/forgot": async (ctx) => {
    limit(ctx, "forgot", 5, 15 * 60 * 1000);
    const email = cleanEmail(ctx.body?.email);
    const generic = { ok: true };
    if (!email) return generic;
    const u = q.userByEmail.get(email);
    if (!u || u.is_banned) return generic;
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    db.prepare("UPDATE users SET reset_hash=?, reset_expires=? WHERE id=?").run(hash, Date.now() + 60 * 60 * 1000, u.id);
    const configuredOrigin = (process.env.PUBLIC_ORIGIN || "").replace(/\/+$/, "");
    const publicOrigin = configuredOrigin || (process.env.NODE_ENV === "production" ? "https://www.mshpit.com" : ctx.origin);
    const link = `${publicOrigin}/?reset=${token}`;
    const r = await sendEmail({
      to: email,
      subject: "Reset your Pit password",
      idempotencyKey: `password-reset-${hash.slice(0, 32)}`,
      text: `Reset your Pit password with this link (valid 1 hour):\n${link}\n\nIf you didn't request this, ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#FF8C42">Reset your Pit password</h2><p>Tap the button to set a new password. This link is valid for 1 hour.</p><p><a href="${link}" style="display:inline-block;background:#FF8C42;color:#1A1206;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">Reset password</a></p><p style="color:#888;font-size:13px">If you didn't request this, you can safely ignore this email.</p></div>`,
    });
    if (!r.sent) console.warn(`[reset] email delivery unavailable (${r.reason}); no reset secret was logged.`);
    return generic;
  },

  // Complete a reset: swap the password, invalidate the token + all sessions, and
  // sign the user straight in on this device.
  "POST /api/reset": (ctx) => {
    limit(ctx, "reset", 10, 15 * 60 * 1000);
    const token = clean(ctx.body?.token, { max: 200 });
    const password = typeof ctx.body?.password === "string" ? ctx.body.password : "";
    if (!token || !isPassword(password)) throw new ApiError(400, "Need a valid link and a new password of at least 8 characters.");
    const hash = createHash("sha256").update(token).digest("hex");
    const u = db.prepare("SELECT * FROM users WHERE reset_hash=? AND reset_expires > ?").get(hash, Date.now());
    if (!u) throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.");
    db.prepare("UPDATE users SET pass_hash=?, reset_hash=NULL, reset_expires=0 WHERE id=?").run(hashPassword(password), u.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id); // sign out everywhere else
    const sess = createSession(u.id, ctx.ip, ctx.ua);
    ctx.setSession(sess);
    return { user: publicUser(q.userById.get(u.id), { self: true }) };
  },

  "GET /api/me": (ctx) => ({ user: ctx.user ? publicUser(ctx.user, { self: true }) : null }),

  // The ids this account follows, lets the client hydrate its follow graph on
  // login / a new device (SQLite migration slice 1, see MIGRATION.md).
  "GET /api/me/following": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare("SELECT followee_id FROM follows WHERE follower_id = ?").all(u.id);
    return { following: rows.map((r) => r.followee_id) };
  },

  // ---- profile ----
  "PATCH /api/me": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "profile", 30, 10 * 60 * 1000);

    // Reject invalid/oversized metadata atomically. Truncating serialized JSON
    // can leave an account with malformed data that breaks every projection.
    const hasExtras = Object.prototype.hasOwnProperty.call(ctx.body || {}, "extras");
    const serializedExtras = hasExtras ? serializeProfileExtras(ctx.body.extras) : undefined;
    if (hasExtras && serializedExtras === null) {
      throw new ApiError(400, `extras must be a JSON object no larger than ${PROFILE_EXTRAS_MAX_BYTES} bytes.`);
    }

    const [, v] = shape(ctx.body, {
      name: { parse: (x) => (isName(x) ? cleanName(x) : undefined) },
      handle: { parse: (x) => { const h = cleanHandle(x); return h && h.length >= 3 ? h : undefined; } },
      bio: { parse: (x) => clean(x, { max: LIMITS.bio, newlines: true }) },
      banner: { parse: (x) => clean(x, { max: 2000 }) },
      avatarUri: { parse: (x) => clean(x, { max: 2000 }) },
      city: { parse: (x) => clean(x, { max: LIMITS.city }) || undefined },
      lat: { parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      lng: { parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      genres: { parse: (x) => cleanStringArray(x, { maxItems: 12, maxLen: 30 }) },
      favoriteArtists: { parse: (x) => cleanStringArray(x, { maxItems: 50, maxLen: 80 }) },
      // Keep this server allow-list aligned with theme.js. If it falls behind,
      // newer themes get silently rejected here, the server then re-hydrates the
      // stale theme on /api/me and the client "snaps back" to a previous theme.
      theme: { parse: (x) => (["stage", "neon", "forest", "ember", "backstage", "vinyl", "daylight", "ice", "rose", "mint", "sunset", "lavender"].includes(x) ? x : undefined) },
      extras: { parse: () => serializedExtras },
    });
    const sets = [];
    const args = [];
    if (v.name) { sets.push("name = ?", "initials = ?"); args.push(v.name, (v.name.match(/\p{L}|\p{N}/gu) || ["?"]).slice(0, 2).join("").toUpperCase()); }
    // @handle change: unique + role-tag + a 10-business-day cooldown.
    if (v.handle && v.handle !== u.handle) {
      const taken = q.userByHandle.get(v.handle);
      if (taken && taken.id !== u.id) throw new ApiError(409, "That username is taken.");
      if (!handleAllowedForRole(v.handle, u.role)) {
        throw new ApiError(400, u.role === "admin" ? 'Admin usernames must contain "admin".' : 'Moderator usernames must contain "mod".');
      }
      if (u.handle_changed_at) {
        const nextAt = addBusinessDays(u.handle_changed_at, HANDLE_COOLDOWN_DAYS);
        if (now() < nextAt) {
          const when = new Date(nextAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          throw new ApiError(429, `Username can only change every ${HANDLE_COOLDOWN_DAYS} business days, next change available ${when}.`);
        }
      }
      sets.push("handle = ?", "handle_changed_at = ?"); args.push(v.handle, now());
    }
    if (v.bio !== undefined) { sets.push("bio = ?"); args.push(v.bio); }
    if (v.banner !== undefined) { sets.push("banner = ?"); args.push(v.banner); }
    if (v.avatarUri !== undefined) { sets.push("avatar_uri = ?"); args.push(v.avatarUri); }
    if (v.city !== undefined) { sets.push("home_city = ?", "home_lat = ?", "home_lng = ?"); args.push(v.city, v.lat ?? null, v.lng ?? null); }
    if (v.genres) { sets.push("genres = ?"); args.push(JSON.stringify(v.genres)); }
    if (v.favoriteArtists) { sets.push("favorite_artists = ?"); args.push(JSON.stringify(v.favoriteArtists)); }
    // Theme is stored inside the extras blob, so it survives sign-out and follows
    // the account. Merge it with an extras patch when both arrive together.
    if (v.theme) {
      const cur = parseStoredProfileExtras(v.extras ?? u.extras);
      cur.theme = v.theme;
      const encoded = serializeProfileExtras(cur);
      if (!encoded) throw new ApiError(400, `profile metadata must be no larger than ${PROFILE_EXTRAS_MAX_BYTES} bytes.`);
      sets.push("extras = ?"); args.push(encoded);
    } else if (v.extras !== undefined) { sets.push("extras = ?"); args.push(v.extras); }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...args, u.id);
    const updatedUser = q.userById.get(u.id);
    if (parseStoredProfileExtras(updatedUser.extras).analyticsOptOut) db.prepare("DELETE FROM events WHERE user_id=?").run(u.id);
    return { user: publicUser(updatedUser, { self: true }) };
  },

  // People search + member directory (find friends), cross-device.
  //  - q >= 1 char: substring match on name/handle (exact matches float to top).
  //  - q empty: browse the newest members, so you can find people WITHOUT knowing
  //    their exact handle (the "I can't locate anyone" fix).
  // Always returns `total` = member count, so the app can show a real stat.
  "GET /api/people": (ctx) => {
    const term = clean(ctx.query.q, { max: 60 }).toLowerCase();
    const total = db.prepare("SELECT COUNT(*) c FROM users WHERE is_banned=0").get().c;
    const cols = "id,name,handle,initials,avatar_uri,avatar_color,verified,role,home_city";
    const map = (r) => ({ id: r.id, name: r.name, handle: r.handle, initials: r.initials, avatarUri: r.avatar_uri, avatarColor: r.avatar_color, verified: !!r.verified, role: r.role, home: { city: r.home_city } });
    // Never surface someone you've blocked (or who blocked you) in search.
    const hidden = blockedIdSet(ctx.user?.id);
    if (term.length < 1) {
      const rows = db.prepare(`SELECT ${cols} FROM users WHERE is_banned=0 ORDER BY created_at DESC LIMIT 60`).all();
      return { users: rows.filter((r) => !hidden.has(r.id)).map(map).slice(0, 40), total };
    }
    const like = `%${term.replace(/[%_\\]/g, "")}%`;
    const rows = db.prepare(
      `SELECT ${cols} FROM users WHERE is_banned=0 AND (lower(name) LIKE ? OR lower(handle) LIKE ?) ORDER BY (lower(handle)=? OR lower(name)=?) DESC, name LIMIT 40`
    ).all(like, like, term, term);
    return { users: rows.filter((r) => !hidden.has(r.id)).map(map).slice(0, 30), total };
  },

  "GET /api/users/:id": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const u = q.userById.get(ctx.params.id);
    if (!u) throw new ApiError(404, "No such user.");
    const followers = db.prepare("SELECT COUNT(*) c FROM follows WHERE followee_id = ?").get(u.id).c;
    const following = db.prepare("SELECT COUNT(*) c FROM follows WHERE follower_id = ?").get(u.id).c;
    const isFollowing = ctx.user ? !!db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(ctx.user.id, u.id) : false;
    return { user: publicUser(u), followers, following, isFollowing };
  },

  // The real people behind the follower/following numbers, so profiles have a
  // clickable follow list like any social platform.
  "GET /api/users/:id/followers": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const hidden = blockedIdSet(ctx.user?.id);
    const rows = db.prepare(`
      SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ? ORDER BY u.name COLLATE NOCASE LIMIT 500`).all(ctx.params.id);
    return { users: rows.filter((r) => !hidden.has(r.id)).map((r) => publicUser(r)) };
  },
  "GET /api/users/:id/following": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const hidden = blockedIdSet(ctx.user?.id);
    const rows = db.prepare(`
      SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = ? ORDER BY u.name COLLATE NOCASE LIMIT 500`).all(ctx.params.id);
    return { users: rows.filter((r) => !hidden.has(r.id)).map((r) => publicUser(r)) };
  },

  "GET /api/users/:id/rewards": (ctx) => {
    if (!q.userById.get(ctx.params.id)) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    return userRewards(ctx.params.id);
  },

  "POST /api/users/:id/follow": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "follow", 60, 10 * 60 * 1000);
    if (u.id === ctx.params.id) throw new ApiError(400, "You can't follow yourself.");
    if (!q.userById.get(ctx.params.id)) throw new ApiError(404, "No such user.");
    if (blockedEitherWay(u.id, ctx.params.id)) throw new ApiError(403, "You can't follow this account.");
    const has = !!db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(u.id, ctx.params.id);
    const following = desiredState(ctx.body, "following", has);
    if (!following && has) db.prepare("DELETE FROM follows WHERE follower_id=? AND followee_id=?").run(u.id, ctx.params.id);
    else if (following && !has) { db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(u.id, ctx.params.id); addNotif(ctx.params.id, u.id, "follow"); }
    return { following };
  },

  // ---- blocks: a real block, not a mute. Severs the follow both ways, stops
  // DMs in both directions, and hides each other's posts from the feed. ----
  "POST /api/users/:id/block": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "block", 30, 10 * 60 * 1000);
    const other = ctx.params.id;
    if (other === u.id) throw new ApiError(400, "You can't block yourself.");
    if (!q.userById.get(other)) throw new ApiError(404, "No such user.");
    const has = !!db.prepare("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?").get(u.id, other);
    const blocked = desiredState(ctx.body, "blocked", has);
    if (!blocked && has) {
      db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(u.id, other);
    } else if (blocked && !has) {
      db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(u.id, other, now());
      // Sever the relationship both ways so neither keeps the other in a list.
      db.prepare("DELETE FROM follows WHERE (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?)").run(u.id, other, other, u.id);
    }
    return { blocked };
  },
  "GET /api/me/blocked": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare(`
      SELECT us.* FROM blocks b JOIN users us ON us.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC LIMIT 500`).all(u.id);
    return { users: rows.map((r) => publicUser(r)) };
  },

  // ---- personal data export: a portable backup of this account's data.
  // High-volume histories are bounded until this becomes an asynchronous archive
  // job; the response documents those windows rather than claiming completeness.
  "GET /api/me/export": (ctx) => {
    // Privacy rights remain available even while posting/browsing is restricted.
    const u = requireSessionUser(ctx);
    limit(ctx, "export", 5, 10 * 60 * 1000);
    const name = (id) => { const x = q.userById.get(id); return x ? { id, name: x.name, handle: x.handle } : { id }; };
    const json = (value, fallback) => {
      try { return value ? JSON.parse(value) : fallback; }
      catch { return fallback; }
    };
    return {
      exportedAt: new Date().toISOString(),
      exportNotes: [
        "Password hashes, reset credentials, provider tokens, session cookies, raw IP addresses, and user-agent strings are intentionally excluded.",
        "Uploaded media files are represented by the URLs attached to exported records; storage-provider audit metadata is not part of the account export.",
        "This synchronous export includes up to 300 plays, 1,000 sent and received messages, 200 notifications, and 5,000 activity events. A queued archive job is required before production-scale launch.",
      ],
      profile: publicUser(u, { self: true }),
      posts: db.prepare("SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC").all(u.id)
        .map((p) => ({ id: p.id, kind: p.kind || "review", artist: p.artist, venue: p.venue, city: p.city, date: p.date, overall: p.overall, band: p.band, room: p.room, review: p.review, tour: p.tour, setlist: json(p.setlist, []), photos: json(p.photos, []), song: json(p.song, null), playlist: json(p.playlist, null), removed: !!p.removed, createdAt: p.created_at })),
      comments: db.prepare("SELECT post_id, text, removed, created_at FROM comments WHERE user_id=? ORDER BY created_at DESC").all(u.id)
        .map((c) => ({ postId: c.post_id, text: c.text, removed: !!c.removed, createdAt: c.created_at })),
      likedPosts: db.prepare("SELECT post_id FROM likes WHERE user_id=?").all(u.id).map((r) => r.post_id),
      following: db.prepare("SELECT followee_id id FROM follows WHERE follower_id=?").all(u.id).map((r) => name(r.id)),
      followers: db.prepare("SELECT follower_id id FROM follows WHERE followee_id=?").all(u.id).map((r) => name(r.id)),
      blocked: db.prepare("SELECT blocked_id id FROM blocks WHERE blocker_id=?").all(u.id).map((r) => name(r.id)),
      playlists: db.prepare("SELECT id,name,tracks,visibility,created_at,updated_at FROM playlists WHERE user_id=? ORDER BY created_at DESC").all(u.id)
        .map((r) => ({ id: r.id, name: r.name, tracks: json(r.tracks, []), visibility: r.visibility || "public", createdAt: r.created_at, updatedAt: r.updated_at || null })),
      listeningHistory: db.prepare("SELECT title,artist,url,video_id,created_at FROM plays WHERE user_id=? ORDER BY created_at DESC LIMIT 300").all(u.id)
        .map((r) => ({ title: r.title, artist: r.artist, url: r.url, videoId: r.video_id, at: r.created_at })),
      going: db.prepare("SELECT artist, venue, city, date FROM going WHERE user_id=?").all(u.id),
      ratings: db.prepare("SELECT kind, ref, rating FROM ratings WHERE user_id=?").all(u.id),
      venueReviews: db.prepare("SELECT id,venue_key,rating,text,photos,removed,created_at FROM venue_reviews WHERE user_id=? ORDER BY created_at DESC").all(u.id)
        .map((r) => ({ id: r.id, venueKey: r.venue_key, rating: r.rating, text: r.text, photos: json(r.photos, []), removed: !!r.removed, createdAt: r.created_at })),
      fanClubs: {
        memberships: db.prepare("SELECT artist FROM fan_club_members WHERE user_id=? ORDER BY artist COLLATE NOCASE").all(u.id).map((r) => r.artist),
        messages: db.prepare("SELECT id,artist,text,removed,created_at FROM fan_club_messages WHERE user_id=? ORDER BY created_at DESC").all(u.id)
          .map((r) => ({ id: r.id, artist: r.artist, text: r.text, removed: !!r.removed, createdAt: r.created_at })),
      },
      loungeMessages: db.prepare("SELECT id,lounge_id,text,removed,created_at FROM lounge_messages WHERE user_id=? ORDER BY created_at DESC").all(u.id)
        .map((r) => ({ id: r.id, loungeId: r.lounge_id, text: r.text, removed: !!r.removed, createdAt: r.created_at })),
      messagesSent: db.prepare("SELECT to_id, text, created_at FROM dms WHERE from_id=? ORDER BY created_at DESC LIMIT 1000").all(u.id)
        .map((m) => ({ to: name(m.to_id), text: m.text, createdAt: m.created_at })),
      messagesReceived: db.prepare("SELECT from_id, text, created_at FROM dms WHERE to_id=? ORDER BY created_at DESC LIMIT 1000").all(u.id)
        .map((m) => ({ from: name(m.from_id), text: m.text, createdAt: m.created_at })),
      artistAccount: {
        requests: db.prepare("SELECT id,artist_name,note,status,created_at FROM artist_requests WHERE user_id=? ORDER BY created_at DESC").all(u.id)
          .map((r) => ({ id: r.id, artistName: r.artist_name, note: r.note, status: r.status, createdAt: r.created_at })),
        profiles: db.prepare("SELECT artist_key,bio,banner,avatar_uri,feed_enabled,updated_at FROM artist_profiles WHERE owner_id=?").all(u.id)
          .map((r) => ({ artistKey: r.artist_key, bio: r.bio, banner: r.banner, avatarUri: r.avatar_uri, feedEnabled: !!r.feed_enabled, updatedAt: r.updated_at })),
        posts: db.prepare("SELECT id,artist_key,text,created_at FROM artist_posts WHERE user_id=? ORDER BY created_at DESC").all(u.id)
          .map((r) => ({ id: r.id, artistKey: r.artist_key, text: r.text, createdAt: r.created_at })),
      },
      reportsSubmitted: db.prepare("SELECT id,target_type,target_id,reason,status,created_at FROM reports WHERE reporter_id=? ORDER BY created_at DESC").all(u.id)
        .map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, status: r.status, createdAt: r.created_at })),
      activityEvents: db.prepare("SELECT id,name,props,created_at FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 5000").all(u.id)
        .map((r) => ({ id: r.id, name: r.name, properties: json(r.props, {}), createdAt: r.created_at })),
      notifications: db.prepare("SELECT type, actor_id, artist, text, created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 200").all(u.id)
        .map((n) => ({ type: n.type, from: n.actor_id ? name(n.actor_id) : null, artist: n.artist, text: n.text, at: n.created_at })),
    };
  },

  // Permanent account deletion. Password confirmation and a tight rate limit
  // guard the destructive action. Rows whose foreign keys would otherwise be
  // anonymized with SET NULL are explicitly removed before deleting the user;
  // all remaining account-owned rows disappear through FK cascades.
  "DELETE /api/me": (ctx) => {
    // A moderation restriction cannot trap someone in the service.
    const u = requireSessionUser(ctx);
    limit(ctx, "delete-account", 5, 60 * 60 * 1000);
    const password = typeof ctx.body?.password === "string" ? ctx.body.password : "";
    if (!password) throw new ApiError(400, "Enter your current password to delete your account.", "VALIDATION_FAILED");
    if (!verifyPassword(password, u.pass_hash)) throw new ApiError(401, "That password doesn't match your account.", "AUTH_INVALID");

    db.exec("BEGIN IMMEDIATE");
    try {
      // These relationships use ON DELETE SET NULL so shared rows can normally
      // survive account changes. Deletion is a privacy erasure, so remove the
      // account's authored/attributable records instead of leaving them behind.
      db.prepare("DELETE FROM notifications WHERE actor_id=?").run(u.id);
      db.prepare("DELETE FROM events WHERE user_id=?").run(u.id);
      db.prepare(`DELETE FROM reports WHERE reporter_id=?
        OR (target_type='user' AND target_id=?)
        OR (target_type='post' AND target_id IN (SELECT id FROM posts WHERE user_id=?))
        OR (target_type='comment' AND target_id IN (SELECT id FROM comments WHERE user_id=?))
        OR (target_type='message' AND target_id IN (SELECT id FROM dms WHERE from_id=? OR to_id=?))`
      ).run(u.id, u.id, u.id, u.id, u.id, u.id);
      db.prepare("DELETE FROM artist_posts WHERE user_id=?").run(u.id);
      db.prepare("DELETE FROM artist_profiles WHERE owner_id=?").run(u.id);
      db.prepare("DELETE FROM users WHERE id=?").run(u.id);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    ctx.clearSession?.();
    return { ok: true };
  },

  // ---- tour dates (scraped into the DB by server/tourdates.js) ----
  "GET /api/discovery/sidebar": (ctx) => discoverySidebar(ctx.user),

  "GET /api/tourdates": () => {
    const rows = db.prepare("SELECT * FROM tour_dates ORDER BY date ASC LIMIT 5000").all();
    return {
      tourDates: rows.map((r) => ({
        id: r.id, artist: r.artist, venue: r.venue, place: r.place,
        lat: r.lat, lng: r.lng, date: r.date, ticketUrl: r.ticket_url,
        soldOut: !!r.sold_out, source: r.source, releaseAt: 0, createdBy: "import",
      })),
    };
  },

  // ---- feed / posts ----
  "GET /api/feed": (ctx) => {
    const { cursor, limit: lim } = pageRequest(ctx, 30, 100);
    const requestedOffset = Number(ctx.query?.offset);
    const off = !cursor && Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? Math.min(requestedOffset, 1_000_000) : 0;
    const viewer = ctx.user?.id;
    const blockSql = viewer ? `AND NOT EXISTS (
      SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)
    )` : "";
    const cursorSql = cursor ? "AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))" : "";
    const args = [];
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    if (viewer) args.push(viewer, viewer);
    args.push(lim + 1);
    if (!cursor) args.push(off);
    // Moderators see which cards carry open reports right on the feed, so
    // flagged content is visible in context instead of only in the queue.
    const staff = ctx.user && (ctx.user.role === "admin" || ctx.user.role === "moderator");
    const flagSql = staff ? `, (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.status = 'open') AS open_reports` : "";
    const found = db.prepare(`
      SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.removed = 0) AS comment_count,
        ${SEEN_ORDINAL_SQL}${flagSql}
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.removed = 0 ${cursorSql} ${blockSql}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?${cursor ? "" : " OFFSET ?"}`).all(...args);
    const { rows, nextCursor } = finishPage(found, lim);
    return { posts: rows.map((p) => postJson(p, viewer)), nextCursor };
  },

  "GET /api/posts/:id/playlist": (ctx) => {
    const row = db.prepare("SELECT user_id,playlist,removed FROM posts WHERE id=?").get(ctx.params.id);
    if (!row || row.removed || !row.playlist || blockedEitherWay(ctx.user?.id, row.user_id)) {
      throw new ApiError(404, "That shared playlist isn't available.", "NOT_FOUND");
    }
    let playlist = null;
    try { playlist = JSON.parse(row.playlist); } catch {}
    if (!playlist?.id || !Array.isArray(playlist.tracks)) throw new ApiError(404, "That shared playlist isn't available.", "NOT_FOUND");
    return { playlist: { ...playlist, tracks: cleanPlaylistTracks(playlist.tracks) || [] } };
  },

  // Clips reel: the same posts as the feed, but only the ones carrying a video,
  // newest first, for the vertical swipe-through mode. Each row keeps its full
  // post projection (so likes/comments/artist all work) plus a `clips` array of
  // just the video URLs. Blocks respected; same (created_at,id) cursor as feed.
  "GET /api/clips": (ctx) => {
    const { cursor, limit: lim } = pageRequest(ctx, 12, 30);
    const viewer = ctx.user?.id;
    const blockSql = viewer ? `AND NOT EXISTS (
      SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)
    )` : "";
    const cursorSql = cursor ? "AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))" : "";
    const args = [];
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    if (viewer) args.push(viewer, viewer);
    args.push(lim + 1);
    // A cheap prefilter in SQL (photos JSON mentions a video extension); the
    // authoritative per-URL check happens in JS below.
    const found = db.prepare(`
      SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.removed = 0) AS comment_count,
        ${SEEN_ORDINAL_SQL}
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.removed = 0 AND p.photos_public = 1
        AND (p.photos LIKE '%.mp4%' OR p.photos LIKE '%.webm%' OR p.photos LIKE '%.mov%' OR p.photos LIKE '%.m4v%')
        ${cursorSql} ${blockSql}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, lim);
    const isClip = (u) => typeof u === "string" && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u) && /^https?:\/\//i.test(u);
    const clips = rows
      .map((p) => {
        const projected = postJson(p, viewer); // photos already parsed here
        return { ...projected, clips: (projected.photos || []).filter(isClip) };
      })
      .filter((p) => p.clips.length > 0);
    return { clips, nextCursor };
  },

  "GET /api/users/:id/posts": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const rows = db.prepare(`
      SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.removed = 0) AS comment_count,
        ${SEEN_ORDINAL_SQL}
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.removed = 0 AND p.user_id = ? ORDER BY p.created_at DESC LIMIT 100`).all(ctx.params.id);
    return { posts: rows.map((p) => postJson(p, ctx.user?.id)) };
  },

  "POST /api/posts": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "post", 20, 60 * 60 * 1000);

    // A plain status/update post ("post whatever", not a concert review): just
    // text and/or photos, no artist/venue/rating. It shares the posts table so
    // it flows through the same feed, likes, comments, and moderation, and the
    // rating/show columns stay empty (overall 0 so it never inflates any chart).
    if (ctx.body?.kind === "status") {
      const [errs, v] = shape(ctx.body, {
        review: { parse: (x) => clean(x, { max: LIMITS.review, newlines: true }) },
        photos: { parse: (x) => cleanStringArray(x, { maxItems: 8, maxLen: 2000 }) },
        photosPublic: { parse: (x) => typeof x === "boolean" ? (x ? 1 : 0) : x === 0 || x === 1 ? x : undefined },
        song: { parse: cleanSong },
      });
      if (errs.length) throw new ApiError(400, errs[0]);
      const text = v.review || "";
      const photos = v.photos || [];
      const playlist = playlistSnapshotForPost(u, ctx.body?.playlistId);
      if (!text && !photos.length && !v.song && !playlist) throw new ApiError(400, "Write something, add media, tag a song, or share a playlist to post.", "VALIDATION_FAILED");
      const id = uid("p");
      postRow.run(id, u.id, "", "", "", "", 0, null, null,
        "{}", text, JSON.stringify(photos), v.photosPublic ?? 1, "[]", null,
        "[]", "status", v.song ? JSON.stringify(v.song) : null, playlist ? JSON.stringify(playlist) : null, null, null, null, now());
      return { id, post: postJson(feedPostById.get(id), u.id) };
    }

    const [errs, v] = shape(ctx.body, {
      artist: { required: true, parse: (x) => clean(x, { max: LIMITS.artist }) || undefined },
      venue: { required: true, parse: (x) => clean(x, { max: LIMITS.venue }) || undefined },
      city: { parse: (x) => clean(x, { max: LIMITS.city }) },
      date: { parse: cleanDate },
      overall: { required: true, parse: (x) => { const r = clampRating(x); return r > 0 ? r : undefined; } },
      band: { parse: (x) => clampRating(x) },
      room: { parse: (x) => clampRating(x) },
      dims: { parse: cleanPostRatingDims },
      review: { parse: (x) => clean(x, { max: LIMITS.review, newlines: true }) },
      photos: { parse: (x) => cleanStringArray(x, { maxItems: 8, maxLen: 2000 }) },
      photosPublic: { parse: (x) => typeof x === "boolean" ? (x ? 1 : 0) : x === 0 || x === 1 ? x : undefined },
      setlist: { parse: (x) => cleanStringArray(x, { maxItems: 40, maxLen: 120 }) },
      tour: { parse: (x) => clean(x, { max: 80 }) || null },
      tags: { parse: cleanPostTags },
      song: { parse: cleanSong },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const id = uid("p");
    const binding = resolveArtistBinding(v.artist, ctx.body?.artistKey);
    postRow.run(id, u.id, v.artist, v.venue, v.city || "", v.date || "", v.overall, v.band ?? null, v.room ?? null,
      JSON.stringify(v.dims || {}), v.review || "", JSON.stringify(v.photos || []), v.photosPublic ?? 0, JSON.stringify(v.setlist || []), v.tour || null,
      JSON.stringify(v.tags || []), "review", v.song ? JSON.stringify(v.song) : null, null,
      binding.artist_key, binding.artist_mbid, venueBinding(v.venue), now());
    return { id, post: postJson(feedPostById.get(id), u.id) };
  },

  "PATCH /api/posts/:id": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "post-edit", 60, 60 * 60 * 1000);
    const current = db.prepare("SELECT * FROM posts WHERE id=? AND removed=0").get(ctx.params.id);
    if (!current) throw new ApiError(404, "That post left the stage. Refresh the feed and try again.", "NOT_FOUND");
    // Author-only, deliberately including admins: a review is someone's own
    // words, and moderation removes content, it never rewrites it.
    if (current.user_id !== u.id) {
      throw new ApiError(403, "Only the person who posted this review can edit it.", "FORBIDDEN");
    }

    const body = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const editable = ["artist", "venue", "city", "date", "overall", "band", "room", "dims", "review", "photos", "photosPublic", "setlist", "tour", "tags", "song", "playlistId"];
    if (!editable.some(has)) throw new ApiError(400, "Make a change before saving this post.", "VALIDATION_FAILED");

    // Optimistic concurrency prevents two devices (or an old open edit sheet)
    // from silently overwriting one another. Older clients may omit `version`,
    // while current clients always send the server projection's version.
    const currentVersion = current.updated_at || current.created_at;
    if (has("version")) {
      const expected = Number(body.version);
      if (!Number.isSafeInteger(expected) || expected < 0) throw new ApiError(400, "That post version is invalid. Refresh and try again.", "VALIDATION_FAILED");
      if (expected !== currentVersion) throw new ApiError(409, "This review changed on another screen. Refresh before saving again.", "CONFLICT");
    }

    const next = { ...current };
    const textField = (key, max, { required = false, newlines = false } = {}) => {
      if (!has(key)) return;
      if (typeof body[key] !== "string") throw new ApiError(400, `${key} is invalid`, "VALIDATION_FAILED");
      const value = clean(body[key], { max, newlines });
      if (required && !value) throw new ApiError(400, `${key} is required`, "VALIDATION_FAILED");
      next[key] = value;
    };
    const ratingField = (key, { required = false } = {}) => {
      if (!has(key)) return;
      if (body[key] === null && !required) { next[key] = null; return; }
      const numeric = Number(body[key]);
      if (!Number.isFinite(numeric)) throw new ApiError(400, `${key} is invalid`, "VALIDATION_FAILED");
      const value = clampRating(numeric);
      if (required && value <= 0) throw new ApiError(400, `${key} is required`, "VALIDATION_FAILED");
      next[key] = value;
    };

    textField("artist", LIMITS.artist, { required: true });
    textField("venue", LIMITS.venue, { required: true });
    textField("city", LIMITS.city);
    // Stored ISO, same as create. A post still holding a legacy display-format
    // or mangled date is repaired by this rather than rejected, since the value
    // canonicalizes to the night it always meant. "" clears the field, which is
    // a normal edit.
    if (has("date")) {
      if (typeof body.date !== "string") throw new ApiError(400, "date is invalid", "VALIDATION_FAILED");
      const raw = clean(body.date, { max: LIMITS.date });
      const value = raw ? cleanDate(raw) : "";
      if (raw && !value) throw new ApiError(400, "date is invalid", "VALIDATION_FAILED");
      next.date = value;
    }
    textField("review", LIMITS.review, { newlines: true });
    ratingField("overall", { required: true });
    ratingField("band");
    ratingField("room");
    if (has("dims")) {
      const dims = cleanPostRatingDims(body.dims);
      if (!dims) throw new ApiError(400, "dims is invalid", "VALIDATION_FAILED");
      next.dims = JSON.stringify(dims);
    }

    if (has("photos")) {
      if (!Array.isArray(body.photos) || body.photos.some((item) => typeof item !== "string")) throw new ApiError(400, "photos is invalid", "VALIDATION_FAILED");
      next.photos = JSON.stringify(cleanStringArray(body.photos, { maxItems: 8, maxLen: 2000 }));
    }
    if (has("photosPublic")) {
      if (typeof body.photosPublic === "boolean") next.photos_public = body.photosPublic ? 1 : 0;
      else if (body.photosPublic === 0 || body.photosPublic === 1) next.photos_public = body.photosPublic;
      else throw new ApiError(400, "photosPublic is invalid", "VALIDATION_FAILED");
    }
    if (has("setlist")) {
      if (!Array.isArray(body.setlist) || body.setlist.some((item) => typeof item !== "string")) throw new ApiError(400, "setlist is invalid", "VALIDATION_FAILED");
      next.setlist = JSON.stringify(cleanStringArray(body.setlist, { maxItems: 40, maxLen: 120 }));
    }
    if (has("tour")) {
      if (body.tour !== null && typeof body.tour !== "string") throw new ApiError(400, "tour is invalid", "VALIDATION_FAILED");
      next.tour = body.tour === null ? null : clean(body.tour, { max: 80 }) || null;
    }
    if (has("tags")) {
      const tags = cleanPostTags(body.tags);
      if (!tags) throw new ApiError(400, "tags is invalid", "VALIDATION_FAILED");
      next.tags = JSON.stringify(tags);
    }
    if (has("song")) {
      // null clears the tag; anything present must be a valid YouTube link.
      const song = cleanSong(body.song);
      if (song === undefined) throw new ApiError(400, "song is invalid", "VALIDATION_FAILED");
      next.song = song ? JSON.stringify(song) : null;
    }
    if (has("playlistId")) {
      if (current.kind !== "status") throw new ApiError(400, "Playlists can only be attached to regular posts.", "VALIDATION_FAILED");
      let currentSnapshot = null;
      try { currentSnapshot = current.playlist ? JSON.parse(current.playlist) : null; } catch {}
      const playlist = playlistSnapshotForPost(u, body.playlistId, currentSnapshot);
      next.playlist = playlist ? JSON.stringify(playlist) : null;
    }

    if (current.kind === "status") {
      let photos = [];
      try { photos = JSON.parse(next.photos || "[]"); } catch {}
      if (!next.review && !photos.length && !next.song && !next.playlist) {
        throw new ApiError(400, "Keep some text, media, a tagged song, or a playlist in this post.", "VALIDATION_FAILED");
      }
    }

    const editedAt = Math.max(now(), currentVersion + 1);
    // Re-resolve the binding on every edit: renaming the artist must move the
    // review to that artist's page, and retyping it as free text must drop the
    // binding rather than leave the post pointing at the previous entity.
    const editBinding = current.kind === "status"
      ? { artist_key: null, artist_mbid: null }
      : resolveArtistBinding(next.artist, has("artistKey") ? body.artistKey : current.artist_key);
    db.prepare(`UPDATE posts SET artist=?,venue=?,city=?,date=?,overall=?,band=?,room=?,dims=?,review=?,photos=?,photos_public=?,setlist=?,tour=?,tags=?,song=?,playlist=?,artist_key=?,artist_mbid=?,venue_key=?,updated_at=? WHERE id=?`)
      .run(next.artist, next.venue, next.city, next.date, next.overall, next.band, next.room, next.dims, next.review, next.photos, next.photos_public, next.setlist, next.tour, next.tags, next.song, next.playlist,
        editBinding.artist_key, editBinding.artist_mbid, current.kind === "status" ? null : venueBinding(next.venue), editedAt, current.id);
    return { post: postJson(feedPostById.get(current.id), u.id) };
  },

  "POST /api/posts/:id/like": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "like", 120, 10 * 60 * 1000);
    const targetPost = db.prepare("SELECT user_id,artist FROM posts WHERE id=? AND removed=0").get(ctx.params.id);
    if (!targetPost) throw new ApiError(404, "No such post.");
    if (blockedEitherWay(u.id, targetPost.user_id)) throw new ApiError(403, "This interaction isn't available.", "FORBIDDEN");
    const has = !!db.prepare("SELECT 1 FROM likes WHERE post_id=? AND user_id=?").get(ctx.params.id, u.id);
    const liked = desiredState(ctx.body, "liked", has);
    if (!liked && has) db.prepare("DELETE FROM likes WHERE post_id=? AND user_id=?").run(ctx.params.id, u.id);
    else if (liked && !has) {
      db.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run(ctx.params.id, u.id);
      addNotif(targetPost.user_id, u.id, "like", { postId: ctx.params.id, artist: targetPost.artist });
    }
    return { liked };
  },

  "GET /api/posts/:id/comments": (ctx) => {
    const post = db.prepare("SELECT user_id,removed FROM posts WHERE id=?").get(ctx.params.id);
    if (!post || post.removed) throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
    if (ctx.user?.id && blockedEitherWay(ctx.user.id, post.user_id)) {
      throw new ApiError(403, "This conversation isn't available.", "FORBIDDEN");
    }
    const { cursor, limit } = pageRequest(ctx, 400, 400);
    const viewerId = ctx.user?.id || null;
    const blockSql = viewerId
      ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
           (b.blocker_id=? AND b.blocked_id=c.user_id) OR
           (b.blocker_id=c.user_id AND b.blocked_id=?))`
      : "";
    const cursorSql = cursor ? "AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))" : "";
    const args = [ctx.params.id];
    if (viewerId) args.push(viewerId, viewerId);
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    args.push(limit + 1);
    const found = db.prepare(`SELECT c.*, u.name, u.initials, u.avatar_uri, u.avatar_color, u.role, u.verified FROM comments c JOIN users u ON u.id=c.user_id
                             WHERE c.post_id=? AND c.removed=0 ${blockSql} ${cursorSql} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    // A page can contain a reply whose parent is older than the page. Pull a
    // bounded ancestor chain so the client never promotes that reply to a fake
    // top-level comment. Removed ancestors are projected as content-free
    // tombstones; leaf deletions disappear entirely.
    const hidden = blockedIdSet(viewerId);
    const byId = new Map(rows.map((comment) => [comment.id, comment]));
    let pending = rows.map((comment) => comment.parent_id).filter(Boolean);
    for (let depth = 0; depth < 6 && pending.length; depth++) {
      const ids = [...new Set(pending.filter((id) => !byId.has(id)))].slice(0, 100);
      if (!ids.length) break;
      const placeholders = ids.map(() => "?").join(",");
      const parents = db.prepare(`SELECT c.*,u.name,u.initials,u.avatar_uri,u.avatar_color,u.role,u.verified
        FROM comments c JOIN users u ON u.id=c.user_id
        WHERE c.post_id=? AND c.id IN (${placeholders})`).all(ctx.params.id, ...ids);
      pending = [];
      for (const parent of parents) {
        if (hidden.has(parent.user_id)) continue;
        byId.set(parent.id, parent);
        if (parent.parent_id) pending.push(parent.parent_id);
      }
    }
    const comments = [...byId.values()]
      .sort((a, b) => a.created_at - b.created_at || String(a.id).localeCompare(String(b.id)))
      .map((c) => c.removed ? {
        id: c.id, userId: null, name: null, initials: null, avatarUri: null,
        avatarColor: null, role: null, verified: false, text: "", deleted: true,
        parentId: c.parent_id || null, createdAt: c.created_at,
      } : {
        id: c.id, userId: c.user_id, name: c.name, initials: c.initials,
        avatarUri: c.avatar_uri, avatarColor: c.avatar_color, role: c.role,
        verified: !!c.verified, text: c.text, deleted: false,
        parentId: c.parent_id || null, createdAt: c.created_at,
      });
    const removedIds = db.prepare("SELECT id FROM comments WHERE post_id=? AND removed=1 ORDER BY created_at DESC LIMIT 500")
      .all(ctx.params.id).map((row) => row.id);
    return { comments, nextCursor, removedIds };
  },

  "POST /api/posts/:id/comments": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "comment", 60, 60 * 60 * 1000);
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!text) throw new ApiError(400, "Say something first.");
    const targetPost = db.prepare("SELECT user_id,artist FROM posts WHERE id=? AND removed=0").get(ctx.params.id);
    if (!targetPost) throw new ApiError(404, "No such post.");
    if (blockedEitherWay(u.id, targetPost.user_id)) throw new ApiError(403, "This interaction isn't available.", "FORBIDDEN");
    // A reply must point at a real comment on THIS post; ignore anything else.
    let parentId = clean(ctx.body?.parentId, { max: 60 }) || null;
    const parent = parentId ? db.prepare("SELECT user_id FROM comments WHERE id=? AND post_id=? AND removed=0").get(parentId, ctx.params.id) : null;
    if (parentId && !parent) parentId = null;
    if (parent && blockedEitherWay(u.id, parent.user_id)) throw new ApiError(403, "This reply isn't available.", "FORBIDDEN");
    const id = uid("c");
    db.prepare("INSERT INTO comments (id,post_id,user_id,text,parent_id,created_at) VALUES (?,?,?,?,?,?)").run(id, ctx.params.id, u.id, text, parentId, now());
    const p = db.prepare("SELECT user_id, artist FROM posts WHERE id=?").get(ctx.params.id);
    if (p) addNotif(p.user_id, u.id, "comment", { postId: ctx.params.id, artist: p.artist, text: text.slice(0, 80) });
    // Also ping the parent comment's author (if it's someone else) so replies notify.
    if (parentId) { const pc = db.prepare("SELECT user_id FROM comments WHERE id=?").get(parentId); if (pc && pc.user_id !== (p && p.user_id)) addNotif(pc.user_id, u.id, "comment", { postId: ctx.params.id, artist: p?.artist, text: text.slice(0, 80) }); }
    return { id, parentId };
  },

  // Members can retract only their own comment. Keep replies from other people:
  // the read route emits a blank tombstone when children still need this parent.
  // A mismatched owner is deliberately indistinguishable from a missing row.
  "DELETE /api/posts/:postId/comments/:id": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "comment-delete", 60, 60 * 60 * 1000);
    const comment = db.prepare("SELECT id,post_id,user_id,removed FROM comments WHERE id=? AND post_id=?")
      .get(ctx.params.id, ctx.params.postId);
    if (!comment || comment.user_id !== u.id) throw new ApiError(404, "That comment is no longer available.", "NOT_FOUND");
    if (!comment.removed) db.prepare("UPDATE comments SET removed=1 WHERE id=? AND post_id=? AND user_id=?").run(comment.id, comment.post_id, u.id);
    const hasReplies = !!db.prepare("SELECT 1 FROM comments WHERE post_id=? AND parent_id=? AND removed=0 LIMIT 1")
      .get(comment.post_id, comment.id);
    return { ok: true, id: comment.id, postId: comment.post_id, tombstone: hasReplies };
  },

  // ---- direct messages (SQLite migration slice 4) ----
  // Every user I've DM'd + that thread's messages. At prototype scale returning
  // all messages is cheap and lets the client compute the Requests/Friends split
  // and unread exactly as it does locally (read markers stay client-side).
  "GET /api/me/threads": (ctx) => {
    const u = requireUser(ctx);
    const hidden = blockedIdSet(u.id);
    // Inbox refreshes need only one latest message per conversation. A windowed
    // query avoids downloading up to 500 messages for every thread every time the
    // inbox is opened or refreshed, while the full route remains for hydration.
    if (String(ctx.query?.summary || "") === "1") {
      const latest = db.prepare(`SELECT id,from_id,to_id,text,created_at,other_id FROM (
        SELECT id,from_id,to_id,text,created_at,
          CASE WHEN from_id=? THEN to_id ELSE from_id END AS other_id,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN from_id=? THEN to_id ELSE from_id END
            ORDER BY created_at DESC,id DESC
          ) AS row_number
        FROM dms WHERE from_id=? OR to_id=?
      ) WHERE row_number=1 ORDER BY created_at DESC,id DESC LIMIT 200`).all(u.id, u.id, u.id, u.id);
      return { threads: latest.filter((message) => !hidden.has(message.other_id)).map((message) => {
        const other = q.userById.get(message.other_id);
        return other ? {
          otherId: message.other_id,
          otherUser: publicUser(other),
          messages: [{ id: message.id, from: message.from_id, text: message.text, createdAt: message.created_at }],
        } : null;
      }).filter(Boolean) };
    }
    const others = db.prepare(`SELECT DISTINCT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other
                               FROM dms WHERE from_id = ? OR to_id = ?`).all(u.id, u.id, u.id);
    const threads = others.map((o) => {
      if (hidden.has(o.other)) return null; // blocked conversations disappear
      const other = q.userById.get(o.other);
      if (!other) return null;
      const msgs = db.prepare(`SELECT id, from_id, text, created_at FROM dms
        WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at DESC, id DESC LIMIT 500`)
        .all(u.id, o.other, o.other, u.id);
      return { otherId: o.other, otherUser: publicUser(other), messages: msgs.reverse().map((m) => ({ id: m.id, from: m.from_id, text: m.text, createdAt: m.created_at })) };
    }).filter(Boolean);
    return { threads };
  },

  "GET /api/dms/:otherId": (ctx) => {
    const u = requireUser(ctx);
    const other = ctx.params.otherId;
    if (blockedEitherWay(u.id, other)) throw new ApiError(403, "This conversation isn't available.", "FORBIDDEN");
    const { cursor, limit } = pageRequest(ctx, 500, 500);
    const after = decodeCursor(ctx.query?.after);
    if (cursor && after) throw new ApiError(400, "Use either before or after, not both.", "VALIDATION_FAILED");

    // Live-chat polling walks forward from the newest row the client has seen.
    // Keep the existing `before` cursor untouched for loading older history.
    if (after) {
      const found = db.prepare(`SELECT id, from_id, text, created_at FROM dms
        WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))
          AND (created_at > ? OR (created_at = ? AND id > ?))
        ORDER BY created_at ASC, id ASC LIMIT ?`)
        .all(u.id, other, other, u.id, after.createdAt, after.createdAt, after.id, limit + 1);
      const hasMore = found.length > limit;
      const rows = hasMore ? found.slice(0, limit) : found;
      return {
        messages: rows.map((m) => ({ id: m.id, from: m.from_id, text: m.text, createdAt: m.created_at })),
        nextCursor: null,
        syncCursor: rows.length ? encodeCursor(rows.at(-1)) : String(ctx.query.after),
        hasMore,
      };
    }

    const cursorSql = cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : "";
    const args = [u.id, other, other, u.id];
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    args.push(limit + 1);
    const found = db.prepare(`SELECT id, from_id, text, created_at FROM dms
      WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) ${cursorSql} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    const syncCursor = !cursor && rows.length ? encodeCursor(rows[0]) : null;
    return { messages: rows.reverse().map((m) => ({ id: m.id, from: m.from_id, text: m.text, createdAt: m.created_at })), nextCursor, syncCursor, hasMore: false };
  },

  "POST /api/dms/:otherId": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "dm", 120, 10 * 60 * 1000);
    const other = ctx.params.otherId;
    if (other === u.id) throw new ApiError(400, "You can't message yourself.");
    if (!q.userById.get(other)) throw new ApiError(404, "No such user.");
    if (blockedEitherWay(u.id, other)) throw new ApiError(403, "You can't message this account.");
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!text) throw new ApiError(400, "Say something first.");
    const id = uid("dm");
    db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)").run(id, u.id, other, text, now());
    addNotif(other, u.id, "dm", { text: text.slice(0, 80) });
    return { id };
  },

  // ---- notifications / activity (server-backed) ----
  "GET /api/me/notifications": (ctx) => {
    const u = requireUser(ctx);
    const hidden = blockedIdSet(u.id);
    const { cursor, limit } = pageRequest(ctx, 100, 100);
    const cursorSql = cursor ? "AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))" : "";
    const args = cursor ? [u.id, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [u.id, limit + 1];
    const found = db.prepare(`
      SELECT n.*, a.name AS actor_name, a.initials AS actor_initials, a.avatar_uri AS actor_uri, a.avatar_color AS actor_color
      FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = ? ${cursorSql} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    return {
      notifications: rows.filter((n) => !n.actor_id || !hidden.has(n.actor_id)).map((n) => ({
        id: n.id, type: n.type, actorId: n.actor_id,
        actorName: n.actor_name || "Someone", actorInitials: n.actor_initials || "?",
        actorUri: n.actor_uri, actorColor: n.actor_color,
        postId: n.post_id, artist: n.artist, text: n.text,
        ts: n.created_at, read: !!n.read,
      })),
      unread: db.prepare(`SELECT COUNT(*) c FROM notifications n WHERE n.user_id=? AND n.read=0
        AND (n.actor_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM blocks b WHERE (b.blocker_id=n.user_id AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=n.user_id)
        ))`).get(u.id).c,
      nextCursor,
    };
  },

  "POST /api/me/notifications/read": (ctx) => {
    const u = requireUser(ctx);
    db.prepare("UPDATE notifications SET read=1 WHERE user_id=? AND read=0").run(u.id);
    return { ok: true };
  },

  // ---- fan clubs (SQLite migration slice 5) ----
  // The artists this account is a member of, lets the client hydrate membership
  // (join-button state + counts) on login. Names are stored lowercased.
  "GET /api/me/fanclubs": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare("SELECT artist FROM fan_club_members WHERE user_id = ?").all(u.id);
    return { artists: rows.map((r) => r.artist) };
  },

  "POST /api/fanclubs/:artist/join": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "fanclub", 60, 10 * 60 * 1000);
    const artist = clean(decodeURIComponent(ctx.params.artist), { max: LIMITS.artist }).toLowerCase();
    if (!artist) throw new ApiError(400, "Bad artist.");
    const has = !!db.prepare("SELECT 1 FROM fan_club_members WHERE artist=? AND user_id=?").get(artist, u.id);
    const joined = desiredState(ctx.body, "joined", has);
    if (!joined && has) db.prepare("DELETE FROM fan_club_members WHERE artist=? AND user_id=?").run(artist, u.id);
    else if (joined && !has) db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(artist, u.id);
    return { member: joined, joined };
  },

  "GET /api/fanclubs/:artist/messages": (ctx) => {
    const artist = clean(decodeURIComponent(ctx.params.artist), { max: LIMITS.artist }).toLowerCase();
    const hidden = blockedIdSet(ctx.user?.id);
    const { cursor, limit } = pageRequest(ctx, 300, 300);
    const after = decodeCursor(ctx.query?.after);
    if (cursor && after) throw new ApiError(400, "Use either before or after, not both.", "VALIDATION_FAILED");
    const members = db.prepare("SELECT COUNT(*) c FROM fan_club_members WHERE artist=?").get(artist).c;
    const removedIds = db.prepare("SELECT id FROM fan_club_messages WHERE artist=? AND removed=1 ORDER BY created_at DESC, id DESC LIMIT 300")
      .all(artist).map((row) => row.id);

    if (after) {
      const found = db.prepare(`SELECT m.*, u.name, u.initials FROM fan_club_messages m JOIN users u ON u.id=m.user_id
                               WHERE m.artist=? AND m.removed=0
                                 AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
                               ORDER BY m.created_at ASC, m.id ASC LIMIT ?`)
        .all(artist, after.createdAt, after.createdAt, after.id, limit + 1);
      const hasMore = found.length > limit;
      const rows = hasMore ? found.slice(0, limit) : found;
      return {
        members,
        messages: rows.filter((m) => !hidden.has(m.user_id)).map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, text: m.text, createdAt: m.created_at })),
        nextCursor: null,
        syncCursor: rows.length ? encodeCursor(rows.at(-1)) : String(ctx.query.after),
        hasMore,
        removedIds,
      };
    }

    const cursorSql = cursor ? "AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : "";
    const args = cursor ? [artist, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [artist, limit + 1];
    const found = db.prepare(`SELECT m.*, u.name, u.initials FROM fan_club_messages m JOIN users u ON u.id=m.user_id
                             WHERE m.artist=? AND m.removed=0 ${cursorSql} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    const syncCursor = !cursor && rows.length ? encodeCursor(rows[0]) : null;
    return { members, messages: rows.reverse().filter((m) => !hidden.has(m.user_id)).map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, text: m.text, createdAt: m.created_at })), nextCursor, syncCursor, hasMore: false, removedIds };
  },

  "POST /api/fanclubs/:artist/messages": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "fanmsg", 60, 60 * 60 * 1000);
    const artist = clean(decodeURIComponent(ctx.params.artist), { max: LIMITS.artist }).toLowerCase();
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!artist || !text) throw new ApiError(400, "Say something first.");
    const member = db.prepare("SELECT 1 FROM fan_club_members WHERE artist=? AND user_id=?").get(artist, u.id);
    if (!member) throw new ApiError(403, "Join this fan club before jumping into the conversation.", "FAN_CLUB_MEMBERSHIP_REQUIRED");
    const id = uid("fc");
    db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, artist, u.id, text, now());
    return { id };
  },

  // ---- concert lounge (shared attendee chat, keyed by concertKey) ----
  "GET /api/lounges/:key/messages": (ctx) => {
    const key = clean(decodeURIComponent(ctx.params.key), { max: 300 }).toLowerCase();
    const hidden = blockedIdSet(ctx.user?.id);
    const { cursor, limit } = pageRequest(ctx, 300, 300);
    const after = decodeCursor(ctx.query?.after);
    if (cursor && after) throw new ApiError(400, "Use either before or after, not both.", "VALIDATION_FAILED");
    const removedIds = db.prepare("SELECT id FROM lounge_messages WHERE lounge_id=? AND removed=1 ORDER BY created_at DESC, id DESC LIMIT 300")
      .all(key).map((row) => row.id);

    if (after) {
      const found = db.prepare(`SELECT m.*, u.name, u.initials, u.avatar_uri, u.avatar_color, u.role FROM lounge_messages m JOIN users u ON u.id=m.user_id
                               WHERE m.lounge_id=? AND m.removed=0
                                 AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
                               ORDER BY m.created_at ASC, m.id ASC LIMIT ?`)
        .all(key, after.createdAt, after.createdAt, after.id, limit + 1);
      const hasMore = found.length > limit;
      const rows = hasMore ? found.slice(0, limit) : found;
      return {
        messages: rows.filter((m) => !hidden.has(m.user_id)).map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, avatarUri: m.avatar_uri, avatarColor: m.avatar_color, role: m.role, text: m.text, createdAt: m.created_at })),
        nextCursor: null,
        syncCursor: rows.length ? encodeCursor(rows.at(-1)) : String(ctx.query.after),
        hasMore,
        removedIds,
      };
    }

    const cursorSql = cursor ? "AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : "";
    const args = cursor ? [key, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [key, limit + 1];
    const found = db.prepare(`SELECT m.*, u.name, u.initials, u.avatar_uri, u.avatar_color, u.role FROM lounge_messages m JOIN users u ON u.id=m.user_id
                             WHERE m.lounge_id=? AND m.removed=0 ${cursorSql} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    const syncCursor = !cursor && rows.length ? encodeCursor(rows[0]) : null;
    return { messages: rows.reverse().filter((m) => !hidden.has(m.user_id)).map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, avatarUri: m.avatar_uri, avatarColor: m.avatar_color, role: m.role, text: m.text, createdAt: m.created_at })), nextCursor, syncCursor, hasMore: false, removedIds };
  },
  "POST /api/lounges/:key/messages": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "loungemsg", 90, 60 * 60 * 1000);
    const key = clean(decodeURIComponent(ctx.params.key), { max: 300 }).toLowerCase();
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!key || !text) throw new ApiError(400, "Say something first.");
    const attendee = db.prepare("SELECT 1 FROM going WHERE user_id=? AND concert_key=?").get(u.id, key);
    if (!attendee) throw new ApiError(403, "Join this show's Going list before posting in the lounge.", "LOUNGE_ATTENDANCE_REQUIRED");
    const id = uid("lm");
    db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, key, u.id, text, now());
    return { id };
  },

  // ---- analytics / ad-targeting data ----
  // Ingest a batch of activity events. Open to guests too (user_id null); this is
  // the behavioral data disclosed in the Privacy policy + consented at sign-up.
  "POST /api/events": (ctx) => {
    limit(ctx, "events", 240, 10 * 60 * 1000);
    const analyticsProfile = ctx.user ? parseStoredProfileExtras(ctx.user.extras) : {};
    if (!ctx.user || !analyticsProfile.consentAt || analyticsProfile.analyticsOptOut) return { ok: true, stored: 0 };
    const list = Array.isArray(ctx.body?.events) ? ctx.body.events.slice(0, 50) : [];
    if (!list.length) return { ok: true, stored: 0 };
    if (now() - lastAnalyticsPruneAt > 60 * 60 * 1000) {
      db.prepare("DELETE FROM events WHERE created_at < ?").run(now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      lastAnalyticsPruneAt = now();
    }
    const ins = db.prepare("INSERT INTO events (id,user_id,name,props,ip,created_at) VALUES (?,?,?,?,?,?)");
    let stored = 0;
    for (const e of list) {
      const name = clean(e?.name, { max: 40 });
      const allowedProps = ANALYTICS_EVENT_PROPS[name];
      if (!allowedProps) continue;
      let props = {};
      if (e && typeof e.props === "object" && e.props) {
        for (const key of allowedProps) {
          const value = e.props[key];
          if (typeof value === "string") {
            const safe = key === "q" ? privacySafeSearchTerm(value) : clean(value, { max: 120 });
            if (safe) props[key] = safe;
          } else if (typeof value === "number" && Number.isFinite(value)) props[key] = value;
          else if (typeof value === "boolean") props[key] = value;
        }
      }
      ins.run(uid("e"), ctx.user.id, name, JSON.stringify(props), null, now());
      stored++;
    }
    return { ok: true, stored };
  },

  // Admin analytics dashboard, the collected data + the ad-interest signals
  // derived from it (top artists / venues / genres / searches).
  "GET /api/admin/analytics": (ctx) => {
    requireAdmin(ctx);
    const dayAgo = now() - 24 * 60 * 60 * 1000;
    const weekAgo = now() - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now() - 30 * 24 * 60 * 60 * 1000;
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const totals = {
      events: one("SELECT COUNT(*) c FROM events").c,
      events24h: one("SELECT COUNT(*) c FROM events WHERE created_at >= ?", dayAgo).c,
      knownUsers: one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE user_id IS NOT NULL").c,
      guestHits: one("SELECT COUNT(*) c FROM events WHERE user_id IS NULL").c,
      users: one("SELECT COUNT(*) c FROM users").c,
      newUsers7d: one("SELECT COUNT(*) c FROM users WHERE created_at >= ?", weekAgo).c,
      activeUsers7d: one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE user_id IS NOT NULL AND created_at >= ?", weekAgo).c,
      posts: one("SELECT COUNT(*) c FROM posts WHERE removed=0").c,
      posts30d: one("SELECT COUNT(*) c FROM posts WHERE removed=0 AND created_at >= ?", monthAgo).c,
    };
    const topBy = (json, name, n = 12, minimum = 1) =>
      all(
        `SELECT json_extract(props, '$.${json}') AS k, COUNT(*) c
         FROM events WHERE name = ? AND json_extract(props, '$.${json}') IS NOT NULL
         GROUP BY k HAVING COUNT(*) >= ? ORDER BY c DESC LIMIT ?`,
        name, minimum, n
      ).map((r) => ({ label: r.k, count: r.c }));

    const signupDays = new Map(all("SELECT date(created_at/1000,'unixepoch') day,COUNT(*) c FROM users WHERE created_at >= ? GROUP BY day", monthAgo).map((row) => [row.day, row.c]));
    const activeDays = new Map(all("SELECT date(created_at/1000,'unixepoch') day,COUNT(DISTINCT user_id) c FROM events WHERE user_id IS NOT NULL AND created_at >= ? GROUP BY day", monthAgo).map((row) => [row.day, row.c]));
    const postDays = new Map(all("SELECT date(created_at/1000,'unixepoch') day,COUNT(*) c FROM posts WHERE removed=0 AND created_at >= ? GROUP BY day", monthAgo).map((row) => [row.day, row.c]));
    const growth = [];
    for (let offset = 29; offset >= 0; offset--) {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - offset);
      const day = date.toISOString().slice(0, 10);
      growth.push({ day, signups: signupDays.get(day) || 0, activeUsers: activeDays.get(day) || 0, posts: postDays.get(day) || 0 });
    }

    // Aggregate words across recent PUBLIC posts. Count a term at most once per
    // post and return only k-anonymous trends, never a post/user association.
    const stopWords = new Set(["the", "and", "for", "that", "this", "with", "was", "were", "are", "but", "not", "you", "your", "they", "their", "from", "have", "has", "had", "just", "show", "concert", "really", "very", "into", "out", "all", "our", "its", "it's"]);
    const wordCounts = new Map();
    for (const row of all("SELECT review FROM posts WHERE removed=0 AND created_at >= ? AND length(review) > 0 ORDER BY created_at DESC LIMIT 5000", now() - 90 * 24 * 60 * 60 * 1000)) {
      const words = new Set(String(row.review || "").toLowerCase().match(/[\p{L}\p{N}']{3,24}/gu) || []);
      for (const word of words) if (!stopWords.has(word) && !/^\d+$/.test(word)) wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
    const postKeywords = [...wordCounts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([label, count]) => ({ label, count }));
    return {
      totals,
      retentionDays: ANALYTICS_RETENTION_DAYS,
      growth,
      byName: all("SELECT name, COUNT(*) c FROM events GROUP BY name ORDER BY c DESC LIMIT 20").map((r) => ({ label: r.name, count: r.c })),
      topArtists: topBy("artist", "view_artist"),
      topVenues: topBy("venue", "view_venue"),
      topGenres: topBy("genre", "view_artist"),
      topSearches: topBy("q", "search", 12, 3),
      postKeywords,
      recent: all(
        `SELECT e.name, e.props, e.created_at, u.handle
         FROM events e LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.created_at DESC LIMIT 30`
      ).map((r) => ({ name: r.name, props: r.name === "search" ? {} : jsonObject(r.props), at: r.created_at, handle: r.handle || "deleted-user" })),
    };
  },

  "GET /api/admin/analytics/users/:id": (ctx) => {
    requireAdmin(ctx);
    const member = q.userById.get(ctx.params.id);
    if (!member) throw new ApiError(404, "That member is no longer available.", "NOT_FOUND");
    const eventRows = db.prepare("SELECT name,props,created_at FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(member.id);
    const breakdown = db.prepare("SELECT name,COUNT(*) count FROM events WHERE user_id=? GROUP BY name ORDER BY count DESC LIMIT 30").all(member.id);
    return {
      user: publicUser(member),
      totals: {
        events: db.prepare("SELECT COUNT(*) c FROM events WHERE user_id=?").get(member.id).c,
        posts: db.prepare("SELECT COUNT(*) c FROM posts WHERE user_id=? AND removed=0").get(member.id).c,
        comments: db.prepare("SELECT COUNT(*) c FROM comments WHERE user_id=? AND removed=0").get(member.id).c,
        plays: db.prepare("SELECT COUNT(*) c FROM plays WHERE user_id=?").get(member.id).c,
        messagesSent: db.prepare("SELECT COUNT(*) c FROM dms WHERE from_id=?").get(member.id).c,
      },
      byName: breakdown.map((row) => ({ label: row.name, count: row.count })),
      recent: eventRows.map((row) => ({
        name: row.name,
        props: row.name === "search" ? {} : jsonObject(row.props),
        at: row.created_at,
      })),
    };
  },

  // ---- reports + admin ----
  "POST /api/reports": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "report", 20, 60 * 60 * 1000);
    const [errs, v] = shape(ctx.body, {
      targetType: { required: true, parse: (x) => (["post", "comment", "user", "message"].includes(x) ? x : undefined) },
      targetId: { required: true, parse: (x) => clean(x, { max: 60 }) || undefined },
      reason: { parse: (x) => clean(x, { max: LIMITS.note }) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const table = { post: "posts", comment: "comments", user: "users", message: "dms" }[v.targetType];
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(v.targetId)) throw new ApiError(404, "That item is no longer available.", "NOT_FOUND");
    const existing = db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='open'").get(u.id, v.targetType, v.targetId);
    if (existing) return { id: existing.id, duplicate: true };
    const id = uid("r");
    db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, v.targetType, v.targetId, v.reason || "", u.id, now());
    return { id };
  },

  // Report a song identity or playback failure. Optionally carries the CORRECT
  // link, which a moderator can validate and pin in one action. Lands in the
  // normal moderation queue with a constrained category for useful triage.
  "POST /api/tracks/report": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "track-report", 15, 60 * 60 * 1000);
    const [errs, v] = shape(ctx.body, {
      title: { required: true, parse: (x) => clean(x, { max: 200 }) || undefined },
      artist: { parse: (x) => clean(x, { max: 120 }) },
      category: { parse: (x) => (["wrong_video", "wont_play", "preview_only", "missing", "other"].includes(x) ? x : undefined) },
      url: { parse: (x) => clean(x, { max: 400 }) },
      note: { parse: (x) => clean(x, { max: LIMITS.note }) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const suggestedId = v.url ? parseYouTubeVideoId(v.url) : null;
    if (v.url && !suggestedId) throw new ApiError(400, "That doesn't look like a YouTube link.", "VALIDATION_FAILED");
    const key = trackOverrideKey(v.title, v.artist);
    const existing = db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_type='track' AND target_id=? AND status='open'").get(u.id, key);
    if (existing) return { id: existing.id, duplicate: true };
    const reason = JSON.stringify({ title: v.title, artist: v.artist || "", category: v.category || "wrong_video", suggestedVideoId: suggestedId, note: v.note || "" });
    const id = uid("r");
    db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, "track", key, reason, u.id, now());
    return { id };
  },

  // Pin the correct video for a song (or "none": confirmed nothing correct is
  // embeddable). Closes every open report on that song and busts the resolver
  // cache, so the fix is heard on the very next play.
  "POST /api/admin/tracks/override": (ctx) => {
    requireModerator(ctx);
    const [errs, v] = shape(ctx.body, {
      title: { required: true, parse: (x) => clean(x, { max: 200 }) || undefined },
      artist: { parse: (x) => clean(x, { max: 120 }) },
      url: { parse: (x) => clean(x, { max: 400 }) },
      none: { parse: (x) => !!x },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const videoId = v.none ? null : parseYouTubeVideoId(v.url);
    if (!v.none && !videoId) throw new ApiError(400, "Paste a YouTube link (watch, youtu.be, or shorts).", "VALIDATION_FAILED");
    const key = trackOverrideKey(v.title, v.artist);
    db.prepare(`INSERT INTO track_overrides (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET video_id=excluded.video_id, set_by=excluded.set_by, updated_at=excluded.updated_at`)
      .run(key, v.title, v.artist || "", videoId, ctx.user.id, now());
    invalidateYouTubeTrack(v.title, v.artist || "");
    db.prepare("UPDATE reports SET status='actioned' WHERE target_type='track' AND target_id=? AND status='open'").run(key);
    moderationRecord(ctx, "track-override", "track", key, v.none ? "confirmed no correct video" : `pinned ${videoId}`);
    return { ok: true, videoId, confirmedUnavailable: v.none };
  },

  // Every pinned song video, newest first, so the Songs tab shows what's been
  // fixed (and lets a bad pin be removed).
  "GET /api/admin/tracks/overrides": (ctx) => {
    requireModerator(ctx);
    const rows = db.prepare("SELECT key,title,artist,video_id,set_by,updated_at FROM track_overrides ORDER BY updated_at DESC LIMIT 200").all();
    return { overrides: rows.map((r) => ({ key: r.key, title: r.title, artist: r.artist, videoId: r.video_id, setBy: r.set_by, updatedAt: r.updated_at })) };
  },

  // Remove a pin: the search resolver takes over again on the next play.
  "DELETE /api/admin/tracks/override": (ctx) => {
    requireModerator(ctx);
    const [errs, v] = shape(ctx.body, {
      title: { required: true, parse: (x) => clean(x, { max: 200 }) || undefined },
      artist: { parse: (x) => clean(x, { max: 120 }) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const key = trackOverrideKey(v.title, v.artist);
    db.prepare("DELETE FROM track_overrides WHERE key=?").run(key);
    invalidateYouTubeTrack(v.title, v.artist || "");
    moderationRecord(ctx, "track-unpin", "track", key, "pin removed, resolver takes over");
    return { ok: true };
  },

  "GET /api/admin/reports": (ctx) => {
    requireModerator(ctx);
    return { reports: db.prepare("SELECT * FROM reports WHERE status='open' ORDER BY created_at DESC LIMIT 200").all() };
  },

  "POST /api/admin/reports/:id/action": (ctx) => {
    requireModerator(ctx);
    const r = db.prepare("SELECT * FROM reports WHERE id=?").get(ctx.params.id);
    if (!r) throw new ApiError(404, "No such report.");
    if (!MODERATABLE_CONTENT[r.target_type]) throw new ApiError(422, "This report needs manual review before it can be closed.", "VALIDATION_FAILED");
    db.exec("BEGIN IMMEDIATE");
    try {
      setContentRemoved(ctx, r.target_type, r.target_id, true, r.reason);
      db.prepare("UPDATE reports SET status='actioned' WHERE id=?").run(r.id);
      db.exec("COMMIT");
      return { ok: true, targetType: r.target_type, targetId: r.target_id };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  },

  "POST /api/admin/reports/:id/dismiss": (ctx) => {
    requireModerator(ctx);
    const report = db.prepare("SELECT * FROM reports WHERE id=?").get(ctx.params.id);
    if (!report) throw new ApiError(404, "No such report.", "NOT_FOUND");
    db.prepare("UPDATE reports SET status='dismissed' WHERE id=?").run(ctx.params.id);
    moderationRecord(ctx, "dismiss_report", "report", report.id, report.reason, { status: report.status }, { status: "dismissed" });
    return { ok: true };
  },

  "POST /api/admin/content/:type/:id": (ctx) => {
    requireModerator(ctx);
    if (typeof ctx.body?.removed !== "boolean") throw new ApiError(400, "removed must be true or false.", "VALIDATION_FAILED");
    return setContentRemoved(ctx, ctx.params.type, ctx.params.id, ctx.body.removed, ctx.body?.reason || "");
  },

  "POST /api/admin/users/:id/ban": (ctx) => {
    const actor = requireAdmin(ctx);
    if (ctx.params.id === ctx.user.id) throw new ApiError(400, "You can't ban yourself.");
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (target.role === "admin") throw new ApiError(403, "Administrator accounts require owner review.", "FORBIDDEN");
    db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(ctx.params.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(ctx.params.id); // kill their sessions immediately
    moderationRecord(ctx, "ban", "user", target.id, ctx.body?.reason || "", { banned: !!target.is_banned }, { banned: true, by: actor.id });
    return { ok: true };
  },

  // Admin-granted verification (the blue check), independent of role. Persisted so
  // it survives reload + shows cross-device.
  "POST /api/admin/users/:id/verified": (ctx) => {
    requireAdmin(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    const verified = ctx.body?.verified ? 1 : 0;
    db.prepare("UPDATE users SET verified=? WHERE id=?").run(verified, ctx.params.id);
    moderationRecord(ctx, verified ? "grant_verification" : "remove_verification", "user", target.id, ctx.body?.reason || "", { verified: !!target.verified }, { verified: !!verified });
    return { ok: true, verified: !!verified };
  },
  "POST /api/admin/users/:id/sponsor": (ctx) => {
    requireAdmin(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    const sponsor = ctx.body?.sponsor ? 1 : 0;
    db.prepare("UPDATE users SET sponsor=? WHERE id=?").run(sponsor, ctx.params.id);
    moderationRecord(ctx, sponsor ? "grant_sponsor" : "remove_sponsor", "user", target.id, ctx.body?.reason || "", { sponsor: !!target.sponsor }, { sponsor: !!sponsor });
    return { ok: true, sponsor: !!sponsor };
  },

  // Full member directory for the admin console (includes banned) + live counts and
  // a per-region (home city) breakdown. This is what makes every real signup show
  // up in the Members tab so it can be verified / moderated.
  "GET /api/admin/members": (ctx) => {
    requireModerator(ctx);
    const rows = db.prepare(
      "SELECT id,name,handle,initials,avatar_uri,avatar_color,verified,sponsor,role,home_city,is_banned,suspended_until,created_at FROM users ORDER BY created_at DESC LIMIT 500"
    ).all();
    const users = rows.map((r) => ({ id: r.id, name: r.name, handle: r.handle, initials: r.initials, avatarUri: r.avatar_uri, avatarColor: r.avatar_color, verified: !!r.verified, sponsor: !!r.sponsor, role: r.role, home: { city: r.home_city }, isBanned: !!r.is_banned, suspendedUntil: r.suspended_until || null, createdAt: r.created_at }));
    const total = db.prepare("SELECT COUNT(*) c FROM users").get().c;
    const banned = db.prepare("SELECT COUNT(*) c FROM users WHERE is_banned=1").get().c;
    const verified = db.prepare("SELECT COUNT(*) c FROM users WHERE verified=1").get().c;
    const regions = db.prepare("SELECT COALESCE(NULLIF(home_city,''),'Unknown') city, COUNT(*) c FROM users GROUP BY city ORDER BY c DESC LIMIT 12").all().map((r) => ({ city: r.city, count: r.c }));
    return { users, total, banned, verified, regions };
  },

  // Persist a role change (fan/artist/moderator/admin) + optional role-tagged handle.
  "POST /api/admin/users/:id/role": (ctx) => {
    requireAdmin(ctx);
    const role = ["fan", "artist", "moderator", "admin"].includes(ctx.body?.role) ? ctx.body.role : null;
    if (!role) throw new ApiError(400, "Bad role.");
    if (ctx.params.id === ctx.user.id) throw new ApiError(400, "You can't change your own role.");
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (target.role === "admin") throw new ApiError(403, "Administrator accounts require owner review.", "FORBIDDEN");
    const handle = ctx.body?.handle ? cleanHandle(ctx.body.handle) : null;
    if (handle && !handleAllowedForRole(handle, role)) throw new ApiError(400, `A ${role} username must include ${role === "admin" ? "admin" : "mod"}.`, "VALIDATION_FAILED");
    const effectiveHandle = handle || target.handle;
    if (!handleAllowedForRole(effectiveHandle, role)) throw new ApiError(400, `A ${role} username must include ${role === "admin" ? "admin" : "mod"}.`, "VALIDATION_FAILED");
    const free = handle && !db.prepare("SELECT 1 FROM users WHERE handle=? AND id<>?").get(handle, ctx.params.id);
    if (handle && !free) throw new ApiError(409, "That username is already taken.", "CONFLICT");
    if (free) db.prepare("UPDATE users SET role=?, handle=? WHERE id=?").run(role, handle, ctx.params.id);
    else db.prepare("UPDATE users SET role=? WHERE id=?").run(role, ctx.params.id);
    moderationRecord(ctx, "change_role", "user", target.id, ctx.body?.reason || "", { role: target.role, handle: target.handle }, { role, handle: free ? handle : target.handle });
    return { ok: true, role };
  },

  // Catalog queue: thin artists (in the DB but no photo yet) + names people
  // searched that MusicBrainz had nothing for. Admin seeds these on demand.
  "GET /api/admin/artist-queue": (ctx) => {
    requireAdmin(ctx);
    return {
      thin: artistStmts.thin.all(60).map((r) => ({ norm: r.norm, name: r.name, searches: r.searches, genre: r.genre })),
      missing: artistStmts.listMissing.all(60).map((r) => ({ norm: r.norm, name: r.name, searches: r.searches })),
      thinTotal: artistStmts.thinCount.get().c,
    };
  },
  // Seed info + photos for specific artists from Deezer (the targeted alternative
  // to a blind 10M dump). Handles both thin artists and missing-search names.
  "POST /api/admin/artists/enrich": async (ctx) => {
    requireAdmin(ctx);
    const names = Array.isArray(ctx.body?.names) ? ctx.body.names.slice(0, 40).map((n) => String(n).slice(0, 120)) : [];
    let enriched = 0;
    for (const n of names) { if (await enrichArtistFromDeezer(n)) { enriched++; artistStmts.clearMissing.run(normName(n)); } }
    return { enriched, requested: names.length };
  },
  // Staff correction for a genre. This is the top of the provenance hierarchy:
  // once set it outranks every automated run, so a re-crawl cannot put Justin
  // Bieber back under Metal. Auditable like every other moderation action, and
  // reversible by passing an empty genre, which drops back to provider evidence.
  "POST /api/admin/artists/genre": (ctx) => {
    requireAdmin(ctx);
    const name = clean(ctx.body?.name, { max: 120 });
    if (!name) throw new ApiError(400, "Name is required.", "VALIDATION_FAILED");
    const row = artistStmts.byNorm.get(normName(name));
    if (!row) throw new ApiError(404, "That artist is not in the catalog.", "NOT_FOUND");

    let data = {};
    try { data = JSON.parse(row.data || "{}"); } catch {}
    const claims = storedClaims(data, row.genre);
    const prior = resolveGenre(claims);

    const requested = clean(ctx.body?.genre, { max: 40 });
    let nextClaims;
    if (requested) {
      const claim = genreClaim(requested, "staff");
      if (!claim) throw new ApiError(400, "That genre is invalid.", "VALIDATION_FAILED");
      nextClaims = upsertClaim(claims, claim);
    } else {
      // Undo: withdraw the staff decision only. The provider claims underneath
      // are still on the record, so the artist falls back to evidence rather
      // than to nothing, and the correction is genuinely reversible.
      nextClaims = withoutSource(claims, "staff");
    }
    const next = resolveGenre(nextClaims);

    const merged = { ...data, genre: next?.value || null, genreClaims: nextClaims, genreRecord: undefined };
    artistStmts.upsert.run(artistRow(row.norm, { ...merged, name: row.name }, row.source || "staff"));
    moderationRecord(ctx, "artist_genre", "artist", row.norm, clean(ctx.body?.reason, { max: LIMITS.note }),
      { genre: prior?.value || null, source: prior?.source || null },
      { genre: next?.value || null, source: next?.source || null });
    return { artist: publicArtist(artistStmts.byNorm.get(row.norm)) };
  },

  // Purge a dead / typo / never-found artist to keep the catalog clean.
  "POST /api/admin/artists/purge": (ctx) => {
    requireAdmin(ctx);
    const norm = normName(clean(ctx.body?.norm, { max: 200 }));
    if (norm) { artistStmts.purge.run(norm); artistStmts.clearMissing.run(norm); }
    return { ok: true };
  },
  // Grow the whole catalog toward N artists across all genres (MusicBrainz crawl +
  // Deezer ranking), as a background job so the request returns immediately. Poll
  // GET for live progress. No bundle change, nothing to deploy.
  "POST /api/admin/catalog/seed": (ctx) => {
    requireAdmin(ctx);
    const mode = ctx.body?.mode === "refresh" ? "refresh" : "grow";
    if (mode === "refresh") return startCatalogSeed({ mode });
    const add = Math.max(100, Math.min(20000, Number(ctx.body?.add) || 2000));
    return startCatalogSeed({ add });
  },
  "GET /api/admin/catalog/seed": (ctx) => {
    requireAdmin(ctx);
    return catalogSeedStatus();
  },
  "DELETE /api/admin/catalog/seed": (ctx) => {
    requireAdmin(ctx);
    return stopCatalogSeed();
  },
  // Durable history for catalog jobs. The in-memory status is lost on restart and
  // once reported "done" after adding nothing, which is how a no-op grow looked
  // successful. This is the record that survives and tells the truth.
  "GET /api/admin/catalog/runs": (ctx) => {
    requireAdmin(ctx);
    const limitN = Math.min(20, Math.max(1, Number(ctx.query.limit) || 8));
    const rows = db.prepare(`SELECT id,mode,status,start_total,target,added,enriched,error_code,note,started_at,finished_at
      FROM seed_runs ORDER BY started_at DESC LIMIT ?`).all(limitN);
    return {
      runs: rows.map((r) => ({
        id: r.id, mode: r.mode, status: r.status, startTotal: r.start_total, target: r.target,
        added: r.added, enriched: r.enriched, errorCode: r.error_code, note: r.note,
        startedAt: r.started_at, finishedAt: r.finished_at,
      })),
    };
  },

  "POST /api/admin/users/:id/unban": (ctx) => {
    requireAdmin(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    db.prepare("UPDATE users SET is_banned=0, suspended_until=NULL WHERE id=?").run(ctx.params.id);
    moderationRecord(ctx, "unban", "user", target.id, ctx.body?.reason || "", { banned: !!target.is_banned, suspendedUntil: target.suspended_until || null }, { banned: false, suspendedUntil: null });
    return { ok: true };
  },

  "POST /api/admin/users/:id/unsuspend": (ctx) => {
    requireModerator(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (target.is_banned) throw new ApiError(409, "This account is banned; an administrator must unban it.", "CONFLICT");
    db.prepare("UPDATE users SET suspended_until=NULL WHERE id=?").run(target.id);
    moderationRecord(ctx, "lift_suspension", "user", target.id, ctx.body?.reason || "", { suspendedUntil: target.suspended_until || null }, { suspendedUntil: null });
    return { ok: true };
  },

  "POST /api/admin/users/:id/suspend": (ctx) => {
    requireModerator(ctx);
    if (ctx.params.id === ctx.user.id) throw new ApiError(400, "You can't suspend yourself.");
    const days = Math.max(1, Math.min(365, Number(ctx.body?.days) || 7));
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (target.role === "admin") throw new ApiError(403, "Administrator accounts require owner review.", "FORBIDDEN");
    const until = now() + days * 86400000;
    db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(until, ctx.params.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(ctx.params.id);
    moderationRecord(ctx, "suspend", "user", target.id, ctx.body?.reason || "", { suspendedUntil: target.suspended_until || null }, { suspendedUntil: until, days });
    return { ok: true, suspendedUntil: until };
  },

  // ---- ratings: album + song stars (SQLite migration slice 7) ----
  "GET /api/ratings": (ctx) => {
    const kind = ctx.query.kind === "song" ? "song" : "album";
    const ref = clean(ctx.query.ref, { max: 200 });
    if (!ref) throw new ApiError(400, "Missing ref.");
    const agg = db.prepare("SELECT AVG(rating) avg, COUNT(*) count FROM ratings WHERE kind=? AND ref=?").get(kind, ref);
    const mine = ctx.user ? db.prepare("SELECT rating FROM ratings WHERE user_id=? AND kind=? AND ref=?").get(ctx.user.id, kind, ref) : null;
    return { avg: agg.avg || 0, count: agg.count || 0, mine: mine?.rating || 0 };
  },
  "POST /api/ratings": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "rate", 120, 10 * 60 * 1000);
    const kind = ctx.body?.kind === "song" ? "song" : "album";
    const ref = clean(ctx.body?.ref, { max: 200 });
    const rating = clampRating(ctx.body?.rating);
    if (!ref || !rating) throw new ApiError(400, "Bad rating.");
    db.prepare(`INSERT INTO ratings (user_id,kind,ref,rating) VALUES (?,?,?,?)
                ON CONFLICT(user_id,kind,ref) DO UPDATE SET rating=excluded.rating`).run(u.id, kind, ref, rating);
    const agg = db.prepare("SELECT AVG(rating) avg, COUNT(*) count FROM ratings WHERE kind=? AND ref=?").get(kind, ref);
    return { avg: agg.avg || 0, count: agg.count || 0, mine: rating };
  },

  // ---- going / attendance (slice 7) ----
  "GET /api/me/going": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare("SELECT concert_key, artist, venue, city, date FROM going WHERE user_id=?").all(u.id);
    return { going: rows.map((r) => ({ key: r.concert_key, artist: r.artist, venue: r.venue, city: r.city, date: r.date })) };
  },
  "POST /api/going": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "going", 120, 10 * 60 * 1000);
    const key = clean(ctx.body?.key, { max: 300 });
    if (!key) throw new ApiError(400, "Missing key.");
    const has = !!db.prepare("SELECT 1 FROM going WHERE user_id=? AND concert_key=?").get(u.id, key);
    const going = desiredState(ctx.body, "going", has);
    if (!going && has) db.prepare("DELETE FROM going WHERE user_id=? AND concert_key=?").run(u.id, key);
    else if (going && !has) db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date) VALUES (?,?,?,?,?,?)")
      .run(u.id, key, clean(ctx.body?.artist, { max: LIMITS.artist }) || "", clean(ctx.body?.venue, { max: LIMITS.venue }) || "",
        // Denormalized display copy only (the key is what identifies the night),
        // so an unparseable date is dropped rather than refused.
        clean(ctx.body?.city, { max: LIMITS.city }) || "", cleanDate(ctx.body?.date) || "");
    return { going };
  },
  "GET /api/going/:key/attendees": (ctx) => {
    const key = decodeURIComponent(ctx.params.key);
    const rows = db.prepare("SELECT user_id FROM going WHERE concert_key=? LIMIT 200").all(key);
    const hidden = blockedIdSet(ctx.user?.id);
    return { attendees: rows.filter((r) => !hidden.has(r.user_id)).map((r) => publicUser(q.userById.get(r.user_id))).filter(Boolean) };
  },

  // ---- venue reviews (slice 7) ----
  "GET /api/venues/:key/reviews": (ctx) => {
    const key = clean(decodeURIComponent(ctx.params.key), { max: 200 }).toLowerCase();
    const hidden = blockedIdSet(ctx.user?.id);
    const { cursor, limit } = pageRequest(ctx, 200, 200);
    const cursorSql = cursor ? "AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))" : "";
    const args = cursor ? [key, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [key, limit + 1];
    const found = db.prepare(`SELECT r.*, u.name, u.initials FROM venue_reviews r JOIN users u ON u.id=r.user_id
                             WHERE r.venue_key=? AND r.removed=0 ${cursorSql} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    return { reviews: rows.filter((r) => !hidden.has(r.user_id)).map((r) => ({ id: r.id, userId: r.user_id, name: r.name, initials: r.initials, rating: r.rating, text: r.text, photos: JSON.parse(r.photos || "[]"), createdAt: r.created_at })), nextCursor };
  },
  "POST /api/venues/:key/reviews": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "venuereview", 30, 60 * 60 * 1000);
    const key = clean(decodeURIComponent(ctx.params.key), { max: 200 }).toLowerCase();
    const rating = clampRating(ctx.body?.rating);
    if (!key || !rating) throw new ApiError(400, "Bad review.");
    const text = clean(ctx.body?.text, { max: LIMITS.review, newlines: true });
    const photos = cleanStringArray(ctx.body?.photos, { maxItems: 8, maxLen: 2000 });
    const id = uid("vr");
    db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, key, u.id, rating, text || "", JSON.stringify(photos || []), now());
    return { id };
  },

  // ---- artist requests + owned profiles (slice 7) ----
  "POST /api/artist-requests": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "artistreq", 5, 60 * 60 * 1000);
    const artistName = clean(ctx.body?.artistName, { max: LIMITS.artist });
    if (!artistName || artistName.length < 2) throw new ApiError(400, "Enter the artist name.");
    const id = uid("ar");
    db.prepare("INSERT INTO artist_requests (id,user_id,artist_name,note,status,created_at) VALUES (?,?,?,?,'pending',?)")
      .run(id, u.id, artistName, clean(ctx.body?.note, { max: LIMITS.note, newlines: true }) || "", now());
    return { id };
  },
  "GET /api/admin/artist-requests": (ctx) => {
    requireAdmin(ctx);
    const rows = db.prepare("SELECT * FROM artist_requests WHERE status='pending' ORDER BY created_at DESC LIMIT 200").all();
    return { requests: rows.map((r) => ({ id: r.id, userId: r.user_id, artistName: r.artist_name, note: r.note, status: r.status })) };
  },
  "POST /api/admin/artist-requests/:id/approve": (ctx) => {
    requireAdmin(ctx);
    const r = db.prepare("SELECT * FROM artist_requests WHERE id=?").get(ctx.params.id);
    if (!r) throw new ApiError(404, "No such request.");
    db.prepare("UPDATE artist_requests SET status='approved' WHERE id=?").run(r.id);
    db.prepare("UPDATE users SET role='artist', artist_name=? WHERE id=?").run(r.artist_name, r.user_id);
    return { ok: true };
  },
  "POST /api/admin/artist-requests/:id/reject": (ctx) => {
    requireAdmin(ctx);
    db.prepare("UPDATE artist_requests SET status='rejected' WHERE id=?").run(ctx.params.id);
    return { ok: true };
  },
  "GET /api/artists/:key/profile": (ctx) => {
    const key = clean(decodeURIComponent(ctx.params.key), { max: 200 }).toLowerCase();
    const p = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);
    const posts = db.prepare("SELECT id, text, created_at FROM artist_posts WHERE artist_key=? ORDER BY created_at DESC LIMIT 100").all(key);
    return {
      profile: p ? { bio: p.bio, banner: p.banner, avatarUri: p.avatar_uri, feedEnabled: !!p.feed_enabled } : null,
      posts: posts.map((x) => ({ id: x.id, text: x.text, createdAt: x.created_at })),
    };
  },
  "PATCH /api/artists/:key/profile": (ctx) => {
    const u = requireUser(ctx);
    const key = clean(decodeURIComponent(ctx.params.key), { max: 200 }).toLowerCase();
    if (!ownsArtist(u, key)) throw new ApiError(403, "Not your page.");
    const [, v] = shape(ctx.body, {
      bio: { parse: (x) => clean(x, { max: 600, newlines: true }) },
      banner: { parse: (x) => clean(x, { max: 2000 }) },
      avatarUri: { parse: (x) => clean(x, { max: 2000 }) },
      feedEnabled: { parse: (x) => (x ? 1 : 0) },
    });
    if (!db.prepare("SELECT 1 FROM artist_profiles WHERE artist_key=?").get(key))
      db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,updated_at) VALUES (?,?,?)").run(key, u.id, now());
    const sets = [], args = [];
    if (v.bio !== undefined) { sets.push("bio=?"); args.push(v.bio); }
    if (v.banner !== undefined) { sets.push("banner=?"); args.push(v.banner); }
    if (v.avatarUri !== undefined) { sets.push("avatar_uri=?"); args.push(v.avatarUri); }
    if (v.feedEnabled !== undefined) { sets.push("feed_enabled=?"); args.push(v.feedEnabled); }
    sets.push("updated_at=?"); args.push(now());
    db.prepare(`UPDATE artist_profiles SET ${sets.join(", ")} WHERE artist_key=?`).run(...args, key);
    return { ok: true };
  },
  "POST /api/artists/:key/posts": (ctx) => {
    const u = requireUser(ctx);
    const key = clean(decodeURIComponent(ctx.params.key), { max: 200 }).toLowerCase();
    if (!ownsArtist(u, key)) throw new ApiError(403, "Not your page.");
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!text) throw new ApiError(400, "Say something first.");
    const id = uid("ap");
    db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, key, u.id, text, now());
    return { id };
  },
  "DELETE /api/artists/:key/posts/:id": (ctx) => {
    const u = requireUser(ctx);
    const key = clean(decodeURIComponent(ctx.params.key), { max: 200 }).toLowerCase();
    if (!ownsArtist(u, key)) throw new ApiError(403, "Not your page.");
    db.prepare("DELETE FROM artist_posts WHERE id=? AND artist_key=?").run(ctx.params.id, key);
    return { ok: true };
  },
};
