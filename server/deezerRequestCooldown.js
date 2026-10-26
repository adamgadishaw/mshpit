import { PROVIDER_RETRY_AFTER_MAX_MS, withProviderRetryDeadline } from "./providerResponsePolicy.js";

// One process-wide provider wait, independent of artist names, endpoints and
// in-flight coalescing keys. No quota guesses, automatic retries or new queue.
export function createDeezerRequestCooldown({ clock = () => Date.now(), unavailable } = {}) {
  if (typeof clock !== "function" || typeof unavailable !== "function") {
    throw new TypeError("Deezer cooldown requires a clock and an unavailable error factory.");
  }
  let retryAt = 0, revision = 0, probe = null;
  const aborted = (signal) => signal?.reason || new DOMException("Cancelled", "AbortError");
  async function run(request, { signal } = {}) {
    if (signal?.aborted) throw aborted(signal);
    if (typeof request !== "function") throw new TypeError("Deezer request must be a function.");
    const at = clock();
    if (retryAt > at || probe) throw unavailable(retryAt, at);
    const ticket = retryAt > 0 ? Symbol("Deezer recovery probe") : null;
    const admittedRevision = revision;
    if (ticket) probe = ticket;
    try {
      const value = await request();
      if (signal?.aborted) throw aborted(signal);
      // An older in-flight success cannot erase a newer refusal, even if its
      // deadline expired before this response finished reading.
      if (ticket && admittedRevision === revision) retryAt = 0;
      return value;
    } catch (error) {
      // Only concrete provider replies can establish a shared wait. Preserve
      // received Retry-After even if the caller leaves before error delivery.
      const deadline = Number(error?.retryAt);
      const receivedAt = clock();
      if (error?.providerResponse === true && [429, 503].includes(Number(error.status))
        && Number.isSafeInteger(deadline) && deadline > receivedAt) {
        retryAt = Math.max(retryAt, Math.min(deadline, receivedAt + PROVIDER_RETRY_AFTER_MAX_MS));
        revision += 1;
        error = withProviderRetryDeadline(error, retryAt, receivedAt);
      }
      if (signal?.aborted) throw aborted(signal);
      throw error;
    } finally {
      // A cancelled or failed probe does not announce recovery. The next
      // deliberate caller may probe; any new Retry-After still holds everyone.
      if (ticket && probe === ticket) probe = null;
    }
  }
  run.status = () => ({ retryAt: retryAt || null, probing: probe !== null });
  return run;
}
