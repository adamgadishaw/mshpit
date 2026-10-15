import { useCallback, useEffect, useRef, useState } from "react";
import { beginLoadState, createLoadState, isLoadCancellation, projectLoadState, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import { AppError } from "../../lib/diagnostics";
import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";

// One festival read (the list or a page) with loading, error and retry state.
export default function useFestivalResource(scope, load, { enabled = true } = {}) {
  const [resource, setResource] = useState(() => createLoadState());
  const controllerRef = useRef(null);
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = scope;
  const refresh = useCallback(async ({ signal } = {}) => {
    controllerRef.current?.abort();
    if (!enabled || signal?.aborted) return null;
    const controller = new AbortController();
    controllerRef.current = controller;
    const relayAbort = () => controller.abort();
    signal?.addEventListener?.("abort", relayAbort, { once: true });
    setResource((current) => beginLoadState(current, { scope }));
    try {
      const data = await load(controller.signal);
      if (!controller.signal.aborted && activeScopeRef.current === scope && controllerRef.current === controller) {
        setResource(resolveLoadState({ scope, data }));
      }
      return data;
    } catch (error) {
      if (!isLoadCancellation(error, controller.signal) && activeScopeRef.current === scope && controllerRef.current === controller) {
        const appError = error instanceof AppError ? error : new AppError(error?.message, { source: "api", context: "Loading festivals" });
        setResource((current) => rejectLoadState(current, { scope, error: appError }));
      }
      throw error;
    } finally {
      signal?.removeEventListener?.("abort", relayAbort);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [scope, load, enabled]);
  const reload = useCallback(() => refresh().then(commandSuccess, (error) => commandFailure(
    error instanceof AppError ? error : new AppError(error?.message, { source: "api", context: "Loading festivals" }),
  )), [refresh]);
  // A saved plan replaces the page data without a round trip.
  const replace = useCallback((update) => setResource((current) => {
    const data = typeof update === "function" ? update(current.data) : update;
    return resolveLoadState({ scope, data });
  }), [scope]);
  useEffect(() => {
    if (enabled) {
      setResource((current) => beginLoadState(current, { scope }));
      void reload();
    }
    return () => { controllerRef.current?.abort(); };
  }, [scope, enabled, reload]);
  return { ...projectLoadState(resource, scope), reload, refresh, replace };
}
