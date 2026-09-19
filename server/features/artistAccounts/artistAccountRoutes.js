import { artistPageName, pendingArtistSignupIntent } from "./artistAccountPolicy.js";
import { assessArtistIdentityRisk } from "./artistIdentityRisk.js";
import { artistIdentityHeld, artistIdentityReview, createArtistVerification, manualIdentityReviewEvidence, verificationReviewReason } from "./artistVerification.js";

export function artistAccountRoutes({
  db, q, ApiError, clean, LIMITS, normName, artistSearchKey, artistStmts, artistRow,
  publicArtist, publicUser, publicProfile, accountIsPublic, requireUser, requireAdmin,
  atomicWrite, limit, uid, now, assertSafeAuthoredText, isLegacyArtistProfile,
  legacyArtistReadOnlyError, resolveReviewedArtistAlias, moderationRecord,
}) {
  const profileByKey = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?");
  const verification = createArtistVerification({ database: db, now, uid });
  const profilesByOwner = db.prepare("SELECT artist_key FROM artist_profiles WHERE owner_id=? LIMIT 2");
  const latestRequest = db.prepare("SELECT id,artist_name,status FROM artist_requests WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1");
  const latestArtistRequest = db.prepare("SELECT id,artist_name,status FROM artist_requests WHERE user_id=? AND lower(trim(artist_name))=? ORDER BY created_at DESC,id DESC LIMIT 1");
  const insertCatalog = db.prepare(`INSERT INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,mbid,spotify_id,country,formed,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (@norm,@name,@public_slug,@search_key,@genre,@photo,@bio,@mbid,@spotify_id,@country,@formed,@popularity,@rank_score,@data,@source,@created_at,@updated_at)`);
  const parseExtras = (user) => {
    try {
      const value = JSON.parse(user?.extras || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  const currentMember = (ctx, { email = false } = {}) => {
    const authenticated = requireUser(ctx);
    const user = q.userById.get(authenticated.id);
    if (!user || !accountIsPublic(user, now())) throw new ApiError(403, "This account cannot manage an artist page right now.", "FORBIDDEN");
    if (ctx.body?.expectedAccountId != null && ctx.body.expectedAccountId !== user.id) {
      throw new ApiError(409, "Your account changed. Open artist setup again.", "ACCOUNT_CHANGED");
    }
    if (email && !user.email_verified_at) {
      throw new ApiError(403, "Confirm your email before creating or claiming an artist page.", "EMAIL_VERIFICATION_REQUIRED");
    }
    return user;
  };
  const ownedProfile = (user) => {
    if (user?.role !== "artist" || !user.artist_name) return null;
    const profile = profileByKey.get(normName(user.artist_name));
    return profile?.owner_id === user.id ? profile : null;
  };
  const snapshot = (user) => {
    const profile = ownedProfile(user);
    const request = profile ? latestArtistRequest.get(user.id, profile.artist_key) : latestRequest.get(user.id);
    return {
      ok: true,
      user: publicUser(user, { self: true }),
      artist: profile ? publicArtist(artistStmts.byNorm.get(profile.artist_key)) : null,
      profile: profile ? publicProfile(profile) : null,
      verification: { status: profile && !profile.removed && !artistIdentityHeld(profile) && user.verified ? "verified" : request?.status || "not_requested", requestId: request?.id || null,
        reviewReason: request ? verification.details(request.id).reviewReason : null },
      identityReview: artistIdentityReview(profile),
      verificationChallenge: verification.ownLatest(user.id, profile?.artist_key || null),
      pendingArtistIntent: pendingArtistSignupIntent(parseExtras(user)),
    };
  };
  const artistConflict = (name, key, userId = null) => {
    const folded = artistSearchKey(name);
    return artistStmts.byNorm.get(key) || artistStmts.byPublicSlug.get(key)
      || resolveReviewedArtistAlias(db, name)
      || (folded && db.prepare("SELECT norm FROM artists WHERE search_key=? LIMIT 1").get(folded))
      || profileByKey.get(key)
      || db.prepare("SELECT id FROM users WHERE role='artist' AND lower(trim(artist_name))=? AND id<>COALESCE(?, '') LIMIT 1").get(key, userId);
  };
  const rejectOtherPending = (userId, key, exceptId = "") => {
    db.prepare("UPDATE artist_requests SET status='rejected' WHERE user_id=? AND lower(trim(artist_name))=? AND status='pending' AND id<>?")
      .run(userId, key, exceptId);
  };
  const applyIdentityHold = (profile, status, reason, reviewerId, reviewedUrl = null) => {
    db.prepare(`UPDATE artist_profiles SET identity_review_status=?,identity_review_reason=?,identity_reviewed_at=?,identity_reviewed_by=?,identity_review_evidence_url=?,updated_at=?
      WHERE artist_key=? AND owner_id=?`).run(status, reason, now(), reviewerId, reviewedUrl, now(), profile.artist_key, profile.owner_id);
    if (["pending", "rejected"].includes(status)) {
      db.prepare("UPDATE users SET verified=0 WHERE id=?").run(profile.owner_id);
      // Quarantine, never delete, identity-bound feed posts. A later identity
      // release does not silently republish content a moderator hid.
      db.prepare("UPDATE posts SET removed=1 WHERE user_id=? AND artist_key=? AND removed=0").run(profile.owner_id, profile.artist_key);
    }
  };

  return {
    "GET /api/artist-account": (ctx) => {
      ctx.setHeader?.("Cache-Control", "private, no-store");
      return snapshot(currentMember(ctx));
    },
    "POST /api/artist-pages": (ctx) => {
      const user = currentMember(ctx, { email: true });
      limit(ctx, "artist-page-create", 5, 60 * 60 * 1000);
      const name = artistPageName(ctx.body?.artistName);
      const key = normName(name);
      if (ctx.body?.bio != null && (typeof ctx.body.bio !== "string" || ctx.body.bio.length > 600)) {
        throw new ApiError(400, "Keep the artist biography within 600 characters.", "VALIDATION_FAILED");
      }
      const bio = clean(ctx.body?.bio, { max: 600, newlines: true }) || null;
      assertSafeAuthoredText(bio, { field: "artist bio" });
      if (isLegacyArtistProfile(key, name)) throw legacyArtistReadOnlyError();
      atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const fresh = currentMember(ctx, { email: true });
        if (!["fan", "artist"].includes(fresh.role)) throw new ApiError(403, "Staff accounts cannot convert themselves into artist accounts.", "FORBIDDEN");
        const own = ownedProfile(fresh);
        if (own?.artist_key === key && !own.removed) {
          if (!artistStmts.byNorm.get(key)) throw new ApiError(409, "Your existing artist page needs a catalog identity review before setup can continue.", "CONFLICT");
          return;
        }
        if (fresh.role === "artist" || profilesByOwner.all(fresh.id).length) {
          throw new ApiError(409, "This account already has an artist page. Manage that page instead.", "ARTIST_PAGE_LIMIT");
        }
        if (artistConflict(name, key, fresh.id)) {
          throw new ApiError(409, "An artist page with that name already exists. Request a reviewed claim instead of creating a duplicate.", "ARTIST_PAGE_EXISTS");
        }
        const identityRisk = assessArtistIdentityRisk(db, { name, handle: fresh.handle, ownerId: fresh.id });
        // New rows only: never upsert an existing provider identity. Member bio
        // and artwork stay in the moderated overlay, not the shared catalog.
        insertCatalog.run(artistRow(key, { name }, "artist-created"));
        db.prepare(`INSERT INTO artist_profiles
          (artist_key,owner_id,bio,feed_enabled,updated_at,identity_review_status,identity_review_json)
          VALUES (?,?,?,1,?,?,?)`)
          .run(key, fresh.id, bio, now(), identityRisk.requiresReview ? "pending" : "clear", JSON.stringify(identityRisk));
        const extras = parseExtras(fresh);
        delete extras.pendingArtistIntent;
        const changed = db.prepare("UPDATE users SET role='artist',artist_name=?,verified=0,extras=?,profile_updated_at=? WHERE id=? AND role='fan'")
          .run(name, JSON.stringify(extras), now(), fresh.id).changes;
        if (Number(changed) !== 1) throw new ApiError(409, "Your account changed while artist setup was finishing. Try again.", "ACCOUNT_CHANGED");
        artistStmts.clearMissing.run(key);
      });
      return snapshot(q.userById.get(user.id));
    },
    "POST /api/artist-verification-challenges": (ctx) => {
      const user = currentMember(ctx, { email: true });
      const name = artistPageName(ctx.body?.artistName);
      const key = normName(name);
      if (ctx.body?.method !== "instagram_story") throw new ApiError(400, "Choose the Instagram Story verification method.", "VALIDATION_FAILED");
      if (!["fan", "artist"].includes(user.role) || (user.role === "artist" && normName(user.artist_name) !== key)) {
        throw new ApiError(403, "Use the account requesting this artist identity.", "FORBIDDEN");
      }
      if (isLegacyArtistProfile(key, name)) throw legacyArtistReadOnlyError();
      limit(ctx, "artist-verification-challenge", 12, 60 * 60 * 1000);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      return atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const fresh = currentMember(ctx, { email: true });
        if (!["fan", "artist"].includes(fresh.role) || (fresh.role === "artist" && normName(fresh.artist_name) !== key)) {
          throw new ApiError(409, "Your artist account changed. Open verification again.", "ACCOUNT_CHANGED");
        }
        return { ok: true, challenge: verification.issue({ userId: fresh.id, name, key, instagramHandle: ctx.body.instagramHandle }) };
      });
    },
    "POST /api/artist-requests": (ctx) => {
      const user = currentMember(ctx, { email: true });
      const name = artistPageName(ctx.body?.artistName);
      const key = normName(name);
      if (!["fan", "artist"].includes(user.role)) throw new ApiError(403, "Use the account that represents the artist.", "FORBIDDEN");
      if (isLegacyArtistProfile(key, name)) throw legacyArtistReadOnlyError();
      if (user.role === "artist" && normName(user.artist_name) !== key) {
        throw new ApiError(409, "Request verification for the artist page this account manages.", "ARTIST_PAGE_LIMIT");
      }
      const note = clean(ctx.body?.note, { max: LIMITS.note, newlines: true }) || "";
      assertSafeAuthoredText(note, { field: "request note" });
      if (note.length < 8) throw new ApiError(400, "Add an official website, social account, or contact we can use to verify you.", "VALIDATION_FAILED");
      limit(ctx, "artistreq", 5, 60 * 60 * 1000);
      return atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const fresh = currentMember(ctx, { email: true });
        if (!["fan", "artist"].includes(fresh.role) || (fresh.role === "artist" && normName(fresh.artist_name) !== key)) {
          throw new ApiError(409, "Your artist account changed. Open verification again.", "ACCOUNT_CHANGED");
        }
        const proof = verification.submission({ userId: fresh.id, key, body: ctx.body || {} });
        const previous = latestArtistRequest.get(fresh.id, key);
        if (previous?.status === "pending") {
          const previousProof = verification.details(previous.id);
          if (previousProof.method === proof.method && (proof.method === "manual"
            || previousProof.challenge?.id === proof.challenge?.id)) return { id: previous.id, status: "pending" };
          if (previousProof.reviewStatus !== "expired") throw new ApiError(409, "This artist already has a pending review. Wait for that review before changing the proof.", "CONFLICT");
          db.prepare("UPDATE artist_requests SET status='rejected' WHERE id=? AND status='pending'").run(previous.id);
        }
        if (ownedProfile(fresh)?.artist_key === key && fresh.verified) throw new ApiError(409, "This artist account already has the verified check.", "ALREADY_VERIFIED");
        const id = uid("ar");
        db.prepare("INSERT INTO artist_requests (id,user_id,artist_name,note,status,created_at) VALUES (?,?,?,?,'pending',?)")
          .run(id, fresh.id, name, note, now());
        verification.bind(id, proof);
        return { id, status: "pending" };
      });
    },
    "GET /api/admin/artist-identities": (ctx) => {
      requireAdmin(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      if (ctx.query?.q != null && (typeof ctx.query.q !== "string" || ctx.query.q.length > 80)) {
        throw new ApiError(400, "Keep the artist search within 80 characters.", "VALIDATION_FAILED");
      }
      const term = clean(ctx.query?.q, { max: 80 }).toLowerCase();
      if (!term) return { artists: [] };
      // Moderation must find held identities even though the public catalog
      // deliberately hides them. Search only local, owned profiles and project
      // review state, never private proof codes or reviewer evidence.
      const rows = db.prepare(`SELECT ap.*,COALESCE(a.name,owner.artist_name,ap.artist_key) AS artist_name
        FROM artist_profiles ap
        LEFT JOIN artists a ON a.norm=ap.artist_key
        LEFT JOIN users owner ON owner.id=ap.owner_id
        WHERE ap.owner_id IS NOT NULL AND (instr(lower(COALESCE(a.name,owner.artist_name,ap.artist_key)),?)>0
          OR instr(ap.artist_key,?)>0)
        ORDER BY CASE WHEN ap.artist_key=? THEN 0 ELSE 1 END,ap.artist_key LIMIT 20`).all(term, term, term);
      return { artists: rows.map((row) => ({ key: row.artist_key, name: row.artist_name,
        ownerId: row.owner_id, identityReview: artistIdentityReview(row) })) };
    },
    "GET /api/admin/artist-requests": (ctx) => {
      requireAdmin(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      const rows = db.prepare("SELECT * FROM artist_requests WHERE status='pending' ORDER BY created_at DESC,id DESC LIMIT 200").all();
      return { requests: rows.map((r) => {
        const key = normName(r.artist_name);
        const profile = profileByKey.get(key);
        const target = q.userById.get(r.user_id);
        const identityReview = artistIdentityReview(profile);
        if (!profile) {
          const risk = assessArtistIdentityRisk(db, { name: r.artist_name, handle: target?.handle, ownerId: r.user_id });
          Object.assign(identityReview, { artistKey: key, reasons: risk.reasons, matches: risk.matches });
        }
        return { id: r.id, userId: r.user_id, artistName: r.artist_name, artistKey: key, note: r.note, status: r.status,
          kind: profile?.owner_id === r.user_id ? "verification" : "claim", identityReview, proof: verification.details(r.id) };
      }) };
    },
    "POST /api/admin/artist-requests/:id/approve": (ctx) => {
      const reviewer = requireAdmin(ctx);
      atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const request = db.prepare("SELECT * FROM artist_requests WHERE id=?").get(ctx.params.id);
        if (!request) throw new ApiError(404, "No such request.", "NOT_FOUND");
        if (request.status !== "pending") throw new ApiError(409, "This request has already been reviewed. A new review is required.", "CONFLICT");
        const key = normName(request.artist_name);
        if (isLegacyArtistProfile(key, request.artist_name)) throw legacyArtistReadOnlyError();
        const target = q.userById.get(request.user_id);
        if (!target) throw new ApiError(404, "The requesting account no longer exists.", "NOT_FOUND");
        if (!["fan", "artist"].includes(target.role) || !accountIsPublic(target, now()) || !target.email_verified_at) {
          throw new ApiError(409, "The requesting account must be active and email-confirmed before approval.", "CONFLICT");
        }
        const profile = profileByKey.get(key);
        const conflict = db.prepare("SELECT id FROM users WHERE role='artist' AND lower(trim(artist_name))=? AND id<>? LIMIT 1").get(key, target.id);
        if (conflict || profile?.removed || (profile?.owner_id && profile.owner_id !== target.id)
          || (target.role === "artist" && normName(target.artist_name) !== key)
          || profilesByOwner.all(target.id).some((row) => row.artist_key !== key)) {
          throw new ApiError(409, "That artist identity is already assigned or requires a separate moderation review.", "CONFLICT");
        }
        if (artistIdentityHeld(profile) && ctx.body?.identityReviewConfirmed !== true) {
          throw new ApiError(400, "Explicitly resolve the identity-risk hold before approving this artist check.", "VALIDATION_FAILED");
        }
        const review = verification.approve(request, ctx.body || {}, reviewer.id);
        if (!artistStmts.byNorm.get(key)) {
          if (artistConflict(request.artist_name, key, target.id) && !profile) throw new ApiError(409, "Resolve the existing artist identity before approving this claim.", "CONFLICT");
          insertCatalog.run(artistRow(key, { name: request.artist_name }, "artist-created"));
        }
        if (profile) db.prepare("UPDATE artist_profiles SET owner_id=?,updated_at=? WHERE artist_key=?").run(target.id, now(), key);
        else db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,feed_enabled,updated_at) VALUES (?,?,1,?)").run(key, target.id, now());
        applyIdentityHold(profileByKey.get(key), "approved", review.reason, reviewer.id, review.reviewedUrl);
        const roleChanged = target.role !== "artist" || target.artist_name !== request.artist_name;
        db.prepare("UPDATE users SET role='artist',artist_name=?,verified=1 WHERE id=?").run(request.artist_name, target.id);
        if (roleChanged) db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
        db.prepare("UPDATE artist_requests SET status='approved' WHERE id=? AND status='pending'").run(request.id);
        rejectOtherPending(target.id, key, request.id);
        moderationRecord(ctx, "approve_artist_claim", "user", target.id, review.reason, { role: target.role, verified: !!target.verified },
          { role: "artist", verified: true, artistKey: key, method: review.method, observedAt: review.observedAt });
      });
      return { ok: true };
    },
    "POST /api/admin/artists/:key/identity-review": (ctx) => {
      const reviewer = requireAdmin(ctx);
      const action = ctx.body?.action;
      if (!["hold", "release", "reject"].includes(action)) throw new ApiError(400, "Choose an identity review action.", "VALIDATION_FAILED");
      const reason = verificationReviewReason(ctx.body?.reason);
      if (action === "release" && ctx.body?.identityReviewConfirmed !== true) throw new ApiError(400, "Confirm that you reviewed and resolved the artist identity risk.", "VALIDATION_FAILED");
      const evidence = action === "release" ? manualIdentityReviewEvidence(ctx.body || {}) : null;
      let requestedKey;
      try { requestedKey = normName(decodeURIComponent(ctx.params?.key || "")); }
      catch { throw new ApiError(400, "Invalid artist link.", "VALIDATION_FAILED"); }
      const artist = artistStmts.byNorm.get(requestedKey) || artistStmts.byPublicSlug.get(requestedKey);
      const key = artist?.norm || requestedKey;
      return atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const profile = profileByKey.get(key);
        if (!profile?.owner_id) throw new ApiError(404, "This artist has no owned page to review.", "NOT_FOUND");
        const prior = artistIdentityReview(profile);
        applyIdentityHold(profile, action === "release" ? "approved" : action === "reject" ? "rejected" : "pending", reason, reviewer.id, evidence?.reviewedUrl || null);
        const identityReview = artistIdentityReview(profileByKey.get(key));
        moderationRecord(ctx, `artist_identity_${action}`, "artist", key, reason,
          { status: prior.status, ownerId: profile.owner_id }, { status: identityReview.status, ownerId: profile.owner_id });
        return { ok: true, identityReview };
      });
    },
    "POST /api/admin/artist-requests/:id/reject": (ctx) => {
      const reviewer = requireAdmin(ctx);
      atomicWrite(() => {
        ctx.assertCurrentSession?.();
        const request = db.prepare("SELECT * FROM artist_requests WHERE id=?").get(ctx.params.id);
        if (!request) throw new ApiError(404, "No such request.", "NOT_FOUND");
        if (request.status !== "pending") throw new ApiError(409, "This request has already been reviewed.", "CONFLICT");
        const reason = verification.reject(request, ctx.body || {}, reviewer.id);
        db.prepare("UPDATE artist_requests SET status='rejected' WHERE id=? AND status='pending'").run(request.id);
        const profile = profileByKey.get(normName(request.artist_name));
        if (profile?.owner_id === request.user_id && artistIdentityHeld(profile)) applyIdentityHold(profile, "rejected", reason, reviewer.id);
        moderationRecord(ctx, "reject_artist_claim", "user", request.user_id, reason, { status: "pending" }, { status: "rejected" });
      });
      return { ok: true };
    },
  };
}
