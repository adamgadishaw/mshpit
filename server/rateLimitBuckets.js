// One expiry node per live map entry. Updating or rolling back a reservation
// replaces that node in place, so churn cannot accumulate stale heap records.
// Callers may mutate count, but must replace a value to change its resetAt.
export function createRateLimitBuckets({ maxEntries = 50_000, pruneLimit = 64 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1
      || !Number.isSafeInteger(pruneLimit) || pruneLimit < 1) {
    throw new TypeError("Invalid rate-limit bucket capacity.");
  }
  const entries = new Map();
  const expiry = [];
  const earlier = (left, right) => left.value.resetAt < right.value.resetAt;
  const swap = (left, right) => {
    [expiry[left], expiry[right]] = [expiry[right], expiry[left]];
    expiry[left].index = left;
    expiry[right].index = right;
  };
  const up = (from) => {
    let at = from;
    while (at > 0) {
      const parent = Math.floor((at - 1) / 2);
      if (!earlier(expiry[at], expiry[parent])) break;
      swap(at, parent); at = parent;
    }
    return at;
  };
  const down = (from) => {
    let at = from;
    while (at * 2 + 1 < expiry.length) {
      let child = at * 2 + 1;
      if (child + 1 < expiry.length && earlier(expiry[child + 1], expiry[child])) child += 1;
      if (!earlier(expiry[child], expiry[at])) break;
      swap(at, child); at = child;
    }
  };
  const remove = (key) => {
    const node = entries.get(key);
    if (!node) return false;
    entries.delete(key);
    const last = expiry.pop();
    if (last !== node) {
      expiry[node.index] = last;
      last.index = node.index;
      down(up(last.index));
    }
    return true;
  };
  const pruneExpired = (now) => {
    let removed = 0;
    while (removed < pruneLimit && expiry.length && expiry[0].value.resetAt <= now) {
      remove(expiry[0].key);
      removed += 1;
    }
    return removed;
  };
  return Object.freeze({
    get size() { return entries.size; },
    get expirySize() { return expiry.length; },
    get: key => entries.get(key)?.value,
    has: key => entries.has(key),
    set(key, value) {
      if (!value || !Number.isFinite(value.resetAt)) throw new TypeError("Invalid rate-limit expiry.");
      const node = entries.get(key);
      if (node) {
        node.value = value;
        down(up(node.index));
      } else {
        if (entries.size >= maxEntries) throw new RangeError("Rate-limit bucket capacity exceeded.");
        const added = { key, value, index: expiry.length };
        entries.set(key, added); expiry.push(added); up(added.index);
      }
    },
    delete: remove,
    clear() { entries.clear(); expiry.length = 0; },
    pruneExpired,
    hasCapacity(keys, now) {
      pruneExpired(now);
      const newKeys = new Set();
      for (const key of keys) if (!entries.has(key)) newKeys.add(key);
      return entries.size + newKeys.size <= maxEntries;
    },
  });
}
