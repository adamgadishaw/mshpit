// Recipient-owned tag controls live with the post-tag feature rather than in
// the legacy API route monolith. Runtime/auth dependencies stay explicit.
export function postTagRoutes({ database, requireUser, limit, atomicWrite, ApiError, normalizeTaggedUserIds, now }) {
  const postById = database.prepare("SELECT id,user_id,tagged_user_ids,removed,created_at,updated_at FROM posts WHERE id=?");
  const existingRejection = database.prepare("SELECT 1 FROM post_tag_rejections WHERE post_id=? AND user_id=?");
  const rejectTag = database.prepare(`INSERT OR IGNORE INTO post_tag_rejections
    (post_id,user_id,created_at) VALUES (?,?,?)`);
  const updateTags = database.prepare(`UPDATE posts SET tagged_user_ids=?,updated_at=?
    WHERE id=? AND removed=0 AND COALESCE(updated_at,created_at)=?`);

  return {
    "DELETE /api/posts/:id/tags/me": (ctx) => {
      const user = requireUser(ctx);
      limit(ctx, "post-tag-self-remove", 60, 60 * 60 * 1000);
      const post = postById.get(ctx.params.id);
      if (!post || post.removed) {
        throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
      }
      let version = post.updated_at || post.created_at;

      atomicWrite(() => {
        // Re-read under the same immediate write transaction as the rejection
        // and JSON update. A concurrent block/account scrub must not be undone
        // by writing a tag list captured before the lock was acquired.
        const transactionPost = postById.get(post.id);
        if (!transactionPost || transactionPost.removed) {
          throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
        }
        const taggedUserIds = normalizeTaggedUserIds((() => {
          try { return JSON.parse(transactionPost.tagged_user_ids || "[]"); }
          catch { return []; }
        })()) || [];
        const nextTaggedUserIds = taggedUserIds.filter((id) => id !== user.id);
        const alreadyRejected = !!existingRejection.get(post.id, user.id);
        if (nextTaggedUserIds.length === taggedUserIds.length && !alreadyRejected) {
          // Keep an untaggable or guessed post indistinguishable from a missing
          // one, and do not let unrelated accounts pre-seed rejection rows.
          throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
        }
        const currentVersion = transactionPost.updated_at || transactionPost.created_at;
        version = currentVersion;
        // Recording this even after an idempotent retry makes the recipient's
        // refusal durable if the first response was lost after the JSON update.
        rejectTag.run(post.id, user.id, now());
        if (nextTaggedUserIds.length === taggedUserIds.length) return;
        version = Math.max(now(), currentVersion + 1);
        const updated = updateTags.run(JSON.stringify(nextTaggedUserIds), version, post.id, currentVersion);
        if (Number(updated.changes || 0) !== 1) {
          throw new ApiError(409, "That post changed. Refresh and try removing your tag again.", "CONFLICT");
        }
      });

      // The canonical post projection is viewer-filtered, but the stored JSON is
      // not. Never echo the remaining ids here: co-tags hidden by a block or an
      // inactive account would otherwise become visible through this mutation.
      // The client needs only the committed version to reconcile its own chip.
      return { ok: true, id: post.id, version };
    },
  };
}
