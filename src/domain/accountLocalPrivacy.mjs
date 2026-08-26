import { venueReviewStorageKey } from "./accountMediaCache.mjs";
import { artistPageCacheStorageKeys } from "./artistPageCache.mjs";
import { commentCacheStorageKey } from "./commentCache.mjs";
import { ACTIVE_COMPOSER_KEY, PENDING_COMPOSER_PICKER_KEY } from "./composerRecovery.mjs";
import { feedFilterStorageKey } from "./feedExperience.mjs";
import { privateListeningStorageKey } from "./privateListening.mjs";
import { youtubeVideoRejectionStorageKey } from "./youtubeVideoRejections.mjs";

export const PLAYER_STATE_STORAGE_KEY = "pit.player.v2";
export const PLAYER_POSITION_STORAGE_KEY = "pit.playpos.v2";
export const LEGACY_PRODUCT_ANALYTICS_STORAGE_KEY = "pit.analytics.v2";
export const LEGACY_DIAGNOSTICS_STORAGE_KEY = "pit.diagnostics.v1";

export const diagnosticsStorageKey = (accountId) => {
  const id = accountId == null || accountId === "" ? null : String(accountId);
  return id
    ? `pit.diagnostics.v2.user.${encodeURIComponent(id)}`
    : "pit.diagnostics.v2.guest";
};

const DRAFTS_STORAGE_KEY = "pit.drafts";
const FOLLOWS_STORAGE_KEY = "pit.follows";
const SINGLE_ACCOUNT_PRIVATE_KEYS = Object.freeze([
  // Pre-account-scoping analytics builds used one device-global retry queue.
  // Ownership cannot be proven, so any authenticated logout retires it.
  LEGACY_PRODUCT_ANALYTICS_STORAGE_KEY,
  // The v1 error history was also device-global. It can contain support request
  // references from a previous account, so it is never adopted by v2.
  LEGACY_DIAGNOSTICS_STORAGE_KEY,
  "pit.blocked",
  "pit.myLikes",
  "pit.session",
  "pit.welcomePending",
  // Navigation frames can contain a private message thread, an editing post,
  // or a composer payload. The shell rebuilds a neutral stack after handoff.
  "pit.stack",
  ACTIVE_COMPOSER_KEY,
  PENDING_COMPOSER_PICKER_KEY,
]);
const LEGACY_PLAYER_KEYS = Object.freeze(["pit.player", "pit.playpos"]);
const OWNED_PLAYER_KEYS = Object.freeze([PLAYER_STATE_STORAGE_KEY, PLAYER_POSITION_STORAGE_KEY]);

const accountIdFor = (value) => value == null || value === "" ? null : String(value);
const record = (value) => value != null && typeof value === "object" && !Array.isArray(value);

export const feedStorageKey = (accountId) => `pit.feed.v2.${accountId || "guest"}`;
export const recommendationPreferenceStorageKey = (accountId) => `pit.feed.preferences.v1.${accountId}`;
export const playHistoryStorageKey = (accountId) => `pit.playhistory.${accountId || "guest"}`;
export const recentSearchStorageKey = (accountId) => accountId
  ? `pit.recentSearches.user.${encodeURIComponent(String(accountId))}`
  : "pit.recentSearches.guest";
export const productAnalyticsStorageKey = (accountId) => accountId ? `pit.analytics.v2.${accountId}` : null;

export function accountScopedPrivateStorageKeys(accountId) {
  const id = accountIdFor(accountId);
  if (!id) return [];
  const artistPage = artistPageCacheStorageKeys(id);
  return [
    feedStorageKey(id),
    recommendationPreferenceStorageKey(id),
    playHistoryStorageKey(id),
    recentSearchStorageKey(id),
    privateListeningStorageKey(id),
    feedFilterStorageKey(id),
    commentCacheStorageKey(id),
    artistPage.profiles,
    artistPage.posts,
    venueReviewStorageKey(id),
    youtubeVideoRejectionStorageKey(id),
    productAnalyticsStorageKey(id),
    diagnosticsStorageKey(id),
  ].filter(Boolean);
}

// The two shared payloads can contain continuity data for several accounts.
// Transform them instead of deleting the whole key so signing out account A can
// never destroy account B's drafts or follow cache on the same device.
export function accountPrivatePayloadsAfterLogout({ accountId, drafts, follows } = {}) {
  const id = accountIdFor(accountId);
  const nextDrafts = (Array.isArray(drafts) ? drafts : []).filter((draft) =>
    accountIdFor(draft?.ownerId) !== id);
  const nextFollows = record(follows)
    ? Object.fromEntries(Object.entries(follows).filter(([ownerId]) => accountIdFor(ownerId) !== id))
    : {};
  return { accountId: id, drafts: nextDrafts, follows: nextFollows };
}

/** Synchronously enforce the shared-device privacy boundary during logout. */
export function purgeAccountLocalPrivacy({ accountId, drafts, follows, load, save, remove } = {}) {
  if (typeof load !== "function" || typeof save !== "function" || typeof remove !== "function") {
    throw new TypeError("logout privacy cleanup requires load, save, and remove persistence adapters");
  }
  const id = accountIdFor(accountId);
  if (!id) return { purged: false, accountId: null, drafts: [], follows: {} };

  const next = accountPrivatePayloadsAfterLogout({
    accountId: id,
    drafts: drafts === undefined ? load(DRAFTS_STORAGE_KEY, []) : drafts,
    follows: follows === undefined ? load(FOLLOWS_STORAGE_KEY, {}) : follows,
  });

  for (const key of accountScopedPrivateStorageKeys(id)) remove(key);
  for (const key of SINGLE_ACCOUNT_PRIVATE_KEYS) remove(key);
  for (const key of LEGACY_PLAYER_KEYS) remove(key);

  if (next.drafts.length) save(DRAFTS_STORAGE_KEY, next.drafts);
  else remove(DRAFTS_STORAGE_KEY);
  if (Object.keys(next.follows).length) save(FOLLOWS_STORAGE_KEY, next.follows);
  else remove(FOLLOWS_STORAGE_KEY);

  for (const key of OWNED_PLAYER_KEYS) {
    const envelope = load(key, null);
    if (accountIdFor(envelope?.ownerId) === id) remove(key);
  }

  return { purged: true, ...next };
}

/**
 * Remove native media-draft files after their references have been purged.
 * Filesystems can briefly hold a picker/file handle, so retry before surfacing a
 * durable shared-device warning. The injected wait keeps the policy testable.
 */
export async function purgeAccountMediaDraftFiles({
  accountId,
  deleteForOwner,
  retryDelays = [50, 150],
  wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  onFailure,
} = {}) {
  const id = accountIdFor(accountId);
  if (!id) return { deleted: false, attempts: 0, skipped: true };
  if (typeof deleteForOwner !== "function") {
    throw new TypeError("media draft cleanup requires an owner deletion adapter");
  }

  const delays = Array.isArray(retryDelays)
    ? retryDelays.filter((delay) => Number.isFinite(Number(delay)) && Number(delay) >= 0)
    : [];
  let failure = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      if (await deleteForOwner(id)) return { deleted: true, attempts: attempt + 1, skipped: false };
      failure = new Error("The account's local media-draft directory could not be removed.");
    } catch (error) {
      failure = error instanceof Error ? error : new Error("The account's local media-draft directory could not be removed.");
    }
    if (attempt < delays.length) await wait(Number(delays[attempt]));
  }

  try { onFailure?.(failure); }
  catch (callbackError) { void callbackError; }
  return { deleted: false, attempts: delays.length + 1, skipped: false };
}
