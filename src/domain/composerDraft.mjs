import {
  mediaProjectFromLegacyUrls,
  mediaProjectPublishedMedia,
  normalizeMediaProject,
  serializableMediaProject,
} from "./mediaProject.mjs";

const text = (value) => value == null ? "" : String(value);

const normalizedDims = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    performance: Number(source.performance) || 0,
    setlist: Number(source.setlist) || 0,
    sound: Number(source.sound) || 0,
    venue: Number(source.venue) || 0,
    crowd: Number(source.crowd) || 0,
    experience: Number(source.experience) || 0,
  };
};

/**
 * Convert live composer state or an older stored draft into one stable shape.
 * Metadata such as ownerId/at is deliberately excluded from the fingerprint so
 * saving a draft does not make the same content look dirty again.
 */
export function normalizeComposerDraft(value = {}) {
  const panels = value.panels && typeof value.panels === "object" ? value.panels : {};
  const legacyPhotos = Array.isArray(value.photos) ? value.photos.filter((uri) => typeof uri === "string").slice(0, 8) : [];
  const normalizedProject = value.mediaProject
    ? normalizeMediaProject(value.mediaProject)
    : mediaProjectFromLegacyUrls(legacyPhotos);
  const mediaProject = serializableMediaProject(normalizedProject);
  const projectedPhotos = mediaProjectPublishedMedia(mediaProject).map((item) => item.url);
  const photos = legacyPhotos.length ? legacyPhotos : projectedPhotos;
  return {
    id: value.id || null,
    submissionId: text(value.submissionId) || null,
    postType: value.postType === "status" ? "status" : "show",
    artist: text(value.artist),
    artistKey: value.artistKey == null || value.artistKey === "" ? null : String(value.artistKey),
    venue: text(value.venue),
    city: text(value.city),
    tour: text(value.tour),
    date: text(value.date),
    dims: normalizedDims(value.dims),
    review: text(value.review),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === "string").slice(0, 5) : [],
    tagDraft: text(value.tagDraft),
    song: value.song && typeof value.song === "object" ? value.song : null,
    songUrl: text(value.songUrl || value.song?.url),
    playlist: value.playlist && typeof value.playlist === "object" ? value.playlist : null,
    photos,
    mediaProject,
    photosPublic: value.photosPublic !== false,
    // Marketing-surface permission is deliberately separate from artist-page
    // sharing and defaults off for every historical or newly opened draft.
    landingShowcase: value.photosPublic !== false && value.landingShowcase === true,
    panels: {
      song: !!(panels.song ?? value.showSong ?? value.song),
      photos: !!(panels.photos ?? value.showPhotos ?? (photos.length || mediaProject.assets.length)),
      playlist: !!(panels.playlist ?? value.showPlaylist ?? value.playlist),
    },
  };
}

export function composerDraftFingerprint(value) {
  const { id: _id, ...content } = normalizeComposerDraft(value);
  return JSON.stringify(content);
}

export function composerDraftHasContent(value) {
  const draft = normalizeComposerDraft(value);
  return !!(
    draft.artist.trim()
    || draft.venue.trim()
    || draft.city.trim()
    || draft.tour.trim()
    || draft.review.trim()
    || draft.tags.length
    || draft.tagDraft.trim()
    || draft.song?.videoId
    || draft.songUrl.trim()
    || draft.playlist
    || draft.photos.length
    || draft.mediaProject.assets.length
    || Object.values(draft.dims).some((rating) => rating > 0)
  );
}

export function composerDraftTitle(value) {
  const draft = normalizeComposerDraft(value);
  if (draft.postType === "status") return draft.review.trim() || "Status draft";
  return `${draft.artist.trim() || "Untitled show"}${draft.venue.trim() ? ` ${String.fromCharCode(183)} ${draft.venue.trim()}` : ""}`;
}

export function shouldScheduleComposerDraftPersistence({ editing = false, dirty = false, hasDraft = false, hasContent = false, fingerprint = null, savedFingerprint = null } = {}) {
  if (editing || (!dirty && !hasDraft)) return false;
  if (hasContent && fingerprint === savedFingerprint) return false;
  return true;
}

export function shouldFlushComposerDraft({ editing = false, dirty = false, hasDraft = false } = {}) {
  return !editing && (dirty || hasDraft);
}
