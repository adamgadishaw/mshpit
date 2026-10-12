import { artistIdentityReview } from "./artistVerification.js";
import { revokeArtistPageAccess } from "./artistAccessRevocation.js";
import { compileArtistAccessPlan, applyArtistContentPublication, independentArtistContentHold } from "./artistAccessPublication.js";

export function artistAccessReviewRoutes({ db, q, requireAdmin, ApiError, clean, normName, accountIsPublic, now, limit, atomicWrite, uid, moderationRecord, assertSafeAuthoredText, publicProfile }) {
  const pageKey = ctx => {
    let value;
    try { value = normName(decodeURIComponent(ctx.params?.key || "")); }
    catch { throw new ApiError(400, "Invalid artist link.", "VALIDATION_FAILED"); }
    if (!value || value.length > 200) throw new ApiError(400, "Invalid artist link.", "VALIDATION_FAILED");
    return db.prepare("SELECT norm FROM artists WHERE norm=? OR public_slug=? LIMIT 1").get(value, value)?.norm || value;
  };
  const reviewReason = body => {
    if (typeof body?.reason !== "string" || body.reason.length > 300) throw new ApiError(400, "Add a reason within 300 characters.", "VALIDATION_FAILED");
    const reason = clean(body.reason, { max: 300 });
    if (reason.length < 8) throw new ApiError(400, "Explain this decision in at least eight characters.", "VALIDATION_FAILED");
    assertSafeAuthoredText(reason, { field: "artist access publication reason" }); return reason;
  };
  return {
    "GET /api/admin/artist-access": ctx => {
      requireAdmin(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      const query = ctx.query?.q;
      if (typeof query !== "string" || query.length > 80 || query.trim().length < 2) {
        throw new ApiError(400, "Search with 2–80 characters of the artist name or page key.", "VALIDATION_FAILED");
      }
      limit(ctx, "artist-access-review", 60, 60_000);
      const term = clean(query, { max: 80 }).toLowerCase();
      if (term.length < 2) throw new ApiError(400, "Enter at least two searchable characters.", "VALIDATION_FAILED");
      // Include unassigned catalog pages and orphan overlays: no result must
      // never be mistaken for proof that a known page has no assignment.
      const rows = db.prepare(`SELECT a.norm AS key,a.name AS name FROM artists a
        WHERE instr(lower(a.name),?)>0 OR instr(a.norm,?)>0 OR instr(COALESCE(a.public_slug,''),?)>0
        UNION SELECT ap.artist_key AS key,ap.artist_key AS name FROM artist_profiles ap
        WHERE NOT EXISTS (SELECT 1 FROM artists a WHERE a.norm=ap.artist_key) AND instr(ap.artist_key,?)>0
        ORDER BY key LIMIT 21`).all(term, term, term, term);
      return { hasMore: rows.length > 20, artists: rows.slice(0, 20).map(row => {
        const profile = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(row.key);
        const owner = profile?.owner_id ? db.prepare("SELECT * FROM users WHERE id=?").get(profile.owner_id) : null;
        return { key: row.key, name: row.name, ownerId: profile?.owner_id || null, updatedAt: profile?.updated_at ?? null,
          removed: !!profile?.removed, identityReview: artistIdentityReview(profile),
          retainedReviews: db.prepare("SELECT COUNT(*) n FROM artist_access_revocations WHERE artist_key=?").get(row.key).n,
          owner: owner ? { id: owner.id, name: owner.name, handle: owner.handle, role: owner.role,
            artistName: owner.artist_name || null, verified: !!owner.verified, active: accountIsPublic(owner, now()),
            matchesArtist: owner.role === "artist" && normName(owner.artist_name) === row.key } : null };
      }) };
    },
    "POST /api/admin/artists/:key/revoke-access": ctx => {
      requireAdmin(ctx);
      const body = ctx.body;
      if (body?.confirmed !== true || typeof body.expectedOwnerId !== "string" || !body.expectedOwnerId
        || body.expectedOwnerId.length > 180 || !Object.hasOwn(body, "expectedUpdatedAt")
        || (body.expectedUpdatedAt !== null && (!Number.isSafeInteger(body.expectedUpdatedAt) || body.expectedUpdatedAt < 0))) {
        throw new ApiError(400, "Review the current assignment and explicitly confirm its revocation.", "VALIDATION_FAILED");
      }
      limit(ctx, "artist-access-revoke", 20, 60_000);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      if (typeof body.reason !== "string" || body.reason.length > 300) throw new ApiError(400, "Add a reason within 300 characters.", "VALIDATION_FAILED");
      const reason = clean(body.reason, { max: 300 });
      if (reason.length < 8) throw new ApiError(400, "Explain why access is being revoked in at least eight characters.", "VALIDATION_FAILED");
      assertSafeAuthoredText(reason, { field: "artist access revocation reason" });
      const key = pageKey(ctx);
      if (!/^[a-f0-9]{64}$/.test(body.expectedContentHash || "") || !["hide", "keep", "selected"].includes(body.disposition || "hide")
        || (body.visibleItems != null && (!Array.isArray(body.visibleItems) || body.visibleItems.length > 2000 || body.visibleItems.some(item => typeof item !== "string" || item.length > 220)))) {
        throw new ApiError(400, "Preview this page's content and choose its publication disposition.", "VALIDATION_FAILED");
      }
      return atomicWrite(() => revokeArtistPageAccess({ db, q, ctx: { ...ctx, body: { ...body, reason } }, key, requireAdmin, ApiError, normName, now, uid, moderationRecord, publicProfile }));
    },
    "GET /api/admin/artists/:key/access-preview": ctx => {
      requireAdmin(ctx);ctx.setHeader?.("Cache-Control", "private, no-store");
      const key = pageKey(ctx), cursor = Number(ctx.query?.cursor || 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 2000) throw new ApiError(400, "Invalid preview page.", "VALIDATION_FAILED");
      const plan = compileArtistAccessPlan({ db, key, publicProfile, now });
      if (plan.content.length > 2000) throw new ApiError(409, "This page needs a larger retained-content review. No changes were made.", "CONFLICT");
      return { contentHash: plan.hash, ownerId: plan.profile?.owner_id || null, updatedAt: plan.profile?.updated_at ?? null,
        contentCount: plan.content.length, profileItems: plan.profileItems,
        items: plan.content.slice(cursor, cursor + 20).map(item => ({ type: item.type, id: item.row.id, itemKey: item.itemKey,
          eligible: item.eligible, previouslyPublic: item.previouslyPublic, userId: item.row.user_id || item.row.owner_id,
          text: item.row.text || item.row.review || null, photos: JSON.parse(item.row.photos || "[]"),
          artist: item.row.artist || null, venue: item.row.venue || null, date: item.row.date || null })),
        cursor: plan.content.length > cursor + 20 ? cursor + 20 : null };
    },
    "POST /api/admin/artists/:key/retained-content/publication": ctx => {
      requireAdmin(ctx);ctx.setHeader?.("Cache-Control", "private, no-store");
      const key = pageKey(ctx), body = ctx.body, reason = reviewReason(body);
      if (body?.confirmed !== true || typeof body.revocationId !== "string" || body.revocationId.length > 100
        || !Array.isArray(body.items) || !body.items.length || body.items.length > 100
        || body.items.some(item => !["profile", "post", "artist_post", "tour_date"].includes(item?.type) || typeof item.id !== "string"
          || item.id.length > 180 || !["hidden", "public"].includes(item.publication) || !Number.isSafeInteger(item.revision) || item.revision < 1)
        || !Object.hasOwn(body, "expectedCurrentOwnerId") || !Object.hasOwn(body, "expectedProfileUpdatedAt")) {
        throw new ApiError(400, "Preview exact retained items and explicitly confirm the publication changes.", "VALIDATION_FAILED");
      }
      if (new Set(body.items.map(item => `${item.type}:${item.id}`)).size !== body.items.length) throw new ApiError(400, "Choose each retained item once.", "VALIDATION_FAILED");
      limit(ctx, "artist-content-publication", 30, 60_000);
      return atomicWrite(() => {
        requireAdmin(ctx);
        const profile = db.prepare("SELECT owner_id,updated_at FROM artist_profiles WHERE artist_key=?").get(key);
        if ((profile?.owner_id || null) !== body.expectedCurrentOwnerId || (profile?.updated_at ?? null) !== body.expectedProfileUpdatedAt) throw new ApiError(409, "The current assignment or page changed. Refresh the retained-content preview.", "CONFLICT");
        const snapshot = db.prepare("SELECT * FROM artist_access_revocations WHERE id=? AND artist_key=?").get(body.revocationId, key);
        if (!snapshot) throw new ApiError(404, "No retained-content review for this page.", "NOT_FOUND");
        let changed = 0;
        for (const item of body.items) changed += applyArtistContentPublication({ db, snapshot, ...item, ApiError, now }) ? 1 : 0;
        if (changed) moderationRecord(ctx, "artist_access_publication", "artist", key, reason, { revocationId: snapshot.id }, { items: body.items.map(({ type, id, publication }) => ({ type, id, publication })) });
        return { ok: true, changed };
      });
    },
    "GET /api/admin/artists/:key/retained-content": ctx => {
      requireAdmin(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      const key = pageKey(ctx), cursor = Number(ctx.query?.cursor || 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 100000) throw new ApiError(400, "Invalid retained-content page.", "VALIDATION_FAILED");
      const revocations = db.prepare(`SELECT id,owner_id,reviewer_id,reason,created_at FROM artist_access_revocations
        WHERE artist_key=? ORDER BY created_at DESC,id DESC LIMIT 20`).all(key);
      const id = ctx.query?.revocationId || revocations[0]?.id;
      if (id != null && (typeof id !== "string" || id.length > 100)) throw new ApiError(400, "Invalid retained-content review.", "VALIDATION_FAILED");
      const snapshot = id ? db.prepare("SELECT * FROM artist_access_revocations WHERE id=? AND artist_key=?").get(id, key) : null;
      if (id && !snapshot) throw new ApiError(404, "No retained-content review for this page.", "NOT_FOUND");
      const rows = snapshot ? db.prepare(`SELECT * FROM artist_access_retained_content
        WHERE revocation_id=? ORDER BY target_type,target_id LIMIT 21 OFFSET ?`).all(id, cursor) : [];
      const scope = db.prepare("SELECT owner_id,updated_at FROM artist_profiles WHERE artist_key=?").get(key);
      return { revocations, currentOwnerId: scope?.owner_id || null, profileUpdatedAt: scope?.updated_at ?? null,
        profileItems: snapshot ? db.prepare("SELECT * FROM artist_access_profile_items WHERE revocation_id=?").all(id).map(item => ({ type: "profile", id: item.slot,
          value: item.value, authorId: item.author_id, eligible: !!item.original_public && !independentArtistContentHold(db, snapshot, "profile", item.slot), publication: item.publication, revision: item.revision })) : [],
        snapshot: snapshot ? { id, ownerId: snapshot.owner_id, reviewerId: snapshot.reviewer_id,
        reason: snapshot.reason, createdAt: snapshot.created_at, status: snapshot.review_status, profile: JSON.parse(snapshot.profile_json) } : null,
        content: rows.slice(0, 20).map(item => { const row = JSON.parse(item.record_json); return { type: item.target_type, id: item.target_id,
          userId: row.user_id || row.owner_id, text: row.text || row.review || null, photos: JSON.parse(row.photos || "[]"),
          eligible: !!item.original_public && !item.superseded && !independentArtistContentHold(db, snapshot, item.target_type, item.target_id),
          publication: item.publication, revision: item.revision, superseded: !!item.superseded,
          artist: row.artist || null, venue: row.venue || null, date: row.date || null, source: row.source || null, createdAt: row.created_at || null }; }),
        cursor: rows.length > 20 ? cursor + 20 : null };
    },
  };
}
