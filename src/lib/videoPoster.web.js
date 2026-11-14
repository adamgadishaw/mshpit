import { VIDEO_POSTER_ERROR_CODES, VideoPosterError, normalizeVideoPosterOptions, videoPosterError } from "../domain/videoPoster.mjs";
import { createOperationGuard, validVideoAsset } from "./videoPosterOperationGuard.mjs";
import { loadChunk } from "./lazyWithRetry";

// Browser decoding/canvas code is needed only for an actual missing cover.
// Cache component-free code only. The original deadline includes chunk loading,
// and cancellation is rechecked before any CORS probe, media decode or URL allocation.
let loadedImplementation = null;
export async function generateVideoPosterAsset(videoAsset, options = {}) {
  if (typeof document === "undefined" || typeof URL === "undefined" || !validVideoAsset(videoAsset)) {
    throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.sourceInvalid);
  }
  const sourceAsset = { ...videoAsset };
  const settings = { ...options };
  const normalized = normalizeVideoPosterOptions(sourceAsset, settings);
  const guard = createOperationGuard(normalized.signal, normalized.timeoutMs);
  try {
    guard.assertActive();
    const implementation = loadedImplementation || await guard.race(
      loadChunk(() => import("./videoPosterWebImplementation.mjs"), { name: "Video cover preparation", reload: null })
        .then(module => { loadedImplementation = module; return module; }),
    );
    guard.assertActive();
    return await implementation.generateVideoPosterAsset(sourceAsset, settings, { guard, normalized });
  } catch (error) {
    throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.encodeFailed);
  }
}

export function releaseVideoPosterAsset(asset) {
  return loadedImplementation?.releaseVideoPosterAsset(asset) || false;
}
