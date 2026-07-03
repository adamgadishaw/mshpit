// API routes. Conventions that keep this hard to crash and easy to fix:
// - every route: authenticate -> rate-limit -> validate (shape) -> act -> respond
// - all handlers are wrapped by the server's try/catch; throwing ApiError(status,
//   message) is the ONLY sanctioned way to fail, anything else becomes a clean 500
// - responses only ever contain public projections (publicUser), never raw rows
import { randomUUID } from "node:crypto";
import { db, q, publicUser } from "./db.js";
import { hashPassword, verifyPassword, createSession, destroySession, rateLimit } from "./auth.js";
import { clean, cleanEmail, isEmail, cleanName, isName, cleanHandle, isPassword, clampRating, cleanStringArray, shape, LIMITS } from "./validate.js";

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => Date.now();
const uid = (p) => `${p}_${randomUUID().slice(0, 12)}`;

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
  if (!rateLimit(`${name}:${ctx.ip}`, max, windowMs)) throw new ApiError(429, "Too many requests — slow down and try again.");
}

// Ensure a unique handle derived from a base string.
function uniqueHandle(base) {
  let h = cleanHandle(base) || "fan";
  if (h.length < 3) h = (h + "fan").slice(0, 20);
  let candidate = h, i = 1;
  while (q.userByHandle.get(candidate)) candidate = (h.slice(0, 17) + i++).slice(0, 20);
  return candidate;
}

const postRow = db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,band,room,review,photos,photos_public,setlist,created_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const feedQuery = db.prepare(`
  SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.removed = 0) AS comment_count
  FROM posts p JOIN users u ON u.id = p.user_id
  WHERE p.removed = 0 ORDER BY p.created_at DESC LIMIT ? OFFSET ?`);

function postJson(p, viewerId) {
  return {
    id: p.id,
    userId: p.user_id,
    user: { name: p.u_name, handle: p.u_handle, initials: p.u_initials, avatarUri: p.u_avatar, avatarColor: p.u_color },
    artist: p.artist, venue: p.venue, city: p.city, date: p.date,
    overall: p.overall, band: p.band, room: p.room, review: p.review,
    photos: JSON.parse(p.photos || "[]"), photosPublic: !!p.photos_public,
    setlist: JSON.parse(p.setlist || "[]"),
    likes: p.like_count ?? 0, comments: p.comment_count ?? 0,
    liked: viewerId ? !!db.prepare("SELECT 1 FROM likes WHERE post_id=? AND user_id=?").get(p.id, viewerId) : false,
    createdAt: p.created_at,
  };
}

// route table: "METHOD /path" -> handler(ctx) ; :params exposed as ctx.params
export const routes = {
  // ---- health ----
  "GET /api/health": () => ({ ok: true, ts: now() }),

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
    // same error either way — never reveal which part was wrong
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

  // ---- profile ----
  "PATCH /api/me": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "profile", 30, 10 * 60 * 1000);
    const [, v] = shape(ctx.body, {
      name: { parse: (x) => (isName(x) ? cleanName(x) : undefined) },
      bio: { parse: (x) => clean(x, { max: LIMITS.bio, newlines: true }) },
      banner: { parse: (x) => clean(x, { max: 2000 }) },
      avatarUri: { parse: (x) => clean(x, { max: 2000 }) },
      city: { parse: (x) => clean(x, { max: LIMITS.city }) || undefined },
      lat: { parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      lng: { parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      genres: { parse: (x) => cleanStringArray(x, { maxItems: 12, maxLen: 30 }) },
      favoriteArtists: { parse: (x) => cleanStringArray(x, { maxItems: 50, maxLen: 80 }) },
      extras: { parse: (x) => (typeof x === "object" && x ? JSON.stringify(x).slice(0, 8000) : undefined) },
    });
    const sets = [];
    const args = [];
    if (v.name) { sets.push("name = ?", "initials = ?"); args.push(v.name, (v.name.match(/\p{L}|\p{N}/gu) || ["?"]).slice(0, 2).join("").toUpperCase()); }
    if (v.bio !== undefined) { sets.push("bio = ?"); args.push(v.bio); }
    if (v.banner !== undefined) { sets.push("banner = ?"); args.push(v.banner); }
    if (v.avatarUri !== undefined) { sets.push("avatar_uri = ?"); args.push(v.avatarUri); }
    if (v.city !== undefined) { sets.push("home_city = ?", "home_lat = ?", "home_lng = ?"); args.push(v.city, v.lat ?? null, v.lng ?? null); }
    if (v.genres) { sets.push("genres = ?"); args.push(JSON.stringify(v.genres)); }
    if (v.favoriteArtists) { sets.push("favorite_artists = ?"); args.push(JSON.stringify(v.favoriteArtists)); }
    if (v.extras) { sets.push("extras = ?"); args.push(v.extras); }
    if (sets.length) db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...args, u.id);
    return { user: publicUser(q.userById.get(u.id), { self: true }) };
  },

  "GET /api/users/:id": (ctx) => {
    const u = q.userById.get(ctx.params.id);
    if (!u) throw new ApiError(404, "No such user.");
    const followers = db.prepare("SELECT COUNT(*) c FROM follows WHERE followee_id = ?").get(u.id).c;
    const following = db.prepare("SELECT COUNT(*) c FROM follows WHERE follower_id = ?").get(u.id).c;
    const isFollowing = ctx.user ? !!db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(ctx.user.id, u.id) : false;
    return { user: publicUser(u), followers, following, isFollowing };
  },

  "POST /api/users/:id/follow": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "follow", 60, 10 * 60 * 1000);
    if (u.id === ctx.params.id) throw new ApiError(400, "You can't follow yourself.");
    if (!q.userById.get(ctx.params.id)) throw new ApiError(404, "No such user.");
    const has = db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(u.id, ctx.params.id);
    if (has) db.prepare("DELETE FROM follows WHERE follower_id=? AND followee_id=?").run(u.id, ctx.params.id);
    else db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(u.id, ctx.params.id);
    return { following: !has };
  },

  // ---- feed / posts ----
  "GET /api/feed": (ctx) => {
    const lim = Math.min(Number(ctx.query.limit) || 30, 100);
    const off = Math.max(Number(ctx.query.offset) || 0, 0);
    return { posts: feedQuery.all(lim, off).map((p) => postJson(p, ctx.user?.id)) };
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
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const id = uid("p");
    postRow.run(id, u.id, v.artist, v.venue, v.city || "", v.date || "", v.overall, v.band ?? null, v.room ?? null,
      v.review || "", JSON.stringify(v.photos || []), v.photosPublic ?? 0, JSON.stringify(v.setlist || []), now());
    return { id };
  },

  "POST /api/posts/:id/like": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "like", 120, 10 * 60 * 1000);
    if (!db.prepare("SELECT 1 FROM posts WHERE id=? AND removed=0").get(ctx.params.id)) throw new ApiError(404, "No such post.");
    const has = db.prepare("SELECT 1 FROM likes WHERE post_id=? AND user_id=?").get(ctx.params.id, u.id);
    if (has) db.prepare("DELETE FROM likes WHERE post_id=? AND user_id=?").run(ctx.params.id, u.id);
    else db.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run(ctx.params.id, u.id);
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
    return { id };
  },

  // ---- fan clubs ----
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
};
