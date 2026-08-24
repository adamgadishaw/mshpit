import { createScopedReadCoordinator } from "./scopedReadCoordinator.mjs";

const EMPTY_RECORD = Object.freeze({});

const accountIdFor = (accountId) => accountId == null || accountId === ""
  ? null
  : String(accountId);

const recordOr = (value, fallback = EMPTY_RECORD) => value != null
  && typeof value === "object"
  && !Array.isArray(value)
  ? value
  : fallback;

const viewerScopeFor = (accountId) => accountIdFor(accountId) == null
  ? "guest"
  : `user:${accountIdFor(accountId)}`;

export function artistPageCacheStorageKeys(accountId) {
  const viewer = accountIdFor(accountId) == null
    ? "guest"
    : `user.${encodeURIComponent(accountIdFor(accountId))}`;
  return {
    profiles: `pit.artistProfiles.v2.${viewer}`,
    posts: `pit.artistPosts.v2.${viewer}`,
  };
}

export function artistPageCacheSnapshot(profiles = EMPTY_RECORD, posts = EMPTY_RECORD) {
  return {
    profiles: recordOr(profiles),
    posts: recordOr(posts),
  };
}

export function createArtistPageCacheState(accountId, snapshot = {}, boundaryEpoch = 0) {
  const safe = artistPageCacheSnapshot(snapshot.profiles, snapshot.posts);
  return {
    accountId: accountIdFor(accountId),
    boundaryEpoch: Math.max(0, Number(boundaryEpoch) || 0),
    ...safe,
  };
}

export function artistPageCacheForViewer(state, accountId) {
  if (accountIdFor(state?.accountId) === accountIdFor(accountId)) return state;
  return createArtistPageCacheState(accountId, {}, state?.boundaryEpoch);
}

export function handoffArtistPageCache(state, accountId, snapshot = {}) {
  const nextAccountId = accountIdFor(accountId);
  if (accountIdFor(state?.accountId) === nextAccountId) return state;
  return createArtistPageCacheState(nextAccountId, snapshot, (state?.boundaryEpoch || 0) + 1);
}

export function clearArtistPageCache(state) {
  return createArtistPageCacheState(
    state?.accountId,
    {},
    (state?.boundaryEpoch || 0) + 1,
  );
}

// A failed refresh deliberately returns the exact same state. That preserves a
// confirmed stale snapshot for the same viewer, while account/block boundaries
// use the two helpers above to replace or clear it before another render.
export function resolveArtistPageRefresh(state, artistKey, result) {
  if (!result?.ok || !artistKey) return state;
  const profile = recordOr(result.profile);
  const posts = Array.isArray(result.posts) ? result.posts : [];
  return {
    ...state,
    profiles: { ...recordOr(state?.profiles), [artistKey]: profile },
    posts: { ...recordOr(state?.posts), [artistKey]: posts },
  };
}

export function createArtistPageReadCoordinator() {
  return createScopedReadCoordinator(viewerScopeFor);
}
