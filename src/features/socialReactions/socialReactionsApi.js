import { api } from "../../lib/api";

export const writeCommentLike = (postId,commentId,liked,accountId) => api(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/like`,
  {method:"POST",body:{liked},expectedAccountId:accountId,context:"Saving your comment like"});
export const writePostRepost = (postId,reposted,accountId) => api(`/api/posts/${encodeURIComponent(postId)}/repost`,
  {method:"POST",body:{reposted},expectedAccountId:accountId,context:"Saving your repost"});

export const readFollowingFeed = ({ accountId, cursor = null, signal }) => api(
  `/api/feed?mode=following&limit=30${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
  { expectedAccountId: accountId, signal, silent: true, context: "Loading posts and reposts from people you follow" },
);

const listeners = new Set();
export function notifySocialReactionChange(accountId) { for (const listener of listeners) listener(accountId); }
export function subscribeSocialReactionChanges(listener) { listeners.add(listener); return () => listeners.delete(listener); }
