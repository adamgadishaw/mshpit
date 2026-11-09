export function createIOSArtistSeenCount({ sessionRef, accountMutationEpochRef, seenCountCache, accountTargetScope, norm, captureAccountMutation, accountMutationIsCurrent, api }) {
  return async (name, { signal } = {}) => {
    const accountId = sessionRef.current?.id || null;
    if (!accountId || !name || signal?.aborted) return null;
    const mutation = captureAccountMutation(accountId, accountMutationEpochRef.current);
    const key = accountTargetScope(accountId, `artist-seen:${norm(name)}`);
    if (seenCountCache.current.has(key)) return seenCountCache.current.get(key);
    try {
      const r = await api(`/api/artists/seen?name=${encodeURIComponent(name)}`, { silent: true, signal, expectedAccountId: accountId });
      // An account handoff can complete while the request is in flight. The key
      // prevents cache reuse; this check also keeps the old promise from handing
      // A's value to a screen now rendering B.
      if (signal?.aborted || !accountMutationIsCurrent(mutation, sessionRef.current?.id, accountMutationEpochRef.current)) return null;
      const value = r || null;
      seenCountCache.current.set(key, value);
      return value;
    } catch {
      // architecture: allow-ambiguous-result -- The personal seen count is optional enrichment; a failed read must not replace the artist page.
      return null;
    }
  };
}

export function createIOSArtistRatingLoader({ sessionRef, accountMutationEpochRef, ratingAggregateKey, claimRatingTicket, rKey, ratingTicketIsCurrent, setRatingAgg, captureAccountMutation, accountMutationIsCurrent, api }) {
  return (kind, artist, title, { signal } = {}) => {
    if (signal?.aborted) return;
    const accountId = sessionRef.current?.id || null;
    const mutation = captureAccountMutation(accountId, accountMutationEpochRef.current);
    const aggregateKey = ratingAggregateKey(accountId, kind, artist, title);
    const ticket = claimRatingTicket(aggregateKey);
    api(`/api/ratings?kind=${kind}&ref=${encodeURIComponent(rKey(artist, title))}`, { expectedAccountId: accountId, signal })
      .then((r) => {
        if (signal?.aborted || !accountMutationIsCurrent(mutation, sessionRef.current?.id, accountMutationEpochRef.current)
          || !ratingTicketIsCurrent(aggregateKey, ticket)) return; // account changed or a newer rating won
        setRatingAgg((m) => ({ ...m, [aggregateKey]: { avg: r.avg, count: r.count, mine: r.mine } }));
      })
      .catch(() => {
        // architecture: allow-empty-catch -- Keep the existing rating when optional background enrichment fails; explicit rating commands report their own failures.
      });
  };
}
