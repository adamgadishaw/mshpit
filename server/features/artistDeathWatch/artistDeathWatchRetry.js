import { ARTIST_DEATH_WATCH_INTERVAL_MS } from "../../../src/domain/artistDeathWatch.mjs";

export const ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const isDeathWatchProviderFailure = (code) => /^(?:wikidata|musicbrainz)_(?:timeout|network|rate_limited|unavailable|rejected|response)$/u.test(String(code || ""));

// The existing durable scan timestamps carry the previous cooldown through a
// restart. No in-memory failure counter can accidentally restart hourly hammering.
export function deathWatchRetryAt(settings,error,at) {
  const previousFailure=isDeathWatchProviderFailure(settings?.lastErrorCode);
  const previousDelay=Number(settings?.nextScanAt)-Number(settings?.lastScanAt);
  const backoff=previousFailure && Number.isFinite(previousDelay) && previousDelay>0
    ? Math.min(ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS,Math.max(ARTIST_DEATH_WATCH_INTERVAL_MS,previousDelay)*2)
    : ARTIST_DEATH_WATCH_INTERVAL_MS;
  const requested=Number(error?.retryAt);
  return Math.min(at+ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS,
    Math.max(at+backoff,Number.isSafeInteger(requested) && requested>at ? requested : 0));
}
