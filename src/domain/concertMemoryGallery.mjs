import { archiveReviewMedia } from "./artistEventArchive.mjs";
import { mediaDisplayItems, mediaDisplayUri } from "./postMediaDisplay.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";

function appendUnique(output, seen, item, limit) {
  if (output.length >= limit || !item) return;
  const uri = text(mediaDisplayUri(item));
  if (!uri || seen.has(uri)) return;
  seen.add(uri);
  output.push(item);
}

/**
 * Owner media is always first. Community rows come only from the privacy-
 * filtered exact-show endpoint and are bounded before reaching the renderer.
 */
export function concertMemoryGallery(log, reviews, { limit = 12 } = {}) {
  const maximum = Math.max(1, Math.min(24, Math.trunc(Number(limit) || 12)));
  const output = [];
  const seen = new Set();
  const ownerLog = log && typeof log === "object" && !Array.isArray(log) ? log : {};

  for (const item of mediaDisplayItems(ownerLog)) {
    appendUnique(output, seen, {
      ...item,
      by: "Your post",
      postId: text(ownerLog.id) || null,
      ownerMedia: true,
    }, maximum);
  }

  for (const review of Array.isArray(reviews) ? reviews : []) {
    for (const item of archiveReviewMedia(review)) {
      appendUnique(output, seen, { ...item, ownerMedia: text(review?.id) === text(ownerLog.id) }, maximum);
    }
  }
  return output;
}
