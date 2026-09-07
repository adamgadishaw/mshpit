import { cleanHandle, isHandle } from "../../domain/validation.mjs";
import { createLoadState, isLoadCancellation, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";

// A single mounted form owns this debounced read. There is no shared cache,
// reservation, background polling, or persisted record of unfinished handles.
export function createHandleAvailabilityController({ read, asError, debounceMs = 450, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let resource = createLoadState();
  let timer = null;
  let active = null;
  let disposed = false;
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  const cancel = () => {
    if (timer !== null) unschedule(timer);
    timer = null;
    active?.abort(); active = null;
  };
  async function request(handle) {
    if (disposed || resource.scope !== handle) return;
    const controller = new AbortController(); active = controller;
    try {
      const result = await read(handle, { signal: controller.signal });
      if (disposed || active !== controller || controller.signal.aborted || resource.scope !== handle) return;
      if (result?.handle !== handle || typeof result.available !== "boolean") throw new TypeError("Handle availability response is invalid.");
      resource = resolveLoadState({ scope: handle, data: result });
    } catch (error) {
      if (disposed || active !== controller || resource.scope !== handle || isLoadCancellation(error, controller.signal)) return;
      resource = rejectLoadState(resource, { scope: handle, error: asError(error), retainData: false });
    } finally {
      if (active === controller) { active = null; if (!disposed) emit(); }
    }
  }
  function setHandle(value, { immediate = false } = {}) {
    cancel();
    const handle = cleanHandle(value);
    resource = createLoadState({ scope: handle, status: isHandle(handle) ? "loading" : "idle" });
    emit();
    if (disposed || !isHandle(handle)) return;
    if (immediate) { void request(handle); return; }
    timer = schedule(() => { timer = null; void request(handle); }, debounceMs);
  }
  return {
    getSnapshot: () => resource,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setHandle,
    retry: () => setHandle(resource.scope, { immediate: true }),
    resume() { disposed = false; },
    dispose() { disposed = true; cancel(); listeners.clear(); },
  };
}
