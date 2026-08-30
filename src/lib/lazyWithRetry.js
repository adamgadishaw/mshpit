import { createElement, lazy } from "react";

// Code-split screens are loaded on demand with import(). That has a failure mode
// the whole-bundle build never had: after a deploy, a browser still running the
// old page holds the old chunk hashes, so the first time it lazy-loads a screen
// it requests a file that no longer exists and import() rejects. React re-throws
// that into the error boundary, which is the "The night hit a snag" screen the
// owner hit opening Moderation right after a deploy. A plain reload fixed it,
// because fresh HTML points at the current hashes.
//
// `loadChunk` wraps a chunk factory so that:
//   1. a transient network blip is retried once after a short pause, and
//   2. a genuine missing-chunk failure triggers exactly one hard reload to pull
//      the new HTML, guarded so it can never loop.
//
// It is separated from lazy() and takes its side effects (reload, storage,
// delay) as arguments purely so it can be tested without a browser.
export function isStaleChunkError(error) {
  const name = String(error?.name || "");
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");
  return name === "ChunkLoadError"
    || /chunkloaderror/i.test(code)
    || /loading (?:css )?chunk .+ failed/i.test(message)
    || /\b404\b/i.test(message);
}

export function dynamicChunkUrl(error, baseUrl = null) {
  const message = String(error?.message || error || "");
  const candidate = message.match(/https?:\/\/[^\s)]+?\.js(?:\?[^\s)]*)?/i)?.[0]
    || message.match(/\(error:\s*([^)]+\.js(?:\?[^)]*)?)\)/i)?.[1];
  if (!candidate) return null;
  try {
    const url = new URL(candidate, baseUrl || undefined);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (baseUrl && url.origin !== new URL(baseUrl).origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function confirmMissingDynamicChunk(error, {
  online = (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  baseUrl = (typeof window !== "undefined" ? window.location?.href : null),
  probe = (typeof fetch === "function"
    ? (url) => fetch(url, { method: "HEAD", cache: "no-store", credentials: "same-origin" })
    : null),
} = {}) {
  const name = String(error?.name || "");
  const message = String(error?.message || error || "");
  const looksDynamic = name === "AsyncRequireError"
    || /failed to fetch dynamically imported module/i.test(message)
    || /importing a module script failed/i.test(message)
    || /error loading dynamically imported module/i.test(message)
    || /loading module .+ failed/i.test(message);
  if (!looksDynamic || !online || !probe) return false;
  const url = dynamicChunkUrl(error, baseUrl);
  if (!url) return false;
  try {
    const response = await probe(url);
    const status = Number(response?.status) || 0;
    const contentType = String(response?.headers?.get?.("content-type") || response?.contentType || "");
    return status === 404 || status === 410 || (status >= 200 && status < 300 && /text\/html/i.test(contentType));
  } catch {
    // A failed verification is indistinguishable from the cellular outage that
    // may have caused the import error. Preserve the current page and draft.
    return false;
  }
}

function updatingMshpitFallback(reload) {
  return function UpdatingMshpitFallback() {
    const manualReload = () => {
      try { reload?.(); } catch { /* The visible escape remains available. */ }
    };
    return createElement(
      "div",
      {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true",
        style: {
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 28,
          boxSizing: "border-box",
          background: "#07090F",
          color: "#F4EFE7",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          textAlign: "center",
        },
      },
      createElement("div", {
        style: {
          color: "#FF8C42",
          fontFamily: "'SFMono-Regular', Consolas, monospace",
          fontSize: 13,
          fontWeight: 900,
          letterSpacing: 4,
        },
      }, "MSHPIT"),
      createElement("h1", { style: { margin: 0, fontSize: 24 } }, "Updating Mshpit…"),
      createElement(
        "p",
        { style: { maxWidth: 420, margin: 0, color: "#9AA0B6", lineHeight: 1.5 } },
        "A newer version is ready. Reload once more if this screen stays here.",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: manualReload,
          "aria-label": "Reload Mshpit",
          style: {
            minHeight: 44,
            marginTop: 8,
            padding: "10px 22px",
            border: 0,
            borderRadius: 999,
            background: "#FF8C42",
            color: "#1A1206",
            font: "inherit",
            fontWeight: 800,
            cursor: "pointer",
          },
        },
        "Try again",
      ),
    );
  };
}

export async function loadChunk(factory, {
  name = "chunk",
  storage = (typeof window !== "undefined" ? window.sessionStorage : null),
  reload = (typeof window !== "undefined" && window.location ? () => window.location.reload() : null),
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  retryDelayMs = 350,
  probe,
  online,
  baseUrl,
} = {}) {
  const key = `pit.chunkReload.${name}`;
  const read = () => { try { return storage?.getItem(key); } catch { return null; } };
  const writeAndConfirm = (v) => {
    try {
      if (!storage) return false;
      storage.setItem(key, v);
      return storage.getItem(key) === String(v);
    } catch {
      // A storage-denied/private session cannot retain the one-shot guard. Do
      // not reload without it, or the same stale chunk could reload forever.
      return false;
    }
  };
  const clear = () => { try { storage?.removeItem(key); } catch { /* private mode */ } };

  try {
    const mod = await factory();
    clear(); // success resets the guard so a future real failure can reload again
    return mod;
  } catch {
    // One quiet retry: covers a dropped request unrelated to a deploy.
    try {
      await delay(retryDelayMs);
      const mod = await factory();
      clear();
      return mod;
    } catch (secondError) {
      // Only a recognized stale/missing asset earns a hard reload. A generic
      // cellular "Failed to fetch" can reject twice while someone is writing a
      // post; reloading in that case destroys unsaved composer state.
      const stale = isStaleChunkError(secondError)
        || await confirmMissingDynamicChunk(secondError, { probe, online, baseUrl });
      if (stale && read() !== "1" && reload && writeAndConfirm("1")) {
        reload();
        // Navigation can be delayed or ignored by mobile Safari. Keep a visible
        // manual escape instead of resolving the lazy screen to a blank app.
        return { default: updatingMshpitFallback(reload) };
      }
      throw secondError;
    }
  }
}

export function lazyWithRetry(factory, name = "chunk") {
  let pending = null;
  const load = () => {
    if (!pending) pending = loadChunk(factory, { name }).catch((error) => { pending = null; throw error; });
    return pending;
  };
  const component = lazy(load);
  // Critical actions (notably the phone composer) can warm their tiny chunk
  // after the first screen settles, instead of making the first tap wait on a
  // cellular round trip. Rejections stay owned by the caller.
  component.preload = load;
  return component;
}
