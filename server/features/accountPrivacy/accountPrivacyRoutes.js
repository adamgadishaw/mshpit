const EXPORT_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_PREFERENCE_WINDOW_MS = 60 * 60 * 1000;

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

// Owner media projections can include a short-lived storage capability in
// `sourceUrl` so the authenticated editor can reopen an original. A portability
// archive is durable and may be copied elsewhere, so it carries only stable
// descriptors and public derivatives, never that private-source bearer URL.
const PORTABLE_MEDIA_FIELDS = Object.freeze([
  "id", "kind", "purpose", "url", "posterUrl", "posterTimeMs", "width", "height",
  "durationMs", "orientation", "mimeType", "byteSize", "status", "renderState",
  "metadataStatus", "codecStatus", "altText", "recipeVersion", "editRecipe",
  "revisionPending", "createdAt", "updatedAt",
]);

export function portableMediaAsset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(PORTABLE_MEDIA_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(value, field))
    .map((field) => [field, value[field]]));
}

export function accountPrivacyRoutes({
  database,
  ApiError,
  findUserById,
  marketingConsentVersion,
  now,
  ownedMediaAsset,
  projectSelf,
  rateLimit,
  requireSessionUser,
  setMarketingPreference,
  verifyPassword,
}) {
  if (!database?.prepare || typeof ApiError !== "function" || typeof findUserById !== "function"
    || !marketingConsentVersion || typeof now !== "function" || typeof ownedMediaAsset !== "function"
    || typeof projectSelf !== "function" || typeof rateLimit !== "function"
    || typeof requireSessionUser !== "function" || typeof setMarketingPreference !== "function"
    || typeof verifyPassword !== "function") {
    throw new TypeError("Account privacy routes require complete boundary dependencies");
  }

  return Object.freeze({
    "POST /api/me/email-preferences": (ctx) => {
      const user = requireSessionUser(ctx);
      ctx.setHeader?.("Cache-Control", "no-store");
      rateLimit(ctx, "email-preferences", 20, EMAIL_PREFERENCE_WINDOW_MS);
      if (typeof ctx.body?.announcements !== "boolean") {
        throw new ApiError(400, "Choose whether announcement email is enabled.", "VALIDATION_FAILED");
      }
      setMarketingPreference({
        id: user.id,
        opt_out: ctx.body.announcements ? 0 : 1,
        at: now(),
        version: marketingConsentVersion,
        source: "account-settings",
      });
      return { user: projectSelf(findUserById(user.id)) };
    },

    // A portable, privacy-filtered account backup. This remains synchronous and
    // explicitly documents bounded histories until the archive job is queued.
    "POST /api/me/export": (ctx) => {
      // Privacy rights remain available when social posting is restricted.
      const user = requireSessionUser(ctx);
      rateLimit(ctx, "export", 5, EXPORT_LIMIT_WINDOW_MS);
      const password = typeof ctx.body?.password === "string" ? ctx.body.password : "";
      if (!password || !verifyPassword(password, user.pass_hash)) {
        throw new ApiError(401, "Enter your current password to download your data.", "AUTH_INVALID");
      }
      // A portability export describes this account's own relationships. It must
      // not become a second profile directory: resolving a counterparty's live
      // name/handle here would bypass blocks and account-visibility restrictions.
      const accountReference = (id) => ({ id });
      return {
        exportedAt: new Date(now()).toISOString(),
        exportNotes: [
          "Password hashes, reset credentials, provider tokens, session cookies, raw IP addresses, and user-agent strings are intentionally excluded.",
          "Uploaded media files are represented by attached URLs and stable media descriptors; storage-provider audit metadata is not part of the account export.",
          "Other accounts are represented by stable internal ids only; live names and handles are excluded so an export cannot bypass blocks or profile visibility.",
          "This synchronous export includes all current feed preferences plus up to 300 plays, 1,000 sent and received messages, 200 notifications, 5,000 activity events, 1,000 posts tagging you, and 1,000 tags you removed. A queued archive job is required before production-scale launch.",
        ],
        profile: projectSelf(user),
        posts: database.prepare("SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC").all(user.id)
          .map((post) => ({ id: post.id, kind: post.kind || "review", artist: post.artist, venue: post.venue, city: post.city, date: post.date, overall: post.overall, band: post.band, room: post.room, review: post.review, tour: post.tour, setlist: parseJson(post.setlist, []), tags: parseJson(post.tags, []), taggedUserIds: parseJson(post.tagged_user_ids, []), campaign: parseJson(post.campaign, null), photos: parseJson(post.photos, []), photosPublic: !!post.photos_public, landingShowcase: !!post.landing_showcase, song: parseJson(post.song, null), playlist: parseJson(post.playlist, null), removed: !!post.removed, createdAt: post.created_at })),
        taggedInPosts: database.prepare(`SELECT t.post_id,p.user_id AS author_id,p.removed,p.created_at
          FROM post_user_tags t JOIN posts p ON p.id=t.post_id
          WHERE t.user_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 1000`).all(user.id)
          .map((row) => ({ postId: row.post_id, authorId: row.author_id, removed: !!row.removed, createdAt: row.created_at })),
        removedPostTags: database.prepare(`SELECT post_id,created_at FROM post_tag_rejections
          WHERE user_id=? ORDER BY created_at DESC,post_id DESC LIMIT 1000`).all(user.id)
          .map((row) => ({ postId: row.post_id, createdAt: row.created_at })),
        mediaAssets: database.prepare("SELECT id FROM media_assets WHERE owner_id=? ORDER BY created_at DESC").all(user.id)
          .map((row) => ownedMediaAsset(database, { ownerId: user.id, assetId: row.id }))
          .map(portableMediaAsset)
          .filter(Boolean),
        comments: database.prepare("SELECT post_id,text,removed,created_at FROM comments WHERE user_id=? ORDER BY created_at DESC").all(user.id)
          .map((row) => ({ postId: row.post_id, text: row.text, removed: !!row.removed, createdAt: row.created_at })),
        likedPosts: database.prepare("SELECT post_id FROM likes WHERE user_id=?").all(user.id).map((row) => row.post_id),
        following: database.prepare("SELECT followee_id id FROM follows WHERE follower_id=?").all(user.id).map((row) => accountReference(row.id)),
        followers: database.prepare("SELECT follower_id id FROM follows WHERE followee_id=?").all(user.id).map((row) => accountReference(row.id)),
        blocked: database.prepare("SELECT blocked_id id FROM blocks WHERE blocker_id=?").all(user.id).map((row) => accountReference(row.id)),
        feedPreferences: database.prepare("SELECT post_id,action,created_at FROM recommendation_preferences WHERE user_id=? ORDER BY created_at DESC").all(user.id)
          .map((row) => ({ postId: row.post_id, action: row.action, createdAt: row.created_at })),
        playlists: database.prepare("SELECT id,name,tracks,visibility,created_at,updated_at FROM playlists WHERE user_id=? ORDER BY created_at DESC").all(user.id)
          .map((row) => ({ id: row.id, name: row.name, tracks: parseJson(row.tracks, []), visibility: row.visibility || "public", createdAt: row.created_at, updatedAt: row.updated_at || null })),
        listeningHistory: database.prepare("SELECT title,artist,url,video_id,provider,source_id,created_at FROM plays WHERE user_id=? ORDER BY created_at DESC LIMIT 300").all(user.id)
          .map((row) => ({ title: row.title, artist: row.artist, url: row.url, videoId: row.video_id, provider: row.provider, sourceId: row.source_id, at: row.created_at })),
        going: database.prepare("SELECT artist,venue,city,date FROM going WHERE user_id=?").all(user.id),
        attendance: database.prepare(`SELECT a.show_id,s.canonical_key,
          COALESCE(a.legacy_concert_key,
            (SELECT sa.alias_value FROM show_aliases sa
              WHERE sa.show_id=s.id AND sa.alias_type='legacy_concert_key'
              ORDER BY sa.alias_value LIMIT 1),s.canonical_key) AS preferred_key,
          COALESCE(NULLIF(a.legacy_artist,''),s.artist) AS artist,
          COALESCE(NULLIF(a.legacy_venue,''),s.venue) AS venue,
          COALESCE(NULLIF(a.legacy_city,''),s.city) AS city,
          COALESCE(NULLIF(a.legacy_date,''),s.date) AS date,
          a.state,a.visibility,a.checked_in_at,a.created_at,a.updated_at,
          EXISTS (SELECT 1 FROM show_attendance_verifications v
            WHERE v.show_id=a.show_id AND v.user_id=a.user_id AND v.revoked_at IS NULL) AS verified
          FROM show_attendance a JOIN shows s ON s.id=a.show_id
          WHERE a.user_id=? ORDER BY a.updated_at DESC,a.show_id`).all(user.id).map((row) => ({
            showId: row.show_id,
            key: row.preferred_key,
            canonicalKey: row.canonical_key,
            artist: row.artist,
            venue: row.venue,
            city: row.city,
            date: row.date,
            state: row.state,
            visibility: row.visibility,
            checkedInAt: row.checked_in_at || null,
            verified: !!row.verified,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
        ratings: database.prepare("SELECT kind,ref,rating FROM ratings WHERE user_id=?").all(user.id),
        venueReviews: database.prepare("SELECT id,venue_key,rating,text,photos,photos_public,removed,created_at FROM venue_reviews WHERE user_id=? ORDER BY created_at DESC").all(user.id)
          .map((row) => ({ id: row.id, venueKey: row.venue_key, rating: row.rating, text: row.text, photos: parseJson(row.photos, []), photosPublic: !!row.photos_public, removed: !!row.removed, createdAt: row.created_at })),
        fanClubs: {
          memberships: database.prepare("SELECT artist FROM fan_club_members WHERE user_id=? ORDER BY artist COLLATE NOCASE").all(user.id).map((row) => row.artist),
          messages: database.prepare("SELECT id,artist,text,removed,created_at FROM fan_club_messages WHERE user_id=? ORDER BY created_at DESC").all(user.id)
            .map((row) => ({ id: row.id, artist: row.artist, text: row.text, removed: !!row.removed, createdAt: row.created_at })),
        },
        loungeMessages: database.prepare("SELECT id,lounge_id,text,removed,created_at FROM lounge_messages WHERE user_id=? ORDER BY created_at DESC").all(user.id)
          .map((row) => ({ id: row.id, loungeId: row.lounge_id, text: row.text, removed: !!row.removed, createdAt: row.created_at })),
        messagesSent: database.prepare("SELECT to_id,text,removed,created_at FROM dms WHERE from_id=? ORDER BY created_at DESC LIMIT 1000").all(user.id)
          .map((row) => ({ to: accountReference(row.to_id), text: row.text, removed: !!row.removed, createdAt: row.created_at })),
        messagesReceived: database.prepare("SELECT from_id,text,removed,created_at FROM dms WHERE to_id=? ORDER BY created_at DESC LIMIT 1000").all(user.id)
          .map((row) => ({ from: accountReference(row.from_id), text: row.text, removed: !!row.removed, createdAt: row.created_at })),
        artistAccount: {
          requests: database.prepare("SELECT id,artist_name,note,status,created_at FROM artist_requests WHERE user_id=? ORDER BY created_at DESC").all(user.id)
            .map((row) => ({ id: row.id, artistName: row.artist_name, note: row.note, status: row.status, createdAt: row.created_at })),
          profiles: database.prepare("SELECT artist_key,bio,banner,avatar_uri,feed_enabled,updated_at FROM artist_profiles WHERE owner_id=?").all(user.id)
            .map((row) => ({ artistKey: row.artist_key, bio: row.bio, banner: row.banner, avatarUri: row.avatar_uri, feedEnabled: !!row.feed_enabled, updatedAt: row.updated_at })),
          posts: database.prepare("SELECT id,artist_key,text,created_at FROM artist_posts WHERE user_id=? ORDER BY created_at DESC").all(user.id)
            .map((row) => ({ id: row.id, artistKey: row.artist_key, text: row.text, createdAt: row.created_at })),
        },
        reportsSubmitted: database.prepare("SELECT id,target_type,target_id,reason,status,created_at FROM reports WHERE reporter_id=? ORDER BY created_at DESC").all(user.id)
          .map((row) => ({ id: row.id, targetType: row.target_type, targetId: row.target_id, reason: row.reason, status: row.status, createdAt: row.created_at })),
        activityEvents: database.prepare("SELECT id,name,props,created_at FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 5000").all(user.id)
          .map((row) => ({ id: row.id, name: row.name, properties: parseJson(row.props, {}), createdAt: row.created_at })),
        notifications: database.prepare("SELECT type,actor_id,artist,text,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 200").all(user.id)
          .map((row) => ({ type: row.type, from: row.actor_id ? accountReference(row.actor_id) : null, artist: row.artist, text: row.text, at: row.created_at })),
      };
    },
  });
}
