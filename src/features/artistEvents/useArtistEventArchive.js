import { useCallback, useEffect, useRef, useState } from "react";
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

export function useArtistEventArchive({ accountId = null, name = null, artistKey = null, enabled = true } = {}) {
  const identity = artistEventIdentity({ artistKey, name });
  const scope = artistEventArchiveScope({ accountId, artistKey, name });
  const [resource, setResource] = useState(() => createLoadState({ data: EMPTY_ARTIST_EVENT_ARCHIVE }));
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!enabled || !identity) {
      setResource(resolveLoadState({ scope, data: EMPTY_ARTIST_EVENT_ARCHIVE }));
      return undefined;
    }

    const controller = new AbortController();
    setResource((current) => beginLoadState(current, { scope, emptyData: EMPTY_ARTIST_EVENT_ARCHIVE }));
    readArtistEventArchive({ accountId, name, artistKey, signal: controller.signal })
      .then((archive) => {
        if (controller.signal.aborted || requestSequence.current !== sequence) return;
        setResource((current) => current.scope === scope ? resolveLoadState({ scope, data: archive }) : current);
      })
      .catch((error) => {
        if (isLoadCancellation(error, controller.signal) || requestSequence.current !== sequence) return;
        setResource((current) => current.scope === scope
          ? rejectLoadState(current, { scope, error, emptyData: EMPTY_ARTIST_EVENT_ARCHIVE })
          : current);
      });

    return () => {
      if (requestSequence.current === sequence) requestSequence.current += 1;
      controller.abort();
    };
  }, [accountId, artistKey, enabled, identity, name, revision, scope]);

  return {
    resource: projectArtistEventArchive(resource, { accountId, artistKey, name }),
    reload: useCallback(() => setRevision((current) => current + 1), []),
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
} = {}) {
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
  const sequence = useRef(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    activeRequest.current?.controller.abort();
    const ticket = ++sequence.current;
    if (!enabled || !identity || !selection) {
      setResource(resolveLoadState({ scope, data: EMPTY_ARTIST_EVENT_REVIEWS }));
      activeRequest.current = null;
      return undefined;
    }

    const controller = new AbortController();
    activeRequest.current = { controller, scope, ticket };
    setResource((current) => beginLoadState(current, { scope, emptyData: EMPTY_ARTIST_EVENT_REVIEWS }));
    readArtistEventReviews({ ...options, limit, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted || scopeRef.current !== scope || activeRequest.current?.ticket !== ticket) return;
        const next = resolveLoadState({
          scope,
          data: { ...page, loadingMore: false },
        });
        resourceRef.current = next;
        setResource(next);
      })
      .catch((error) => {
        if (isLoadCancellation(error, controller.signal) || scopeRef.current !== scope || activeRequest.current?.ticket !== ticket) return;
        setResource((current) => {
          if (current.scope !== scope) return current;
          const next = rejectLoadState(current, { scope, error, emptyData: EMPTY_ARTIST_EVENT_REVIEWS });
          resourceRef.current = next;
          return next;
        });
      })
      .finally(() => {
        if (activeRequest.current?.ticket === ticket) activeRequest.current = null;
      });

    return () => {
      if (activeRequest.current?.ticket === ticket) activeRequest.current = null;
      controller.abort();
    };
    // The scope owns every request field; `options` remains intentionally inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, artistKey, enabled, identity, limit, name, revision, scope, selection, showKey, tourKey]);

  // The scope effect aborts replacements, while this lifecycle cleanup also
  // catches a load-more request that began after the initial effect settled.
  useEffect(() => () => activeRequest.current?.controller.abort(), []);

  const loadMore = useCallback(async () => {
    const current = projectArtistEventReviews(resourceRef.current, options);
    const data = current.data || EMPTY_ARTIST_EVENT_REVIEWS;
    if (!enabled || !identity || !selection || !data.nextCursor || data.loadingMore || activeRequest.current) return current;

    const ticket = ++sequence.current;
    const controller = new AbortController();
    activeRequest.current = { controller, scope, ticket };
    const loading = beginLoadState(current, { scope, emptyData: EMPTY_ARTIST_EVENT_REVIEWS });
    const loadingResource = { ...loading, data: { ...data, loadingMore: true } };
    resourceRef.current = loadingResource;
    setResource(loadingResource);
    try {
      const page = await readArtistEventReviews({ ...options, cursor: data.nextCursor, limit, signal: controller.signal });
      if (controller.signal.aborted || scopeRef.current !== scope || activeRequest.current?.ticket !== ticket) return resourceRef.current;
      const next = resolveLoadState({
        scope,
        data: {
          reviews: mergeArtistEventReviewPage(data.reviews, page.reviews),
          nextCursor: page.nextCursor,
          total: page.total,
          loadingMore: false,
        },
      });
      resourceRef.current = next;
      setResource(next);
      return next;
    } catch (error) {
      if (isLoadCancellation(error, controller.signal) || scopeRef.current !== scope || activeRequest.current?.ticket !== ticket) return resourceRef.current;
      const rejected = rejectLoadState(resourceRef.current, { scope, error, emptyData: EMPTY_ARTIST_EVENT_REVIEWS });
      const next = { ...rejected, data: { ...data, loadingMore: false } };
      resourceRef.current = next;
      setResource(next);
      return next;
    } finally {
      if (activeRequest.current?.ticket === ticket) activeRequest.current = null;
    }
  }, [accountId, artistKey, enabled, identity, limit, name, scope, selection, showKey, tourKey]);

  return {
    resource: projectArtistEventReviews(resource, options),
    reload: useCallback(() => setRevision((current) => current + 1), []),
    loadMore,
  };
}
