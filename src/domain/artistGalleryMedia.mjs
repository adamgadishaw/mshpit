const identity = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

export function artistGalleryIdentityKey(name, artistKey = null) {
  return identity(artistKey) || identity(name);
}

export function postMatchesArtistGallery(post, { name, artistKey = null } = {}) {
  const expectedKey = identity(artistKey);
  if (expectedKey) return identity(post?.artistKey) === expectedKey;
  return identity(post?.artist) === identity(name);
}

export function mergeArtistGalleryMedia(local, server, { blockedIds = [], removedUris = [] } = {}) {
  const blocked = new Set((Array.isArray(blockedIds) ? blockedIds : []).map(String));
  const removed = new Set(Array.isArray(removedUris) ? removedUris : []);
  const seen = new Set();
  return [...(Array.isArray(local) ? local : []), ...(Array.isArray(server) ? server : [])].filter((item) => {
    const uri = typeof item?.uri === "string" ? item.uri : "";
    if (!uri || seen.has(uri) || removed.has(uri) || (item?.ownerId && blocked.has(String(item.ownerId)))) return false;
    seen.add(uri);
    return true;
  });
}
