import { mediaDisplayItems } from "./postMediaDisplay.mjs";

const has = (values, id) => id != null && values.includes(id);
const assetAllowed = (asset, isPhotoRemoved) => !isPhotoRemoved || ![
  typeof asset === "string" ? asset : null,
  asset?.uri, asset?.url, asset?.sourceUrl, asset?.posterUrl, asset?.posterUri,
].some(uri => typeof uri === "string" && uri && isPhotoRemoved(uri));
const filterSame = (values, predicate) => {
  if (!Array.isArray(values)) return values;
  const kept = values.filter(predicate);
  return kept.length === values.length ? values : kept;
};

// Retained route/history objects are fallback data, never an exemption from
// the live Store's moderation, block, or per-asset privacy projection.
export function projectIOSDetailPost(post, { removedIds = [], blockedIds = [], isPhotoRemoved } = {}) {
  if (!post || has(removedIds, post.id) || has(removedIds, post.postId)
      || has(blockedIds, post.userId || post.ownerId || post.user?.id)) return null;
  let result = post;
  const set = (key, value) => { if (value !== post[key]) result = { ...result, [key]: value }; };
  const allowed = asset => assetAllowed(asset, isPhotoRemoved);
  const visible = mediaDisplayItems(post), kept = visible.filter(allowed);
  // Filtering only legacy photos would resurrect descriptors when that array
  // becomes empty. Project both representations from the same visible order.
  if (kept.length !== visible.length) {
    set("photos", kept.map(asset => asset.uri)); set("media", kept);
  } else {
    set("photos", filterSame(post.photos, allowed)); set("media", filterSame(post.media, allowed));
  }
  if (!allowed(post.photo)) set("photo", null);
  set("convertingMedia", filterSame(post.convertingMedia, allowed));
  set("taggedPeople", filterSame(post.taggedPeople, person => !has(blockedIds, person?.id)));
  if (post.cover && (!allowed(post.cover) || has(removedIds, post.cover.postId) || has(blockedIds, post.cover.userId))) set("cover", null);
  if (post.news) {
    const news = post.news, media = filterSame(news.media, allowed);
    const artists = (Array.isArray(news.artists) ? news.artists : []).map(artist => !allowed(artist?.photo) ? { ...artist, photo: null } : artist);
    const sources = filterSame(news.sources, source => source?.kind !== "photo" || allowed(source));
    if (media !== news.media || sources !== news.sources || artists.some((artist, index) => artist !== news.artists[index])) {
      set("news", { ...news, media, artists, sources });
    }
  }
  return result;
}

export function projectIOSDetailUser(user, isPhotoRemoved) {
  if (!user || !isPhotoRemoved) return user;
  let result = user;
  for (const key of ["banner", "avatarUri"]) {
    if (user[key] && isPhotoRemoved(user[key])) result = { ...result, [key]: null };
  }
  return result;
}
