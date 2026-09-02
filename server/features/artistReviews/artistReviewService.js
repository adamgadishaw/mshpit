import { normalizeTaggedPeople } from "../../../src/domain/postFriendTags.mjs";
import { archiveShowKey, isArchiveDate } from "../artistArchive/artistArchiveKeys.js";

const boundedLimit = (value) => {
  const requested = Number(value);
  return Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 10) : 3;
};

const list = (value) => Array.isArray(value) ? value : [];

function artistReviewProjection(post) {
  const publicMedia = post.photosPublic === true || Number(post.photosPublic) === 1;
  const artistIdentity = String(post.artistKey || post.artist || "").trim();
  const venueIdentity = String(post.venueKey || post.venue || "").trim();
  const exactShowKey = post.kind !== "status" && artistIdentity && venueIdentity && isArchiveDate(post.date)
    ? archiveShowKey({ artistIdentity, venueIdentity, date: post.date })
    : null;
  return {
    id: post.id,
    userId: post.userId,
    kind: post.kind === "status" ? "memory" : "review",
    user: post.user,
    artist: post.artist,
    venue: post.venue,
    city: post.city,
    date: post.date,
    artistKey: post.artistKey || null,
    artistMbid: post.artistMbid || null,
    venueKey: post.venueKey || null,
    archiveShowKey: exactShowKey,
    overall: post.overall,
    band: post.band ?? null,
    room: post.room ?? null,
    dims: post.dims && typeof post.dims === "object" && !Array.isArray(post.dims) ? post.dims : {},
    review: post.review,
    photosPublic: publicMedia,
    photos: publicMedia ? list(post.photos) : [],
    media: publicMedia ? list(post.media) : [],
    mediaAssetIds: publicMedia ? list(post.mediaAssetIds) : [],
    setlist: list(post.setlist),
    tour: post.tour || null,
    tags: [],
    taggedPeople: normalizeTaggedPeople(post.taggedPeople),
    song: post.song ?? null,
    likes: Math.max(0, Number(post.likes) || 0),
    comments: Math.max(0, Number(post.comments) || 0),
    liked: !!post.liked,
    seen: post.seen ?? null,
    createdAt: post.createdAt ?? null,
    editedAt: post.editedAt ?? null,
    version: post.version ?? post.editedAt ?? post.createdAt ?? null,
  };
}

export function createArtistReviewService({ repository, projectPost, attachViewerLikes }) {
  if (!repository?.findTopReviews) throw new TypeError("Artist reviews require a repository");
  if (typeof projectPost !== "function") throw new TypeError("Artist reviews require the canonical post projector");
  if (typeof attachViewerLikes !== "function") throw new TypeError("Artist reviews require the viewer-like page projector");

  return Object.freeze({
    readTopReviews({ artistKey = null, name = null, viewerId = null, limit = 3 } = {}) {
      const rows = repository.findTopReviews({
        artistKey,
        name,
        viewerId,
        limit: boundedLimit(limit),
      });
      const rowsWithViewerLikes = attachViewerLikes(rows, viewerId);
      return rowsWithViewerLikes.map((row) => artistReviewProjection(projectPost(row, viewerId)));
    },
  });
}
