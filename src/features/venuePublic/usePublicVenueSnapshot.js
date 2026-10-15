import { useCallback, useEffect, useRef, useState } from "react";
import { beginLoadState, isLoadCancellation, projectLoadState, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import { accountTargetScope } from "../../domain/screenScope.mjs";
import { publicVenueRequestPath } from "../../domain/publicVenueSnapshot.mjs";
import { fetchPublicVenueSnapshot } from "./venuePublicService";

// Screen-owned public data: one eight-event page, no persistent/global cache.
// Navigation/account changes hide old data during render and abort the request.
// Refresh replaces the page; overlapping reads use latest-wins adoption.
export default function usePublicVenueSnapshot({ name, identity, accountId = null }) {
  const path = publicVenueRequestPath(name, identity);
  const source = identity?.source || null;
  const providerVenueId = identity?.providerVenueId || identity?.venue_provider_id || null;
  const scope = accountTargetScope(accountId, JSON.stringify(["public-venue", path, source, providerVenueId]));
  const [resource, setResource] = useState(null);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const sequence = useRef(0);
  const pending = useRef(null);
  const load = useCallback(async ({ after = null, signal } = {}) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const ticket = ++sequence.current;
    const current = () => !controller.signal.aborted && sequence.current === ticket && activeScope.current === scope;
    if (current()) setResource(previous => beginLoadState(previous, { scope }));
    try {
      const data = await fetchPublicVenueSnapshot({ path, identity: { source, providerVenueId }, after, accountId, signal: controller.signal });
      if (current()) setResource(resolveLoadState({ scope, data }));
    } catch (error) {
      if (current() && !isLoadCancellation(error, controller.signal)) {
        setResource(previous => rejectLoadState(previous, { scope, error,
          retainData: error?.status !== 404 && error?.status !== 403 }));
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }, [path, source, providerVenueId, scope, accountId]);
  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, [load]);
  return { resource: projectLoadState(resource, scope), load };
}
