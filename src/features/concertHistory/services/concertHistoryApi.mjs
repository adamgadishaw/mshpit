import { api } from "../../../lib/api";
import { concertHistoryRequest } from "../concertHistoryRequest.mjs";

export async function requestConcertHistoryPage({ accountId = null, targetId, before = null, signal }) {
  const request = concertHistoryRequest({ accountId, targetId, before });
  return api(request.path, { expectedAccountId: request.expectedAccountId, signal, silent: true, context: "Loading concert history" });
}

export async function readConcertHistoryPost(postId, { accountId = null, signal } = {}) {
  const result = await api(`/api/posts/${encodeURIComponent(postId)}`, {
    expectedAccountId: accountId || null, signal, silent: true, context: "Opening a concert review",
  });
  return result?.post;
}
