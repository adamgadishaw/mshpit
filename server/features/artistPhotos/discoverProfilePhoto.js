import { accountIsPublic, profileAudienceAllows } from "../../accountVisibility.js";
import { artistHasLegacyMemorial } from "../../artistMemorialTourDateVisibility.js";
import { retainedProfileProjection } from "../artistAccounts/artistAccessPublication.js";
import { artistIdentityHeld } from "../artistAccounts/artistVerification.js";
import { verifiedFinalizedLegacyMedia } from "../../mediaLegacyFinalize.js";

// Use only the current profile avatar slot, never banners or fan gallery media.
// Callers first filter catalog visibility and hydrate only their bounded results.
export function discoverProfilePhoto(database, artist, viewer = null) {
  if (!database || !artist?.norm) return null;
  let profile = database.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(artist.norm);
  if (!profile?.avatar_uri || profile.removed || artistIdentityHeld(profile)) return null;
  if (profile.owner_id) {
    const owner = database.prepare("SELECT * FROM users WHERE id=?").get(profile.owner_id);
    if (!profileAudienceAllows(owner, viewer)) return null;
    if (viewer?.id && database.prepare(`SELECT 1 FROM blocks WHERE
      (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?) LIMIT 1`)
      .get(viewer.id, owner.id, owner.id, viewer.id)) return null;
  }
  profile = retainedProfileProjection(database, profile, viewer?.id || null, Date.now());
  const ownerId = profile.avatar_owner_id || profile.owner_id;
  if (!ownerId || !profile.avatar_uri) return null;
  if (artistHasLegacyMemorial(database, { artistKey: artist.norm })) {
    const curator = database.prepare("SELECT * FROM users WHERE id=?").get(ownerId);
    if (curator?.role !== "admin" || !accountIsPublic(curator)) return null;
  }
  // The uploader is storage provenance, not the audience of staff-curated art.
  // Descriptor and object verification rejects raw, removed or wrong-slot media.
  return verifiedFinalizedLegacyMedia(database, {
    ownerId, publicUrl: profile.avatar_uri, purpose: "avatar",
  })?.publicUrl || null;
}
