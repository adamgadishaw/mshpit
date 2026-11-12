import { useCallback, useEffect, useRef, useState } from "react";
import { discoverPhotosPresentation, discoverPhotosScope } from "./discoverPhotosApi.mjs";
import { loadDiscoverPhotos } from "./discoverPhotosClientApi";

export function useDiscoverPhotos({ accountId = null, region = "Worldwide", city = "" } = {}) {
  const scopeKey = discoverPhotosScope({ accountId, region, city });
  const [state, setState] = useState(null);
  const controllerRef = useRef(null);
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const locationRef = useRef({ region, city });
  locationRef.current = { region, city };
  const refresh = useCallback(async ({ signal } = {}) => {
    if (signal?.aborted || activeScopeRef.current !== scopeKey) return null;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const relayAbort = () => controller.abort();
    signal?.addEventListener?.("abort", relayAbort, { once: true });
    const currentRequest = () => !controller.signal.aborted
      && controllerRef.current === controller && activeScopeRef.current === scopeKey;
    setState((current) => ({ scopeKey, status: "loading", photos: current?.scopeKey === scopeKey ? current.photos : [] }));
    try {
      const photos = await loadDiscoverPhotos({ ...locationRef.current, signal: controller.signal });
      if (!currentRequest()) return null;
      setState({ scopeKey, status: "ready", photos });
      return true;
    } catch {
      // architecture: allow-ambiguous-result -- Discover's optional refresh coordinator consumes true/false/null outcomes; this hook owns the visible photo error, and stale/cancelled work is ignored.
      if (!currentRequest()) return null;
      setState((current) => ({
        scopeKey, status: "error", photos: current?.scopeKey === scopeKey ? current.photos : [],
      }));
      return false;
    } finally {
      signal?.removeEventListener?.("abort", relayAbort);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [scopeKey]);
  const retry = useCallback(() => refresh(), [refresh]);
  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
    // The normalized scope includes account identity, country and explicit city.
    // A new identity never renders the previous viewer's gallery for one frame.
  }, [refresh]);
  return { ...discoverPhotosPresentation(state, scopeKey), retry, refresh };
}
