import { accountIsPublic, activeAccountSql, profileAudienceAllows } from "./accountVisibility.js";

// Imported catalogue identities are public facts. A member-created identity is
// user content instead, and must never outlive its owner's publication boundary.
export function publicArtistCatalogSql(alias = "a") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new TypeError("Invalid SQL alias");
  return `(COALESCE(${alias}.source,'')!='artist-created' OR EXISTS (
    SELECT 1 FROM artist_profiles catalog_profile
    JOIN users catalog_owner ON catalog_owner.id=catalog_profile.owner_id
    WHERE catalog_profile.artist_key=${alias}.norm AND catalog_profile.removed=0
      AND COALESCE(catalog_profile.identity_review_status,'clear') IN ('clear','approved')
      AND ${activeAccountSql("catalog_owner")}
      AND COALESCE(catalog_owner.profile_audience,'everyone')='everyone'
  ))`;
}

export function artistCatalogVisibleTo(database, artist, viewer = null) {
  if (!artist) return false;
  if (artist.source !== "artist-created") return true;
  const owner = database.prepare(`SELECT u.*,ap.identity_review_status FROM artist_profiles ap
    JOIN users u ON u.id=ap.owner_id WHERE ap.artist_key=? AND ap.removed=0 LIMIT 1`)
    .get(artist.norm);
  if (!owner || !accountIsPublic(owner) || !profileAudienceAllows(owner, viewer)) return false;
  if (["pending", "rejected"].includes(owner.identity_review_status) && viewer?.id !== owner.id) return false;
  if (!viewer?.id || viewer.id === owner.id) return true;
  return !database.prepare(`SELECT 1 FROM blocks
    WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?) LIMIT 1`)
    .get(viewer.id, owner.id, owner.id, viewer.id);
}
