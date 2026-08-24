import {
  beginLoadState,
  createLoadState,
  isLoadCancellation,
  rejectLoadState,
  resolveLoadState,
} from "../../domain/loadState.mjs";

const text = (value) => value == null ? "" : String(value).trim();
const DEFAULT_CACHE_ENTRIES = 32;

export function profileHistoryScope(accountId, targetId) {
  return JSON.stringify([text(accountId), text(targetId)]);
}

export function emptyProfileHistoryState(scope = "") {
  return createLoadState({
    scope,
    data: {
      posts: [],
      nextCursor: null,
      complete: false,
      loadingMore: false,
    },
  });
}

const cursorNumber = (post) => Number.isFinite(Number(post?.createdAt)) ? Number(post.createdAt) : 0;
const cursorId = (post) => text(post?.id);

export function compareProfileHistoryPosts(a, b) {
  const time = cursorNumber(b) - cursorNumber(a);
  return time || cursorId(b).localeCompare(cursorId(a));
}

export function mergeProfileHistoryPage(current, incoming, { refresh = false, nextCursor = null } = {}) {
  const existing = Array.isArray(current) ? current.filter((post) => cursorId(post)) : [];
  const page = Array.isArray(incoming) ? incoming.filter((post) => cursorId(post)) : [];
  let retained = existing;

  if (refresh) {
    if (!nextCursor || !page.length) {
      retained = [];
    } else {
      // The refreshed head is authoritative through its last tuple. Rows older
      // than that boundary belong to pages the user already loaded and remain
      // visible instead of being silently evicted by a head refresh.
      const boundary = page.at(-1);
      retained = existing.filter((post) => compareProfileHistoryPosts(post, boundary) > 0);
    }
  }

  const byId = new Map();
  for (const post of [...retained, ...page]) byId.set(cursorId(post), post);
  return [...byId.values()].sort(compareProfileHistoryPosts);
}

function scopeAccountId(scope) {
  try {
    const parsed = JSON.parse(scope);
    return Array.isArray(parsed) ? text(parsed[0]) : undefined;
  } catch {
    return undefined;
  }
}

function cacheEntryLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("profile history cache limit must be a positive integer");
  }
  return limit;
}

export function createProfileHistoryStore({ fetchPage, now = () => Date.now(), maxEntries = DEFAULT_CACHE_ENTRIES } = {}) {
  if (typeof fetchPage !== "function") throw new TypeError("profile history requires fetchPage");
  const cacheLimit = cacheEntryLimit(maxEntries);
  const entries = new Map();
  const listeners = new Map();
  const active = new Map();
  const mutationOverlays = new Map();
  const invalidatedScopes = new Set();
  const lastUsed = new Map();
  let sequence = 0;
  let accessSequence = 0;

  const touch = (scope) => lastUsed.set(scope, ++accessSequence);
  const forgetScope = (scope) => {
    entries.delete(scope);
    mutationOverlays.delete(scope);
    invalidatedScopes.delete(scope);
    lastUsed.delete(scope);
  };
  const scopeIsPinned = (scope) => active.has(scope) || (listeners.get(scope)?.size || 0) > 0;
  const evictInactive = (protectedScope = null) => {
    while (entries.size > cacheLimit) {
      let oldestScope = null;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const scope of entries.keys()) {
        if (scope === protectedScope || scopeIsPinned(scope)) continue;
        const accessedAt = lastUsed.get(scope) || 0;
        if (accessedAt < oldestAccess) {
          oldestAccess = accessedAt;
          oldestScope = scope;
        }
      }
      // Active screens and reads are allowed to temporarily pin the cache above
      // its target. Their unsubscribe/finally paths run eviction again.
      if (oldestScope == null) break;
      forgetScope(oldestScope);
    }
  };

  const snapshot = (scope) => {
    if (!entries.has(scope)) entries.set(scope, emptyProfileHistoryState(scope));
    touch(scope);
    // Protect the object being returned so useSyncExternalStore receives a
    // referentially stable empty snapshot before its subscription is installed.
    evictInactive(scope);
    return entries.get(scope);
  };
  const existingSnapshot = (scope) => entries.get(scope) || emptyProfileHistoryState(scope);
  const publish = (scope, value) => {
    entries.set(scope, value);
    touch(scope);
    for (const listener of listeners.get(scope) || []) listener();
    evictInactive(scope);
    return value;
  };
  const paramsScope = ({ accountId, targetId }) => profileHistoryScope(accountId, targetId);
  const overlayFor = (scope) => {
    if (!mutationOverlays.has(scope)) mutationOverlays.set(scope, { upserts: new Map(), removals: new Map() });
    return mutationOverlays.get(scope);
  };
  const applyMutationOverlay = (scope, rows, serverPage, { nextCursor }) => {
    const overlay = overlayFor(scope);
    const serverById = new Map((Array.isArray(serverPage) ? serverPage : []).map((post) => [post?.id, post]));
    const boundary = serverPage?.at?.(-1) || null;
    for (const [id, override] of overlay.upserts) {
      const server = serverById.get(id);
      const serverVersion = Number(server?.version ?? server?.editedAt ?? server?.createdAt);
      const overrideVersion = Number(override?.version ?? override?.editedAt ?? override?.createdAt);
      if (server && Number.isFinite(serverVersion) && Number.isFinite(overrideVersion) && serverVersion >= overrideVersion) {
        overlay.upserts.delete(id);
      }
    }
    const filtered = rows.filter((post) => !overlay.removals.has(post?.id));
    for (const [id, removed] of overlay.removals) {
      if (serverById.has(id)) continue;
      const coveredByPage = !nextCursor || (boundary && removed && compareProfileHistoryPosts(removed, boundary) <= 0);
      if (coveredByPage) overlay.removals.delete(id);
    }
    return mergeProfileHistoryPage(filtered, [...overlay.upserts.values()]);
  };
  const accountScopes = (accountId) => {
    const wanted = text(accountId);
    return [...new Set([
      ...entries.keys(),
      ...listeners.keys(),
      ...active.keys(),
      ...mutationOverlays.keys(),
      ...invalidatedScopes,
    ])].filter((scope) => scopeAccountId(scope) === wanted);
  };
  const stopScopeRead = (scope) => {
    const request = active.get(scope);
    request?.controller.abort();
    active.delete(scope);
    return !!request;
  };
  const settledState = (scope, current, data = current?.data) => {
    const nextData = {
      ...(data || emptyProfileHistoryState(scope).data),
      loadingMore: false,
    };
    return createLoadState({
      scope,
      status: current?.updatedAt != null ? "ready" : "idle",
      data: nextData,
      updatedAt: current?.updatedAt ?? null,
    });
  };
  const transformOverlay = (scope, transformPost) => {
    const overlay = mutationOverlays.get(scope);
    if (!overlay) return false;
    let changed = false;
    for (const [id, post] of [...overlay.upserts]) {
      const next = transformPost(post);
      if (next === post) continue;
      changed = true;
      if (next) overlay.upserts.set(id, next);
      else {
        overlay.upserts.delete(id);
        // Preserve a data-free tombstone so an older page cannot resurrect a
        // post whose author was scrubbed from this viewer's cache.
        overlay.removals.set(id, null);
      }
    }
    for (const [id, post] of [...overlay.removals]) {
      if (!post) continue;
      const next = transformPost(post);
      if (next === post) continue;
      changed = true;
      overlay.removals.set(id, next || null);
    }
    return changed;
  };

  const run = async (params, { refresh }) => {
    const scope = paramsScope(params);
    const previous = snapshot(scope);
    const previousData = previous.data || emptyProfileHistoryState(scope).data;
    if (!refresh && (!previousData.nextCursor || previousData.loadingMore)) return previous;
    const prior = active.get(scope);
    if (prior) {
      if (!refresh) return prior.promise;
      prior.controller.abort();
    }
    const controller = new AbortController();
    const ticket = ++sequence;
    const loading = beginLoadState(previous, { scope, emptyData: emptyProfileHistoryState(scope).data, retainData: true });
    publish(scope, {
      ...loading,
      // Optimistic mutations can exist before the first successful read, when
      // canonical LoadState intentionally has no updatedAt yet. Preserve that
      // data explicitly; mutation overlays below arbitrate the eventual reply.
      data: { ...previousData, loadingMore: !refresh },
    });
    const promise = (async () => {
      try {
        const payload = await fetchPage({
          accountId: params.accountId || null,
          targetId: params.targetId,
          before: refresh ? null : previousData.nextCursor,
          signal: controller.signal,
        });
        if (controller.signal.aborted || active.get(scope)?.ticket !== ticket) return existingSnapshot(scope);
        const posts = Array.isArray(payload?.posts) ? payload.posts : [];
        const nextCursor = typeof payload?.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null;
        const merged = mergeProfileHistoryPage(previousData.posts, posts, { refresh, nextCursor });
        invalidatedScopes.delete(scope);
        return publish(scope, resolveLoadState({
          scope,
          data: {
            posts: applyMutationOverlay(scope, merged, posts, { nextCursor }),
            nextCursor,
            complete: !nextCursor,
            loadingMore: false,
          },
          updatedAt: now(),
        }));
      } catch (error) {
        if (controller.signal.aborted || active.get(scope)?.ticket !== ticket) return existingSnapshot(scope);
        if (isLoadCancellation(error, controller.signal)) return existingSnapshot(scope);
        const rejected = rejectLoadState(snapshot(scope), {
          scope,
          error,
          emptyData: emptyProfileHistoryState(scope).data,
          retainData: true,
        });
        return publish(scope, {
          ...rejected,
          data: { ...(snapshot(scope).data || previousData), loadingMore: false },
        });
      } finally {
        if (active.get(scope)?.ticket === ticket) active.delete(scope);
        evictInactive();
      }
    })();
    active.set(scope, { ticket, controller, promise });
    return promise;
  };

  return {
    getSnapshot: (scope) => snapshot(scope),
    subscribe(scope, listener) {
      snapshot(scope);
      const scoped = listeners.get(scope) || new Set();
      scoped.add(listener);
      listeners.set(scope, scoped);
      return () => {
        scoped.delete(listener);
        if (!scoped.size) {
          listeners.delete(scope);
          const stopped = stopScopeRead(scope);
          if (stopped && entries.has(scope)) entries.set(scope, settledState(scope, entries.get(scope)));
          evictInactive();
        }
      };
    },
    ensure(params, { maxAgeMs = 30_000 } = {}) {
      const scope = paramsScope(params);
      const current = snapshot(scope);
      if (active.has(scope)) return active.get(scope).promise;
      if (!invalidatedScopes.has(scope) && current.updatedAt != null && now() - current.updatedAt < maxAgeMs) return Promise.resolve(current);
      return run(params, { refresh: true });
    },
    refresh: (params) => run(params, { refresh: true }),
    loadMore: (params) => run(params, { refresh: false }),
    removePost(params, postId) {
      const scope = paramsScope(params);
      const current = snapshot(scope);
      const overlay = overlayFor(scope);
      const removed = current.data.posts.find((post) => post?.id === postId) || null;
      overlay.upserts.delete(postId);
      overlay.removals.set(postId, removed);
      return publish(scope, {
        ...current,
        data: { ...current.data, posts: current.data.posts.filter((post) => post?.id !== postId) },
      });
    },
    upsertPost(params, post, { previousId = null } = {}) {
      if (!post?.id) return snapshot(paramsScope(params));
      const scope = paramsScope(params);
      const current = snapshot(scope);
      const overlay = overlayFor(scope);
      if (previousId) {
        const replaced = current.data.posts.find((row) => row?.id === previousId) || null;
        overlay.upserts.delete(previousId);
        overlay.removals.set(previousId, replaced);
      }
      overlay.removals.delete(post.id);
      overlay.upserts.set(post.id, post);
      const retained = current.data.posts.filter((row) => row?.id !== post.id && (!previousId || row?.id !== previousId));
      return publish(scope, {
        ...current,
        data: { ...current.data, posts: mergeProfileHistoryPage(retained, [post]) },
      });
    },
    updatePost(params, postId, updater) {
      if (!postId || typeof updater !== "function") return snapshot(paramsScope(params));
      const scope = paramsScope(params);
      const current = snapshot(scope);
      let changed = false;
      const posts = current.data.posts.map((post) => {
        if (post?.id !== postId) return post;
        const next = updater(post);
        if (!next || next === post) return post;
        changed = true;
        const overlay = overlayFor(scope);
        overlay.removals.delete(postId);
        overlay.upserts.set(postId, next);
        return next;
      });
      return changed ? publish(scope, { ...current, data: { ...current.data, posts } }) : current;
    },
    invalidateAccount(accountId) {
      const scopes = accountScopes(accountId);
      for (const scope of scopes) {
        invalidatedScopes.add(scope);
        const stopped = stopScopeRead(scope);
        if (stopped && entries.has(scope)) publish(scope, settledState(scope, entries.get(scope)));
      }
      evictInactive();
      return scopes.length;
    },
    scrubAccount(accountId, transformPost) {
      if (typeof transformPost !== "function") throw new TypeError("profile history scrub requires a post transform");
      const scopes = accountScopes(accountId);
      for (const scope of scopes) {
        invalidatedScopes.add(scope);
        const stopped = stopScopeRead(scope);
        const overlayChanged = transformOverlay(scope, transformPost);
        const current = entries.get(scope);
        if (!current) continue;
        let postsChanged = false;
        const posts = [];
        for (const post of current.data?.posts || []) {
          const next = transformPost(post);
          if (next !== post) {
            postsChanged = true;
            if (post?.id) {
              const overlay = overlayFor(scope);
              overlay.upserts.delete(post.id);
              if (next) {
                overlay.removals.delete(post.id);
                overlay.upserts.set(post.id, next);
              } else {
                overlay.removals.set(post.id, null);
              }
            }
          }
          if (next) posts.push(next);
        }
        if (postsChanged || overlayChanged || stopped) {
          publish(scope, settledState(scope, current, { ...current.data, posts }));
        }
      }
      evictInactive();
      return scopes.length;
    },
    resetAccount(accountId) {
      const scopes = accountScopes(accountId);
      for (const scope of scopes) {
        stopScopeRead(scope);
        forgetScope(scope);
        // Explicit account reset is a privacy boundary, unlike LRU eviction: a
        // mounted old-account hook must immediately observe an empty snapshot.
        for (const listener of listeners.get(scope) || []) listener();
      }
      evictInactive();
      return scopes.length;
    },
  };
}
