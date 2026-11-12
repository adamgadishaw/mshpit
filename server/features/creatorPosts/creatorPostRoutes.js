import { ApiError } from "../../errors.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { managedCreatorEntity } from "./creatorPostService.js";

export function creatorPostRoutes({ database: db, requireUser, rateLimit, readPost, artistIdentity, resolveUnclaimedEntity = () => null, now = Date.now }) {
  const target = (ctx, provision = false) => {
    const type = ctx.params.type;
    let key;
    try { key = decodeURIComponent(ctx.params.key); } catch { throw new ApiError(400, "Choose a valid page.", "VALIDATION_FAILED"); }
    if (!["artist", "venue", "event"].includes(type) || !key || key.length > 200) throw new ApiError(400, "Choose a valid page.", "VALIDATION_FAILED");
    const row = type === "artist"
      ? db.prepare("SELECT artist_key AS entity_key FROM artist_profiles WHERE artist_key=? AND removed=0 AND COALESCE(identity_review_status,'clear') IN ('clear','approved')").get(key)
      : db.prepare("SELECT entity_key,status FROM creator_entities WHERE entity_type=? AND entity_key=?").get(type, key);
    if (row && type !== 'artist' && row.status !== 'active') throw new ApiError(404, "That page is unavailable.", "NOT_FOUND");
    if (!row) {
      const trusted = type === 'artist' ? null : resolveUnclaimedEntity(type, key);
      if (!trusted || trusted.entityType !== type || trusted.entityKey !== key || typeof trusted.name !== 'string'
        || !trusted.name.trim() || trusted.name.length > 200 || /[\p{Cc}\p{Cf}]/u.test(trusted.name)) throw new ApiError(404, "That page is unavailable.", "NOT_FOUND");
      if (provision) {
        if (!db.isTransaction) throw new TypeError('Unclaimed page provisioning requires the follow transaction');
        // Only trusted catalogue identity supplies this row. A follow never
        // sets an owner or replaces an existing owner's/moderator's decision.
        db.prepare("INSERT INTO creator_entities(entity_type,entity_key,name,owner_id,status) VALUES(?,?,?,NULL,'active') ON CONFLICT(entity_type,entity_key) DO NOTHING").run(type, key, trusted.name);
      }
    }
    return { type, key };
  };
  const preference = (accountId, type, key) => {
    const saved = db.prepare("SELECT following,notify_updates FROM creator_follows WHERE account_id=? AND entity_type=? AND entity_key=?").get(accountId, type, key);
    const following = type === "artist" ? !!db.prepare(`SELECT 1 FROM users account WHERE account.id=? AND (
      EXISTS(SELECT 1 FROM fan_club_members club JOIN json_each(?) alias
        ON club.artist=alias.value OR pit_artist_identity(club.artist)=pit_artist_identity(alias.value)
        WHERE club.user_id=account.id)
      OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(account.favorite_artists) THEN account.favorite_artists ELSE '[]' END) fav WHERE lower(trim(fav.value))=?))`).get(accountId, JSON.stringify(artistIdentity(key).aliases), key) : !!saved?.following;
    return { following, notifyUpdates: saved?.notify_updates !== 0 };
  };
  return {
    "GET /api/creators/:type/:key/follow": ctx => {
      const account = requireUser(ctx), { type, key } = target(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      return preference(account.id, type, key);
    },
    "PUT /api/creators/:type/:key/notifications": ctx => {
      const account = requireUser(ctx);
      if (typeof ctx.body?.notifyUpdates !== "boolean") throw new ApiError(400, "Choose whether page updates are on or off.", "VALIDATION_FAILED");
      rateLimit(ctx, "creator-preference", 60, 60_000);
      return withImmediateWrite(db, () => {
        ctx.assertCurrentSession?.();
        const { type, key } = target(ctx, true), current = preference(account.id, type, key);
        db.prepare(`INSERT INTO creator_follows(account_id,entity_type,entity_key,following,notify_updates,updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(account_id,entity_type,entity_key) DO UPDATE SET notify_updates=excluded.notify_updates,updated_at=excluded.updated_at`)
          .run(account.id, type, key, +current.following, +ctx.body.notifyUpdates, now());
        return { ...current, notifyUpdates: ctx.body.notifyUpdates };
      });
    },
    "GET /api/me/creator-entities": ctx => {
      const account = requireUser(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      const candidates = db.prepare("SELECT entity_type,entity_key FROM creator_entities WHERE owner_id=? AND status='active'").all(account.id);
      const current = db.prepare("SELECT artist_name FROM users WHERE id=?").get(account.id);
      if (current?.artist_name) candidates.push({ entity_type: "artist", entity_key: current.artist_name.trim().toLowerCase() });
      return { entities: candidates.map(row => managedCreatorEntity(db, account.id, row.entity_type, row.entity_key)).filter(Boolean) };
    },
    "GET /api/creators/:type/:key/posts": ctx => {
      const { type, key } = target(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      // Reuse the ordinary post read boundary (moderation, audience, media and
      // blocks) rather than inventing a second public post representation.
      const rows = db.prepare(`SELECT id FROM posts WHERE creator_update IS NOT NULL AND removed=0
        AND json_extract(creator_update,'$.entityType')=? AND json_extract(creator_update,'$.entityKey')=?
        ORDER BY created_at DESC,id DESC LIMIT 30`).all(type, key);
      const posts = [];
      for (const row of rows) {
        try { const result = readPost(ctx, row.id); if (result.post?.creatorUpdate) posts.push(result.post); }
        catch (error) { if (![403, 404].includes(error.status)) throw error; }
      }
      return { posts };
    },
    "PUT /api/creators/:type/:key/follow": ctx => {
      const account = requireUser(ctx);
      const { following, notifyUpdates } = ctx.body || {};
      if (typeof following !== "boolean" || (notifyUpdates !== undefined && typeof notifyUpdates !== "boolean")) throw new ApiError(400, "Choose following and update notification preferences.", "VALIDATION_FAILED");
      rateLimit(ctx, "creator-follow", 60, 60_000);
      return withImmediateWrite(db, () => {
        ctx.assertCurrentSession?.();
        const { type, key } = target(ctx, true);
        if (type === "artist") throw new ApiError(400, "Use the artist page’s Follow button to follow this artist.", "VALIDATION_FAILED");
        const alerts = notifyUpdates ?? preference(account.id, type, key).notifyUpdates;
        db.prepare(`INSERT INTO creator_follows(account_id,entity_type,entity_key,following,notify_updates,updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(account_id,entity_type,entity_key) DO UPDATE SET following=excluded.following,notify_updates=excluded.notify_updates,updated_at=excluded.updated_at`)
          .run(account.id, type, key, +following, +alerts, now());
        return { following, notifyUpdates: alerts };
      });
    },
  };
}
