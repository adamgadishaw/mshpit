import { lazy } from "react";

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
  const write = (v) => { try { storage?.setItem(key, v); } catch { /* private mode */ } };
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
      if (stale && read() !== "1" && reload) {
        write("1");
        reload();
        // Render nothing during the sliver before unload.
        return { default: () => null };
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
