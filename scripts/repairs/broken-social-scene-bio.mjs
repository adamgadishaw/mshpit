// One incident, one field. No application DB import, migrations, or providers.
import { createHash } from "node:crypto";
import { projectArtistKnowledgeSource } from "../../src/domain/artistKnowledge.mjs";

export const ARTIST_KEY = "broken social scene";
export function repairSnapshot(database) {
  const artist = database.prepare("SELECT * FROM artists WHERE norm=?").get(ARTIST_KEY);
  const profile = database.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(ARTIST_KEY);
  if (!artist || artist.name !== "Broken Social Scene" || artist.public_slug !== "broken-social-scene"
    || !profile || profile.owner_id !== null || profile.bio !== null || profile.bio_staff_curated !== 1
    || profile.bio_author_id !== null || profile.bio_retention_id !== null
    || profile.removed || (profile.identity_review_status && profile.identity_review_status !== "clear")
    || !profile.avatar_uri || !profile.avatar_owner_id) throw new Error("Incident state guard failed; stop for review.");
  const source = projectArtistKnowledgeSource(JSON.parse(artist.data), { mbid: artist.mbid, bio: artist.bio });
  if (!artist.bio || source?.provider !== "wikipedia") throw new Error("Original attributed catalog biography is not valid.");
  const snapshot = { artist: { ...artist }, profile: { ...profile } };
  return { ...snapshot, sha256: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
}

export function repairAccidentalBioOverride(database, { expectedSha256, audit, at = Date.now() }) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || "") || typeof audit !== "function") throw new Error("Reviewed snapshot and durable audit required.");
  database.exec("BEGIN IMMEDIATE");
  try {
    const before = repairSnapshot(database);
    if (before.sha256 !== expectedSha256) throw new Error("Snapshot changed; stop for review.");
    // The caller must durably record the full before-image before any write.
    audit({ event: "prepared", at, before, change: { bio_staff_curated: [1, 0] } });
    const result = database.prepare(`UPDATE artist_profiles SET bio_staff_curated=0
      WHERE artist_key=? AND bio IS NULL AND bio_staff_curated=1`).run(ARTIST_KEY);
    if (Number(result.changes) !== 1) throw new Error("Expected exactly one repaired profile.");
    const after = { ...database.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(ARTIST_KEY) };
    if (JSON.stringify(after) !== JSON.stringify({ ...before.profile, bio_staff_curated: 0 })) throw new Error("Unexpected profile change.");
    audit({ event: "verified-before-commit", at, after });
    database.exec("COMMIT");
    return after;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
