import { useEffect, useState } from "react";
import { subscribeAuthorBadgeChanges } from "../domain/authorBadgeChanges.mjs";
import { reconcilePostAuthorBadges } from "../domain/postBadgeBundle.mjs";

// A navigation-held post may never enter the feed cache. Apply confirmed author
// changes while it is mounted, scoped to the viewer and exact source snapshot.
export function usePostAuthorBadges(post, accountId = null) {
  const [confirmed, setConfirmed] = useState(null);
  useEffect(() => subscribeAuthorBadgeChanges(event => {
    if ((event.accountId || null) !== (accountId || null) || event.user?.id !== post?.userId) return;
    setConfirmed({ source: post, accountId, post: reconcilePostAuthorBadges([post], event.user)[0] });
  }), [post, accountId]);
  return confirmed?.source === post && confirmed.accountId === accountId ? confirmed.post : post;
}
