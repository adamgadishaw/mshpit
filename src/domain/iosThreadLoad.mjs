const cancelled = () => Object.assign(new Error("Cancelled"), { name: "AbortError" });

// Store fences reads per thread. Serialize unlike requests so a full refresh
// cannot invalidate a live poll, and only share identical cursor/context work.
// Each poll receives its own result, including the cursor and catch-up flag.
// Strict Store success is trusted here; this is not raw-response validation.
export function createIOSThreadLoad(onChange) {
  let generation = 0;
  let tail = Promise.resolve();
  let ready = false;
  let status = "loading";
  const requests = new Map();
  const publish = (next) => { status = next; onChange(next); };
  const cancel = () => {
    generation += 1;
    for (const request of requests.values()) request.controller.abort();
    requests.clear();
    tail = Promise.resolve();
  };
  const run = ({ load, after = null, forceContext = false, signal, interactive = false }) => {
    if (signal?.aborted) return Promise.reject(cancelled());
    const key = JSON.stringify([after || null, forceContext]);
    const existing = requests.get(key);
    if (existing && !existing.controller.signal.aborted) {
      existing.interactive ||= interactive;
      return existing.promise;
    }
    const request = { controller: new AbortController(), generation, interactive, promise: null };
    const abort = () => request.controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const current = () => generation === request.generation && !request.controller.signal.aborted;
    requests.set(key, request);
    request.promise = tail.then(async () => {
      if (!current()) throw cancelled();
      const previousStatus = status;
      if (request.interactive) publish("loading");
      try {
        const result = await load({ after, forceContext, signal: request.controller.signal, strict: true });
        if (!current() || result?.stale) throw cancelled();
        // An incremental response cannot establish that initial history loaded.
        if (!after) ready = true;
        if (ready) publish("ready");
        return result;
      } catch (error) {
        if (current() && error?.name !== "AbortError" && (!ready || request.interactive)) publish("error");
        else if (generation === request.generation && status === "loading") publish(previousStatus);
        throw error;
      }
    }).finally(() => {
      signal?.removeEventListener("abort", abort);
      if (requests.get(key) === request) requests.delete(key);
    });
    // A failed read must not block the next queued retry or existing poll.
    tail = request.promise.catch(() => undefined);
    return request.promise;
  };
  return { run, cancel };
}
