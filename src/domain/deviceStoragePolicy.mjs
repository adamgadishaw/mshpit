// Browser storage is a continuity cache, never the source of truth for server
// entities. Keep recoverable projections disposable so they cannot crowd out a
// member's unfinished, device-authored work.
const DISPOSABLE_CACHE_KEYS = new Set([
  "pit.artistPosts",
  "pit.artistProfiles",
  "pit.comments",
  "pit.feed",
  "pit.snapshots",
  "pit.tourDates",
  "pit.users",
  "pit.venueReviews",
]);

const DISPOSABLE_CACHE_PREFIXES = Object.freeze([
  "pit.artistPosts.v2.",
  "pit.artistProfiles.v2.",
  "pit.comments.v2.",
  "pit.feed.v2.",
  "pit.playhistory.",
  "pit.venueReviews.v2.",
]);

const DURABLE_AUTHORED_KEYS = new Set([
  "pit.activeComposer",
  "pit.drafts",
  "pit.pendingComposerPicker",
]);

export function isDisposableDeviceCacheKey(value) {
  const key = String(value || "");
  return DISPOSABLE_CACHE_KEYS.has(key)
    || DISPOSABLE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isDurableAuthoredDeviceStateKey(value) {
  return DURABLE_AUTHORED_KEYS.has(String(value || ""));
}

export function shouldToastDeviceStorageFailure({ operation, key } = {}) {
  return operation !== "read" && isDurableAuthoredDeviceStateKey(key);
}

export function isWebStorageQuotaError(error) {
  if (!error) return false;
  const name = String(error.name || "");
  const code = Number(error.code);
  return name === "QuotaExceededError"
    || (name === "NS_ERROR_DOM_QUOTA_REACHED" && code === 1014)
    || code === 22;
}

function storageKeys(storage) {
  const keys = [];
  const count = Math.max(0, Number(storage?.length) || 0);
  for (let index = 0; index < count; index += 1) {
    const key = storage.key(index);
    if (typeof key === "string") keys.push(key);
  }
  return keys;
}

/**
 * Write once, evict only server-recoverable caches after a quota failure, then
 * retry exactly once. A second failure is allowed to reach the normal storage
 * diagnostics path. Drafts, composer recovery and user preferences are never
 * evicted here.
 */
export function writeWebStorageWithQuotaRecovery(storage, key, value) {
  try {
    storage.setItem(key, value);
    return { recovered: false, evicted: [] };
  } catch (error) {
    if (!isWebStorageQuotaError(error)) throw error;
    const evicted = storageKeys(storage).filter(isDisposableDeviceCacheKey);
    if (!evicted.length) throw error;
    for (const cacheKey of evicted) storage.removeItem(cacheKey);
    storage.setItem(key, value);
    return { recovered: true, evicted };
  }
}
