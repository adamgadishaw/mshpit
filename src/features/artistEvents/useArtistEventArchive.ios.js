import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { getIOSDetailPrivacySnapshot, subscribeIOSDetailPrivacy, invalidateIOSDetailPrivacy } from "../../lib/iosDetailPrivacy";
import {
  beginLoadState,
  createLoadState,
  isLoadCancellation,
  rejectLoadState,
  resolveLoadState,
} from "../../domain/loadState.mjs";
import { artistEventIdentity } from "../../domain/artistEventArchive.mjs";
import {
  artistEventArchiveScope,
  artistEventReviewsScope,
  EMPTY_ARTIST_EVENT_ARCHIVE,
  EMPTY_ARTIST_EVENT_REVIEWS,
  mergeArtistEventReviewPage,
  projectArtistEventArchive,
  projectArtistEventReviews,
} from "./artistEventState.mjs";
import { readArtistEventArchive, readArtistEventReviews } from "./services/artistEventApi.mjs";

export function useArtistEventArchive({ accountId = null, name = null, artistKey = null, enabled = true, presentation = null } = {}) {
  const inherited = useIOSDetailPresentation();
  const { active, current, guard, token } = presentation || inherited;
  const identity = artistEventIdentity({ artistKey, name });
  const scope = artistEventArchiveScope({ accountId, artistKey, name });
  const [resource, setResource] = useState(() => createLoadState({ data: EMPTY_ARTIST_EVENT_ARCHIVE }));
  const resourceRef = useRef(resource);
  resourceRef.current = resource;
  const requestSequence = useRef(0);
  const activeRequest = useRef(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const cancelRequest = useCallback(() => {
    const request = activeRequest.current;
    if (!request) return;
    activeRequest.current = null;
    request.controller.abort();
    if (request.before && resourceRef.current.scope === request.scope) {
      resourceRef.current = request.before;
      setResource(request.before);
    }
  }, []);


  const runArchive = useCallback(async ({ signal: externalSignal } = {}) => {
    if (!active || !current()) return resourceRef.current;
    cancelRequest();
    const sequence = ++requestSequence.current;
    if (!enabled || !identity) {
      // Not requested is not a successful empty response. Keep updatedAt null
      // so the first failure after opening Shows remains an initial-load error.
      const next = createLoadState({ scope, data: EMPTY_ARTIST_EVENT_ARCHIVE });
      resourceRef.current = next;
      setResource(next);
      activeRequest.current = null;
      return next;
    }

    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (externalSignal?.aborted) relayAbort();
    else externalSignal?.addEventListener?.("abort", relayAbort, { once: true });
    const request = { controller, scope, sequence, before: resourceRef.current };
    activeRequest.current = request;
    const loading = beginLoadState(resourceRef.current, { scope, emptyData: EMPTY_ARTIST_EVENT_ARCHIVE });
    resourceRef.current = loading;
    setResource(loading);
    try {
      const archive = await readArtistEventArchive({ accountId, name, artistKey, signal: controller.signal });
      if (!current() || controller.signal.aborted || scopeRef.current !== scope || activeRequest.current !== request) {
        return resourceRef.current;
      }
      const next = resolveLoadState({ scope, data: archive });
      resourceRef.current = next;
      setResource(next);
      return next;
    } catch (error) {
      if (!current() || isLoadCancellation(error, controller.signal)
        || scopeRef.current !== scope
        || activeRequest.current !== request) {
        return resourceRef.current;
      }
      const next = rejectLoadState(resourceRef.current, {
        scope,
        error,
        emptyData: EMPTY_ARTIST_EVENT_ARCHIVE,
      });
      resourceRef.current = next;
      setResource(next);
      return next;
    } finally {
      externalSignal?.removeEventListener?.("abort", relayAbort);
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }, [accountId, artistKey, enabled, identity, name, scope, active, token]);

  useEffect(() => {
    if (!enabled || resourceRef.current.scope !== scope || resourceRef.current.updatedAt == null) void runArchive();
    return () => {
      if (activeRequest.current?.scope === scope) cancelRequest();
    };
  }, [runArchive, scope]);

  const refresh = useCallback(async ({ signal } = {}) => {
    const next = await runArchive({ signal });
    if (signal?.aborted) {
      throw Object.assign(new Error("Artist archive refresh was cancelled."), { name: "AbortError" });
    }
    if (next.status === "error") throw next.error;
    return next.data;
  }, [runArchive]);

  const projected = projectArtistEventArchive(resource, { accountId, artistKey, name });
  return {
    // Render pending immediately on enable, before the request effect runs.
    resource: enabled && identity && projected.status === "idle"
      ? { ...projected, status: "loading" }
      : projected,
    reload: guard(runArchive),
    refresh,
  };
}

export function useArtistEventReviews({
  accountId = null,
  name = null,
  artistKey = null,
  showKey = null,
  tourKey = null,
  limit = 30,
  enabled = true,
  presentation = null,
} = {}) {
  const inherited = useIOSDetailPresentation();
  const owner = presentation || inherited;
  const { active, current, guard, token } = owner;
  const canAct = owner.canAct || current;
  const commandToken = owner.commandToken || token;
  const privacyRevision = useSyncExternalStore(subscribeIOSDetailPrivacy, getIOSDetailPrivacySnapshot, getIOSDetailPrivacySnapshot);
  const identity = artistEventIdentity({ artistKey, name });
  const selection = showKey || tourKey || "";
  const options = { accountId, name, artistKey, showKey, tourKey };
  const scope = artistEventReviewsScope(options);
  const [resource, setResource] = useState(() => createLoadState({ data: EMPTY_ARTIST_EVENT_REVIEWS }));
  const resourceRef = useRef(resource);
  resourceRef.current = resource;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const activeRequest = useRef(null);
  const [revision, setRevision] = useState(0);
  const settledRead = useRef(null);
  const readKey = JSON.stringify([scope, revision, enabled, limit]);
  const commit = useCallback(next => {
    resourceRef.current = next;
    setResource(next);
    return next;
  }, []);
  const cancelRequest = useCallback(() => {
    const request = activeRequest.current;
    if (!request) return;
    activeRequest.current = null;
    request.controller.abort();
    if (request.before && resourceRef.current.scope === request.scope) commit(request.before);
  }, [commit]);

  const run = useCallback(async ({ mode = "replace", signal: externalSignal } = {}) => {
    if (!active || !current()) return { cancelled: true };
    const snapshot = projectArtistEventReviews(resourceRef.current, options);
    const proof = getIOSDetailPrivacySnapshot();
    const hasProof = snapshot.privacyRevision === proof && !snapshot.privacyWithdrawn;
    const data = hasProof ? snapshot.data : EMPTY_ARTIST_EVENT_REVIEWS;
    if (mode === "append" && (!enabled || !identity || !selection || !data.nextCursor || data.loadingMore || activeRequest.current)) return snapshot;
    cancelRequest();
    if (!enabled || !identity || !selection) {
      settledRead.current = readKey;
      return commit({ ...resolveLoadState({ scope, data: EMPTY_ARTIST_EVENT_REVIEWS }), privacyRevision: proof });
    }

    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (externalSignal?.aborted) relayAbort();
    else externalSignal?.addEventListener?.("abort", relayAbort, { once: true });
    const request = { controller, scope, before: resourceRef.current };
    activeRequest.current = request;
    const owns = () => current() && !controller.signal.aborted && scopeRef.current === scope && activeRequest.current === request;
    const loading = beginLoadState(snapshot, { scope, emptyData: EMPTY_ARTIST_EVENT_REVIEWS, retainData: hasProof });
    commit({ ...loading, privacyRevision: proof, ...(mode === "append" ? { data: { ...data, loadingMore: true } } : {}) });
    const withdraw = () => {
      settledRead.current = readKey;
      return commit({ ...createLoadState({ scope, data: EMPTY_ARTIST_EVENT_REVIEWS }), privacyRevision: getIOSDetailPrivacySnapshot(), privacyWithdrawn: true });
    };
    try {
      const page = await readArtistEventReviews({ ...options, ...(mode === "append" ? { cursor: data.nextCursor } : {}), limit, signal: controller.signal });
      if (!owns()) return { cancelled: true };
      // A request accepted under old access cannot restore private rows after a
      // sibling denial, account privacy change, or media withdrawal.
      if (getIOSDetailPrivacySnapshot() !== proof) return withdraw();
      const reviews = mode === "append" ? mergeArtistEventReviewPage(data.reviews, page.reviews) : page.reviews;
      const removed = mode !== "append" && hasProof && data.reviews?.some(row => !reviews?.some(next => next.id === row.id));
      if (removed) invalidateIOSDetailPrivacy();
      settledRead.current = readKey;
      return commit({
        ...resolveLoadState({ scope, data: { ...page, reviews, loadingMore: false } }),
        privacyRevision: getIOSDetailPrivacySnapshot(),
      });
    } catch (error) {
      if (!owns() || isLoadCancellation(error, controller.signal)) return { cancelled: true };
      const denied = [403, 404, 410].includes(error?.status);
      const proofCurrent = getIOSDetailPrivacySnapshot() === proof;
      // Denials may settle after another resource already retired this proof,
      // but publish at most once for the captured proof. Never auto-refetch.
      if (denied && proofCurrent) invalidateIOSDetailPrivacy();
      if (!proofCurrent && !denied) return withdraw();
      settledRead.current = readKey;
      const rejected = rejectLoadState(resourceRef.current, {
        scope, error, emptyData: EMPTY_ARTIST_EVENT_REVIEWS, retainData: !denied && hasProof,
      });
      return commit({ ...rejected,
        data: denied ? EMPTY_ARTIST_EVENT_REVIEWS : { ...rejected.data, loadingMore: false },
        privacyRevision: getIOSDetailPrivacySnapshot(), privacyWithdrawn: denied,
      });
    } finally {
      externalSignal?.removeEventListener?.("abort", relayAbort);
      if (activeRequest.current === request) activeRequest.current = null;
    }
    // Privacy revisions deliberately do not start reads. A fresh user command
    // captures the current proof, while the original read admission stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, artistKey, enabled, identity, limit, name, readKey, scope, selection, showKey, tourKey, active, token, cancelRequest, commit]);

  useLayoutEffect(() => {
    if (!active || !current()) return undefined;
    if (!(settledRead.current === readKey && resourceRef.current.scope === scope)) void run();
    return cancelRequest;
  }, [run, readKey, scope, active, token, cancelRequest]);
  // Also cancel manual pagination started after the initial read settled.
  useLayoutEffect(() => cancelRequest, [active, token, cancelRequest]);

  const refresh = useCallback(async ({ signal } = {}) => {
    if (!active || !canAct()) throw Object.assign(new Error("Artist review refresh was cancelled."), { name: "AbortError" });
    const next = await run({ signal });
    if (next.cancelled || signal?.aborted || next.privacyWithdrawn && next.status !== "error") {
      throw Object.assign(new Error("Artist review refresh was cancelled."), { name: "AbortError" });
    }
    if (next.status === "error") throw next.error;
    return next.data;
  }, [run, active, commandToken]);
  const loadMore = useCallback(() => {
    if (!active || !canAct()) return Promise.resolve(resourceRef.current);
    return run({ mode: "append" });
  }, [run, active, commandToken]);
  const projected = projectArtistEventReviews(resource, options);
  const proofRevoked = projected.scope === resource.scope && resource.privacyRevision != null && resource.privacyRevision !== privacyRevision;
  return {
    resource: proofRevoked ? {
      ...createLoadState({ scope, data: EMPTY_ARTIST_EVENT_REVIEWS }), privacyWithdrawn: true,
    } : projected,
    reload: guard(useCallback(() => setRevision(value => value + 1), [])),
    refresh,
    loadMore,
  };
}
