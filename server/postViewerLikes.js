/**
 * Add the requesting member's like state to a bounded page of post rows.
 *
 * Feed projection used to execute one `likes` lookup from `postJson` for every
 * card. Keep the query at the page boundary instead: one indexed read answers
 * the same question for every row, and the canonical projector can still retain
 * its single-row fallback for feature routes that do not yet project in bulk.
 */
export function attachViewerLikes(database, posts, viewerId) {
  const rows = Array.isArray(posts) ? posts : [];
  if (!rows.length) return rows;
  if (!viewerId) return rows.map((row) => ({ ...row, viewer_liked: 0 }));

  const ids = [...new Set(rows
    .map((row) => row?.id)
    .filter((id) => typeof id === "string" && id.length > 0))];
  if (!ids.length) return rows.map((row) => ({ ...row, viewer_liked: 0 }));

  const placeholders = ids.map(() => "?").join(",");
  const liked = new Set(database.prepare(
    `SELECT post_id FROM likes WHERE user_id=? AND post_id IN (${placeholders})`,
  ).all(viewerId, ...ids).map((row) => row.post_id));

  return rows.map((row) => ({
    ...row,
    viewer_liked: liked.has(row?.id) ? 1 : 0,
  }));
}
