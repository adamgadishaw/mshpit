import { useEffect, useRef, useState } from "react";
import { readFollowingFeed, readLocalFeed, subscribeSocialReactionChanges } from "./socialReactionsApi";
import { beginLoadState, createLoadState, isLoadCancellation, projectLoadState, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import { toAppError } from "../../lib/diagnostics";

import { subscribeAuthorBadgeChanges } from "../../domain/authorBadgeChanges.mjs";
import { reconcilePostAuthorBadges } from "../../domain/postBadgeBundle.mjs";

const emptyFeed = () => ({ posts: [], nextCursor: null });
export default function useFollowingFeed({ accountId, enabled, privacyScope, retainOnInactive = true, presentation = null, mode = "following", homeCity = null }) {
  const scope = JSON.stringify([accountId || null, privacyScope, mode, homeCity]);
  const admission = useRef(null);
  if (admission.current?.scope !== scope || admission.current?.retainOnInactive !== retainOnInactive) {
    // A fresh identity prevents an A -> B -> A privacy round trip from admitting
    // the first A's resource, even when its serialized query scope matches again.
    const identity = {};
    admission.current = { scope, identity, retainOnInactive, complete: false, retry: null, cursors: new Set(), revision: 0, reconciledRevision: 0,
      settled: createLoadState({ scope: identity, data: emptyFeed() }) };
  }
  const data = admission.current;
  const [resource, setResource] = useState(() => createLoadState({ scope: data.identity, status: "loading", data: emptyFeed() }));
  const mounted = useRef(true);
  const current = useRef(null);
  if (current.current?.data !== data || current.current?.enabled !== enabled || current.current?.presentation !== presentation) {
    current.current?.request?.controller.abort();
    current.current = { data, accountId, enabled, presentation, resource: null, request: null, refreshQueued: false };
  }
  const owner = current.current;
  const scoped = projectLoadState(resource, data.identity, emptyFeed());
  owner.resource = retainOnInactive && ["loading", "refreshing"].includes(scoped.status) && !owner.request ? data.settled : scoped;
  const admitted = () => mounted.current && current.current === owner && owner.enabled && owner.presentation?.current() !== false;
  const request = async (more = false) => {
    if (!admitted() || !owner.accountId || (more && (owner.request || !owner.resource.data.nextCursor))) return false;
    // Explicit refresh supersedes an older-page request without losing its rows.
    if (!more && owner.request) { owner.request.controller.abort(); owner.request = null; }
    const requestedCursor = more ? owner.resource.data.nextCursor : null;
    const token = { controller: new AbortController(), revision: data.revision };
    owner.request = token;
    owner.resource = beginLoadState(owner.resource, { scope: data.identity, emptyData: emptyFeed() });
    setResource(owner.resource);
    const valid = () => admitted() && owner.request === token && !token.controller.signal.aborted;
    try {
      const result = await (mode === "local" ? readLocalFeed : readFollowingFeed)({ accountId: owner.accountId, cursor: requestedCursor, signal: token.controller.signal });
      if (!valid()) return false;
      if (!Array.isArray(result?.posts)) throw toAppError(null, { code: "PIT-API-001", context: "Loading Following feed", source: "api" });
      const nextCursor = result.nextCursor;
      if (!Object.prototype.hasOwnProperty.call(result, "nextCursor")
        || (nextCursor != null && (typeof nextCursor !== "string" || !nextCursor))
        || (more && nextCursor && (nextCursor === requestedCursor || data.cursors.has(nextCursor)))) {
        throw toAppError(null, { code: "PIT-API-001", context: "Advancing Following feed", source: "api" });
      }
      if (!more) data.cursors.clear();
      else data.cursors.add(requestedCursor);
      const previousPosts = more ? owner.resource.data.posts : [];
      const byId = new Map(previousPosts.map(post => [post.id, post]));
      for (const post of result.posts) byId.set(post.id, post);
      const next = resolveLoadState({ scope: data.identity, data: { posts: [...byId.values()], nextCursor: result.nextCursor || null } });
      owner.resource = next;
      data.complete = true;
      data.retry = null;
      if (!more) data.reconciledRevision = token.revision;
      data.settled = next;
      setResource(next);
      return true;
    } catch (error) {
      // architecture: allow-ambiguous-result -- retained feed rows remain usable; the visible scoped error offers a retry
      if (valid()) {
        // Cancellation is lifecycle control, not a failed resource. Preserve the
        // last settled canonical state, including a previous retryable error.
        const next = isLoadCancellation(error, token.controller.signal) ? data.settled : rejectLoadState(owner.resource, {
          scope: data.identity,
          error: toAppError(error, { status: error?.status, context: "Loading Following feed", source: "api" }),
          emptyData: emptyFeed(),
          retainData: ![401, 403, 404, 410].includes(Number(error?.status)),
        });
        owner.resource = next;
        if (!isLoadCancellation(error, token.controller.signal)) { data.complete = true; data.retry = { more }; }
        data.settled = next;
        setResource(next);
      }
      return false;
    } finally {
      if (current.current === owner && owner.request === token) {
        owner.request = null;
        // Several completed mutations during pagination need one fresh read,
        // not a lost invalidation or an unbounded queue of duplicate requests.
        const refresh = owner.refreshQueued;
        owner.refreshQueued = false;
        if (refresh && admitted()) void requestRef.current();
      }
    }
  };
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    mounted.current = true;
    if (!enabled || !accountId) return () => { mounted.current = false; };
    if (!retainOnInactive || !data.complete || data.revision !== data.reconciledRevision) void requestRef.current();
    return () => {
      mounted.current = false;
      owner.request?.controller.abort();
      owner.request = null;
      owner.refreshQueued = false;
    };
  }, [owner, data, enabled, accountId, retainOnInactive]);
  const listen = !!accountId && (retainOnInactive || enabled);
  useEffect(() => {
    if (!listen) return undefined;
    // A paused retained Feed still hears local mutation invalidations. It only
    // records a version while hidden; the next admitted entry reconciles once,
    // even when expanded history is too large for periodic head polling.
    return subscribeSocialReactionChanges((changed) => {
      const live = current.current;
      if (!mounted.current || admission.current !== data || live?.data !== data || changed !== accountId) return;
      data.revision++;
      if (!live.enabled || live.presentation?.current() === false) return;
      if (live.request) live.refreshQueued = true;
      else void requestRef.current();
    });
  }, [data, accountId, listen]);
  useEffect(() => subscribeAuthorBadgeChanges(event => {
    const live = current.current;
    if (event.accountId !== accountId || admission.current !== data || live?.data !== data) return;
    live.request?.controller.abort(); live.request = null; live.refreshQueued = false;
    const next = createLoadState({ ...data.settled, data: { ...data.settled.data,
      posts: reconcilePostAuthorBadges(data.settled.data.posts, event.user) } });
    data.settled = next; live.resource = next; setResource(next);
    if (!data.complete && live.enabled) void requestRef.current();
  }), [accountId, data]);
  const view = owner.resource;
  // Keep the screen's established presentation API while the owned resource is
  // canonical: a refresh is its existing spinner, and loaded means admitted data.
  return { scope, posts: view.data.posts, nextCursor: view.data.nextCursor, status: view.status === "refreshing" ? "loading" : view.status,
    loaded: view.updatedAt != null, failedMore: view.status === "error" && data.retry?.more === true,
    reload: () => request(false), loadMore: () => request(true), retry: () => request(data.retry?.more === true) };
}
