import { createHash } from "node:crypto";
import { artistIdentityHeld } from "./artistVerification.js";

const tables = { post: "posts", artist_post: "artist_posts", tour_date: "tour_dates" };
const slots = { bio: "bio", avatar: "avatar_uri", banner: "banner" };
const active = (user, at) => !!user && !user.is_banned && !user.dormant_at && !(user.suspended_until > at);
const contributor = user => user ? { id: user.id, name: user.name, handle: user.handle } : null;

export function refreshRetainedPublicationScope(db, key, at) {
  const profile = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);if (!profile) return;
  const source = db.prepare(`SELECT r.id,r.owner_id FROM artist_access_revocations r WHERE r.artist_key=? AND (
    EXISTS(SELECT 1 FROM artist_access_retained_content c WHERE c.revocation_id=r.id AND c.publication='public' AND c.superseded=0) OR
    EXISTS(SELECT 1 FROM artist_access_profile_items i WHERE i.revocation_id=r.id AND i.publication='public'
      AND ((i.slot='bio' AND r.id=?) OR (i.slot='avatar' AND r.id=?) OR (i.slot='banner' AND r.id=?))))
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1`).get(key, profile.bio_retention_id, profile.avatar_retention_id, profile.banner_retention_id);
  db.prepare("UPDATE artist_profiles SET publication_author_id=?,publication_revocation_id=?,updated_at=? WHERE artist_key=?")
    .run(source?.owner_id || null, source?.id || null, at, key);
}

export function compileArtistAccessPlan({ db, key, publicProfile, now }) {
  const profile = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);
  const owner = profile?.owner_id ? db.prepare("SELECT * FROM users WHERE id=?").get(profile.owner_id) : null;
  const projected = profile ? publicProfile(profile) : null, profileItems = [];
  const eligible = !!projected && active(owner, now()) && (owner.profile_audience || "everyone") === "everyone" && !profile.removed && !artistIdentityHeld(profile);
  if (owner) for (const [slot, field] of Object.entries(slots)) {
    const authorId = slot === "bio" ? profile.bio_author_id || owner.id : profile[`${slot}_owner_id`] || owner.id;
    if (profile[field] != null && authorId === owner.id && !(slot === "bio" && profile.bio_staff_curated)) {
      profileItems.push({ type: "profile", id: slot, itemKey: `profile:${slot}`, value: profile[field], authorId,
        eligible: !!eligible && projected?.[slot === "avatar" ? "avatarUri" : field] === profile[field] });
    }
  }
  const content = owner ? [
    ...db.prepare("SELECT * FROM artist_posts WHERE artist_key=? AND user_id=? ORDER BY id LIMIT 2001").all(key, owner.id).map(row => ({ type: "artist_post", row })),
    ...db.prepare("SELECT * FROM posts WHERE artist_key=? AND user_id=? AND kind='status' AND artist_mbid IS NULL ORDER BY id LIMIT 2001").all(key, owner.id).map(row => ({ type: "post", row })),
    ...db.prepare("SELECT * FROM tour_dates WHERE owner_id=? AND source='artist-submitted' AND COALESCE(artist_key,lower(trim(artist)))=? ORDER BY id LIMIT 2001")
      .all(owner.id, key).map(row => ({ type: "tour_date", row })),
  ].map(item => {
    const prior = db.prepare(`SELECT c.*,r.created_at,r.artist_key FROM artist_access_retained_content c JOIN artist_access_revocations r ON r.id=c.revocation_id
      WHERE c.target_type=? AND c.target_id=? AND c.superseded=0 LIMIT 1`).get(item.type, item.row.id);
    const originalPublic = !item.row.removed || !!prior?.original_public;
    const safe = !!eligible && !(item.row.release_at > now()) && (!prior || !independentArtistContentHold(db, prior, item.type, item.row.id));
    return { ...item, itemKey: `${item.type}:${item.row.id}`, eligible: safe && originalPublic,
      previouslyPublic: safe && !item.row.removed && (!prior || prior.publication === "public") };
  }) : [];
  const hash = createHash("sha256").update(JSON.stringify({ profile, owner: owner ? { id: owner.id, role: owner.role,
    artistName: owner.artist_name, audience: owner.profile_audience, banned: owner.is_banned, dormant: owner.dormant_at,
    suspended: owner.suspended_until } : null, profileItems, content })).digest("hex");
  return { profile, owner, profileItems, content, hash };
}

export function independentArtistContentHold(db, snapshot, type, id) {
  const row = db.prepare(`SELECT action FROM moderation_actions WHERE created_at>=? AND (
    (target_type=? AND target_id=? AND action IN ('remove','restore','delete')) OR
    (target_type='artist' AND target_id=? AND action IN ('artist_identity_hold','artist_identity_reject','artist_identity_release')))
    ORDER BY created_at DESC,id DESC LIMIT 1`).get(snapshot.created_at, type === "profile" ? "artist_profile" : type, type === "profile" ? snapshot.artist_key : id, snapshot.artist_key);
  return !!row && ["remove", "delete", "artist_identity_hold", "artist_identity_reject"].includes(row.action);
}

export function applyArtistContentPublication({ db, snapshot, type, id, publication, revision, ApiError, now }) {
  const profileItem = type === "profile", table = profileItem ? "artist_access_profile_items" : "artist_access_retained_content";
  const item = profileItem ? db.prepare(`SELECT * FROM ${table} WHERE revocation_id=? AND slot=?`).get(snapshot.id, id)
    : db.prepare(`SELECT * FROM ${table} WHERE revocation_id=? AND target_type=? AND target_id=?`).get(snapshot.id, type, id);
  if (!item || item.revision !== revision || item.superseded) throw new ApiError(409, "This retained item changed or has a newer snapshot. Refresh the preview before confirming.", "CONFLICT");
  const profile = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(snapshot.artist_key);
  const author = db.prepare("SELECT * FROM users WHERE id=?").get(snapshot.owner_id);
  if (publication === "public" && (!item.original_public || !active(author, now()) || author.profile_audience === "only_me"
    || profile?.removed || artistIdentityHeld(profile) || independentArtistContentHold(db, snapshot, type, id))) {
    throw new ApiError(409, "Previously private, moderated or restricted content must stay hidden. Independent holds are not overridden.", "CONFLICT");
  }
  if (item.publication === publication) return false;
  if (profileItem && publication === "public") {
    const field = slots[id];
    if (!profile || (profile[field] != null && profile[`${id}_retention_id`] !== snapshot.id)) {
      throw new ApiError(409, "Current page content occupies this slot. Retained content cannot overwrite another contributor.", "CONFLICT");
    }
  }
  if (!profileItem && publication === "public") {
    const original = JSON.parse(item.record_json), current = db.prepare(`SELECT * FROM ${tables[type]} WHERE id=?`).get(id);
    const fields = type === "post" ? ["review", "photos", "photos_public", "user_id"] : type === "artist_post" ? ["text", "user_id"] : ["artist", "venue", "date", "owner_id", "source", "ticket_url"];
    if (!current || fields.some(field => current[field] !== original[field])) throw new ApiError(409, "Content changed independently of this snapshot. No earlier content was restored.", "CONFLICT");
  }
  if (profileItem) db.prepare(`UPDATE ${table} SET publication=?,revision=revision+1 WHERE revocation_id=? AND slot=?`).run(publication, snapshot.id, id);
  else db.prepare(`UPDATE ${table} SET publication=?,revision=revision+1 WHERE revocation_id=? AND target_type=? AND target_id=?`).run(publication, snapshot.id, type, id);
  if (profileItem) {
    const field = slots[id], reference = `${id}_retention_id`;
    if (publication === "public") {
      db.prepare(`UPDATE artist_profiles SET ${field}=?,${reference}=?,${id === "bio" ? "bio_author_id" : `${id}_owner_id`}=?,updated_at=? WHERE artist_key=?`)
        .run(item.value, snapshot.id, item.author_id, now(), snapshot.artist_key);
    } else if (profile?.[reference] === snapshot.id) db.prepare(`UPDATE artist_profiles SET ${field}=NULL,${reference}=NULL,updated_at=? WHERE artist_key=?`).run(now(), snapshot.artist_key);
  } else if (type !== "tour_date") db.prepare(`UPDATE ${tables[type]} SET removed=? WHERE id=?`).run(publication === "public" ? 0 : 1, id);
  refreshRetainedPublicationScope(db, snapshot.artist_key, now());
  return true;
}

export function retainedContributor(db, type, id) {
  const row = db.prepare(`SELECT r.owner_id FROM artist_access_retained_content c JOIN artist_access_revocations r ON r.id=c.revocation_id
    WHERE c.target_type=? AND c.target_id=? AND c.publication='public' AND c.superseded=0 LIMIT 1`).get(type, id);
  return row ? contributor(db.prepare("SELECT id,name,handle FROM users WHERE id=?").get(row.owner_id)) : null;
}

export function retainedProfileProjection(db, original, viewerId = null, at = Date.now()) {
  if (!original) return original;
  const profile = { ...original };
  for (const [slot, field] of Object.entries(slots)) {
    const retentionId = profile[`${slot}_retention_id`]; if (!retentionId) continue;
    const snapshot = db.prepare("SELECT * FROM artist_access_revocations WHERE id=?").get(retentionId);
    const item = db.prepare("SELECT * FROM artist_access_profile_items WHERE revocation_id=? AND slot=?").get(retentionId, slot);
    const author = item ? db.prepare("SELECT * FROM users WHERE id=?").get(item.author_id) : null;
    const privateAudience = author?.profile_audience === "only_me" || (!viewerId && author?.profile_audience === "members");
    const blocked = viewerId && author && db.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?) LIMIT 1").get(viewerId, author.id, author.id, viewerId);
    if (!snapshot || !item || item.publication !== "public" || !active(author, at) || privateAudience || blocked
      || profile.removed || artistIdentityHeld(profile) || independentArtistContentHold(db, snapshot, "profile", slot)) profile[field] = null;
    else profile[`${slot}Contributor`] = contributor(author);
  }
  return profile;
}
