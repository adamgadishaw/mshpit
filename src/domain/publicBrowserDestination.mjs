import { isPublicEntityPath, parseCityPath, parsePath } from "./urls.mjs";
import { mainTabForPath, serverDocumentNavigationPath } from "./browserNavigation.mjs";
import { publicCollectionHydration, publicEntryFrame, resolvedPublicCollectionFrame } from "./publicFrameNavigation.mjs";
import { memberTabRequiresAccount } from "./memberAccess.mjs";
import { isOnlineReview } from "./onlineReview.mjs";
import { isCityOnlyReview } from "./showNavigation.mjs";

// Both initial links and uncached Back/Forward entries use this same resolver.
// Never hydrate a missing entity as the homepage or a different collection.
export async function publicBrowserDestination(path, { accountId = null, signal, resolveEntity, readPost, profileFrame, publicFrameHint = null } = {}) {
  const base = { stack: [{}], tab: "discover", landing: false, accountId };
  const framed = (frame, canonicalPath = path) => ({ ...base, stack: [{}, frame], path: canonicalPath });
  if (path === "/") return { ...base, tab: "feed", landing: true, path: "/" };
  const tab = mainTabForPath(path);
  if (tab) return !accountId && memberTabRequiresAccount(tab)
    ? framed({ auth: true, authMode: "login" }, "/login") : { ...base, tab, path };
  const entry = publicEntryFrame(path);
  if (entry) return framed(entry);
  if (path === "/privacy" || path === "/terms") return framed({ [path.slice(1)]: true });
  const city = parseCityPath(path);
  if (city || path === "/cities") return framed({ cityGuide: city || { directory: true } });
  if (serverDocumentNavigationPath(path)) return framed({ routeError: path });
  if (path === "/artists" || path === "/events") return framed({ directory: path.slice(1) });
  const collection = publicCollectionHydration(path);
  if (!collection && !isPublicEntityPath(path)) return framed({ routeError: path });
  const entity = await resolveEntity(collection?.resolvePath || path, { signal });
  if (signal?.aborted) return null;
  if (!entity) return framed({ routeError: path });
  if (collection) {
    const frame = resolvedPublicCollectionFrame(collection, entity);
    return framed(frame || { routeError: path });
  }
  const canonicalPath = typeof entity.path === "string" && /^\/(?!\/)/.test(entity.path)
    && !/[?#\\\u0000-\u0020\u007f]/.test(entity.path) ? entity.path : path;
  if (entity.kind === "artist") {
    const canonical = parsePath(canonicalPath);
    return framed({ artistName: entity.name, ...(canonical?.type === "artist" ? { artistPublicSlug: canonical.value } : {}) }, canonicalPath);
  }
  if (entity.kind === "venue") return framed({ venueName: entity.name, venue: {
    name: entity.name, providerVenueId: entity.providerVenueId || entity.venue_provider_id || null, source: entity.source || null,
  } }, canonicalPath);
  if (entity.kind === "profile") {
    const frame = await profileFrame(entity);
    return signal?.aborted ? null : framed(frame, canonicalPath);
  }
  if (entity.kind === "show") {
    const post = await readPost(entity.id, { signal });
    if (signal?.aborted) return null;
    const preferPost = !!post && publicFrameHint && typeof publicFrameHint === "object" && !Array.isArray(publicFrameHint)
      && typeof publicFrameHint.postId === "string" && publicFrameHint.postId.length > 0 && publicFrameHint.postId.length <= 200
      && publicFrameHint.postId === post.id && post.id === entity.id;
    return framed(!post ? { routeError: path } : preferPost || post.kind === "status" || isOnlineReview(post) || isCityOnlyReview(post) ? { post } : { openLog: post }, canonicalPath);
  }
  if (entity.kind === "event" || entity.kind === "concert") return framed({ openLog: { ...entity, performanceEvent: true } }, canonicalPath);
  return framed({ routeError: path });
}
