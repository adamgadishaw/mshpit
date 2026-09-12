import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createConcertHistoryResource } from "./concertHistoryLoader.mjs";
import { requestConcertHistoryPage, readConcertHistoryPost } from "./services/concertHistoryApi.mjs";

export function useConcertHistory({ accountId = null, authEpoch = 0, targetId, enabled = true, mapVisible = true }) {
  const resource = useMemo(() => createConcertHistoryResource({
    requestPage: ({ before, signal }) => requestConcertHistoryPage({ accountId, targetId, before, signal }),
    readPost: (postId, { signal }) => readConcertHistoryPost(postId, { accountId, signal }),
  }), [accountId, authEpoch, targetId, enabled, mapVisible]);
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => {
    resource.activate();
    if (enabled && targetId) void resource.loadMore();
    return () => resource.dispose();
  }, [resource, enabled, targetId]);
  return { ...snapshot, loadMore: resource.loadMore, retry: resource.retry, refresh: resource.refresh, removePost: resource.removePost, openConcert: resource.openConcert };
}
