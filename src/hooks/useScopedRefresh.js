import { useCallback, useEffect, useRef, useState } from "react";

import { createScopedRefreshCoordinator } from "../domain/scopedRefresh.mjs";

const IDLE = Object.freeze({ scope: "", refreshing: false });

// Controlled refresh state for one account + screen target. The task always
// receives the current AbortSignal and is awaited before the indicator settles.
// Errors are returned as typed outcomes so a native/web refresh gesture never
// creates an unhandled rejection; screens may project them through `onError`.
export default function useScopedRefresh({ scope, task, enabled = true, onError = null } = {}) {
  const taskRef = useRef(task);
  const errorRef = useRef(onError);
  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) coordinatorRef.current = createScopedRefreshCoordinator(scope);
  taskRef.current = task;
  errorRef.current = onError;
  const [state, setState] = useState(() => ({ ...IDLE, scope }));

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    coordinator.cancel(scope);
    setState({ scope, refreshing: false });
    return () => coordinator.cancel(scope);
  }, [scope]);

  const refresh = useCallback(async () => {
    if (!enabled || typeof taskRef.current !== "function") return { ok: false, disabled: true };
    const coordinator = coordinatorRef.current;
    const request = coordinator.start(scope);
    setState({ scope, refreshing: true });
    try {
      const value = await taskRef.current({ signal: request.controller.signal, scope });
      if (!coordinator.isCurrent(request, scope)) return { ok: false, stale: true };
      return { ok: true, value };
    } catch (error) {
      if (request.controller.signal.aborted || error?.name === "AbortError") {
        return { ok: false, aborted: true };
      }
      if (coordinator.isCurrent(request, scope) && typeof errorRef.current === "function") {
        errorRef.current(error);
      }
      return { ok: false, error };
    } finally {
      if (coordinator.settle(request)) setState({ scope, refreshing: false });
    }
  }, [enabled, scope]);

  return {
    refresh,
    refreshing: state.scope === scope && state.refreshing,
  };
}
