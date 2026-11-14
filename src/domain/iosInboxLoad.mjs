// Shares the existing poll with foreground refresh. This owns no timers and
// never edits cached conversations. Ready follows the strict Store loader's
// successful result; this coordinator does not validate raw response schemas.
// Same-screen callers share one promise. The initiating caller owns its abort
// signal; a joining caller cannot cancel another caller's read. Scope cleanup
// uses cancel() to abort the shared read and fence every caller's completion.
export function createIOSInboxLoad(onChange) {
  let flight = null;
  let ready = false;
  let generation = 0;
  let status = "loading";
  const publish = (next) => { status = next; onChange(next); };

  const cancel = () => {
    generation += 1;
    flight?.controller.abort();
    flight = null;
  };

  const run = ({ load, signal, interactive = false }) => {
    if (signal?.aborted) return Promise.reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    if (flight && !flight.controller.signal.aborted) {
      flight.interactive ||= interactive;
      return flight.promise;
    }
    const request = { controller: new AbortController(), interactive, generation, promise: null, previousStatus: status };
    flight = request;
    const abort = () => request.controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const current = () => flight === request && generation === request.generation && !request.controller.signal.aborted;
    if (interactive) publish("loading");
    request.promise = Promise.resolve().then(() => {
      if (!current()) throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
      return load({ signal: request.controller.signal, strict: true });
    }).then((value) => {
      if (current()) {
        ready = true;
        publish("ready");
      }
      return value;
    }).catch((error) => {
      if (current() && error?.name !== "AbortError" && (!ready || request.interactive)) publish("error");
      else if (flight === request && generation === request.generation && status === "loading") publish(request.previousStatus);
      throw error;
    }).finally(() => {
      signal?.removeEventListener("abort", abort);
      if (flight === request && generation === request.generation && request.controller.signal.aborted && status === "loading") publish(request.previousStatus);
      if (flight === request) flight = null;
    });
    return request.promise;
  };

  return { run, cancel };
}
