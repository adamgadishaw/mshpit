import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Read status belongs to this exact visit, not the Store's shared review cache.
// The Store remains the authority for privacy-filtered notes (including a newly
// submitted note). Only a successful current read permits an empty-state claim.
export default function useIOSVenueReviews({ scope, enabled, venueName, loadVenueReviews }) {
  const visit = useMemo(() => ({ alive: false, pending: null }), [scope, enabled, venueName]);
  const current = useRef(visit);
  current.current = visit;
  const loader = useRef(loadVenueReviews);
  loader.current = loadVenueReviews;
  const [state, setState] = useState(null);
  const load = useCallback(() => {
    if (!enabled || !visit.alive || current.current !== visit) return Promise.resolve({ ok: false, stale: true });
    // Mount, retry and page refresh share one accepted read. A refresh gesture's
    // cancellation must not cancel a read still needed by the current visit.
    if (visit.pending) return visit.pending.promise;
    const controller = new AbortController();
    const request = { controller, promise: null };
    visit.pending = request;
    const isCurrent = () => visit.alive && current.current === visit
      && visit.pending === request && !controller.signal.aborted;
    setState({ visit, status: "loading" });
    request.promise = Promise.resolve().then(() => {
      if (!isCurrent()) return { ok: false, stale: true };
      return loader.current(venueName, { signal: controller.signal });
    }).then(result => {
      if (isCurrent()) {
        // This checks the Store result contract, not the raw network schema.
        const succeeded = result?.ok === true && Array.isArray(result.reviews);
        setState({ visit, status: succeeded ? "ready" : "error" });
      }
      return result;
    }, error => {
      if (isCurrent()) setState({ visit, status: "error" });
      return { ok: false, error };
    }).finally(() => {
      if (visit.pending === request) visit.pending = null;
    });
    return request.promise;
  }, [visit, enabled, venueName]);
  useEffect(() => {
    visit.alive = true;
    void load();
    return () => {
      visit.alive = false;
      visit.pending?.controller.abort();
      visit.pending = null;
    };
  }, [visit, load]);
  return { status: !enabled ? null : state?.visit === visit ? state.status : "loading", load };
}
