import { publicFramePath } from "./publicFrameNavigation.mjs";
import { slugify } from "./urls.mjs";

const text = (value) => String(value ?? "").trim();
const artistNameOf = (frame) => text(frame?.artistName || frame?.artistArchive?.name);
const isCanonicalSlug = (value) => !!value && value.length <= 80 && slugify(value) === value;

function throwIfCancelled(signal) {
  if (!signal?.aborted) return;
  const error = signal.reason instanceof Error ? signal.reason : new Error("Navigation cancelled");
  if (error.name === "Error") error.name = "AbortError";
  throw error;
}

function abortable(read, signal) {
  throwIfCancelled(signal);
  if (!signal) return read;
  return new Promise((resolve, reject) => {
    const abort = () => {
      try { throwIfCancelled(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(read).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function needsPublicFrameIdentity(frame, options = {}) {
  if (!frame || (!artistNameOf(frame) && !frame.profileId)) return false;
  const cached = artistNameOf(frame) ? options.resolveArtistMeta?.(artistNameOf(frame)) : null;
  if (cached?.transient === true && !frame.artistPublicSlug && !frame.artistArchive?.publicSlug) return true;
  return !publicFramePath(frame, options);
}

/**
 * Complete a selected public identity before painting a different page. Only
 * authoritative stored slugs/handles can create a shareable route; an unknown
 * name is not a licence to invent a URL. Null means stay on the current page
 * and present an unavailable/retry state. Errors and cancellation propagate.
 */
export async function resolvePublicFrameIdentity(frame, {
  signal, resolveArtistMeta, resolveUser, resolveArtist, loadUser, profileFrame,
} = {}) {
  throwIfCancelled(signal);
  if (!frame || typeof frame !== "object") return null;
  const options = { resolveArtistMeta, resolveUser };
  if (!needsPublicFrameIdentity(frame, options)) {
    const path = publicFramePath(frame, options);
    return path ? { frame, path } : null;
  }

  const artistName = artistNameOf(frame);
  if (artistName) {
    if (artistName.length > 200 || typeof resolveArtist !== "function") return null;
    const artist = await abortable(resolveArtist(artistName, { signal }), signal);
    throwIfCancelled(signal);
    const slug = text(artist?.publicSlug || artist?.public_slug);
    if (!artist || artist.transient === true || !isCanonicalSlug(slug)) return null;
    const name = text(artist.name) || artistName;
    const next = frame.artistArchive
      ? { ...frame, artistArchive: { ...frame.artistArchive, name, publicSlug: slug, artistKey: artist.key || artist.norm || frame.artistArchive.artistKey || null } }
      : { ...frame, artistName: name, artistPublicSlug: slug };
    const path = publicFramePath(next);
    return path ? { frame: next, path } : null;
  }

  const id = text(frame.profileId);
  if (!id || id.length > 200 || typeof loadUser !== "function") return null;
  const result = await abortable(loadUser(id, { signal }), signal);
  throwIfCancelled(signal);
  // A stale cached profile is not authority after a failed/forbidden read.
  const user = result?.status === "ready" ? result.user : null;
  if (!user || text(user.id) !== id) return null;
  const projected = typeof profileFrame === "function" ? profileFrame(id, user) : frame;
  if (!projected || typeof projected !== "object") return null;
  if (artistNameOf(projected)) {
    // Artist-owned accounts have a public artist identity, not a duplicate fan
    // profile. The second and final read may resolve that artist's stored slug.
    return resolvePublicFrameIdentity(projected, { signal, resolveArtistMeta, resolveArtist });
  }
  if (text(projected.profileId) !== id || !text(user.handle)) return null;
  const next = { ...projected, profileHandle: text(user.handle) };
  const path = publicFramePath(next);
  return path ? { frame: next, path } : null;
}
