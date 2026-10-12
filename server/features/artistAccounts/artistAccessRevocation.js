import { resolvedOwnedMediaKey } from "../../mediaDeletion.js";
import { assetObjectRecords } from "../../mediaAssets.js";
import { compileArtistAccessPlan, applyArtistContentPublication, refreshRetainedPublicationScope } from "./artistAccessPublication.js";

export function revokeArtistPageAccess({ db, q, ctx, key, requireAdmin, ApiError, normName, now, uid, moderationRecord, publicProfile }) {
  const actor = requireAdmin(ctx), profile = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);
  if (!profile?.owner_id) throw new ApiError(409, "This page is already unassigned. Search again to confirm its current state.", "CONFLICT");
  if (profile.owner_id !== ctx.body.expectedOwnerId || (profile.updated_at ?? null) !== ctx.body.expectedUpdatedAt) {
    throw new ApiError(409, "This assignment changed. Search again and review its current owner before revoking access.", "CONFLICT");
  }
  const ownerId = profile.owner_id, owner = q.userById.get(ownerId), at = now(), id = uid("aar");
  const plan = compileArtistAccessPlan({ db, key, publicProfile, now });
  if (ctx.body.expectedContentHash !== plan.hash) throw new ApiError(409, "Page content changed. Refresh the preview before revoking access.", "CONFLICT");
  const heldBio = plan.profileItems.some(item => item.id === "bio"), heldAvatar = plan.profileItems.some(item => item.id === "avatar"), heldBanner = plan.profileItems.some(item => item.id === "banner");
  const snapshot = { ownerId, ownerRole: owner?.role || null, artistName: owner?.artist_name || null,
    bio: heldBio ? profile.bio : null, avatarUri: heldAvatar ? profile.avatar_uri : null,
    banner: heldBanner ? profile.banner : null, feedEnabled: !!profile.feed_enabled,
    avatarOwnerId: heldAvatar ? ownerId : null, bannerOwnerId: heldBanner ? ownerId : null };
  db.prepare("INSERT INTO artist_access_revocations(id,artist_key,owner_id,reviewer_id,reason,created_at,profile_json) VALUES (?,?,?,?,?,?,?)")
    .run(id, key, ownerId, actor.id, ctx.body.reason, at, JSON.stringify(snapshot));
  const content = plan.content;
  if (content.length > 2000) throw new ApiError(409, "This page needs a larger retained-content review. No access or content changed.", "CONFLICT");
  const urls = new Set([snapshot.avatarUri, snapshot.banner].filter(Boolean)), assetIds = new Set();
  for (const { type, row, eligible } of content) {
    db.prepare("UPDATE artist_access_retained_content SET superseded=1 WHERE target_type=? AND target_id=?").run(type, row.id);
    db.prepare("INSERT INTO artist_access_retained_content(revocation_id,target_type,target_id,record_json,original_public) VALUES (?,?,?,?,?)")
      .run(id, type, row.id, JSON.stringify(row), eligible ? 1 : 0);
    if (type === "artist_post") db.prepare("UPDATE artist_posts SET removed=1 WHERE id=?").run(row.id);
    if (type === "post") {
      db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(row.id);
      for (const url of JSON.parse(row.photos || "[]")) if (typeof url === "string") urls.add(url);
      for (const asset of db.prepare("SELECT asset_id FROM post_media WHERE post_id=?").all(row.id)) assetIds.add(asset.asset_id);
    }
  }
  for (const item of plan.profileItems) db.prepare("INSERT INTO artist_access_profile_items(revocation_id,slot,value,author_id,original_public) VALUES (?,?,?,?,?)").run(id, item.id, item.value, item.authorId, item.eligible ? 1 : 0);
  // Profile slots may use stable derivatives too; retain the whole descriptor,
  // not just the public URL. Original uploader attribution remains unchanged.
  for (const url of urls) for (const asset of db.prepare(`SELECT id FROM media_assets WHERE owner_id=? AND (source_url=? OR id IN
    (SELECT asset_id FROM media_variants WHERE public_url=?))`).all(ownerId, url, url)) assetIds.add(asset.id);
  const media = assetObjectRecords(db, [...assetIds]);
  for (const url of urls) media.push({ ownerId, publicUrl: url, objectKey: resolvedOwnedMediaKey(db, url, { ownerId }).key || "" });
  for (const item of media) {
    if (item.ownerId !== ownerId || !item.publicUrl) continue;
    if (item.objectKey && db.prepare("SELECT 1 FROM media_deletion_queue WHERE owner_id=? AND object_key=? AND status='processing'").get(ownerId, item.objectKey)) {
      throw new ApiError(409, "Media cleanup is in progress. Review the page again before revoking access.", "CONFLICT");
    }
    db.prepare("INSERT OR IGNORE INTO artist_access_retained_media(revocation_id,owner_id,url,object_key) VALUES (?,?,?,?)")
      .run(id, ownerId, item.publicUrl, item.objectKey || "");
  }
  db.prepare(`UPDATE artist_profiles SET owner_id=NULL,
    bio=CASE WHEN ? THEN NULL ELSE bio END,
    avatar_uri=CASE WHEN ? THEN NULL ELSE avatar_uri END,avatar_owner_id=CASE WHEN ? THEN NULL ELSE avatar_owner_id END,
    banner=CASE WHEN ? THEN NULL ELSE banner END,banner_owner_id=CASE WHEN ? THEN NULL ELSE banner_owner_id END,updated_at=?
    WHERE artist_key=? AND owner_id=?`).run(heldBio ? 1 : 0, heldAvatar ? 1 : 0, heldAvatar ? 1 : 0, heldBanner ? 1 : 0, heldBanner ? 1 : 0, at, key, ownerId);
  for (const item of plan.profileItems) db.prepare(`UPDATE artist_profiles SET ${item.id}_retention_id=NULL${item.id === "bio" ? ",bio_author_id=NULL" : ""} WHERE artist_key=?`).run(key);
  // Other people's updates and staff-curated copy stay published. Only the
  // matching artist identity ends; ordinary sessions and other roles survive.
  if (owner?.role === "artist" && normName(owner.artist_name) === key) {
    db.prepare("UPDATE users SET role='fan',artist_name=NULL,verified=0,profile_updated_at=? WHERE id=?").run(at, ownerId);
  }
  db.prepare("UPDATE artist_requests SET status='rejected' WHERE user_id=? AND lower(trim(artist_name))=? AND status='pending'").run(ownerId, key);
  db.prepare("UPDATE artist_verification_challenges SET status='revoked' WHERE user_id=? AND artist_key=? AND status IN ('active','submitted')").run(ownerId, key);
  const disposition = ctx.body.disposition || "hide", chosen = new Set(ctx.body.visibleItems || []), snapshotRow = db.prepare("SELECT * FROM artist_access_revocations WHERE id=?").get(id);
  const items = [...plan.profileItems, ...content.map(item => ({ ...item, id: item.row.id }))];
  if ([...chosen].some(itemKey => !items.some(item => item.itemKey === itemKey))) throw new ApiError(400, "Choose items from this exact preview.", "VALIDATION_FAILED");
  for (const item of items) if ((disposition === "keep" && (item.previouslyPublic ?? item.eligible)) || (disposition === "selected" && chosen.has(item.itemKey))) {
    applyArtistContentPublication({ db, snapshot: snapshotRow, type: item.type, id: item.id, publication: "public", revision: 1, ApiError, now });
  }
  refreshRetainedPublicationScope(db, key, at);
  moderationRecord(ctx, "artist_access_revoked", "artist", key, ctx.body.reason, { ownerId }, { ownerId: null, revocationId: id, retainedContent: content.length, disposition, visibleItems: [...chosen] });
  return { ok: true, revocationId: id, retainedContent: content.length };
}
