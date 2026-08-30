import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginLoadState,
  createLoadState,
  isLoadCancellation,
  projectLoadState,
  rejectLoadState,
  resolveLoadState,
} from "../../domain/loadState.mjs";
import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";
import {
  readArtistDeathWatch,
  reviewArtistDeathCandidate,
  runArtistDeathWatch,
  setArtistDeathWatchEnabled,
} from "./artistDeathWatchApi.mjs";

const EMPTY = Object.freeze({ settings: null, counts: { pending: 0, dismissed: 0, memorialized: 0 }, candidates: [], eligibleArtists: 0 });

export default function useArtistDeathWatchAdmin({ accountId, enabled }) {
  const scope = enabled && accountId ? `artist-death-watch:${accountId}` : null;
  const [resource, setResource] = useState(() => createLoadState({ data: EMPTY }));
  const [revision, setRevision] = useState(0);
  const actionRef = useRef(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    if (!enabled || !accountId) {
      setResource(resolveLoadState({ scope, data: EMPTY }));
      return undefined;
    }
    const controller = new AbortController();
    setResource((current) => beginLoadState(current, { scope, emptyData: EMPTY }));
    readArtistDeathWatch({ accountId, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted && scopeRef.current === scope) {
          setResource((current) => current.scope === scope ? resolveLoadState({ scope, data }) : current);
        }
      })
      .catch((error) => {
        if (!isLoadCancellation(error, controller.signal) && scopeRef.current === scope) {
          setResource((current) => current.scope === scope
            ? rejectLoadState(current, { scope, error, emptyData: EMPTY })
            : current);
        }
      });
    return () => controller.abort();
  }, [accountId, enabled, revision, scope]);

  useEffect(() => () => actionRef.current?.abort(), []);

  const action = useCallback(async (work) => {
    if (!accountId || !scope) return commandSuccess({ status: "unavailable" });
    if (actionRef.current) return commandSuccess({ status: "busy" });
    const controller = new AbortController();
    actionRef.current = controller;
    setResource((current) => beginLoadState(current, { scope, emptyData: EMPTY }));
    try {
      const result = await work(controller.signal);
      if (!controller.signal.aborted && scopeRef.current === scope) setRevision((current) => current + 1);
      return commandSuccess(result);
    } catch (error) {
      if (isLoadCancellation(error, controller.signal) || scopeRef.current !== scope) {
        return commandSuccess({ status: "cancelled" });
      }
      setResource((current) => current.scope === scope
        ? rejectLoadState(current, { scope, error, emptyData: EMPTY })
        : current);
      return commandFailure(error);
    } finally {
      if (actionRef.current === controller) actionRef.current = null;
    }
  }, [accountId, scope]);

  const projected = projectLoadState(resource, scope, EMPTY);
  return {
    data: projected.data || EMPTY,
    loading: projected.status === "loading" || projected.status === "refreshing",
    error: projected.error,
    reload: useCallback(() => setRevision((current) => current + 1), []),
    setEnabled: useCallback((value) => action((signal) => setArtistDeathWatchEnabled(value, { accountId, signal })), [accountId, action]),
    runNow: useCallback(() => action((signal) => runArtistDeathWatch({ accountId, signal })), [accountId, action]),
    review: useCallback((artistKey, status) => action((signal) => reviewArtistDeathCandidate(artistKey, status, { accountId, signal })), [accountId, action]),
  };
}
