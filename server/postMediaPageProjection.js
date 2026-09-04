import { legacyVideoPosterDescriptorsByPost } from "./legacyVideoPosters.js";
import { postMediaStateByPost } from "./mediaAssets.js";

const POST_MEDIA_BATCH_SIZE = 100;
const PRELOADED_POST_MEDIA = Symbol("preloadedPostMedia");

function postIds(rows) {
  return [...new Set(rows
    .map((row) => row?.id)
    .filter((id) => typeof id === "string" && id))];
}

// Feed/profile pages already have a bounded set of post ids. Resolve their
// durable media in one query per 100 cards instead of letting the canonical
// projector repeat the same multi-table lookup once for every card. The
// context is deliberately non-enumerable: it is request-local authorization
// state and can never leak into JSON or a cached recommendation snapshot.
export function attachPostMediaPageProjection(database, posts, {
  ownerId = null,
  projectStable = postMediaStateByPost,
  projectLegacy = legacyVideoPosterDescriptorsByPost,
} = {}) {
  const rows = Array.isArray(posts) ? posts : [];
  const ids = postIds(rows);
  if (!ids.length) return rows;

  const byPost = new Map();
  for (let offset = 0; offset < ids.length; offset += POST_MEDIA_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + POST_MEDIA_BATCH_SIZE);
    const stable = projectStable(database, batch, { ownerId });
    const legacy = projectLegacy(database, batch);
    for (const id of batch) {
      byPost.set(id, Object.freeze({
        stable: Object.freeze({
          assets: stable?.assetsByPost?.get(id) || [],
          linkedAssetIds: [],
        }),
        legacy: legacy?.get(id) || [],
      }));
    }
  }

  return rows.map((row) => {
    const projection = byPost.get(row?.id);
    if (!projection) return row;
    const copy = { ...row };
    Object.defineProperty(copy, PRELOADED_POST_MEDIA, {
      configurable: false,
      enumerable: false,
      value: projection,
      writable: false,
    });
    return copy;
  });
}

export function preloadedPostMedia(row) {
  return row?.[PRELOADED_POST_MEDIA] || null;
}
