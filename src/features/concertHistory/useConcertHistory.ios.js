import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { concertHistoryResponse } from "./concertHistoryRequest.mjs";
import { createConcertHistoryResource } from "./concertHistoryLoader.mjs";
import { requestConcertHistoryPage, readConcertHistoryPost } from "./services/concertHistoryApi.mjs";
import { createConcertHistoryPrivacyScope } from "./services/concertHistoryPrivacy.ios.js";
import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";

export function useConcertHistory({ accountId = null, authEpoch = 0, targetId, enabled = true, mapVisible = true }) {
  const presentation = useIOSDetailPresentation();
  const { active, current, guard } = presentation;
  const canAct = presentation.canAct || current;
  const actionAdmission = useRef(canAct);
  actionAdmission.current = canAct;
  const privacy = useMemo(() => createConcertHistoryPrivacyScope({ accountId, authEpoch, targetId }), [accountId, authEpoch, targetId]);
  useSyncExternalStore(privacy.subscribe, privacy.getSnapshot, privacy.getSnapshot);
  const receipt = useMemo(() => ({ revision: privacy.getSnapshot() }), [privacy, enabled, mapVisible]);
  const resource = useMemo(() => {
    let batch = null;
    return createConcertHistoryResource({
    requestPage: async ({ before, signal }) => {
      if (batch?.signal !== signal) batch = { signal, canAct: actionAdmission.current };
      if (!batch.canAct() || (before && receipt.revision !== privacy.getSnapshot())) {
        throw Object.assign(new Error("Concert history admission expired."), { name: "AbortError" });
      }
      const result = await privacy.read(async () => {
        const payload = await requestConcertHistoryPage({ accountId, targetId, before, signal });
        concertHistoryResponse(payload);
        return payload;
      }, { signal, recover: !before });
      if (!result.current()) throw Object.assign(new Error("Concert history read expired."), { name: "AbortError" });
      receipt.revision = result.revision;
      return result.payload;
    },
    readPost: async (postId, { signal }) => {
      const result = await privacy.read(() => readConcertHistoryPost(postId, { accountId, signal }), { signal });
      if (!result.current()) throw Object.assign(new Error("Concert review read expired."), { name: "AbortError" });
      return result.payload;
    },
  });
  }, [privacy, receipt, enabled, mapVisible]);
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => {
    resource.activate();
    return () => resource.dispose();
  }, [resource]);
  useEffect(() => {
    if (!active || !canAct()) { resource.pause(); return; }
    if (enabled && targetId && !privacy.denied() && resource.getSnapshot().status === "loading") void resource.loadMore();
    return () => resource.pause();
  }, [resource, active, current, enabled, targetId]);
  const denied = privacy.denied() || receipt.revision !== privacy.getSnapshot();
  return { ...snapshot, ...(denied ? { concerts: [], nextCursor: null, complete: false, mapVisible: false,
    status: "error", loadingMore: false, openingId: null, error: "This concert history is no longer available." } : {}),
    loadMore: guard(() => denied ? resource.refresh() : resource.loadMore()),
    retry: guard(() => denied ? resource.refresh() : resource.retry()), refresh: guard(resource.refresh),
    removePost: resource.removePost, openConcert: guard((row, onOpen) => {
      const revision = receipt.revision;
      if (privacy.denied() || revision !== privacy.getSnapshot()) return;
      return resource.openConcert(row, post => {
        if (canAct() && !privacy.denied() && revision === privacy.getSnapshot()) onOpen?.(post);
      });
    }) };
}
