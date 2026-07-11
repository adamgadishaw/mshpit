// API routes. Conventions that keep this hard to crash and easy to fix:
// - every route: authenticate -> rate-limit -> validate (shape) -> act -> respond
// - all handlers are wrapped by the server's try/catch; throwing ApiError(status,
//   message) is the ONLY sanctioned way to fail, anything else becomes a clean 500
// - responses only ever contain public projections (publicUser), never raw rows
import { randomUUID } from "node:crypto";
import { db, q, publicUser, artistStmts, publicArtist, artistRow, normName } from "./db.js";
import { hashPassword, verifyPassword, createSession, destroySession, rateLimit } from "./auth.js";
import { startCatalogSeed, catalogSeedStatus } from "./catalogSeed.js";
import { clean, cleanEmail, isEmail, cleanName, isName, cleanHandle, isPassword, clampRating, cleanStringArray, shape, LIMITS } from "./validate.js";

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => Date.now();
const uid = (p) => `${p}_${randomUUID().slice(0, 12)}`;

// Advance a timestamp by N business days (skip Sat/Sun), for the @handle cooldown.
function addBusinessDays(ts, n) {
  const d = new Date(ts);
  let added = 0;
  while (added < n) { d.setUTCDate(d.getUTCDate() + 1); const day = d.getUTCDay(); if (day !== 0 && day !== 6) added++; }
  return d.getTime();
}
const HANDLE_COOLDOWN_DAYS = 10; // business days between username changes
// Staff must carry their role in their @ (moderator → "mod", admin → "admin").
function handleAllowedForRole(handle, role) {
  if (role === "admin") return handle.includes("admin");
  if (role === "moderator") return handle.includes("mod");
  return true;
}

function requireUser(ctx) {
  if (!ctx.user) throw new ApiError(401, "Log in first.");
  if (ctx.user.is_banned) throw new ApiError(403, "This account is banned.");
  if (ctx.user.suspended_until && ctx.user.suspended_until > now()) throw new ApiError(403, "This account is suspended.");
  return ctx.user;
}
function requireAdmin(ctx) {
  const u = requireUser(ctx);
  if (u.role !== "admin") throw new ApiError(403, "Admins only.");
  return u;
}
function limit(ctx, name, max, windowMs) {
  if (!rateLimit(`${name}:${ctx.ip}`, max, windowMs)) throw new ApiError(429, "Too many requests, slow down and try again.");
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

const postRow = db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,band,room,review,photos,photos_public,setlist,tour,created_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const feedQuery = db.prepare(`
  SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.removed = 0) AS comment_count
  FROM posts p JOIN users u ON u.id = p.user_id
  WHERE p.removed = 0 ORDER BY p.created_at DESC LIMIT ? OFFSET ?`);

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

function postJson(p, viewerId) {
  return {
    id: p.id,
    userId: p.user_id,
    user: { name: p.u_name, handle: p.u_handle, initials: p.u_initials, avatarUri: p.u_avatar, avatarColor: p.u_color },
    artist: p.artist, venue: p.venue, city: p.city, date: p.date,
    overall: p.overall, band: p.band, room: p.room, review: p.review,
    photos: JSON.parse(p.photos || "[]"), photosPublic: !!p.photos_public,
    setlist: JSON.parse(p.setlist || "[]"),
    tour: p.tour || null,
    likes: p.like_count ?? 0, comments: p.comment_count ?? 0,
    liked: viewerId ? !!db.prepare("SELECT 1 FROM likes WHERE post_id=? AND user_id=?").get(p.id, viewerId) : false,
    createdAt: p.created_at,
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

// Spotify Connect config. Keys come from the server env (SPOTIFY_CLIENT_ID/SECRET);
// scopes cover the Web Playback SDK (streaming) + reading/controlling playback.
const SPOTIFY_SCOPES = "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state";
const spotifyStates = new Map(); // CSRF state -> { userId, exp }; single server instance, so in-memory is fine
const spotifyKeys = () => ({ id: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET });

// App-level Spotify token (client credentials) for catalog lookups like resolving a
// track title to a playable URL. Cached until ~expiry.
let spAppTok = null, spAppExp = 0;
async function spotifyAppToken() {
  if (spAppTok && Date.now() < spAppExp - 30000) return spAppTok;
  const { id, secret } = spotifyKeys();
  if (!id || !secret) return null;
  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials", signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    if (!d.access_token) return null;
    spAppTok = d.access_token; spAppExp = Date.now() + (d.expires_in || 3600) * 1000;
    return spAppTok;
  } catch { return null; }
}

const deezerCache = new Map(); // norm(name) -> { data, exp }
async function dz(url) { const r = await fetch(url, { signal: AbortSignal.timeout(9000) }); return r.ok ? r.json() : null; }

// Enrich a (usually thin) catalog artist from Deezer: photo, popularity, and top
// track titles. Upserts into the artists table so the page fills in. Returns true
// if Deezer had a match.
async function enrichArtistFromDeezer(name) {
  const s = await dz(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`);
  const dzA = s?.data?.[0];
  if (!dzA) return false;
  const existing = artistStmts.byNorm.get(normName(name));
  let data = {};
  try { data = existing?.data ? JSON.parse(existing.data) : {}; } catch {}
  const top = await dz(`https://api.deezer.com/artist/${dzA.id}/top?limit=10`);
  data.topTracks = (top?.data || []).map((t) => ({ title: t.title, album: t.album?.title || null, preview: t.preview || null }));
  data.name = existing?.name || dzA.name;
  const pop = Math.max(1, Math.min(100, Math.round(Math.log10((dzA.nb_fan || 0) + 1) * 12.5)));
  const now = Date.now();
  artistStmts.upsert.run({
    norm: normName(name), name: existing?.name || dzA.name, genre: existing?.genre || null,
    photo: dzA.picture_xl || dzA.picture_big || null, bio: existing?.bio || null,
    mbid: existing?.mbid || null, spotify_id: existing?.spotify_id || null, country: existing?.country || null,
    formed: existing?.formed || null, popularity: pop, rank_score: Math.round(pop * 1000),
    data: JSON.stringify(data), source: existing?.source || "deezer", created_at: existing?.created_at || now, updated_at: now,
  });
  return true;
}

// route table: "METHOD /path" -> handler(ctx) ; :params exposed as ctx.params
export const routes = {
  // ---- health ---- (spotify + origin are safe config diagnostics, no secrets)
  "GET /api/health": (ctx) => ({ ok: true, ts: now(), spotify: !!process.env.SPOTIFY_CLIENT_ID, redirectUri: `${ctx.origin}/api/spotify/callback` }),

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

  // Full discography with tracklists, from Deezer (keyless). Powers the artist
  // page: real albums you can expand into songs to rate and play. Cached a day.
  "GET /api/artists/discography": async (ctx) => {
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    const key = name.toLowerCase();
    const hit = deezerCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.data;
    limit(ctx, "discography", 40, 10 * 60 * 1000);
    try {
      const s = await dz(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`);
      const artist = s?.data?.[0];
      if (!artist) return { albums: [] };
      const al = await dz(`https://api.deezer.com/artist/${artist.id}/albums?limit=50`);
      const seen = new Set();
      const picks = (al?.data || [])
        .filter((x) => x.record_type === "album" && x.title && !seen.has(x.title.toLowerCase()) && seen.add(x.title.toLowerCase()))
        .sort((a, b) => String(b.release_date || "").localeCompare(String(a.release_date || "")))
        .slice(0, 12);
      const albums = [];
      for (const alb of picks) {
        const full = await dz(`https://api.deezer.com/album/${alb.id}`);
        albums.push({
          id: alb.id, title: alb.title, year: (alb.release_date || "").slice(0, 4), cover: alb.cover_medium || alb.cover || null,
          tracks: (full?.tracks?.data || []).map((t) => ({ title: t.title, preview: t.preview || null, duration: t.duration || 0 })),
        });
      }
      const data = { artist: { name: artist.name, fans: artist.nb_fan, photo: artist.picture_xl || artist.picture_big }, albums };
      deezerCache.set(key, { data, exp: Date.now() + 24 * 3600 * 1000 });
      return data;
    } catch { return { albums: [] }; }
  },

  // Resolve a track title (+ artist) to a Deezer 30s preview mp3 (keyless), so the
  // in-app player can play ANY song for everyone, no Spotify account needed.
  "GET /api/deezer/track": async (ctx) => {
    const title = clean(ctx.query.title, { max: 200 });
    const artist = clean(ctx.query.artist, { max: 120 });
    if (!title) throw new ApiError(400, "Missing title.");
    const key = "dztrk:" + (artist + "|" + title).toLowerCase();
    const hit = deezerCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.data;
    let s = await dz(`https://api.deezer.com/search?q=${encodeURIComponent(`track:"${title}"${artist ? ` artist:"${artist}"` : ""}`)}&limit=1`);
    if (!s?.data?.length) s = await dz(`https://api.deezer.com/search?q=${encodeURIComponent((artist ? artist + " " : "") + title)}&limit=1`);
    const t = s?.data?.[0];
    const data = { preview: t?.preview || null, url: t?.link || null, title: t?.title || null, artist: t?.artist?.name || null };
    deezerCache.set(key, { data, exp: Date.now() + 24 * 3600 * 1000 });
    return data;
  },

  // Resolve a track title (+ artist) to a playable Spotify URL, so album tracks
  // can stream full in the top player.
  "GET /api/spotify/track": async (ctx) => {
    const title = clean(ctx.query.title, { max: 200 });
    const artist = clean(ctx.query.artist, { max: 120 });
    if (!title) throw new ApiError(400, "Missing title.");
    const tok = await spotifyAppToken();
    if (!tok) return { url: null };
    const query = encodeURIComponent(`track:"${title}"${artist ? ` artist:"${artist}"` : ""}`);
    try {
      const r = await fetch(`https://api.spotify.com/v1/search?type=track&limit=1&q=${query}`, { headers: { Authorization: "Bearer " + tok }, signal: AbortSignal.timeout(8000) });
      const d = await r.json().catch(() => ({}));
      const t = d?.tracks?.items?.[0];
      return { url: t?.external_urls?.spotify || null };
    } catch { return { url: null }; }
  },

  // ---- Listening: cross-device play history + "friends listening" ----
  "POST /api/plays": (ctx) => {
    const u = requireUser(ctx);
    const title = clean(ctx.body?.title, { max: 200 });
    if (!title) return { ok: false };
    limit(ctx, "play", 300, 60 * 60 * 1000);
    db.prepare("INSERT INTO plays (id,user_id,title,artist,url,art,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(uid("pl"), u.id, title, clean(ctx.body?.artist, { max: 120 }) || null, clean(ctx.body?.url, { max: 400 }) || null, clean(ctx.body?.art, { max: 500 }) || null, now());
    db.prepare("DELETE FROM plays WHERE user_id=? AND id NOT IN (SELECT id FROM plays WHERE user_id=? ORDER BY created_at DESC LIMIT 300)").run(u.id, u.id);
    return { ok: true };
  },
  "GET /api/me/plays": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare("SELECT title,artist,url,art,created_at FROM plays WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(u.id);
    return { plays: rows.map((r) => ({ title: r.title, artist: r.artist, url: r.url, art: r.art, at: r.created_at })) };
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
    const tracks = Array.isArray(ctx.body?.tracks) ? ctx.body.tracks.slice(0, 100).map((t) => ({ title: clean(t?.title, { max: 200 }), artist: clean(t?.artist, { max: 120 }) || null, url: clean(t?.url, { max: 400 }) || null, preview: clean(t?.preview, { max: 500 }) || null, art: clean(t?.art, { max: 500 }) || null })).filter((t) => t.title) : [];
    if (!tracks.length) throw new ApiError(400, "A playlist needs tracks.");
    const id = uid("pls");
    db.prepare("INSERT INTO playlists (id,user_id,name,tracks,created_at) VALUES (?,?,?,?,?)").run(id, u.id, name, JSON.stringify(tracks), now());
    return { id, name, tracks, at: now() };
  },
  "GET /api/users/:id/playlists": (ctx) => {
    const rows = db.prepare("SELECT id,name,tracks,created_at FROM playlists WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(ctx.params.id);
    return { playlists: rows.map((r) => ({ id: r.id, name: r.name, tracks: JSON.parse(r.tracks || "[]"), at: r.created_at })) };
  },
  // Add tracks to (and/or rename) an existing playlist. Lets people build a
  // playlist one song at a time instead of only snapshotting a whole session.
  "PATCH /api/playlists/:id": (ctx) => {
    const u = requireUser(ctx);
    const row = db.prepare("SELECT tracks FROM playlists WHERE id=? AND user_id=?").get(ctx.params.id, u.id);
    if (!row) throw new ApiError(404, "Playlist not found.");
    let tracks = JSON.parse(row.tracks || "[]");
    const incoming = Array.isArray(ctx.body?.add) ? ctx.body.add : (ctx.body?.track ? [ctx.body.track] : []);
    const add = incoming.map((t) => ({ title: clean(t?.title, { max: 200 }), artist: clean(t?.artist, { max: 120 }) || null, url: clean(t?.url, { max: 400 }) || null, preview: clean(t?.preview, { max: 500 }) || null, art: clean(t?.art, { max: 500 }) || null })).filter((t) => t.title);
    for (const t of add) {
      const k = t.url || t.title.toLowerCase();
      if (!tracks.some((x) => (x.url || (x.title || "").toLowerCase()) === k)) tracks.push(t);
    }
    tracks = tracks.slice(0, 100);
    const name = ctx.body?.name != null ? (clean(ctx.body.name, { max: 80 }) || "Untitled") : null;
    if (name) db.prepare("UPDATE playlists SET tracks=?, name=? WHERE id=? AND user_id=?").run(JSON.stringify(tracks), name, ctx.params.id, u.id);
    else db.prepare("UPDATE playlists SET tracks=? WHERE id=? AND user_id=?").run(JSON.stringify(tracks), ctx.params.id, u.id);
    return { ok: true, count: tracks.length };
  },
  "DELETE /api/playlists/:id": (ctx) => {
    const u = requireUser(ctx);
    db.prepare("DELETE FROM playlists WHERE id=? AND user_id=?").run(ctx.params.id, u.id);
    return { ok: true };
  },

  // ---- Spotify Connect: OAuth + Web Playback SDK tokens ----
  // Lets a user link their own Spotify so the in-app player streams FULL tracks
  // (Premium only, per Spotify's SDK). Tokens live server-side only.
  "GET /api/spotify/login": (ctx) => {
    const u = requireUser(ctx);
    const { id } = spotifyKeys();
    if (!id) throw new ApiError(503, "Spotify is not configured on the server.");
    const state = randomUUID();
    spotifyStates.set(state, { userId: u.id, exp: Date.now() + 10 * 60 * 1000 });
    const url = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
      response_type: "code", client_id: id, scope: SPOTIFY_SCOPES, redirect_uri: `${ctx.origin}/api/spotify/callback`, state,
    }).toString();
    return { redirect: url };
  },
  "GET /api/spotify/callback": async (ctx) => {
    const home = `${ctx.origin}/`;
    const pending = ctx.query.state && spotifyStates.get(ctx.query.state);
    if (ctx.query.state) spotifyStates.delete(ctx.query.state);
    if (ctx.query.error || !ctx.query.code || !pending || pending.exp < Date.now()) return { redirect: `${home}?spotify=error` };
    const { id, secret } = spotifyKeys();
    try {
      const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: ctx.query.code, redirect_uri: `${ctx.origin}/api/spotify/callback` }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      if (!r.ok || !d.access_token) return { redirect: `${home}?spotify=error` };
      db.prepare("UPDATE users SET spotify_access_token=?, spotify_refresh_token=?, spotify_expires_at=? WHERE id=?")
        .run(d.access_token, d.refresh_token || null, Date.now() + (d.expires_in || 3600) * 1000, pending.userId);
      return { redirect: `${home}?spotify=connected` };
    } catch { return { redirect: `${home}?spotify=error` }; }
  },
  "GET /api/spotify/status": (ctx) => {
    const u = requireUser(ctx);
    return { connected: !!q.userById.get(u.id)?.spotify_refresh_token };
  },
  "POST /api/spotify/disconnect": (ctx) => {
    const u = requireUser(ctx);
    db.prepare("UPDATE users SET spotify_access_token=NULL, spotify_refresh_token=NULL, spotify_expires_at=0 WHERE id=?").run(u.id);
    return { ok: true };
  },
  // Hand the client a fresh access token for the Web Playback SDK, refreshing when
  // it's within 30s of expiry. Never exposes the refresh token.
  "GET /api/spotify/token": async (ctx) => {
    const u = requireUser(ctx);
    const row = q.userById.get(u.id);
    if (!row?.spotify_refresh_token) throw new ApiError(400, "Spotify not connected.");
    if (row.spotify_access_token && row.spotify_expires_at > Date.now() + 30000) return { token: row.spotify_access_token, expiresAt: row.spotify_expires_at };
    const { id, secret } = spotifyKeys();
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.spotify_refresh_token }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) {
      db.prepare("UPDATE users SET spotify_access_token=NULL, spotify_refresh_token=NULL, spotify_expires_at=0 WHERE id=?").run(u.id);
      throw new ApiError(401, "Spotify session expired, reconnect.");
    }
    const exp = Date.now() + (d.expires_in || 3600) * 1000;
    if (d.refresh_token) db.prepare("UPDATE users SET spotify_access_token=?, spotify_expires_at=?, spotify_refresh_token=? WHERE id=?").run(d.access_token, exp, d.refresh_token, u.id);
    else db.prepare("UPDATE users SET spotify_access_token=?, spotify_expires_at=? WHERE id=?").run(d.access_token, exp, u.id);
    return { token: d.access_token, expiresAt: exp };
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
    if (!u || !verifyPassword(v.password, u.pass_hash)) throw new ApiError(401, "Wrong email or password.");
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
      // All 8 themes (4 dark + 4 light). If this list falls behind theme.js, the
      // newer themes get silently rejected here, the server then re-hydrates the
      // stale theme on /api/me and the client "snaps back" to a previous theme.
      theme: { parse: (x) => (["stage", "neon", "forest", "ember", "daylight", "ice", "rose", "mint"].includes(x) ? x : undefined) },
      extras: { parse: (x) => (typeof x === "object" && x ? JSON.stringify(x).slice(0, 8000) : undefined) },
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
    // Theme is stored inside the extras blob (which publicUser spreads back out as
    // user.theme), so it survives sign-out and follows the account to new devices.
    if (v.theme && v.extras === undefined) {
      const cur = JSON.parse(u.extras || "{}");
      cur.theme = v.theme;
      sets.push("extras = ?"); args.push(JSON.stringify(cur).slice(0, 8000));
    } else if (v.extras) { sets.push("extras = ?"); args.push(v.extras); }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...args, u.id);
    return { user: publicUser(q.userById.get(u.id), { self: true }) };
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
    if (term.length < 1) {
      const rows = db.prepare(`SELECT ${cols} FROM users WHERE is_banned=0 ORDER BY created_at DESC LIMIT 40`).all();
      return { users: rows.map(map), total };
    }
    const like = `%${term.replace(/[%_\\]/g, "")}%`;
    const rows = db.prepare(
      `SELECT ${cols} FROM users WHERE is_banned=0 AND (lower(name) LIKE ? OR lower(handle) LIKE ?) ORDER BY (lower(handle)=? OR lower(name)=?) DESC, name LIMIT 30`
    ).all(like, like, term, term);
    return { users: rows.map(map), total };
  },

  "GET /api/users/:id": (ctx) => {
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
    const rows = db.prepare(`
      SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ? ORDER BY u.name COLLATE NOCASE LIMIT 500`).all(ctx.params.id);
    return { users: rows.map((r) => publicUser(r)) };
  },
  "GET /api/users/:id/following": (ctx) => {
    const rows = db.prepare(`
      SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = ? ORDER BY u.name COLLATE NOCASE LIMIT 500`).all(ctx.params.id);
    return { users: rows.map((r) => publicUser(r)) };
  },

  "POST /api/users/:id/follow": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "follow", 60, 10 * 60 * 1000);
    if (u.id === ctx.params.id) throw new ApiError(400, "You can't follow yourself.");
    if (!q.userById.get(ctx.params.id)) throw new ApiError(404, "No such user.");
    if (blockedEitherWay(u.id, ctx.params.id)) throw new ApiError(403, "You can't follow this account.");
    const has = db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(u.id, ctx.params.id);
    if (has) db.prepare("DELETE FROM follows WHERE follower_id=? AND followee_id=?").run(u.id, ctx.params.id);
    else { db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(u.id, ctx.params.id); addNotif(ctx.params.id, u.id, "follow"); }
    return { following: !has };
  },

  // ---- blocks: a real block, not a mute. Severs the follow both ways, stops
  // DMs in both directions, and hides each other's posts from the feed. ----
  "POST /api/users/:id/block": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "block", 30, 10 * 60 * 1000);
    const other = ctx.params.id;
    if (other === u.id) throw new ApiError(400, "You can't block yourself.");
    if (!q.userById.get(other)) throw new ApiError(404, "No such user.");
    const has = db.prepare("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?").get(u.id, other);
    if (has) {
      db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(u.id, other);
    } else {
      db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(u.id, other, now());
      // Sever the relationship both ways so neither keeps the other in a list.
      db.prepare("DELETE FROM follows WHERE (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?)").run(u.id, other, other, u.id);
    }
    return { blocked: !has };
  },
  "GET /api/me/blocked": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare(`
      SELECT us.* FROM blocks b JOIN users us ON us.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC LIMIT 500`).all(u.id);
    return { users: rows.map((r) => publicUser(r)) };
  },

  // ---- personal data export: a full backup of everything this account owns.
  // Facebook-style "Download your information", one JSON file. ----
  "GET /api/me/export": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "export", 5, 10 * 60 * 1000);
    const name = (id) => { const x = q.userById.get(id); return x ? { id, name: x.name, handle: x.handle } : { id }; };
    return {
      exportedAt: new Date().toISOString(),
      profile: publicUser(u, { self: true }),
      posts: db.prepare("SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC").all(u.id)
        .map((p) => ({ id: p.id, artist: p.artist, venue: p.venue, city: p.city, date: p.date, overall: p.overall, band: p.band, room: p.room, review: p.review, tour: p.tour, setlist: p.setlist ? JSON.parse(p.setlist) : [], photos: p.photos ? JSON.parse(p.photos) : [], createdAt: p.created_at })),
      comments: db.prepare("SELECT post_id, text, created_at FROM comments WHERE user_id=? AND removed=0 ORDER BY created_at DESC").all(u.id)
        .map((c) => ({ postId: c.post_id, text: c.text, createdAt: c.created_at })),
      following: db.prepare("SELECT followee_id id FROM follows WHERE follower_id=?").all(u.id).map((r) => name(r.id)),
      followers: db.prepare("SELECT follower_id id FROM follows WHERE followee_id=?").all(u.id).map((r) => name(r.id)),
      blocked: db.prepare("SELECT blocked_id id FROM blocks WHERE blocker_id=?").all(u.id).map((r) => name(r.id)),
      playlists: db.prepare("SELECT id,name,tracks,created_at FROM playlists WHERE user_id=? ORDER BY created_at DESC").all(u.id)
        .map((r) => ({ id: r.id, name: r.name, tracks: JSON.parse(r.tracks || "[]"), createdAt: r.created_at })),
      listeningHistory: db.prepare("SELECT title,artist,url,created_at FROM plays WHERE user_id=? ORDER BY created_at DESC LIMIT 300").all(u.id)
        .map((r) => ({ title: r.title, artist: r.artist, url: r.url, at: r.created_at })),
      going: db.prepare("SELECT artist, venue, city, date FROM going WHERE user_id=?").all(u.id),
      ratings: db.prepare("SELECT kind, ref, rating FROM ratings WHERE user_id=?").all(u.id),
      messagesSent: db.prepare("SELECT to_id, text, created_at FROM dms WHERE from_id=? ORDER BY created_at DESC LIMIT 1000").all(u.id)
        .map((m) => ({ to: name(m.to_id), text: m.text, createdAt: m.created_at })),
      notifications: db.prepare("SELECT type, actor_id, artist, text, created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 200").all(u.id)
        .map((n) => ({ type: n.type, from: n.actor_id ? name(n.actor_id) : null, artist: n.artist, text: n.text, at: n.created_at })),
    };
  },

  // ---- tour dates (scraped into the DB by server/tourdates.js) ----
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
    const lim = Math.min(Number(ctx.query.limit) || 30, 100);
    const off = Math.max(Number(ctx.query.offset) || 0, 0);
    const hidden = blockedIdSet(ctx.user?.id);
    return { posts: feedQuery.all(lim, off).filter((p) => !hidden.has(p.user_id)).map((p) => postJson(p, ctx.user?.id)) };
  },

  "GET /api/users/:id/posts": (ctx) => {
    const rows = db.prepare(`
      SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.removed = 0) AS comment_count
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.removed = 0 AND p.user_id = ? ORDER BY p.created_at DESC LIMIT 100`).all(ctx.params.id);
    return { posts: rows.map((p) => postJson(p, ctx.user?.id)) };
  },

  "POST /api/posts": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "post", 20, 60 * 60 * 1000);
    const [errs, v] = shape(ctx.body, {
      artist: { required: true, parse: (x) => clean(x, { max: LIMITS.artist }) || undefined },
      venue: { required: true, parse: (x) => clean(x, { max: LIMITS.venue }) || undefined },
      city: { parse: (x) => clean(x, { max: LIMITS.city }) },
      date: { parse: (x) => clean(x, { max: LIMITS.date }) },
      overall: { required: true, parse: (x) => { const r = clampRating(x); return r > 0 ? r : undefined; } },
      band: { parse: (x) => clampRating(x) },
      room: { parse: (x) => clampRating(x) },
      review: { parse: (x) => clean(x, { max: LIMITS.review, newlines: true }) },
      photos: { parse: (x) => cleanStringArray(x, { maxItems: 8, maxLen: 2000 }) },
      photosPublic: { parse: (x) => (x ? 1 : 0) },
      setlist: { parse: (x) => cleanStringArray(x, { maxItems: 40, maxLen: 120 }) },
      tour: { parse: (x) => clean(x, { max: 80 }) || null },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const id = uid("p");
    postRow.run(id, u.id, v.artist, v.venue, v.city || "", v.date || "", v.overall, v.band ?? null, v.room ?? null,
      v.review || "", JSON.stringify(v.photos || []), v.photosPublic ?? 0, JSON.stringify(v.setlist || []), v.tour || null, now());
    return { id };
  },

  "POST /api/posts/:id/like": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "like", 120, 10 * 60 * 1000);
    if (!db.prepare("SELECT 1 FROM posts WHERE id=? AND removed=0").get(ctx.params.id)) throw new ApiError(404, "No such post.");
    const has = db.prepare("SELECT 1 FROM likes WHERE post_id=? AND user_id=?").get(ctx.params.id, u.id);
    if (has) db.prepare("DELETE FROM likes WHERE post_id=? AND user_id=?").run(ctx.params.id, u.id);
    else {
      db.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run(ctx.params.id, u.id);
      const p = db.prepare("SELECT user_id, artist FROM posts WHERE id=?").get(ctx.params.id);
      if (p) addNotif(p.user_id, u.id, "like", { postId: ctx.params.id, artist: p.artist });
    }
    return { liked: !has };
  },

  "GET /api/posts/:id/comments": (ctx) => {
    const rows = db.prepare(`SELECT c.*, u.name, u.initials FROM comments c JOIN users u ON u.id=c.user_id
                             WHERE c.post_id=? AND c.removed=0 ORDER BY c.created_at DESC LIMIT 200`).all(ctx.params.id);
    return { comments: rows.map((c) => ({ id: c.id, userId: c.user_id, name: c.name, initials: c.initials, text: c.text, createdAt: c.created_at })) };
  },

  "POST /api/posts/:id/comments": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "comment", 60, 60 * 60 * 1000);
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!text) throw new ApiError(400, "Say something first.");
    if (!db.prepare("SELECT 1 FROM posts WHERE id=? AND removed=0").get(ctx.params.id)) throw new ApiError(404, "No such post.");
    const id = uid("c");
    db.prepare("INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, ctx.params.id, u.id, text, now());
    const p = db.prepare("SELECT user_id, artist FROM posts WHERE id=?").get(ctx.params.id);
    if (p) addNotif(p.user_id, u.id, "comment", { postId: ctx.params.id, artist: p.artist, text: text.slice(0, 80) });
    return { id };
  },

  // ---- direct messages (SQLite migration slice 4) ----
  // Every user I've DM'd + that thread's messages. At prototype scale returning
  // all messages is cheap and lets the client compute the Requests/Friends split
  // and unread exactly as it does locally (read markers stay client-side).
  "GET /api/me/threads": (ctx) => {
    const u = requireUser(ctx);
    const others = db.prepare(`SELECT DISTINCT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other
                               FROM dms WHERE from_id = ? OR to_id = ?`).all(u.id, u.id, u.id);
    const hidden = blockedIdSet(u.id);
    const threads = others.map((o) => {
      if (hidden.has(o.other)) return null; // blocked conversations disappear
      const other = q.userById.get(o.other);
      if (!other) return null;
      const msgs = db.prepare(`SELECT id, from_id, text, created_at FROM dms
        WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at ASC LIMIT 500`)
        .all(u.id, o.other, o.other, u.id);
      return { otherId: o.other, otherUser: publicUser(other), messages: msgs.map((m) => ({ id: m.id, from: m.from_id, text: m.text, createdAt: m.created_at })) };
    }).filter(Boolean);
    return { threads };
  },

  "GET /api/dms/:otherId": (ctx) => {
    const u = requireUser(ctx);
    const other = ctx.params.otherId;
    const msgs = db.prepare(`SELECT id, from_id, text, created_at FROM dms
      WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at ASC LIMIT 500`)
      .all(u.id, other, other, u.id);
    return { messages: msgs.map((m) => ({ id: m.id, from: m.from_id, text: m.text, createdAt: m.created_at })) };
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
    const rows = db.prepare(`
      SELECT n.*, a.name AS actor_name, a.initials AS actor_initials, a.avatar_uri AS actor_uri, a.avatar_color AS actor_color
      FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`).all(u.id)
      .filter((n) => !n.actor_id || !hidden.has(n.actor_id)); // old pings from blocked people vanish too
    return {
      notifications: rows.map((n) => ({
        id: n.id, type: n.type, actorId: n.actor_id,
        actorName: n.actor_name || "Someone", actorInitials: n.actor_initials || "?",
        actorUri: n.actor_uri, actorColor: n.actor_color,
        postId: n.post_id, artist: n.artist, text: n.text,
        ts: n.created_at, read: !!n.read,
      })),
      unread: db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0").get(u.id).c,
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
    const has = db.prepare("SELECT 1 FROM fan_club_members WHERE artist=? AND user_id=?").get(artist, u.id);
    if (has) db.prepare("DELETE FROM fan_club_members WHERE artist=? AND user_id=?").run(artist, u.id);
    else db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(artist, u.id);
    return { member: !has };
  },

  "GET /api/fanclubs/:artist/messages": (ctx) => {
    const artist = clean(decodeURIComponent(ctx.params.artist), { max: LIMITS.artist }).toLowerCase();
    const rows = db.prepare(`SELECT m.*, u.name, u.initials FROM fan_club_messages m JOIN users u ON u.id=m.user_id
                             WHERE m.artist=? AND m.removed=0 ORDER BY m.created_at ASC LIMIT 300`).all(artist);
    const members = db.prepare("SELECT COUNT(*) c FROM fan_club_members WHERE artist=?").get(artist).c;
    return { members, messages: rows.map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, text: m.text, createdAt: m.created_at })) };
  },

  "POST /api/fanclubs/:artist/messages": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "fanmsg", 60, 60 * 60 * 1000);
    const artist = clean(decodeURIComponent(ctx.params.artist), { max: LIMITS.artist }).toLowerCase();
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!artist || !text) throw new ApiError(400, "Say something first.");
    const id = uid("fc");
    db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, artist, u.id, text, now());
    return { id };
  },

  // ---- analytics / ad-targeting data ----
  // Ingest a batch of activity events. Open to guests too (user_id null); this is
  // the behavioral data disclosed in the Privacy policy + consented at sign-up.
  "POST /api/events": (ctx) => {
    limit(ctx, "events", 240, 10 * 60 * 1000);
    const list = Array.isArray(ctx.body?.events) ? ctx.body.events.slice(0, 50) : [];
    if (!list.length) return { ok: true, stored: 0 };
    const ins = db.prepare("INSERT INTO events (id,user_id,name,props,ip,created_at) VALUES (?,?,?,?,?,?)");
    let stored = 0;
    for (const e of list) {
      const name = clean(e?.name, { max: 40 });
      if (!name) continue;
      let props = {};
      if (e && typeof e.props === "object" && e.props) {
        for (const [k, v] of Object.entries(e.props).slice(0, 12)) {
          if (typeof v === "string") props[clean(k, { max: 24 })] = clean(v, { max: 120 });
          else if (typeof v === "number" || typeof v === "boolean") props[clean(k, { max: 24 })] = v;
        }
      }
      ins.run(uid("e"), ctx.user?.id ?? null, name, JSON.stringify(props), ctx.ip, now());
      stored++;
    }
    return { ok: true, stored };
  },

  // Admin analytics dashboard, the collected data + the ad-interest signals
  // derived from it (top artists / venues / genres / searches).
  "GET /api/admin/analytics": (ctx) => {
    requireAdmin(ctx);
    const dayAgo = now() - 24 * 60 * 60 * 1000;
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const totals = {
      events: one("SELECT COUNT(*) c FROM events").c,
      events24h: one("SELECT COUNT(*) c FROM events WHERE created_at >= ?", dayAgo).c,
      knownUsers: one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE user_id IS NOT NULL").c,
      guestHits: one("SELECT COUNT(*) c FROM events WHERE user_id IS NULL").c,
      users: one("SELECT COUNT(*) c FROM users").c,
      posts: one("SELECT COUNT(*) c FROM posts WHERE removed=0").c,
    };
    const topBy = (json, name, n = 12) =>
      all(
        `SELECT json_extract(props, '$.${json}') AS k, COUNT(*) c
         FROM events WHERE name = ? AND json_extract(props, '$.${json}') IS NOT NULL
         GROUP BY k ORDER BY c DESC LIMIT ?`,
        name, n
      ).map((r) => ({ label: r.k, count: r.c }));
    return {
      totals,
      byName: all("SELECT name, COUNT(*) c FROM events GROUP BY name ORDER BY c DESC LIMIT 20").map((r) => ({ label: r.name, count: r.c })),
      topArtists: topBy("artist", "view_artist"),
      topVenues: topBy("venue", "view_venue"),
      topGenres: topBy("genre", "view_artist"),
      topSearches: topBy("q", "search"),
      recent: all(
        `SELECT e.name, e.props, e.created_at, u.handle
         FROM events e LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.created_at DESC LIMIT 30`
      ).map((r) => ({ name: r.name, props: JSON.parse(r.props || "{}"), at: r.created_at, handle: r.handle || "guest" })),
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
    const id = uid("r");
    db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, v.targetType, v.targetId, v.reason || "", u.id, now());
    return { id };
  },

  "GET /api/admin/reports": (ctx) => {
    requireAdmin(ctx);
    return { reports: db.prepare("SELECT * FROM reports WHERE status='open' ORDER BY created_at DESC LIMIT 200").all() };
  },

  "POST /api/admin/reports/:id/action": (ctx) => {
    requireAdmin(ctx);
    const r = db.prepare("SELECT * FROM reports WHERE id=?").get(ctx.params.id);
    if (!r) throw new ApiError(404, "No such report.");
    if (r.target_type === "post") db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(r.target_id);
    if (r.target_type === "comment") db.prepare("UPDATE comments SET removed=1 WHERE id=?").run(r.target_id);
    db.prepare("UPDATE reports SET status='actioned' WHERE id=?").run(r.id);
    return { ok: true };
  },

  "POST /api/admin/reports/:id/dismiss": (ctx) => {
    requireAdmin(ctx);
    db.prepare("UPDATE reports SET status='dismissed' WHERE id=?").run(ctx.params.id);
    return { ok: true };
  },

  "POST /api/admin/users/:id/ban": (ctx) => {
    requireAdmin(ctx);
    if (ctx.params.id === ctx.user.id) throw new ApiError(400, "You can't ban yourself.");
    db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(ctx.params.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(ctx.params.id); // kill their sessions immediately
    return { ok: true };
  },

  // Admin-granted verification (the blue check), independent of role. Persisted so
  // it survives reload + shows cross-device.
  "POST /api/admin/users/:id/verified": (ctx) => {
    requireAdmin(ctx);
    const verified = ctx.body?.verified ? 1 : 0;
    db.prepare("UPDATE users SET verified=? WHERE id=?").run(verified, ctx.params.id);
    return { ok: true, verified: !!verified };
  },

  // Full member directory for the admin console (includes banned) + live counts and
  // a per-region (home city) breakdown. This is what makes every real signup show
  // up in the Members tab so it can be verified / moderated.
  "GET /api/admin/members": (ctx) => {
    requireAdmin(ctx);
    const rows = db.prepare(
      "SELECT id,name,handle,initials,avatar_uri,avatar_color,verified,role,home_city,is_banned,suspended_until,created_at FROM users ORDER BY created_at DESC LIMIT 500"
    ).all();
    const users = rows.map((r) => ({ id: r.id, name: r.name, handle: r.handle, initials: r.initials, avatarUri: r.avatar_uri, avatarColor: r.avatar_color, verified: !!r.verified, role: r.role, home: { city: r.home_city }, isBanned: !!r.is_banned, suspendedUntil: r.suspended_until || null, createdAt: r.created_at }));
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
    const handle = ctx.body?.handle ? cleanHandle(ctx.body.handle) : null;
    const free = handle && !db.prepare("SELECT 1 FROM users WHERE handle=? AND id<>?").get(handle, ctx.params.id);
    if (free) db.prepare("UPDATE users SET role=?, handle=? WHERE id=?").run(role, handle, ctx.params.id);
    else db.prepare("UPDATE users SET role=? WHERE id=?").run(role, ctx.params.id);
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
    const target = Math.max(200, Math.min(20000, Number(ctx.body?.target) || 10000));
    return startCatalogSeed({ target });
  },
  "GET /api/admin/catalog/seed": (ctx) => {
    requireAdmin(ctx);
    return catalogSeedStatus();
  },

  "POST /api/admin/users/:id/unban": (ctx) => {
    requireAdmin(ctx);
    db.prepare("UPDATE users SET is_banned=0, suspended_until=NULL WHERE id=?").run(ctx.params.id);
    return { ok: true };
  },

  "POST /api/admin/users/:id/suspend": (ctx) => {
    requireAdmin(ctx);
    if (ctx.params.id === ctx.user.id) throw new ApiError(400, "You can't suspend yourself.");
    const days = Math.max(1, Math.min(365, Number(ctx.body?.days) || 7));
    const until = now() + days * 86400000;
    db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(until, ctx.params.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(ctx.params.id);
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
    const has = db.prepare("SELECT 1 FROM going WHERE user_id=? AND concert_key=?").get(u.id, key);
    if (has) { db.prepare("DELETE FROM going WHERE user_id=? AND concert_key=?").run(u.id, key); return { going: false }; }
    db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date) VALUES (?,?,?,?,?,?)")
      .run(u.id, key, clean(ctx.body?.artist, { max: LIMITS.artist }) || "", clean(ctx.body?.venue, { max: LIMITS.venue }) || "",
        clean(ctx.body?.city, { max: LIMITS.city }) || "", clean(ctx.body?.date, { max: LIMITS.date }) || "");
    return { going: true };
  },
  "GET /api/going/:key/attendees": (ctx) => {
    const key = decodeURIComponent(ctx.params.key);
    const rows = db.prepare("SELECT user_id FROM going WHERE concert_key=? LIMIT 200").all(key);
    return { attendees: rows.map((r) => publicUser(q.userById.get(r.user_id))).filter(Boolean) };
  },

  // ---- venue reviews (slice 7) ----
  "GET /api/venues/:key/reviews": (ctx) => {
    const key = clean(decodeURIComponent(ctx.params.key), { max: 200 }).toLowerCase();
    const rows = db.prepare(`SELECT r.*, u.name, u.initials FROM venue_reviews r JOIN users u ON u.id=r.user_id
                             WHERE r.venue_key=? AND r.removed=0 ORDER BY r.created_at DESC LIMIT 200`).all(key);
    return { reviews: rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name, initials: r.initials, rating: r.rating, text: r.text, photos: JSON.parse(r.photos || "[]"), createdAt: r.created_at })) };
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
