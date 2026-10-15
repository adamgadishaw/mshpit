import { activeAccountSql } from "../../accountVisibility.js";
import { artistCatalogVisibleTo } from "../../artistCatalogVisibility.js";
import { MAX_FOLLOWED_ARTISTS, nextArtistFollowSelection } from "../../../src/domain/artistFollowFanClub.mjs";

const normalize = (value) => String(value || "").trim().toLowerCase();
const searchKey = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const names = (value) => { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, MAX_FOLLOWED_ARTISTS) : []; } catch { return []; } };

export function createConnections({ database, ApiError, requireUser, rateLimit, visibleProfileOrNull,
  blockedEitherWay, projectUser, projectArtist, resolveArtist, decodeKey, atomicWrite, now = Date.now }) {
  database.function("connection_search_key", { deterministic: true }, searchKey);
  database.function("connection_artist_key", { deterministic: true }, normalize);
  const visibility = (viewerId) => ({
    sql: `${activeAccountSql("u")}
      AND (u.id=? OR COALESCE(u.profile_audience,'everyone')='everyone' OR (?<>'' AND u.profile_audience='members'))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?))`,
    args: [viewerId, viewerId, viewerId, viewerId],
  });
  const ownerFor = (ctx) => {
    const id = ctx.params?.id;
    if (!id || (id !== ctx.user?.id && blockedEitherWay(ctx.user?.id, id))) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const owner = visibleProfileOrNull(id, ctx.user);
    if (!owner) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    return owner;
  };
  const selection = (ctx, mode) => {
    const q = typeof ctx.query?.q === "string" ? searchKey(ctx.query.q.trim()) : "";
    const filter = ctx.query?.filter || "all";
    if (q.length > 80 || !["all", "verified", "following"].includes(filter)) throw new ApiError(400, "Choose a valid connection filter.", "VALIDATION_FAILED");
    const rawLimit = ctx.query?.limit ?? 30;
    if (!/^[1-9][0-9]*$/.test(String(rawLimit))) throw new ApiError(400, "Choose a valid page size.", "VALIDATION_FAILED");
    const limit = Math.min(50, Number(rawLimit));
    if (!Number.isSafeInteger(limit)) throw new ApiError(400, "Choose a valid page size.", "VALIDATION_FAILED");
    const scope = JSON.stringify([ctx.user?.id || null, ctx.params.id, mode, q, filter]);
    let after = null;
    if (ctx.query?.cursor) {
      try {
        if (typeof ctx.query.cursor !== "string" || ctx.query.cursor.length > 1400 || !/^[A-Za-z0-9_-]+$/.test(ctx.query.cursor)) throw new Error("cursor");
        after = JSON.parse(Buffer.from(ctx.query.cursor, "base64url").toString("utf8"));
        if (after.scope !== scope || typeof after.name !== "string" || after.name.length > 200 || typeof after.id !== "string" || !after.id || after.id.length > 200) throw new Error("cursor");
      } catch { throw new ApiError(400, "This connection page expired. Refresh the list.", "VALIDATION_FAILED"); }
    }
    return { q, filter, limit, scope, after };
  };
  const cursorFor = (scope, row) => Buffer.from(JSON.stringify({ scope, name: searchKey(row.name), id: row.id })).toString("base64url");
  const directoryUser = (row) => {
    const projected = projectUser(row);
    // A row needs identity, not hundreds of music preferences or profile text.
    return Object.fromEntries(["id", "name", "handle", "role", "verified", "sponsor", "membershipBadge", "artistName", "home", "avatarUri", "initials"]
      .filter((key) => projected[key] !== undefined).map((key) => [key, projected[key]]));
  };
  const people = (ctx, mode, countOnly = false) => {
    const viewerId = ctx.user?.id || "";
    const visible = visibility(viewerId);
    const ownerColumn = mode === "followers" ? "followee_id" : "follower_id";
    const memberColumn = mode === "followers" ? "follower_id" : "followee_id";
    const base = `FROM follows f JOIN users u ON u.id=f.${memberColumn} WHERE f.${ownerColumn}=? AND ${visible.sql}`;
    if (countOnly) return database.prepare(`SELECT COUNT(*) AS n ${base}`).get(ctx.params.id, ...visible.args).n;
    const options = selection(ctx, mode);
    const conditions = [];
    const args = [ctx.params.id, ...visible.args];
    if (options.q) { conditions.push("(instr(connection_search_key(u.name),?)>0 OR instr(connection_search_key(u.handle),?)>0)"); args.push(options.q, options.q.replace(/^@/, "")); }
    if (options.filter === "verified") conditions.push(`u.verified=1 AND NOT (u.role='artist' AND COALESCE(u.artist_name,'')<>'' AND EXISTS (
      SELECT 1 FROM artist_profiles held WHERE held.owner_id=u.id AND held.artist_key=connection_artist_key(u.artist_name)
      AND held.identity_review_status IN ('pending','rejected')))`);
    if (options.filter === "following") { conditions.push("EXISTS (SELECT 1 FROM follows mine WHERE mine.follower_id=? AND mine.followee_id=u.id)"); args.push(viewerId); }
    if (options.after) { conditions.push("(connection_search_key(u.name)>? OR (connection_search_key(u.name)=? AND u.id>?))"); args.push(options.after.name, options.after.name, options.after.id); }
    const rows = database.prepare(`SELECT u.* ${base} ${conditions.length ? "AND " + conditions.join(" AND ") : ""} ORDER BY connection_search_key(u.name),u.id LIMIT ?`).all(...args, options.limit + 1);
    const page = rows.slice(0, options.limit);
    return { users: page.map(directoryUser), nextCursor: rows.length > options.limit ? cursorFor(options.scope, page.at(-1)) : null };
  };
  const artists = (owner, viewer) => {
    const selected = [...new Map(names(owner.favorite_artists).map((name) => [normalize(name), name])).entries()];
    if (!selected.length) return [];
    const rows = database.prepare("SELECT a.*,ap.owner_id AS connection_owner_id FROM artists a LEFT JOIN artist_profiles ap ON ap.artist_key=a.norm AND ap.removed=0 WHERE a.norm IN (SELECT value FROM json_each(?))").all(JSON.stringify(selected.map(([key]) => key)));
    const byKey = new Map(rows.map((row) => [row.norm, row]));
    return selected.flatMap(([key, name]) => {
      const row = byKey.get(key);
      // An owner may remove their own saved selection without learning any
      // current private metadata about a withdrawn or blocked artist page.
      const unavailable = () => viewer?.id === owner.id ? [{ id: key, key, name, unavailable: true }] : [];
      if (!row || !artistCatalogVisibleTo(database, row, viewer)) return unavailable();
      if (row.connection_owner_id && blockedEitherWay(viewer?.id, row.connection_owner_id)) return unavailable();
      const projected = projectArtist(row);
      return [{ id: row.norm, key: row.norm, name: row.name, photo: projected.photo || null, genre: projected.genre || null }];
    }).sort((a, b) => searchKey(a.name) < searchKey(b.name) ? -1 : searchKey(a.name) > searchKey(b.name) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
  const counts = (ctx, owner = ownerFor(ctx)) => ({
    followers: people(ctx, "followers", true),
    following: people(ctx, "following", true),
    artistFollowing: artists(owner, ctx.user).length,
  });
  const readPeople = (mode) => (ctx) => {
    ctx.setHeader?.("Cache-Control", "private, no-store");
    ownerFor(ctx);
    rateLimit(ctx, "connections-read", 120, 60_000);
    return people(ctx, mode);
  };
  return {
    counts,
    routes: {
      "GET /api/users/:id/followers": readPeople("followers"),
      "GET /api/users/:id/following": readPeople("following"),
      "GET /api/users/:id/artist-following": (ctx) => {
        ctx.setHeader?.("Cache-Control", "private, no-store");
        const owner = ownerFor(ctx);
        rateLimit(ctx, "connections-read", 120, 60_000);
        const options = selection(ctx, "artists");
        if (options.filter !== "all") throw new ApiError(400, "Choose a valid artist filter.", "VALIDATION_FAILED");
        const rows = artists(owner, ctx.user).filter((row) => (!options.q || searchKey(row.name).includes(options.q))
          && (!options.after || searchKey(row.name) > options.after.name || (searchKey(row.name) === options.after.name && row.id > options.after.id)));
        const page = rows.slice(0, options.limit);
        return { artists: page, nextCursor: rows.length > options.limit ? cursorFor(options.scope, page.at(-1)) : null };
      },
      "POST /api/artists/:key/follow": (ctx) => {
        const actor = requireUser(ctx);
        rateLimit(ctx, "artist-follow", 90, 10 * 60_000);
        if (typeof ctx.body?.following !== "boolean") throw new ApiError(400, "Choose whether to follow this artist.", "VALIDATION_FAILED");
        const key = decodeKey(ctx);
        return atomicWrite(() => {
          ctx.assertCurrentSession?.();
          const current = database.prepare("SELECT * FROM users WHERE id=?").get(actor.id);
          const row = resolveArtist(key, ctx);
          const following = ctx.body.following;
          const existing = names(current.favorite_artists);
          // Revocation does not disclose whether a hidden/deleted artist exists.
          const artistName = following ? row?.name : existing.find((name) => normalize(name) === normalize(key)) || row?.name || key;
          if (following && (!row || !artistCatalogVisibleTo(database, row, actor))) throw new ApiError(404, "This artist isn't available.", "NOT_FOUND");
          const ownerId = row && database.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=? AND removed=0").get(row.norm)?.owner_id;
          if (following && ownerId && blockedEitherWay(actor.id, ownerId)) throw new ApiError(404, "This artist isn't available.", "NOT_FOUND");
          const result = nextArtistFollowSelection(existing, artistName, { following });
          if (result.limitReached) throw new ApiError(400, `You can follow up to ${MAX_FOLLOWED_ARTISTS} artists. Unfollow one first.`, "VALIDATION_FAILED");
          if (result.changed) database.prepare("UPDATE users SET favorite_artists=?,profile_updated_at=? WHERE id=?").run(JSON.stringify(result.artists), Math.max(now(), Number(current.profile_updated_at || 0) + 1), actor.id);
          const updated = database.prepare("SELECT * FROM users WHERE id=?").get(actor.id);
          return { following, favoriteArtists: names(updated.favorite_artists), profileUpdatedAt: updated.profile_updated_at };
        });
      },
    },
  };
}
