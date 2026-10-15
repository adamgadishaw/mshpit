import { api } from "../../lib/api";

export const searchArtistAccess = (query, { signal } = {}) => api(`/api/admin/artist-access?q=${encodeURIComponent(query.trim())}`, {
  signal, silent: true, context: "Reviewing artist page access",
});
export const revokeArtistAccess = (artist, reason, { signal, contentHash, disposition = "hide", visibleItems = [] } = {}) => api(`/api/admin/artists/${encodeURIComponent(artist.key)}/revoke-access`, {
  method: "POST", body: { confirmed: true, expectedOwnerId: artist.ownerId, expectedUpdatedAt: artist.updatedAt, expectedContentHash: contentHash, disposition, visibleItems, reason },
  signal, silent: true, context: "Revoking artist page access",
});
export const previewArtistAccess = (artistKey, { signal, cursor = 0 } = {}) => api(`/api/admin/artists/${encodeURIComponent(artistKey)}/access-preview?cursor=${cursor}`, { signal, silent: true, context: "Previewing artist content" });
export const changeRetainedArtistPublication = (artistKey, review, items, reason, { signal } = {}) => api(`/api/admin/artists/${encodeURIComponent(artistKey)}/retained-content/publication`, {
  method: "POST", body: { confirmed: true, revocationId: review.snapshot.id, expectedCurrentOwnerId: review.currentOwnerId,
    expectedProfileUpdatedAt: review.profileUpdatedAt, items, reason }, signal, silent: true, context: "Updating retained artist publication",
});
export const reviewRetainedArtistContent = (artistKey, { signal, revocationId = "", cursor = 0 } = {}) => api(`/api/admin/artists/${encodeURIComponent(artistKey)}/retained-content?cursor=${cursor}${revocationId ? `&revocationId=${encodeURIComponent(revocationId)}` : ""}`, {
  signal, silent: true, context: "Reviewing retained artist content",
});
