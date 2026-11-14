import { ApiError } from "../../errors.js";
import { accountIsPublic, activeAccountSql } from "../../accountVisibility.js";
import { assertSafeAuthoredFields } from "../../contentSafety.js";
import { creatorUpdateDraft, creatorUpdateError } from "../../../src/domain/creatorUpdate.mjs";

export function managedCreatorEntity(db, accountId, type, key) {
  const account = db.prepare("SELECT * FROM users WHERE id=?").get(accountId);
  if (!accountIsPublic(account) || account.role !== type) return null;
  if (type === "artist") {
    if (String(account.artist_name || "").trim().toLowerCase() !== key) return null;
    const owned = db.prepare(`SELECT 1 FROM artist_profiles WHERE artist_key=? AND owner_id=? AND removed=0
      AND COALESCE(identity_review_status,'clear') IN ('clear','approved')`).get(key, accountId);
    return owned ? { entityType: type, entityKey: key, name: account.artist_name } : null;
  }
  if (!["venue", "event"].includes(type)) return null;
  const row = db.prepare("SELECT name FROM creator_entities WHERE entity_type=? AND entity_key=? AND owner_id=? AND status='active'").get(type, key, accountId);
  return row ? { entityType: type, entityKey: key, name: row.name } : null;
}

export function assertCreatorUpdate(db, accountId, body) {
  if (body?.creatorUpdate == null) return null;
  if (body.kind !== "status" || body.attendanceTicket || body.campaign) throw new ApiError(400, "Use an update post for this page.", "VALIDATION_FAILED");
  const error = creatorUpdateError(body.creatorUpdate);
  if (error) throw new ApiError(400, error, "VALIDATION_FAILED");
  const update = creatorUpdateDraft(body.creatorUpdate);
  if (!managedCreatorEntity(db, accountId, update.entityType, update.entityKey)) throw new ApiError(403, "This account does not manage that page.", "FORBIDDEN");
  assertSafeAuthoredFields({ title: update.title, location: update.location });
  return update;
}

export function projectedCreatorUpdate(db, post) {
  if (!post?.creator_update) return null;
  let value;
  try { value = JSON.parse(post.creator_update); } catch { return null; }
  const entity = managedCreatorEntity(db, post.user_id, value.entityType, value.entityKey);
  if (!entity || creatorUpdateError(value)) return null;
  const linked = value.calendar ? db.prepare(`SELECT td.id,td.date,td.venue,td.place,td.ticket_url,td.event_status,td.creator_revision
    FROM creator_calendar_publications cp JOIN tour_dates td ON td.id=cp.event_id WHERE cp.post_id=?`).get(post.id) : null;
  return { ...value, entityName: entity.name, ...(linked ? { calendarEvent: { id: linked.id, date: linked.date, venue: linked.venue,
    place: linked.place, ticketUrl: linked.ticket_url || "", status: linked.event_status || "scheduled", revision: linked.creator_revision } } : {}) };
}

// Inbox delivery is part of the post transaction. A lost response cannot create
// another notice. No email or device-push transport is invoked here: those have
// separate opt-in/delivery systems. Blocking, muting, privacy and account state
// apply both at creation and at inbox read time.
export function persistCreatorUpdate(db, { accountId, postId, update, at, artistIdentity }) {
  if (!update) return;
  const entity = managedCreatorEntity(db, accountId, update.entityType, update.entityKey);
  if (!entity) throw new ApiError(403, "This account no longer manages that page.", "FORBIDDEN");
  db.prepare("UPDATE posts SET creator_update=? WHERE id=? AND user_id=?").run(JSON.stringify(update), postId, accountId);
  db.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,actor_id,type,post_id,artist,text,created_at)
    SELECT 'cu_' || lower(hex(randomblob(16))),member.id,$actor,'creator_update',$post,$name,$title,$at
    FROM users member JOIN users author ON author.id=$actor
    LEFT JOIN creator_follows pref ON pref.account_id=member.id AND pref.entity_type=$type AND pref.entity_key=$key
    WHERE member.id<>$actor AND ${activeAccountSql("member")} AND ${activeAccountSql("author")}
      AND COALESCE(author.profile_audience,'everyone')<>'only_me'
      AND COALESCE(pref.notify_updates,1)=1
      AND (($type<>'artist' AND pref.following=1) OR ($type='artist' AND (
        EXISTS(SELECT 1 FROM fan_club_members club JOIN json_each($artistAliases) alias
          ON club.artist=alias.value OR pit_artist_identity(club.artist)=pit_artist_identity(alias.value)
          WHERE club.user_id=member.id)
        OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(member.favorite_artists) THEN member.favorite_artists ELSE '[]' END) fav WHERE lower(trim(fav.value)) IN ($key,lower($name)))
      )))
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=member.id AND b.blocked_id=$actor) OR (b.blocker_id=$actor AND b.blocked_id=member.id))
      AND NOT EXISTS(SELECT 1 FROM account_mutes m WHERE m.muter_id=member.id AND m.muted_id=$actor)`)
    .run({ $actor: accountId, $post: postId, $type: update.entityType, $key: update.entityKey, $name: entity.name, $title: update.title, $at: at,
      $artistAliases: JSON.stringify(update.entityType === "artist" ? artistIdentity?.aliases || [update.entityKey] : []) });
}

export const CREATOR_NOTICE_VISIBLE_SQL = `(n.type<>'creator_update' OR EXISTS (
  SELECT 1 FROM posts cp JOIN users ca ON ca.id=cp.user_id
  WHERE cp.id=n.post_id AND cp.removed=0 AND cp.creator_update IS NOT NULL AND ${activeAccountSql("ca")}
    AND COALESCE(ca.profile_audience,'everyone')<>'only_me'
    AND ((ca.role='artist' AND json_extract(cp.creator_update,'$.entityType')='artist'
      AND lower(trim(ca.artist_name))=json_extract(cp.creator_update,'$.entityKey')
      AND EXISTS(SELECT 1 FROM artist_profiles ap WHERE ap.artist_key=json_extract(cp.creator_update,'$.entityKey') AND ap.owner_id=ca.id AND ap.removed=0 AND COALESCE(ap.identity_review_status,'clear') IN ('clear','approved')))
      OR EXISTS(SELECT 1 FROM creator_entities ce WHERE ce.entity_type=ca.role AND ce.entity_type=json_extract(cp.creator_update,'$.entityType') AND ce.entity_key=json_extract(cp.creator_update,'$.entityKey') AND ce.owner_id=ca.id AND ce.status='active'))
))`;
