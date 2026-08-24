import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginLoadState,
  createLoadState,
  isLoadCancellation,
  rejectLoadState,
  resolveLoadState,
} from "../../domain/loadState.mjs";
import {
  artistReviewsIdentity,
  artistReviewsScope,
  EMPTY_ARTIST_REVIEWS,
  projectArtistReviewsResource,
} from "./artistReviewsState.mjs";
import { readArtistTopReviews } from "./services/artistReviewsApi.mjs";

// Screen-local public review resource. Privacy/block projection makes the data
// viewer-dependent, so its complete key is accountId + artist identity. There
// is no persistence or stale TTL: one bounded (10-row maximum) snapshot is kept
// for this hook instance, same-scope refresh may retain it, and a scope change
// projects empty synchronously. Only one request is current; replacement and
// unmount abort it, and no cross-screen in-flight work is deduplicated.
export function useArtistTopReviews({ accountId = null, name = null, artistKey = null, limit = 3 } = {}) {
  const scope = artistReviewsScope({ accountId, name, artistKey });
  const identity = artistReviewsIdentity({ name, artistKey });
  const [resource, setResource] = useState(() => createLoadState({ data: EMPTY_ARTIST_REVIEWS }));
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    if (!identity) {
      setResource(resolveLoadState({ scope, data: EMPTY_ARTIST_REVIEWS }));
      return undefined;
    }

    const controller = new AbortController();
    setResource((current) => beginLoadState(current, {
      scope,
      emptyData: EMPTY_ARTIST_REVIEWS,
    }));

    readArtistTopReviews({ accountId, name, artistKey, limit, signal: controller.signal })
      .then((reviews) => {
        if (controller.signal.aborted || requestSequence.current !== sequence) return;
        setResource((current) => current.scope === scope
          ? resolveLoadState({ scope, data: reviews })
          : current);
      })
      .catch((error) => {
        if (isLoadCancellation(error, controller.signal) || requestSequence.current !== sequence) return;
        setResource((current) => current.scope === scope
          ? rejectLoadState(current, { scope, error, emptyData: EMPTY_ARTIST_REVIEWS })
          : current);
      });

    return () => {
      if (requestSequence.current === sequence) requestSequence.current += 1;
      controller.abort();
    };
  }, [accountId, artistKey, identity, limit, name, revision, scope]);

  const reload = useCallback(() => setRevision((current) => current + 1), []);
  return {
    resource: projectArtistReviewsResource(resource, { accountId, name, artistKey }),
    reload,
  };
}
