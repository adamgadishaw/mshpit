import { useRef, useState } from "react";

import { ENABLE_DEMO_DATA } from "../../config/runtime.mjs";
import {
  artistPageCacheForViewer,
  artistPageCacheSnapshot,
  artistPageCacheStorageKeys,
  clearArtistPageCache,
  createArtistPageCacheState,
  createArtistPageReadCoordinator,
  handoffArtistPageCache,
  resolveArtistPageRefresh,
} from "../../domain/artistPageCache.mjs";
import { sanitizePersistedStoreValue } from "../../domain/dataPolicy.mjs";
import { load, save } from "../../lib/persist";

const DEMO_PROFILES = { turnstile: { feedEnabled: true } };
const DEMO_POSTS = {
  turnstile: [{ id: "ap1", text: "New tour dates just dropped. MSG we're coming for you.", ts: "2d" }],
};
let legacyCacheScrubbed = false;

const loadSnapshot = (accountId) => {
  const keys = artistPageCacheStorageKeys(accountId);
  return artistPageCacheSnapshot(
    sanitizePersistedStoreValue(
      "pit.artistProfiles",
      load(keys.profiles, ENABLE_DEMO_DATA ? DEMO_PROFILES : {}),
      ENABLE_DEMO_DATA,
    ),
    sanitizePersistedStoreValue(
      "pit.artistPosts",
      load(keys.posts, ENABLE_DEMO_DATA ? DEMO_POSTS : {}),
      ENABLE_DEMO_DATA,
    ),
  );
};

const persistSnapshot = (state) => {
  const keys = artistPageCacheStorageKeys(state?.accountId);
  save(keys.profiles, state?.profiles || {});
  save(keys.posts, state?.posts || {});
};

export function useAccountArtistPageCache(initialAccountId = null) {
  const cacheRef = useRef(null);
  if (!cacheRef.current) {
    if (!legacyCacheScrubbed) {
      // The v1 keys were device-global and cannot be assigned to a viewer safely.
      save("pit.artistProfiles", {});
      save("pit.artistPosts", {});
      legacyCacheScrubbed = true;
    }
    cacheRef.current = {
      reads: createArtistPageReadCoordinator(),
      state: createArtistPageCacheState(initialAccountId, loadSnapshot(initialAccountId)),
    };
  }
  const [state, setState] = useState(() => cacheRef.current.state);
  cacheRef.current.state = state;

  const commit = (updater, { claim = null, persist = true } = {}) => {
    const current = cacheRef.current.state;
    if (claim && !cacheRef.current.reads.isCurrent(claim, current.accountId)) return false;
    const next = typeof updater === "function" ? updater(current) : updater;
    if (!next || next === current) return true;
    cacheRef.current.state = next;
    setState(next);
    if (persist) persistSnapshot(next);
    return true;
  };

  return {
    snapshot: artistPageCacheForViewer(state, initialAccountId),
    adoptAccount(nextAccountId) {
      const current = cacheRef.current.state;
      const next = handoffArtistPageCache(current, nextAccountId, loadSnapshot(nextAccountId));
      if (next === current) return false;
      cacheRef.current.reads.reset();
      cacheRef.current.state = next;
      setState(next);
      return true;
    },
    invalidate() {
      cacheRef.current.reads.reset();
      const next = clearArtistPageCache(cacheRef.current.state);
      cacheRef.current.state = next;
      setState(next);
      persistSnapshot(next);
    },
    updateProfiles(updater, options) {
      return commit((current) => ({
        ...current,
        profiles: typeof updater === "function" ? updater(current.profiles) : updater,
      }), options);
    },
    updatePosts(updater, options) {
      return commit((current) => ({
        ...current,
        posts: typeof updater === "function" ? updater(current.posts) : updater,
      }), options);
    },
    resolveRefresh(artistKey, result, options) {
      return commit((current) => resolveArtistPageRefresh(current, artistKey, result), options);
    },
    claim(kind, accountId) {
      return cacheRef.current.reads.claim(kind, accountId);
    },
    isCurrent(claim, accountId) {
      return cacheRef.current.reads.isCurrent(claim, accountId);
    },
    persistCurrent() {
      persistSnapshot(cacheRef.current.state);
    },
  };
}
