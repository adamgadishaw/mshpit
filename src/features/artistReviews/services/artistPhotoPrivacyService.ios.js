import { commandSuccess, commandFailure } from "../../../domain/commandResult.mjs";
import { getIOSDetailPrivacySnapshot, invalidateIOSDetailPrivacy } from "../../../lib/iosDetailPrivacy.ios.js";

// Ownership follows the Store provider's existing account epoch, not a screen
// or a shared singleton cache. Bound the metadata and reject evicted requests.
const providers = new WeakMap();
const LIMIT = 64;
function stateFor(owner) {
  let state = providers.get(owner);
  if (!state || state.epoch !== owner.current) {
    state = { epoch: owner.current, entries: new Map() };
    providers.set(owner, state);
  }
  return state;
}

export function createIOSArtistPhotoLoader({ sessionRef, accountMutationEpochRef, artistPhotoCacheKey,
  setArtistPhotosSrv, captureAccountMutation, accountMutationIsCurrent, artistPageAccessDenied, isLoadCancellation, AppError, commandError, api }) {
  const context = "Refreshing artist photos";
  const skipped = (flag, code = "PIT-REQ-003") => ({
    ...commandFailure(new AppError(undefined, { code, context, source: "artist-photos" })),
    [flag]: true,
  });
  return async (name, artistKey = null, { signal } = {}) => {
    const key = artistPhotoCacheKey(name, artistKey);
    if (!key) return skipped("missing", "PIT-REQ-002");
    if (signal?.aborted) return skipped("aborted");
    const accountId = sessionRef.current?.id || null;
    const mutation = captureAccountMutation(accountId, accountMutationEpochRef.current);
    const privacy = getIOSDetailPrivacySnapshot();
    const state = stateFor(accountMutationEpochRef);
    const entry = { privacy: state.entries.get(key)?.privacy };
    state.entries.delete(key);
    state.entries.set(key, entry);
    while (state.entries.size > LIMIT) state.entries.delete(state.entries.keys().next().value);
    const owns = () => !signal?.aborted
      && accountMutationIsCurrent(mutation, sessionRef.current?.id, accountMutationEpochRef.current)
      && stateFor(accountMutationEpochRef).entries.get(key) === entry;
    const mayAdopt = () => owns() && privacy === getIOSDetailPrivacySnapshot();
    try {
      const query = new URLSearchParams({ name: String(name || "") });
      if (artistKey) query.set("artistKey", String(artistKey));
      const { photos } = await api(`/api/artists/photos?${query.toString()}`, {
        signal, silent: true, context: "Refreshing artist photos", expectedAccountId: accountId,
      });
      if (!Array.isArray(photos) || !mayAdopt()) return skipped("stale");
      const snapshot = photos.map((photo) => ({ ...photo, uri: photo.uri, by: photo.by,
        postId: photo.postId, ownerId: photo.userId || photo.ownerId, source: "fan" }));
      setArtistPhotosSrv((groups) => {
        if (!mayAdopt()) return groups;
        entry.privacy = privacy;
        return { ...groups, [key]: snapshot };
      });
      // Keep the legacy photos alias while also exposing the canonical receipt.
      return { ...commandSuccess({ photos: snapshot }), photos: snapshot };
    } catch (error) {
      // Current authoritative denials revoke older retained occurrences too.
      // A late denial from a superseded read cannot erase a newer receipt.
      if (owns() && (artistPageAccessDenied(error) || [404, 410].includes(Number(error?.status)))) {
        if ([403, 404, 410].includes(Number(error?.status))) invalidateIOSDetailPrivacy();
        entry.privacy = undefined;
        setArtistPhotosSrv((groups) => owns() ? { ...groups, [key]: [] } : groups);
      }
      return isLoadCancellation(error, signal)
        ? skipped("aborted")
        : commandError(error, context);
    }
  };
}

export function projectIOSArtistPhotos({ owner, key, local, server, removedIds, blockedIds, removedPhotos, isPhotoRemoved, mergeArtistGalleryMedia }) {
  const currentServer = stateFor(owner).entries.get(key)?.privacy === getIOSDetailPrivacySnapshot() ? server : [];
  const allowed = (photo) => !removedIds.includes(photo.postId)
    && ![photo.uri, photo.url, photo.sourceUrl, photo.posterUrl, photo.posterUri].some((uri) => uri && isPhotoRemoved(uri));
  return mergeArtistGalleryMedia(local.filter(allowed), currentServer.filter(allowed), { blockedIds, removedUris: removedPhotos });
}
