import { randomUUID } from "node:crypto";
import { ArtistBiographyValidationError, artistBiographyBindingMatches, artistBiographyIdentity, projectArtistBiography, validateStaffArtistBiography } from "../../../src/domain/artistBiography.mjs";

const dataFor = (row) => { try { const value = JSON.parse(row?.data || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } };
const revisionFor = (data) => Number.isSafeInteger(data.biographyStaff?.revision) && data.biographyStaff.revision >= 0 ? data.biographyStaff.revision : 0;

export function artistBiographyRoutes({ database, ApiError, requireAdmin, rateLimit, now = Date.now, publicArtist }) {
  const find = database.prepare("SELECT * FROM artists WHERE norm=? OR public_slug=? ORDER BY CASE WHEN norm=? THEN 0 ELSE 1 END LIMIT 1");
  const update = database.prepare("UPDATE artists SET data=?,updated_at=? WHERE norm=? AND data IS ?");
  const audit = database.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const artist = (ctx) => {
    let key;
    try { key = decodeURIComponent(String(ctx.params?.key || "")).trim().toLowerCase(); }
    catch { throw new ApiError(400, "Choose a valid artist.", "VALIDATION_FAILED"); }
    if (!key || key.length > 200 || /[\u0000-\u001f\u007f]/u.test(key)) throw new ApiError(400, "Choose a valid artist.", "VALIDATION_FAILED");
    const row = find.get(key, key, key);
    if (!row) throw new ApiError(404, "That artist is not in the catalog.", "NOT_FOUND");
    return row;
  };
  const read = (row) => {
    const data = dataFor(row);
    const facts = projectArtistBiography(data, { artistMbid: row.mbid });
    const requiresReview = Object.prototype.hasOwnProperty.call(data, "biographyStaff") && !artistBiographyBindingMatches(data.biographyStaff, row.mbid);
    return { artistKey: row.norm, artistMbid: artistBiographyIdentity(row.mbid), facts, revision: revisionFor(data), requiresReview,
      pendingFacts: requiresReview ? projectArtistBiography({ biographyFacts: data.biographyStaff?.facts }) : null,
      legacyYear: typeof row.formed === "string" ? row.formed.slice(0, 80) : null };
  };
  return {
    "GET /api/admin/artists/:key/biography": (ctx) => {
      requireAdmin(ctx); ctx.setHeader?.("Cache-Control", "private, no-store");
      return read(artist(ctx));
    },
    "PUT /api/admin/artists/:key/biography": (ctx) => {
      const actor = requireAdmin(ctx);
      rateLimit(ctx, "artist-biography-write", 60, 600_000);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      if (!Number.isSafeInteger(ctx.body?.revision) || ctx.body.revision < 0) throw new ApiError(400, "Reload the artist facts before saving.", "VALIDATION_FAILED");
      let facts;
      try { facts = validateStaffArtistBiography(ctx.body?.facts, { at: now() }); }
      catch (error) {
        if (error instanceof ArtistBiographyValidationError) throw new ApiError(400, error.message, "VALIDATION_FAILED");
        throw error;
      }
      const row = artist(ctx), data = dataFor(row), revision = revisionFor(data);
      if (revision !== ctx.body.revision) throw new ApiError(409, "These artist facts changed. Reload before saving.", "CONFLICT");
      const artistMbid = artistBiographyIdentity(row.mbid);
      if (!Object.prototype.hasOwnProperty.call(ctx.body, "artistMbid") || ctx.body.artistMbid !== artistMbid) {
        throw new ApiError(409, "The artist identity changed. Reload and review the facts before saving.", "CONFLICT");
      }
      const next = { ...data, biographyStaff: { revision: revision + 1, artistMbid, facts } };
      const reason = typeof ctx.body?.reason === "string" ? ctx.body.reason.trim().slice(0, 600) : "Artist biography correction";
      database.exec("SAVEPOINT artist_biography_write");
      try {
        if (Number(update.run(JSON.stringify(next), now(), row.norm, row.data).changes) !== 1) {
          throw new ApiError(409, "This artist changed. Reload before saving.", "CONFLICT");
        }
        audit.run(randomUUID(), actor.id, "artist_biography", "artist", row.norm, reason,
          JSON.stringify({ facts: projectArtistBiography(data, { artistMbid: row.mbid }), revision,
            artistMbid: data.biographyStaff?.artistMbid ?? null, correction: data.biographyStaff || null }),
          JSON.stringify({ facts, revision: revision + 1, artistMbid }), ctx.requestId || null, now());
        database.exec("RELEASE artist_biography_write");
      } catch (error) {
        database.exec("ROLLBACK TO artist_biography_write; RELEASE artist_biography_write");
        throw error;
      }
      const saved = find.get(row.norm, row.norm, row.norm);
      return { ...read(saved), artist: publicArtist(saved) };
    },
  };
}
