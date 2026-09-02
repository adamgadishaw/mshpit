import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginLoadState,
  createLoadState,
  isLoadCancellation,
  rejectLoadState,
  resolveLoadState,
} from "../../domain/loadState.mjs";
import {
  artistRecommendationScope,
  EMPTY_ARTIST_RECOMMENDATIONS,
  projectArtistRecommendationResource,
} from "./artistRecommendationState.mjs";
import { readArtistRecommendations } from "./services/artistRecommendationApi.mjs";

export function useArtistRecommendations({ accountId = null, enabled = true, limit = 6, profileRevision = 0 } = {}) {
  const scope = artistRecommendationScope(accountId, profileRevision);
  const [resource, setResource] = useState(() => createLoadState({ data: EMPTY_ARTIST_RECOMMENDATIONS }));
  const resourceRef = useRef(resource);
  const activeRequest = useRef(null);
  const scopeRef = useRef(scope);
  resourceRef.current = resource;
  scopeRef.current = scope;

  const run = useCallback(async ({ signal: externalSignal } = {}) => {
    activeRequest.current?.controller.abort();
    if (!enabled || !accountId) {
      const next = resolveLoadState({ scope, data: EMPTY_ARTIST_RECOMMENDATIONS });
      resourceRef.current = next;
      setResource(next);
      return next;
    }
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (externalSignal?.aborted) relayAbort();
    else externalSignal?.addEventListener?.("abort", relayAbort, { once: true });
    const request = { accountId, controller, scope };
    activeRequest.current = request;
    const loading = beginLoadState(resourceRef.current, {
      scope,
      emptyData: EMPTY_ARTIST_RECOMMENDATIONS,
      retainData: true,
    });
    resourceRef.current = loading;
    setResource(loading);
    try {
      const data = await readArtistRecommendations({ accountId, limit, signal: controller.signal });
      if (controller.signal.aborted || activeRequest.current !== request || scopeRef.current !== scope) return resourceRef.current;
      const next = resolveLoadState({ scope, data });
      resourceRef.current = next;
      setResource(next);
      return next;
    } catch (error) {
      if (isLoadCancellation(error, controller.signal) || activeRequest.current !== request || scopeRef.current !== scope) {
        return resourceRef.current;
      }
      const next = rejectLoadState(resourceRef.current, {
        scope,
        error,
        emptyData: EMPTY_ARTIST_RECOMMENDATIONS,
        retainData: true,
      });
      resourceRef.current = next;
      setResource(next);
      return next;
    } finally {
      externalSignal?.removeEventListener?.("abort", relayAbort);
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }, [accountId, enabled, limit, scope]);

  useEffect(() => {
    void run();
    return () => {
      if (activeRequest.current?.scope === scope) {
        activeRequest.current.controller.abort();
        activeRequest.current = null;
      }
    };
  }, [run, scope]);

  const refresh = useCallback(async ({ signal } = {}) => {
    const next = await run({ signal });
    if (signal?.aborted) throw Object.assign(new Error("Artist recommendation refresh was cancelled."), { name: "AbortError" });
    if (next.status === "error") throw next.error;
    return next.data;
  }, [run]);

  return {
    resource: projectArtistRecommendationResource(resource, accountId, profileRevision),
    refresh,
    retry: run,
  };
}
