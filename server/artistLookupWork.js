// Bounded remote directory work, separate from durable catalogue identities.
// Provider failures never become cached "artist does not exist" answers.
export function createArtistLookupWork({
  maxActive = 8, maxEntries = 128, resultTtlMs = 5 * 60_000,
  failureTtlMs = 30_000, deadlineMs = 6_000, clock = Date.now,
} = {}) {
  for (const [value, maximum] of [[maxActive, 32], [maxEntries, 512], [resultTtlMs, 3_600_000],
    [failureTtlMs, 3_600_000], [deadlineMs, 30_000]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError("Invalid artist lookup work limit.");
  }
  if (typeof clock !== "function") throw new TypeError("Artist lookup clock must be a function.");
  const active = new Map();
  const settled = new Map();
  const abortReason = (signal) => signal?.reason || new DOMException("Cancelled", "AbortError");
  const busy = () => Object.assign(new Error("Artist lookup capacity is temporarily full."), {
    name: "ArtistLookupCapacityError", status: 503, code: "queue_saturated", retryable: true, retryAfterMs: 1_000,
  });
  function remember(key, entry, ttl) {
    const now = clock();
    for (const [candidate, value] of settled) if (value.expires <= now) settled.delete(candidate);
    settled.delete(key);
    settled.set(key, { ...entry, expires: now + ttl });
    while (settled.size > maxEntries) settled.delete(settled.keys().next().value);
  }
  function subscribe(job, signal) {
    job.waiters += 1;
    return new Promise((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener("abort", cancel);
        job.waiters -= 1;
        if (!job.done && !job.waiters) job.controller.abort(new DOMException("All artist lookup callers left.", "AbortError"));
        return true;
      };
      const cancel = () => { if (release()) reject(abortReason(signal)); };
      signal?.addEventListener("abort", cancel, { once: true });
      job.promise.then(
        (value) => { if (release()) resolve(value); },
        (error) => { if (release()) reject(error); },
      );
    });
  }
  async function run(key, work, { signal } = {}) {
    if (signal?.aborted) throw abortReason(signal);
    if (typeof key !== "string" || !key || key.length > 500 || typeof work !== "function") {
      throw new TypeError("Artist lookup requires a bounded key and work callback.");
    }
    const cached = settled.get(key);
    if (cached?.expires > clock()) {
      if (cached.error) throw cached.error;
      return cached.value;
    }
    if (cached) settled.delete(key);
    let job = active.get(key);
    // Abandoned work retains its capacity reservation until it unwinds.
    if (job?.controller.signal.aborted) throw busy();
    if (!job) {
      if (active.size >= maxActive) throw busy();
      const controller = new AbortController();
      job = { controller, done: false, waiters: 0, promise: null };
      const timer = setTimeout(() => controller.abort(Object.assign(new Error("Artist lookup exceeded its deadline."), {
        name: "ArtistLookupTimeoutError", status: 504, code: "provider_timeout", retryable: true,
      })), deadlineMs);
      job.promise = Promise.resolve().then(() => work(controller.signal)).then((value) => {
        if (controller.signal.aborted) throw abortReason(controller.signal);
        remember(key, { value }, resultTtlMs);
        return value;
      }).catch((error) => {
        if (error?.name !== "AbortError" && (!controller.signal.aborted || controller.signal.reason?.name === "ArtistLookupTimeoutError")) {
          const retry = Number(error?.retryAfterMs);
          remember(key, { error }, Math.max(failureTtlMs, Math.min(60 * 60_000, Number.isFinite(retry) ? retry : 0)));
        }
        throw error;
      }).finally(() => {
        job.done = true;
        clearTimeout(timer);
        if (active.get(key) === job) active.delete(key);
      });
      active.set(key, job);
    }
    return subscribe(job, signal);
  }
  run.status = () => ({ active: active.size, cached: settled.size });
  return run;
}
