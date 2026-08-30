import {
  artistConcertsPath,
  artistPath,
  concertPath,
  eventPath,
  parsePublicCollectionPath,
  postPath,
  profilePath,
  venuePath,
} from "./urls.mjs";
import { showNavigationPostId } from "./showNavigation.mjs";

const text = (value) => String(value ?? "").trim();

// Convert an in-memory navigation frame into the public URL it owns. Frames
// without a public identity deliberately return null so temporary app state is
// never written into browser history.
export function publicFramePath(frame, { resolveArtistMeta, resolveUser } = {}) {
  if (!frame) return null;
  if (frame.directory === "artists" || frame.directory === "events") return `/${frame.directory}`;
  if (frame.artistArchive?.name) {
    const publicSlug = text(
      frame.artistArchive.publicSlug
      || resolveArtistMeta?.(frame.artistArchive.name)?.publicSlug,
    );
    return publicSlug ? artistConcertsPath(publicSlug) : null;
  }
  if (frame.artistName) {
    const publicSlug = text(frame.artistPublicSlug || resolveArtistMeta?.(frame.artistName)?.publicSlug);
    return publicSlug ? artistPath(frame.artistName, publicSlug) : null;
  }
  if (frame.venueName) return venuePath(frame.venue || frame.venueName);
  if (frame.post?.id) return postPath(frame.post.id);
  const showPostId = showNavigationPostId(frame.openLog);
  if (showPostId) return postPath(showPostId);
  if (frame.openLog?.archiveShowKey) return concertPath(frame.openLog.archiveShowKey);
  if (frame.openLog?.performanceEvent && frame.openLog?.id) return eventPath(frame.openLog.id);
  if (frame.profileId) {
    const user = resolveUser?.(frame.profileId);
    return user?.handle ? profilePath(user.handle) : null;
  }
  return null;
}

// Collection documents are server-rendered separately from entity documents.
// Tell the client which base entity to resolve so refreshing the nested archive
// URL opens the same ArtistArchiveScreen as an in-app click.
export function publicCollectionHydration(pathname) {
  const collection = parsePublicCollectionPath(pathname);
  if (collection?.type !== "artist-concerts") return null;
  return Object.freeze({
    type: collection.type,
    publicSlug: collection.artistSlug,
    resolvePath: artistPath(collection.artistSlug, collection.artistSlug),
  });
}

export function resolvedPublicCollectionFrame(hydration, entity) {
  if (hydration?.type !== "artist-concerts" || entity?.kind !== "artist" || !text(entity.name)) return null;
  return Object.freeze({
    artistArchive: {
      name: text(entity.name),
      artistKey: entity.artistKey || null,
      publicSlug: hydration.publicSlug,
    },
  });
}
