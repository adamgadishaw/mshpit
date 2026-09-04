import {
  archiveIdentityPart,
  archiveReviewCursor,
  archiveShowKey,
  archiveTourIdentity,
  archiveTourKey,
  canonicalArchiveTourIdentity,
  decodeArchiveReviewCursor,
  decodeArchiveShowKey,
  decodeArchiveTourKey,
  normalizeArchivePart,
} from "./artistArchiveKeys.js";
import { projectedTourDateTicketUrl } from "../../../src/domain/ticketLinks.mjs";

const list = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const validUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);
const imageUrl = (value) => validUrl(value) && !/\.(?:mp4|mov|m4v|webm)(?:$|[?#])/i.test(value);

function parseArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mediaForRows(rows, viewerId, projectMediaState) {
  const byPost = new Map();
  const linked = new Set();
  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const state = projectMediaState(chunk.map((row) => row.id), viewerId) || {};
    for (const id of state.linkedPostIds || []) linked.add(id);
    for (const [id, assets] of state.assetsByPost || []) byPost.set(id, list(assets));
  }
  for (const row of rows) {
    if (!row.photos_public) {
      byPost.set(row.id, []);
      continue;
    }
    if (!linked.has(row.id)) {
      byPost.set(row.id, parseArray(row.photos).filter(validUrl).map((url) => ({
        url,
        kind: imageUrl(url) ? "image" : "video",
        posterUrl: null,
        altText: "",
      })));
    }
  }
  return byPost;
}

function rowMatchesShow(row, decoded) {
  return archiveIdentityPart(row.artist_key || row.artist) === archiveIdentityPart(decoded.artistIdentity)
    && archiveIdentityPart(row.venue_key || row.venue) === archiveIdentityPart(decoded.venueIdentity)
    && row.date === decoded.date;
}

function rowMatchesTour(row, decoded) {
  return normalizeArchivePart(row.artist_key || row.artist) === normalizeArchivePart(decoded.artistIdentity)
    && archiveTourIdentity(row).identity === canonicalArchiveTourIdentity(decoded.tourIdentity, row.artist);
}

function tourLabelQuality(value) {
  const label = String(value || "").trim();
  let score = /\btour\s*$/iu.test(label) ? 80 : 0;
  if (/^The\b/u.test(label)) score += 20;
  if (/[a-z]/u.test(label) && /[A-Z]/u.test(label)) score += 10;
  if (/[-\u2010-\u2015]/u.test(label)) score += 5;
  return score;
}

function tourDisplayVariant(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function preferredTour(rows) {
  const variants = new Map();
  rows.forEach((row, index) => {
    const candidate = archiveTourIdentity(row);
    const variantKey = `${candidate.identity}\0${tourDisplayVariant(candidate.label)}`;
    const vote = variants.get(variantKey) || { ...candidate, count: 0, firstIndex: index };
    vote.count += 1;
    variants.set(variantKey, vote);
  });
  return [...variants.values()].sort((a, b) => tourLabelQuality(b.label) - tourLabelQuality(a.label)
    || b.count - a.count
    || b.label.length - a.label.length
    || a.firstIndex - b.firstIndex || a.identity.localeCompare(b.identity))[0]
    || archiveTourIdentity(rows[0]);
}

function reviewProjection(row, media, projectReviewUser) {
  const user = projectReviewUser({
    id: row.user_id,
    name: row.u_name,
    handle: row.u_handle,
    initials: row.u_initials,
    avatarUri: row.u_avatar,
    avatarColor: row.u_color,
  });
  return Object.freeze({
    id: row.id,
    userId: row.user_id,
    user,
    artist: row.artist,
    artistKey: row.artist_key || null,
    venue: row.venue,
    venueKey: row.venue_key || null,
    city: row.city,
    date: row.date,
    tour: row.tour || null,
    overall: number(row.overall),
    band: row.band == null ? null : number(row.band),
    room: row.room == null ? null : number(row.room),
    review: row.review || "",
    photosPublic: !!row.photos_public,
    media: list(media),
    photos: list(media).map((asset) => asset.url),
    likes: Math.max(0, number(row.like_count)),
    comments: Math.max(0, number(row.comment_count)),
    createdAt: number(row.created_at),
  });
}

function coverCandidates(rows, mediaByPost, reactionCounts) {
  const candidates = [];
  for (const row of rows) {
    for (const asset of mediaByPost.get(row.id) || []) {
      const kind = asset.kind || "image";
      if (kind !== "image" && !validUrl(asset.posterUrl)) continue;
      candidates.push({
        url: asset.url,
        posterUrl: asset.posterUrl || null,
        posterTimeMs: asset.posterTimeMs ?? null,
        kind,
        altText: asset.altText || "",
        by: row.u_name || "A Pit fan",
        userId: row.user_id,
        postId: row.id,
        reactions: reactionCounts.get(`${row.id}\0${asset.url}`) || 0,
        engagement: number(row.like_count) + number(row.comment_count),
        createdAt: number(row.created_at),
      });
    }
  }
  return candidates.sort((a, b) =>
    Number(b.kind === "image") - Number(a.kind === "image")
      || b.reactions - a.reactions
      || b.engagement - a.engagement
      || b.createdAt - a.createdAt
      || a.postId.localeCompare(b.postId))[0] || null;
}

function representativeCity(rows) {
  const votes = new Map();
  rows.forEach((row, index) => {
    const label = String(row.city || "").trim();
    if (!label) return;
    const identity = archiveIdentityPart(label);
    const vote = votes.get(identity) || { label, count: 0, firstIndex: index };
    vote.count += 1;
    votes.set(identity, vote);
  });
  return [...votes.values()].sort((a, b) => b.count - a.count
    || b.label.length - a.label.length || a.firstIndex - b.firstIndex || a.label.localeCompare(b.label))[0]?.label || "";
}

function showSummary(rows, mediaByPost, reactionCounts, artistIdentity) {
  const first = rows[0];
  const latestByReviewer = new Map();
  for (const row of rows) if (!latestByReviewer.has(row.user_id)) latestByReviewer.set(row.user_id, row);
  const reviewerRows = [...latestByReviewer.values()];
  const ratings = reviewerRows.map((row) => number(row.overall));
  const ratingCount = ratings.length;
  const avgRating = ratingCount ? ratings.reduce((sum, rating) => sum + rating, 0) / ratingCount : 0;
  const likes = reviewerRows.reduce((sum, row) => sum + number(row.like_count), 0);
  const comments = reviewerRows.reduce((sum, row) => sum + number(row.comment_count), 0);
  const mediaCount = reviewerRows.reduce((sum, row) => sum + (mediaByPost.get(row.id)?.length || 0), 0);
  const mediaReactions = reviewerRows.reduce((sum, row) => sum + (mediaByPost.get(row.id) || [])
    .reduce((assetSum, asset) => assetSum + (reactionCounts.get(`${row.id}\0${asset.url}`) || 0), 0), 0);
  const prior = 3.8;
  const priorWeight = 5;
  const confidenceRating = ((avgRating * ratingCount) + (prior * priorWeight)) / (ratingCount + priorWeight);
  const depth = Math.min(1, Math.log1p(ratingCount + likes * 0.2 + comments * 0.4) / Math.log(30));
  const mediaSignal = Math.min(1, Math.log1p(mediaCount + mediaReactions) / Math.log(16));
  const tour = preferredTour(reviewerRows);
  const venueIdentity = first.venue_key || first.venue;
  return Object.freeze({
    key: archiveShowKey({ artistIdentity, venueIdentity, date: first.date }),
    artist: first.artist,
    artistKey: first.artist_key || null,
    venue: first.venue,
    venueKey: first.venue_key || null,
    place: representativeCity(reviewerRows),
    date: first.date,
    tourKey: archiveTourKey({ artistIdentity, tourIdentity: tour.identity }),
    tourName: tour.label,
    avgRating,
    ratingCount,
    reviewCount: reviewerRows.filter((row) => String(row.review || "").trim()).length,
    likes,
    comments,
    mediaCount,
    cover: coverCandidates(reviewerRows, mediaByPost, reactionCounts),
    rankScore: ((confidenceRating / 5) * 0.7 + depth * 0.2 + mediaSignal * 0.1) * 100,
  });
}

function tourSummary(tourKey, shows) {
  const ratingCount = shows.reduce((sum, show) => sum + show.ratingCount, 0);
  const weighted = shows.reduce((sum, show) => sum + show.avgRating * show.ratingCount, 0);
  const covers = shows.map((show) => show.cover).filter(Boolean).sort((a, b) =>
    Number(b.kind === "image") - Number(a.kind === "image") || b.reactions - a.reactions || b.engagement - a.engagement);
  const dates = shows.map((show) => show.date).sort();
  const labelVotes = new Map();
  shows.forEach((show, index) => {
    const label = tourDisplayVariant(show.tourName) || "Live archive";
    const key = label;
    const vote = labelVotes.get(key) || { label, count: 0, firstIndex: index };
    vote.count += Math.max(1, number(show.ratingCount));
    labelVotes.set(key, vote);
  });
  const name = [...labelVotes.values()].sort((a, b) => tourLabelQuality(b.label) - tourLabelQuality(a.label)
    || b.count - a.count
    || b.label.length - a.label.length
    || a.firstIndex - b.firstIndex || a.label.localeCompare(b.label))[0]?.label
    || "Live archive";
  return Object.freeze({
    key: tourKey,
    name,
    showCount: shows.length,
    reviewCount: shows.reduce((sum, show) => sum + show.reviewCount, 0),
    ratingCount,
    avgRating: ratingCount ? weighted / ratingCount : 0,
    firstDate: dates[0] || null,
    lastDate: dates.at(-1) || null,
    cover: covers[0] || null,
  });
}

function dateProjection(row) {
  return Object.freeze({
    id: row.id,
    artist: row.artist,
    venue: row.venue,
    place: row.place,
    lat: row.lat,
    lng: row.lng,
    date: row.date,
    ticketUrl: projectedTourDateTicketUrl(row),
    soldOut: !!row.sold_out,
    source: row.source || null,
    releaseAt: number(row.release_at),
    createdBy: row.owner_id || "import",
  });
}

export function createArtistArchiveService({
  repository,
  projectMediaState,
  projectReviewUser = (user) => user,
  today = () => new Date().toISOString().slice(0, 10),
}) {
  if (!repository?.findReviewRows || !repository?.findScopedReviewRows || !repository?.countScopedReviewRows
    || typeof projectMediaState !== "function" || typeof projectReviewUser !== "function") {
    throw new TypeError("Artist archive service dependencies are missing");
  }

  function readRows(options) {
    return repository.findReviewRows({ ...options, limit: 2_000 });
  }

  return Object.freeze({
    readArchive({ artistKey = null, name, viewer = null } = {}) {
      const viewerId = viewer?.id || null;
      const artistIdentity = artistKey || name;
      const rows = readRows({ artistKey, name, viewerId });
      const mediaByPost = mediaForRows(rows, viewerId, projectMediaState);
      const reactionCounts = repository.findReactionCounts(
        [...mediaByPost.entries()].flatMap(([postId, assets]) => assets.map((asset) => ({ postId, url: asset.url }))),
        viewerId,
      );
      const grouped = new Map();
      for (const row of rows) {
        const key = archiveShowKey({
          artistIdentity,
          venueIdentity: row.venue_key || row.venue,
          date: row.date,
        });
        const listForShow = grouped.get(key) || [];
        listForShow.push(row);
        grouped.set(key, listForShow);
      }
      const shows = [...grouped.values()].map((group) => showSummary(group, mediaByPost, reactionCounts, artistIdentity));
      const historical = shows.filter((show) => show.date <= today());
      const topShows = [...historical].sort((a, b) => b.rankScore - a.rankScore
        || b.ratingCount - a.ratingCount || b.mediaCount - a.mediaCount || b.date.localeCompare(a.date) || a.key.localeCompare(b.key)).slice(0, 3);
      const byTour = new Map();
      for (const show of historical) {
        const group = byTour.get(show.tourKey) || [];
        group.push(show);
        byTour.set(show.tourKey, group);
      }
      const tours = [...byTour.entries()].map(([key, tourShows]) => tourSummary(key, tourShows))
        .sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || "") || a.name.localeCompare(b.name));
      const upcoming = repository.findUpcomingRows({ name, viewer, today: today() }).map(dateProjection);
      return Object.freeze({
        artist: Object.freeze({ key: artistKey || null, name }),
        topShows,
        tours,
        shows: historical.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key)),
        upcoming,
        totals: Object.freeze({
          shows: historical.length,
          ratings: historical.reduce((sum, show) => sum + show.ratingCount, 0),
          reviews: historical.reduce((sum, show) => sum + show.reviewCount, 0),
          tours: tours.length,
          upcoming: upcoming.length,
        }),
        truncated: rows.length >= 2_000,
      });
    },

    readReviews({ artistKey = null, name, viewerId = null, showKey = null, tourKey = null, cursor = null, limit = 20 } = {}) {
      if (!!showKey === !!tourKey) return null;
      const decodedShow = showKey ? decodeArchiveShowKey(showKey) : null;
      const decodedTour = tourKey ? decodeArchiveTourKey(tourKey) : null;
      if ((showKey && !decodedShow) || (tourKey && !decodedTour)) return null;
      const expectedIdentity = normalizeArchivePart(artistKey || name);
      const decodedIdentity = normalizeArchivePart((decodedShow || decodedTour).artistIdentity);
      if (!expectedIdentity || expectedIdentity !== decodedIdentity) return null;
      const decodedCursor = decodeArchiveReviewCursor(cursor);
      if (decodedCursor === false) return null;
      const requestedLimit = Number(limit);
      const take = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? Math.min(50, requestedLimit) : 20;
      const selection = decodedShow ? { show: decodedShow } : { tour: decodedTour };
      const candidates = repository.findScopedReviewRows({
        artistKey, name, viewerId, ...selection, cursor: decodedCursor, limit: take + 1,
      }).filter((row) => decodedShow ? rowMatchesShow(row, decodedShow) : rowMatchesTour(row, decodedTour));
      const hasMore = candidates.length > take;
      const page = candidates.slice(0, take);
      const mediaByPost = mediaForRows(page, viewerId, projectMediaState);
      return Object.freeze({
        reviews: page.map((row) => reviewProjection(row, mediaByPost.get(row.id) || [], projectReviewUser)),
        nextCursor: hasMore ? archiveReviewCursor(page.at(-1)) : null,
        total: repository.countScopedReviewRows({ artistKey, name, viewerId, ...selection }),
      });
    },
  });
}
