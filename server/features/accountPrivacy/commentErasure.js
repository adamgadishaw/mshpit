// Account erasure physically removes authored comments. Reconnect another
// member's replies through that erased chain without retaining its content or
// attribution. A surviving ancestor remains part of the chain, including its
// visibility/block restrictions; only a genuine erased root becomes NULL.
export function reparentRepliesForAccountErasure(db, userId) {
  if (!db.isTransaction) throw new TypeError("Comment erasure requires an active transaction");
  const erased = new Map(db.prepare("SELECT id,post_id,parent_id FROM comments WHERE user_id=?")
    .all(userId).map((row) => [row.id, row]));
  if (!erased.size) return;

  // Resolve from the original graph before writing any links. Cache shared
  // chains so an account's many nested comments do not require quadratic walks.
  const replacements = new Map();
  const replacementFor = (parentId, postId) => {
    const path = new Set();
    let replacement;
    while (true) {
      if (parentId === null || !erased.has(parentId)) {
        replacement = parentId;
        break;
      }
      const ancestor = erased.get(parentId);
      if (ancestor.post_id !== postId || path.has(parentId)) break;
      if (replacements.has(parentId)) {
        replacement = replacements.get(parentId);
        break;
      }
      path.add(parentId);
      parentId = ancestor.parent_id;
    }
    for (const id of path) replacements.set(id, replacement);
    return replacement;
  };
  // There is no parent_id index. Joining each erased parent to its replies
  // would rescan the same thread for every erased comment while holding the
  // writer lock. Read each affected post once through the existing post index.
  const repliesInPost = db.prepare(`SELECT c.id,c.post_id,c.parent_id FROM comments c
    JOIN posts p ON p.id=c.post_id
    WHERE c.post_id=? AND c.user_id<>? AND p.user_id<>?`);
  const updates = [];
  for (const postId of new Set([...erased.values()].map((row) => row.post_id))) {
    for (const reply of repliesInPost.all(postId, userId, userId)) {
      if (erased.get(reply.parent_id)?.post_id !== postId) continue;
      updates.push({ id: reply.id, parentId: replacementFor(reply.parent_id, postId) });
    }
  }
  const update = db.prepare("UPDATE comments SET parent_id=? WHERE id=?");
  for (const reply of updates) {
    // Existing malformed ancestry must stay unavailable, never become a valid
    // root. Missing surviving parents retain their invalid link; cycles or
    // cross-post erased chains retain theirs for the existing fail-closed reads.
    if (reply.parentId !== undefined) update.run(reply.parentId, reply.id);
  }
}
