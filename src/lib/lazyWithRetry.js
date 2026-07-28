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
export async function loadChunk(factory, {
  name = "chunk",
  storage = (typeof window !== "undefined" ? window.sessionStorage : null),
  reload = (typeof window !== "undefined" && window.location ? () => window.location.reload() : null),
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  retryDelayMs = 350,
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
      // Still failing. If we have not already reloaded for this chunk in this
      // tab, reload once to get fresh HTML with current hashes. The guard makes
      // this at-most-once, so a truly missing file surfaces the error boundary
      // rather than a reload loop.
      if (read() !== "1" && reload) {
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
