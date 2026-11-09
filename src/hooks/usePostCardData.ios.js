import { useMemo } from "react";
import { useStore } from "../store";
import { resolvePostAuthor } from "../domain/postAuthor.mjs";

// The legacy Store binding stays outside shared presentation. Expose only the
// card's existing read/action contract; do not fetch, subscribe or mutate here.
export default function usePostCardData(log) {
  const { userById, likeInfo, toggleLike, commentsFor, session, userBadges,
    deleteOwnPost, refreshFeed, setPostRepost } = useStore();
  const cachedAuthor = userById?.(log.userId);
  const author = useMemo(() => resolvePostAuthor({ userId: log.userId, cached: cachedAuthor, embedded: log.user }),
    [cachedAuthor, log.user, log.userId]);
  const { count: likeCount, liked } = likeInfo(log.id, log.likes || 0);
  return {
    author, session, badges: userBadges(author), likeCount, liked,
    commentCount: commentsFor(log.id).length || log.comments || 0,
    viewCount: Math.max(0, Math.trunc(Number(log.viewCount) || 0)),
    // Converting clips are private to the author, including cached shared-device cards.
    convertingClips: Array.isArray(log.convertingMedia) && session?.id && log.userId === session.id ? log.convertingMedia : [],
    likeInfo, toggleLike, deleteOwnPost, refreshFeed, setPostRepost,
  };
}
