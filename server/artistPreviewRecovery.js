// Public previews only. Stored catalogue reads never reach this helper, and a
// fallback cannot create/attach an artist or replace a MusicBrainz identity.
// Start a second, independently bounded provider only if the first is slow or
// unavailable; a fast primary answer performs no extra network request.
export function resolveArtistPreviewWithFallback({ primary, fallback, signal, hedgeAfterMs = 1_500 }) {
  if (typeof primary !== "function" || typeof fallback !== "function"
    || !Number.isSafeInteger(hedgeAfterMs) || hedgeAfterMs < 1 || hedgeAfterMs > 10_000) {
    throw new TypeError("Artist preview recovery requires bounded provider callbacks.");
  }
  const cancelled = () => signal?.reason || new DOMException("Cancelled", "AbortError");
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const primaryController = new AbortController(), fallbackController = new AbortController();
    let done = false, primaryDone = false, fallbackDone = false, fallbackStarted = false;
    let primaryError = null, fallbackError = null, timer;
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      primaryController.abort();
      fallbackController.abort();
      if (error) reject(error); else resolve(result);
    }
    function abort() { finish(cancelled()); }
    function exhausted() {
      if (primaryDone && fallbackDone) finish(primaryError || fallbackError, { artist: null, provider: null });
    }
    function startFallback() {
      if (done || fallbackStarted) return;
      fallbackStarted = true;
      Promise.resolve().then(() => {
        if (done) return null;
        return fallback(fallbackController.signal);
      }).then((artist) => {
        fallbackDone = true;
        if (artist) finish(null, { artist, provider: "deezer" }); else exhausted();
      }, (error) => { fallbackDone = true; fallbackError = error; exhausted(); });
    }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(startFallback, hedgeAfterMs);
    Promise.resolve().then(() => {
      if (done) return null;
      return primary(primaryController.signal);
    }).then((artist) => {
      primaryDone = true;
      if (artist) finish(null, { artist, provider: "musicbrainz" });
      else { startFallback(); exhausted(); }
    }, (error) => {
      primaryDone = true;
      primaryError = error;
      // Validation, authorization and programming errors must not be hidden by
      // an unrelated provider's plausible-looking result.
      if (error?.code !== "PROVIDER_UNAVAILABLE") finish(error);
      else { startFallback(); exhausted(); }
    });
  });
}
