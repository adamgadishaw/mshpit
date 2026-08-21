export function recommendationPreferenceMutationKey(accountId, postId) {
  return JSON.stringify([String(accountId || ""), String(postId || "")]);
}

// Preference writes are optimistic, but the server still has to observe them in
// the same order as the taps that produced them. In particular, an Undo DELETE
// must never overtake the preceding Not-for-me POST on a fast second tap.
export function createRecommendationPreferenceCoordinator() {
  const tails = new Map();
  const pendingHides = new Map();
  const latestOperations = new Map();
  let revision = 0;

  const enqueue = (key, task) => {
    const previous = tails.get(key) || Promise.resolve();
    const ready = previous.then(() => undefined, () => undefined);
    const result = ready.then(task);
    const settled = result.then(() => undefined, () => undefined);
    tails.set(key, settled);
    settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key);
    });
    return result;
  };

  const claim = (key, intent) => {
    const operation = { key, intent, revision: ++revision, promise: null };
    latestOperations.set(key, operation);
    return operation;
  };

  const hide = (key, request) => {
    const operation = claim(key, "hidden");
    operation.promise = enqueue(key, request);
    pendingHides.set(key, operation);
    operation.promise.then(
      () => {
        if (pendingHides.get(key) === operation) pendingHides.delete(key);
      },
      () => {
        if (pendingHides.get(key) === operation) pendingHides.delete(key);
      },
    );
    return operation;
  };

  const undo = (key, request) => {
    // Capture the hide that was pending when Undo was tapped. A later hide has
    // its own position in the queue and must not change this transaction.
    const precedingHide = pendingHides.get(key) || null;
    const operation = claim(key, "visible");
    operation.promise = enqueue(key, async () => {
      if (precedingHide) {
        const hideCommitted = await precedingHide.promise.then(() => true, () => false);
        // If the POST failed, the server is already in the requested visible
        // state. Skipping DELETE also avoids turning its network failure into a
        // false rollback to hidden.
        if (!hideCommitted) return { ok: true, skipped: true, reason: "hide_failed" };
      }
      return request();
    });
    return operation;
  };

  return {
    hide,
    undo,
    isCurrent(operation) {
      return !!operation && latestOperations.get(operation.key) === operation;
    },
  };
}
