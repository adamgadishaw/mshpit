import { useCallback, useEffect, useRef, useState } from "react";
import { beginLoadState, createLoadState, isLoadCancellation, projectLoadState, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import { AppError } from "../../lib/diagnostics";
import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";

export default function useCityResource(scope, load, { enabled = true, delay = 0 } = {}) {
  const [resource, setResource] = useState(() => createLoadState());
  const controllerRef = useRef(null);
  const timerRef = useRef(null);
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = scope;
  const refresh = useCallback(async ({ signal } = {}) => {
    clearTimeout(timerRef.current);
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
        const appError = error instanceof AppError ? error : new AppError(error?.message, { source: "api", context: "Loading a city page" });
        setResource((current) => rejectLoadState(current, { scope, error: appError }));
      }
      throw error;
    } finally {
      signal?.removeEventListener?.("abort", relayAbort);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [scope, load, enabled]);
  // Button retries report their result without leaking a rejected event-handler promise.
  // Pull refresh uses the rejecting refresh() operation so its coordinator can await failures.
  const reload = useCallback(() => refresh().then(commandSuccess, (error) => commandFailure(
    error instanceof AppError ? error : new AppError(error?.message, { source: "api", context: "Loading a city page" }),
  )), [refresh]);
  useEffect(() => {
    if (enabled) {
      setResource((current) => beginLoadState(current, { scope }));
      timerRef.current = setTimeout(reload, delay);
    }
    return () => { clearTimeout(timerRef.current); controllerRef.current?.abort(); };
  }, [scope, enabled, delay, reload]);
  return { ...projectLoadState(resource, scope), reload, refresh };
}
