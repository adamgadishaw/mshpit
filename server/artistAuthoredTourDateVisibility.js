import { activeAccountSql } from "./accountVisibility.js";

// Provider events remain public facts. Dates authored for a member-created
// identity are UGC and inherit that page's current ownership/publication scope.
export function artistAuthoredTourDateVisibleSql(alias = "td", viewerSql = "NULL") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)
    || !/^(?:NULL|@[a-z_][a-z0-9_]*|\?[1-9][0-9]*)$/i.test(viewerSql)) {
    throw new TypeError("Invalid artist-authored tour-date SQL scope");
  }
  const identity = `COALESCE(${alias}.artist_key,LOWER(TRIM(${alias}.artist)))`;
  return `(${alias}.owner_id IS NULL OR (NOT EXISTS (
    SELECT 1 FROM artist_profiles held_profile
    WHERE held_profile.artist_key=${identity} AND held_profile.owner_id=${alias}.owner_id
      AND held_profile.identity_review_status IN ('pending','rejected')
  ) AND (NOT EXISTS (
    SELECT 1 FROM artists authored_identity
    WHERE authored_identity.norm=${identity} AND authored_identity.source='artist-created'
  ) OR EXISTS (
    SELECT 1 FROM artist_profiles authored_profile
    JOIN users authored_owner ON authored_owner.id=authored_profile.owner_id
    WHERE authored_profile.artist_key=${identity} AND authored_profile.owner_id=${alias}.owner_id
      AND authored_profile.removed=0 AND ${activeAccountSql("authored_owner")}
      AND COALESCE(authored_profile.identity_review_status,'clear') IN ('clear','approved')
      AND (COALESCE(authored_owner.profile_audience,'everyone')='everyone'
        OR (${viewerSql} IS NOT NULL AND authored_owner.profile_audience='members')
        OR authored_owner.id=${viewerSql})
  ))))`;
}
