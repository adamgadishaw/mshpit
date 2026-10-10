import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  canonicalArtistIdentity,
  canonicalArtistIdentityScope,
} from "../domain/canonicalArtistIdentity.mjs";
import { useStore } from "../store";
import { createArtistLookupController } from "../features/artistSearch/artistLookupController.mjs";

const projectedResolution = (current, scope, immediate, enabled) => {
  if (current?.scope === scope) return current;
  return {
    scope,
    status: immediate.artistKey ? "ready" : enabled && immediate.artistName ? "checking" : "unavailable",
    identity: immediate,
  };
};

// Archive links sometimes predate durable artist keys. Resolve those names
// through the catalogue once, keep the result scoped to this route, and leave
// the route closed when the catalogue cannot return an exact persisted key.
export default function useCanonicalArtistIdentity({
  artistName = null,
  artistKey = null,
  enabled = true,
} = {}) {
  const { session, remoteArtistMeta, resolveArtist } = useStore();
  const accountScope = session?.id || "guest";
  const lookup = useMemo(() => createArtistLookupController(), [accountScope]);
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  const resolverRef = useRef(resolveArtist);
  const cachedReaderRef = useRef(remoteArtistMeta);
  resolverRef.current = resolveArtist;
  cachedReaderRef.current = remoteArtistMeta;
  const scope = JSON.stringify([accountScope, canonicalArtistIdentityScope({ artistName, artistKey })]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const immediate = canonicalArtistIdentity({
    artistName,
    artistKey,
    catalogArtist: remoteArtistMeta?.(artistName),
  });
  const [resolution, setResolution] = useState(null);
  const [revision, setRevision] = useState(0);
  const [, refreshCooldown] = useState(0);
  const retryRequested = useRef(false);
  const sequence = useRef(0);
  const retryAt = lookup.retryAt(accountScope);
  useEffect(() => () => lookup.reset(), [lookup]);
  useEffect(() => {
    if (!retryAt) return undefined;
    const timer = setTimeout(() => refreshCooldown((value) => value + 1), Math.max(1, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt, lookup]);

  useEffect(() => {
    retryRequested.current = false;
    const ticket = ++sequence.current;
    const cached = canonicalArtistIdentity({
      artistName,
      artistKey,
      catalogArtist: cachedReaderRef.current?.(artistName),
    });
    if (!enabled || !cached.artistName) {
      setResolution({ scope, status: "unavailable", identity: cached });
      return undefined;
    }
    if (cached.artistKey) {
      setResolution({ scope, status: "ready", identity: cached });
      return undefined;
    }
    const request = lookup.begin(accountScope, cached.artistName);
    if (!request) {
      setResolution({ scope, status: "unavailable", identity: cached });
      return undefined;
    }
    const isCurrent = () => lookupRef.current === lookup && scopeRef.current === scope
      && sequence.current === ticket && lookup.isCurrent(request);
    setResolution({ scope, status: "checking", identity: cached });
    Promise.resolve().then(() => {
      if (!isCurrent()) return null;
      return resolverRef.current?.(cached.artistName, { signal: request.controller.signal, throwOnError: true });
    })
      .then((catalogArtist) => {
        if (!isCurrent()) return;
        const identity = canonicalArtistIdentity({ artistName: cached.artistName, catalogArtist });
        setResolution({
          scope,
          status: identity.artistKey ? "ready" : "unavailable",
          identity,
          missing: !identity.artistKey,
        });
      })
      .catch((error) => {
        if (!isCurrent()) return;
        lookup.fail(request, error);
        setResolution({ scope, status: "unavailable", identity: cached, error });
      })
      .finally(() => {
        lookup.finish(request);
      });
    return () => {
      request.controller.abort();
      lookup.finish(request);
    };
  }, [artistKey, artistName, enabled, revision, scope, lookup, accountScope, immediate.artistKey]);

  const projected = projectedResolution(resolution, scope, immediate, enabled);
  return {
    ...projected.identity,
    status: projected.status,
    error: projected.error || null,
    missing: projected.missing === true,
    retryAt,
    retryDisabled: projected.status === "checking" || retryAt > Date.now(),
    retry: useCallback(() => {
      if (lookup.current() || lookup.retryAt(accountScope) > Date.now() || retryRequested.current) return;
      retryRequested.current = true;
      setRevision((current) => current + 1);
    }, [lookup, accountScope]),
  };
}
