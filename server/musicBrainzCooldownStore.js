import { PROVIDER_RETRY_AFTER_MAX_MS } from "./providerResponsePolicy.js";

export const MUSICBRAINZ_COOLDOWN_KEY = "provider:musicbrainz:cooldown:v1";

function validDeadline(value, at) {
  if (typeof value !== "string" || !/^\d{1,16}$/u.test(value)) return 0;
  const deadline = Number(value);
  return Number.isSafeInteger(deadline) && deadline > 0 && deadline <= at + PROVIDER_RETRY_AFTER_MAX_MS
    ? deadline : 0;
}

// Only the existing app_meta namespace is used. Construction prepares reads
// and writes; it never changes schema or creates a cooldown on startup.
export function createMusicBrainzCooldownStore(database) {
  const read = database.prepare("SELECT value FROM app_meta WHERE key=?");
  const extend = database.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
    WHERE NOT (
      length(app_meta.value) BETWEEN 1 AND 16
      AND app_meta.value NOT GLOB '*[^0-9]*'
      AND CAST(app_meta.value AS INTEGER) BETWEEN 1 AND ?
      AND CAST(app_meta.value AS INTEGER) >= CAST(excluded.value AS INTEGER)
    )`);
  return Object.freeze({
    readDeadline(at) {
      return validDeadline(read.get(MUSICBRAINZ_COOLDOWN_KEY)?.value, at);
    },
    extendDeadline(deadline, at) {
      if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(deadline) || deadline <= at) {
        throw new TypeError("MusicBrainz cooldown requires an absolute future deadline.");
      }
      const bounded = Math.min(deadline, at + PROVIDER_RETRY_AFTER_MAX_MS);
      // One atomic max-only statement prevents an older failing request from
      // shortening a newer process's provider deadline. Success never deletes it.
      extend.run(MUSICBRAINZ_COOLDOWN_KEY, String(bounded), at + PROVIDER_RETRY_AFTER_MAX_MS);
      return validDeadline(read.get(MUSICBRAINZ_COOLDOWN_KEY)?.value, at);
    },
  });
}
