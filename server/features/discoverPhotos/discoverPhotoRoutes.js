import { accountIsPublic, activeAccountSql } from "../../accountVisibility.js";
import { postMediaStateByPost } from "../../mediaAssets.js";
import { safeOwnedReadyMediaUrl } from "../../publicMedia.js";
import { inPersonReviewSql } from "../../onlineReviews.js";
import { discoverCountryIdentity } from "../../../src/domain/discoverScene.mjs";
import { discoverPhotoCity, discoverPhotoCountry } from "../../../src/domain/discoverPhotoLocation.mjs";

export const DISCOVER_PHOTO_LIMIT = 30;
const CANDIDATE_LIMIT = 100;
const text = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";

export function discoverPhotoRoutes({ database, rateLimit, ApiError }) {
  // These are query helpers, not schema/index expressions; backup/restore
  // connections do not need them to read or validate the database.
  database.function("pit_discover_photo_country", { deterministic: true }, discoverPhotoCountry);
  database.function("pit_discover_photo_city", { deterministic: true }, discoverPhotoCity);
  return {
    "GET /api/discover/photos": (ctx) => {
      ctx.setHeader?.("Cache-Control", "private, no-store");
      rateLimit(ctx, "discover-photos", 120, 10 * 60 * 1000);
      const country = discoverCountryIdentity(text(ctx.query?.country, 80));
      const city = discoverPhotoCity(text(ctx.query?.city, 120));
      const suppliedLimit = ctx.query?.limit;
      const number = suppliedLimit == null ? DISCOVER_PHOTO_LIMIT : Number(suppliedLimit);
      if (!Number.isSafeInteger(number) || number < 1) throw new ApiError(400, "Choose a valid photo limit.", "VALIDATION_FAILED");
      const limit = Math.min(number, DISCOVER_PHOTO_LIMIT);
      const viewerId = accountIsPublic(ctx.user) ? ctx.user.id : null;
      const clauses = [];
      const args = [viewerId];
      if (country && country !== "worldwide") {
        clauses.push("AND pit_discover_photo_country(p.city)=?");
        args.push(country);
      }
      if (city) {
        clauses.push("AND pit_discover_photo_city(p.city)=?");
        args.push(city);
      }
      if (viewerId) {
        clauses.push(`AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
          AND NOT EXISTS (SELECT 1 FROM account_mutes m WHERE m.muter_id=? AND m.muted_id=p.user_id)`);
        args.push(viewerId, viewerId, viewerId);
      }
      args.push(CANDIDATE_LIMIT);
      // Filter scope and publication rights BEFORE the candidate limit. A busy
      // country, raw upload, or private post cannot displace Toronto's gallery.
      // Do not read review text, tagged people, email, or private source fields.
      const rows = database.prepare(`SELECT p.id,p.user_id,p.artist,p.venue,p.city,p.date,p.created_at,u.name AS author_name
        FROM posts p INDEXED BY idx_posts_discover_photos JOIN users u ON u.id=p.user_id
        WHERE p.removed=0 AND p.photos_public=1 AND ${inPersonReviewSql("p")}
          AND ${activeAccountSql("u")} AND u.email_verified_at>0
          AND (COALESCE(u.profile_audience,'everyone')='everyone'
            OR (? IS NOT NULL AND u.profile_audience='members'))
          AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.target_type='post' AND r.target_id=p.id AND r.status='open')
          AND EXISTS (SELECT 1 FROM post_media pm
            JOIN media_assets a ON a.id=pm.asset_id AND a.owner_id=p.user_id
            JOIN media_objects source ON source.owner_id=a.owner_id AND source.object_key=a.source_key
            LEFT JOIN media_variants rv ON rv.id=a.render_variant_id AND rv.asset_id=a.id AND rv.role='render'
            LEFT JOIN media_objects rendition ON rendition.owner_id=a.owner_id AND rendition.object_key=rv.object_key
            WHERE pm.post_id=p.id AND a.status='ready' AND a.source_verified_at IS NOT NULL
              AND a.metadata_status='declared' AND source.status IN ('issued','associated')
              AND ((a.kind='image' AND a.codec_status='not_applicable') OR (a.kind='video' AND a.codec_status='verified'))
              AND ((a.kind='video' AND a.render_state='not_required' AND a.source_storage_scope='public' AND source.storage_scope='public' AND a.source_url LIKE 'https://%')
                OR (a.render_state='ready' AND rv.status='verified' AND rv.public_url LIKE 'https://%'
                  AND (a.kind!='image' OR rv.verification_origin='private_derivative_v1')
                  AND rendition.storage_scope='public' AND rendition.status IN ('issued','associated'))))
          ${clauses.join("\n")}
        ORDER BY p.created_at DESC,p.id DESC LIMIT ?`).all(...args);
      const media = postMediaStateByPost(database, rows.map((row) => row.id)).assetsByPost;
      const photos = [];
      const seen = new Set();
      for (const row of rows) {
        for (const asset of media.get(row.id) || []) {
          // A post can mix a safe image and an old source-backed video. The
          // post-level EXISTS is not permission for every attachment in it.
          if (asset.kind === "video" && asset.renderState === "not_required"
            && !database.prepare(`SELECT 1 FROM media_assets a JOIN media_objects source
              ON source.owner_id=a.owner_id AND source.object_key=a.source_key
              WHERE a.id=? AND a.owner_id=? AND a.source_storage_scope='public'
                AND source.storage_scope='public' AND source.status IN ('issued','associated')`).get(asset.id, row.user_id)) continue;
          // Reuse the established ownership/readiness authority, not the
          // denormalized posts.photos array or an owner's source projection.
          if (!/^https:\/\//i.test(asset.url || "") || seen.has(asset.url)
            || !safeOwnedReadyMediaUrl(database, { ownerId: row.user_id, url: asset.url, kind: asset.kind })) continue;
          seen.add(asset.url);
          photos.push({
            id: asset.id, uri: asset.url, kind: asset.kind,
            posterUrl: asset.posterUrl || null, posterTimeMs: asset.posterTimeMs ?? null,
            altText: text(asset.altText, 500), artist: text(row.artist), venue: text(row.venue),
            city: text(row.city), country: discoverPhotoCountry(row.city), date: text(row.date, 40),
            by: text(row.author_name, 120), logId: row.id, postId: row.id, ownerId: row.user_id,
            source: "fan", photosPublic: true,
          });
          if (photos.length >= limit) break;
        }
        if (photos.length >= limit) break;
      }
      return { photos };
    },
  };
}
