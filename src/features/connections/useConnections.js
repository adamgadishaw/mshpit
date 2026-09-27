import { useEffect, useRef, useState } from "react";
import { fetchConnections } from "../../lib/connectionsApi";
import { connectionFailure, emptyConnectionList, EMPTY_CONNECTIONS, mergeConnectionRows, visibleConnectionList } from "../../domain/connectionList.mjs";
import { beginLoadState, resolveLoadState } from "../../domain/loadState.mjs";

export function useConnections({ scope, userId, kind, query, filter, accountId }) {
  const [state, setState] = useState(() => emptyConnectionList(scope));
  const current = useRef({ scope, request: 0, controller: null });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const load = async (cursor = null, { signal } = {}) => {
    if (!userId || signal?.aborted) return;
    current.current.controller?.abort();
    const request = { scope, request: current.current.request + 1, controller: new AbortController() };
    current.current = request;
    const abort = () => request.controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    setState((previous) => beginLoadState(previous, { scope, emptyData: EMPTY_CONNECTIONS }));
    try {
      const result = await fetchConnections(userId, kind, { query, filter, cursor, accountId, signal: request.controller.signal });
      if (request.controller.signal.aborted || current.current !== request || scopeRef.current !== scope) return;
      const rows = (kind === "artists" ? result.artists : result.users) || [];
      setState((previous) => resolveLoadState({ scope, data: {
        rows: cursor ? mergeConnectionRows(visibleConnectionList(previous, scope).data.rows, rows) : rows,
        nextCursor: result.nextCursor || null } }));
    } catch (error) {
      if (request.controller.signal.aborted || current.current !== request || scopeRef.current !== scope) return;
      setState((previous) => connectionFailure(previous, scope, error));
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  };
  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => { void load(); }, query ? 250 : 0);
    return () => { clearTimeout(timer); current.current.controller?.abort(); };
    // scope includes every request and privacy input; no stale list flashes on change.
  }, [scope]);
  const view = visibleConnectionList(state, scope);
  const error = view.error ? [401, 403, 404].includes(Number(view.error.status)) ? "This connection list isn't available." : "This list could not load. Try again." : "";
  return { ...view, ...view.data, error, refresh: (options) => load(null, options), more: () => view.data.nextCursor && !["loading", "refreshing"].includes(view.status) ? load(view.data.nextCursor) : Promise.resolve() };
}
