const SCRIPT_SELECTOR = "script[data-pit-youtube-iframe-api]";
const API_URL = "https://www.youtube.com/iframe_api";

let sharedApiPromise = null;

function removeScript(script) {
  try {
    script?.remove?.();
    if (script?.parentNode) script.parentNode.removeChild(script);
  } catch {}
}

function apiReady(windowObject) {
  return typeof windowObject?.YT?.Player === "function";
}

/**
 * Load the browser IFrame API once, while keeping a failed CDN/script attempt
 * retryable. Timer injection exists solely so lifecycle regressions stay
 * deterministic in Node without a browser or real network.
 */
export function loadYouTubeIframeApi({
  windowObject = typeof window !== "undefined" ? window : null,
  documentObject = typeof document !== "undefined" ? document : null,
  timeoutMs = 12_000,
  pollIntervalMs = 50,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!windowObject || !documentObject) return Promise.reject(new Error("no-dom"));
  if (apiReady(windowObject)) return Promise.resolve(windowObject.YT);
  if (sharedApiPromise) return sharedApiPromise;

  sharedApiPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;
    let poll = null;
    let previousReadyCalled = false;
    const previousReady = windowObject.onYouTubeIframeAPIReady;
    let script = documentObject.querySelector?.(SCRIPT_SELECTOR) || null;

    // A timed-out/error script cannot emit another useful load event. Keeping
    // it made every later mount reuse a poisoned tag and time out forever.
    if (script?.dataset?.pitYoutubeIframeApiState === "failed") {
      removeScript(script);
      script = null;
    }

    if (!script) {
      script = documentObject.createElement("script");
      script.src = API_URL;
      script.async = true;
      script.dataset.pitYoutubeIframeApi = "true";
      script.dataset.pitYoutubeIframeApiState = "loading";
      documentObject.head.appendChild(script);
    }

    const restoreReadyHandler = () => {
      if (windowObject.onYouTubeIframeAPIReady !== onApiReady) return;
      if (typeof previousReady === "function") windowObject.onYouTubeIframeAPIReady = previousReady;
      else {
        try { delete windowObject.onYouTubeIframeAPIReady; } catch { windowObject.onYouTubeIframeAPIReady = undefined; }
      }
    };

    const cleanup = () => {
      clearTimeoutFn(timeout);
      clearIntervalFn(poll);
      script?.removeEventListener?.("load", checkReady);
      script?.removeEventListener?.("error", onScriptError);
      restoreReadyHandler();
    };

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        if (script?.dataset) script.dataset.pitYoutubeIframeApiState = "failed";
        removeScript(script);
        reject(error);
        return;
      }
      if (script?.dataset) script.dataset.pitYoutubeIframeApiState = "ready";
      resolve(windowObject.YT);
    };

    function checkReady() {
      if (apiReady(windowObject)) finish();
    }

    function onScriptError() {
      finish(new Error("yt-api-load-failed"));
    }

    function onApiReady() {
      // Preserve another library's callback without building an ever-growing
      // wrapper chain across Pit retries.
      if (!previousReadyCalled && typeof previousReady === "function" && previousReady !== onApiReady) {
        previousReadyCalled = true;
        try { previousReady(); } catch {}
      }
      checkReady();
    }

    windowObject.onYouTubeIframeAPIReady = onApiReady;
    script.addEventListener?.("load", checkReady);
    script.addEventListener?.("error", onScriptError, { once: true });
    // Polling closes a real integration hole: another embed can replace the
    // single global ready callback after this loader installs its handler.
    poll = setIntervalFn(checkReady, pollIntervalMs);
    timeout = setTimeoutFn(() => finish(new Error("yt-api-load-timeout")), timeoutMs);
    checkReady();
  }).catch((error) => {
    sharedApiPromise = null;
    throw error;
  });

  return sharedApiPromise;
}

export function resetYouTubeIframeApiForTests() {
  sharedApiPromise = null;
}
