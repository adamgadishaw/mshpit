export function goingIntentKey(accountId, showKey) {
  return `${String(accountId || "")}::${String(showKey || "")}`;
}

// Going writes are serialized per account/show. This makes the server observe
// rapid taps in intent order, while the revision/epoch checks let the UI ignore
// an older response and synchronously invalidate every write on account change.
export function createGoingIntentCoordinator() {
  let epoch = 0;
  let revision = 0;
  const tails = new Map();
  const latest = new Map();

  const begin = ({ accountId, showKey, desired, send }) => {
    const key = goingIntentKey(accountId, showKey);
    const operation = { accountId, showKey, desired: !!desired, epoch, revision: ++revision, key };
    latest.set(key, operation);
    const previous = tails.get(key) || Promise.resolve();
    const result = previous.catch(() => undefined).then(async () => {
      if (operation.epoch !== epoch) return { ok: false, stale: true, skipped: true };
      try {
        const value = await send();
        return { ok: true, stale: operation.epoch !== epoch, value };
      } catch (error) {
        return { ok: false, stale: operation.epoch !== epoch, error };
      }
    });
    const tail = result.finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    tails.set(key, tail);
    operation.result = result;
    return operation;
  };

  return {
    begin,
    isActive(operation, accountId) {
      return !!operation && operation.epoch === epoch && operation.accountId === accountId;
    },
    isLatest(operation, accountId) {
      return this.isActive(operation, accountId) && latest.get(operation.key) === operation;
    },
    reset() {
      epoch += 1;
      latest.clear();
      tails.clear();
    },
  };
}
