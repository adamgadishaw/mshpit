import { ApiError } from "../../errors.js";
import { clean, LIMITS } from "../../validate.js";
import { assertSafeAuthoredText } from "../../contentSafety.js";
import { ensureArtistVerificationSchema } from "./artistVerification.js";

export function artistPageName(value) {
  if (typeof value !== "string" || [...value].length > LIMITS.artist
    || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new ApiError(400, `Use an artist name of 2–${LIMITS.artist} characters.`, "VALIDATION_FAILED");
  }
  const normalized = value.normalize("NFKC");
  if ([...normalized].length > LIMITS.artist) throw new ApiError(400, "That artist name is too long.", "VALIDATION_FAILED");
  const name = clean(normalized, { max: LIMITS.artist });
  if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name) || /^https?:\/\//iu.test(name)) {
    throw new ApiError(400, "Enter your artist or band name, not a website address.", "VALIDATION_FAILED");
  }
  assertSafeAuthoredText(name, { field: "artist name" });
  return name;
}

export function artistSignupIntent(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => key !== "artistName")) {
    throw new ApiError(400, "Choose a valid artist account name.", "VALIDATION_FAILED");
  }
  return { artistName: artistPageName(value.artistName) };
}

// This is a private signup draft, never proof of ownership or a public badge.
export function pendingArtistSignupIntent(extras) {
  try { return artistSignupIntent(extras?.pendingArtistIntent); }
  catch { return null; }
}

export function ensureArtistAccountSchema(database, at = Date.now()) {
  ensureArtistVerificationSchema(database);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_artist_requests_user_created
    ON artist_requests(user_id,created_at DESC,id DESC)`);
  const marker = "artist-accounts:approved-check-backfill:v1";
  if (database.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marker)) return;
  // Existing approved claims were presented as verified. Preserve only that
  // durable evidence; role alone and a check explicitly revoked by staff never
  // mint a check. The enclosing schema migration holds the write lock.
  database.prepare(`UPDATE users SET verified=1
    WHERE role='artist' AND verified=0 AND EXISTS (
      SELECT 1 FROM artist_requests r JOIN artist_profiles ap
        ON ap.artist_key=lower(trim(r.artist_name)) AND ap.owner_id=users.id
      WHERE r.user_id=users.id AND r.status='approved'
        AND lower(trim(r.artist_name))=lower(trim(users.artist_name))
    ) AND NOT EXISTS (
      SELECT 1 FROM moderation_actions m
      WHERE m.target_type='user' AND m.target_id=users.id AND m.action='remove_verification'
    )`).run();
  database.prepare("INSERT INTO app_meta (key,value) VALUES (?,?)").run(marker, String(at));
}
