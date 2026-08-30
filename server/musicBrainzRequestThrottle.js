// MusicBrainz permits one request per second per application/IP. Independent
// background features must therefore share a start-time gate, not merely avoid
// overlapping batches: one job can finish and the next can otherwise start in
// the same second. This queue is process-wide and keeps at least 1.1 seconds
// between request starts, including after a failed request.

export const MUSICBRAINZ_REQUEST_INTERVAL_MS = 1_100;

function abortError(signal) {
  return signal?.reason || new DOMException("Aborted", "AbortError");
}

function abortableDelay(milliseconds, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, milliseconds));
    timer.unref?.();
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createMusicBrainzRequestThrottle({
  minimumIntervalMs = MUSICBRAINZ_REQUEST_INTERVAL_MS,
  clock = () => performance.now(),
  wait = abortableDelay,
} = {}) {
  const interval = Math.max(1_000, Math.trunc(Number(minimumIntervalMs) || MUSICBRAINZ_REQUEST_INTERVAL_MS));
  let tail = Promise.resolve();
  let lastStartedAt = null;

  return function runMusicBrainzRequest(request, { signal } = {}) {
    if (typeof request !== "function") return Promise.reject(new TypeError("MusicBrainz request must be a function"));
    const run = async () => {
      if (signal?.aborted) throw abortError(signal);
      if (lastStartedAt != null) {
        // Recheck after every wait so an early timer or a test clock that moves
        // in small steps cannot weaken the provider-wide start-time contract.
        let remaining = lastStartedAt + interval - Number(clock());
        while (remaining > 0) {
          await wait(remaining, { signal });
          if (signal?.aborted) throw abortError(signal);
          remaining = lastStartedAt + interval - Number(clock());
        }
      }
      lastStartedAt = Number(clock());
      return request();
    };
    const result = tail.then(run, run);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export const runMusicBrainzRequest = createMusicBrainzRequestThrottle();
