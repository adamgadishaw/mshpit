import { useCallback, useEffect, useRef, useState } from "react";

import {
  canonicalArtistIdentity,
  canonicalArtistIdentityScope,
} from "../domain/canonicalArtistIdentity.mjs";
import { useStore } from "../store";

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
  const { remoteArtistMeta, resolveArtist } = useStore();
  const resolverRef = useRef(resolveArtist);
  const cachedReaderRef = useRef(remoteArtistMeta);
  resolverRef.current = resolveArtist;
  cachedReaderRef.current = remoteArtistMeta;
  const scope = canonicalArtistIdentityScope({ artistName, artistKey });
  const immediate = canonicalArtistIdentity({
    artistName,
    artistKey,
    catalogArtist: remoteArtistMeta?.(artistName),
  });
  const [resolution, setResolution] = useState(null);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
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
    let cancelled = false;
    setResolution({ scope, status: "checking", identity: cached });
    Promise.resolve(resolverRef.current?.(cached.artistName))
      .then((catalogArtist) => {
        if (cancelled || sequence.current !== ticket) return;
        const identity = canonicalArtistIdentity({ artistName: cached.artistName, catalogArtist });
        setResolution({
          scope,
          status: identity.artistKey ? "ready" : "unavailable",
          identity,
        });
      })
      .catch(() => {
        if (cancelled || sequence.current !== ticket) return;
        setResolution({ scope, status: "unavailable", identity: cached });
      });
    return () => {
      cancelled = true;
    };
  }, [artistKey, artistName, enabled, revision, scope]);

  const projected = projectedResolution(resolution, scope, immediate, enabled);
  return {
    ...projected.identity,
    status: projected.status,
    retry: useCallback(() => setRevision((current) => current + 1), []),
  };
}
