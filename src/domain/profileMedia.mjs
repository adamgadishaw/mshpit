import { mediaDisplayItems } from "./postMediaDisplay.mjs";

// Builds the public profile wall from the same stable descriptors as the feed.
// A viewer never receives media from an explicitly private post, while owners
// retain the complete wall. Descriptor fields such as posterUrl, kind, altText,
// dimensions, and the server-rendered URL remain intact for resilient display.
export function profileMediaItems(logs, { isSelf = false } = {}) {
  const gallery = [];
  for (const log of Array.isArray(logs) ? logs : []) {
    if (!log || typeof log !== "object" || (!isSelf && log.photosPublic === false)) continue;
    for (const item of mediaDisplayItems(log)) {
      gallery.push({
        ...item,
        uri: item.uri,
        postId: log.id || null,
        ownerId: log.userId || null,
      });
    }
  }
  return gallery;
}
