import { useCallback, useEffect, useState } from "react";
import { discoverPhotosPresentation, discoverPhotosScope } from "./discoverPhotosApi.mjs";
import { loadDiscoverPhotos } from "./discoverPhotosClientApi";

export function useDiscoverPhotos({ accountId = null, region = "Worldwide", city = "" } = {}) {
  const scopeKey = discoverPhotosScope({ accountId, region, city });
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ scopeKey, status: "loading", photos: current?.scopeKey === scopeKey ? current.photos : [] }));
    loadDiscoverPhotos({ region, city, signal: controller.signal }).then((photos) => {
      if (!controller.signal.aborted) setState({ scopeKey, status: "ready", photos });
    }).catch(() => {
      if (!controller.signal.aborted) setState((current) => ({
        scopeKey, status: "error", photos: current?.scopeKey === scopeKey ? current.photos : [],
      }));
    });
    return () => controller.abort();
    // The normalized scope includes account identity, country and explicit city.
    // A new identity never renders the previous viewer's gallery for one frame.
  }, [scopeKey, attempt]);
  return { ...discoverPhotosPresentation(state, scopeKey), retry };
}
