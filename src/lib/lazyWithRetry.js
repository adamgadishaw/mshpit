import { createElement, lazy } from "react";
import WebChunkRecovery from "./webChunkRecovery.js";

// Retry a transient chunk failure once. Browser chunk failures then resolve to
// an in-place recovery view: navigation is always an explicit preservation
// decision, never an automatic reload that can discard a mounted draft.
function isExplicitStaleChunkError(error) {
  const name = String(error?.name || "");
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");
  return name === "ChunkLoadError"
    || /chunkloaderror/i.test(code)
    || /loading (?:css )?chunk .+ failed/i.test(message)
    // Expo can also reject a chunk from a mismatched module registry.
    || /^Requiring unknown module "\d{1,9}"\.$/i.test(message);
}

export function isStaleChunkError(error) {
  return isExplicitStaleChunkError(error) || /\b404\b/i.test(String(error?.message || error || ""));
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

function isDynamicChunkError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || error || "");
  return name === "AsyncRequireError"
    || /failed to fetch dynamically imported module/i.test(message)
    || /importing a module script failed/i.test(message)
    || /error loading dynamically imported module/i.test(message)
    || /loading module .+ failed/i.test(message);
}

// The app boundary also catches ordinary render errors, so a bare 404 alone
// must not turn its explicit retry into a document reload.
export function isChunkLoadError(error) {
  return isExplicitStaleChunkError(error) || isDynamicChunkError(error);
}

export async function confirmMissingDynamicChunk(error, {
  online = (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  baseUrl = (typeof window !== "undefined" ? window.location?.href : null),
  probe = (typeof fetch === "function"
    ? (url) => fetch(url, { method: "HEAD", cache: "no-store", credentials: "same-origin" })
    : null),
} = {}) {
  if (!isDynamicChunkError(error) || !online || !probe) return false;
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
  reload = (typeof window !== "undefined" && window.location ? () => window.location.reload() : null),
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  retryDelayMs = 350,
} = {}) {
  try { return await factory(); }
  catch {
    await delay(retryDelayMs);
    try { return await factory(); }
    catch (error) {
      // The reload capability marks foreground browser loads. Preloads and
      // native imports retain their existing rejection behavior. No probe,
      // storage getter or navigation is needed to keep the working tree alive.
      if (reload && (isStaleChunkError(error) || isChunkLoadError(error))) {
        return { default: () => createElement(WebChunkRecovery, { reload }) };
      }
      throw error;
    }
  }
}

export function lazyWithRetry(factory, name = "chunk") {
  let pending = null;
  let warming = false;
  const start = (preload) => {
    warming = preload;
    // Background warming may run while someone is writing or uploading. A
    // missing optional screen must not hard-reload that working page.
    const operation = loadChunk(factory, { name, ...(preload ? { reload: null } : {}) }).then(
      (module) => {
        if (pending === operation) warming = false;
        return module;
      },
      (error) => {
        if (pending === operation) { pending = null; warming = false; }
        throw error;
      },
    );
    pending = operation;
    return operation;
  };
  const load = () => {
    if (!pending) return start(false);
    // Navigation can join an in-flight warmup. If that optional attempt fails,
    // the real screen load still gets its own in-place recovery path.
    return warming ? pending.catch(() => load()) : pending;
  };
  const component = lazy(load);
  // Critical actions (notably the phone composer) can warm their tiny chunk
  // after the first screen settles, instead of making the first tap wait on a
  // cellular round trip. Rejections stay owned by the caller.
  component.preload = () => pending || start(true);
  return component;
}
