import { accountIsPublic, profileAudienceAllows } from "../../accountVisibility.js";

// Inject api.js's existing fanClubArtistIdentity resolver. In particular, do
// not equate ambiguous display names with one of two distinct catalogue keys.
export function createLocalAlertAudience({ db, resolveArtistIdentity }) {
  if (typeof resolveArtistIdentity !== "function") throw new TypeError("Canonical artist identity is required");
  const keyFor = value => resolveArtistIdentity(value)?.artistKey || null;
  return function canNotifyArtist(accountId, event, at) {
    const identity = resolveArtistIdentity(event.artist_public_slug || event.artist_key);
    if (!identity || identity.artistKey !== event.artist_key) return false;
    const account = db.prepare("SELECT * FROM users WHERE id=?").get(accountId);
    if (!accountIsPublic(account, at)) return false;
    const belongs = value => keyFor(value) === identity.artistKey;
    const preferences = db.prepare("SELECT entity_key,notify_updates FROM creator_follows WHERE account_id=? AND entity_type='artist'").all(accountId);
    if (preferences.some(row => !row.notify_updates && belongs(row.entity_key))) return false;
    const profileKeys = [identity.artist, event.artist, identity.storageArtist].filter(Boolean).map(value => String(value).trim().toLowerCase());
    for (const profileKey of new Set(profileKeys)) {
      const owner = db.prepare("SELECT u.* FROM artist_profiles p JOIN users u ON u.id=p.owner_id WHERE p.artist_key=? AND p.removed=0").get(profileKey);
      if (!owner) continue;
      if (owner.id === accountId || !accountIsPublic(owner, at) || !profileAudienceAllows(owner, account)) return false;
      if (db.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(accountId, owner.id, owner.id, accountId)
        || db.prepare("SELECT 1 FROM account_mutes WHERE muter_id=? AND muted_id=?").get(accountId, owner.id)) return false;
    }
    let favourites;
    try { favourites = JSON.parse(account.favorite_artists || "[]"); }
    catch { favourites = []; }
    if (Array.isArray(favourites) && favourites.some(value => typeof value === "string" && belongs(value))) return true;
    return db.prepare("SELECT artist FROM fan_club_members WHERE user_id=?").all(accountId).some(row => belongs(row.artist));
  };
}

export function creatorCalendarNoticeFor(db, accountId, event) {
  // Only the publication that created this exact calendar record. Edits and
  // cancellation have their own creator notice and never announce a new date.
  return db.prepare(`SELECT n.id FROM creator_calendar_publications cp JOIN notifications n ON n.post_id=cp.post_id
    WHERE cp.event_id=? AND cp.revision=1 AND cp.state='published' AND n.user_id=? AND n.type='creator_update'
    ORDER BY n.created_at,n.id LIMIT 1`).get(event.id, accountId)?.id || null;
}
