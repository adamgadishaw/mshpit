import {
  VIDEO_POSTER_ERROR_CODES,
  VideoPosterError,
  boundedPosterSize,
  normalizeVideoPosterOptions,
  videoPosterCandidateTimes,
  videoPosterError,
  videoPosterFileName,
  videoPosterFrameIsStrong,
  videoPosterFrameIsUsable,
  videoPosterFrameProfile,
  videoPosterSourceNeedsCorsProbe,
} from "../domain/videoPoster.mjs";

const ownedPosterUris = new Set();

const isCancellation = (error) => error?.code === VIDEO_POSTER_ERROR_CODES.aborted
  || error?.code === VIDEO_POSTER_ERROR_CODES.timeout;

function createOperationGuard(signal, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const assertActive = () => {
    if (signal?.aborted) throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.aborted);
    if (Date.now() >= deadline) throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.timeout);
  };
  const race = (operation) => {
    assertActive();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, new VideoPosterError(VIDEO_POSTER_ERROR_CODES.aborted));
      const timer = setTimeout(
        () => finish(reject, new VideoPosterError(VIDEO_POSTER_ERROR_CODES.timeout)),
        Math.max(1, deadline - Date.now()),
      );
      signal?.addEventListener?.("abort", onAbort, { once: true });
      Promise.resolve(operation).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
  };
  return { assertActive, race, remainingMs: () => Math.max(0, deadline - Date.now()) };
}

const REMOTE_POSTER_OUTPUT_RESERVE_MS = 4_000;
const REMOTE_POSTER_SEEK_BUDGET_MS = 3_500;

function validVideoAsset(asset) {
  if (!asset || typeof asset !== "object") return false;
  const uri = String(asset.uri || "");
  const mime = String(asset.mimeType || asset.file?.type || "").toLowerCase();
  const name = String(asset.fileName || asset.file?.name || uri);
  return !!uri && (asset.type === "video" || mime.startsWith("video/") || /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(name));
}

function localVideoSource(asset) {
  if (asset?.file && typeof URL?.createObjectURL === "function") {
    try {
      return { uri: URL.createObjectURL(asset.file), internal: true };
    } catch {}
  }
  const uri = String(asset?.uri || "");
  if (/^(blob:|data:video\/)/i.test(uri)) return { uri, internal: false };
  if (/^https:\/\/[^\s]+$/i.test(uri)) {
    const pageHref = typeof location === "undefined" ? null : location.href;
    return { uri, internal: false, crossOrigin: videoPosterSourceNeedsCorsProbe(uri, pageHref) };
  }
  throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.sourceInvalid);
}

async function assertRemotePosterCors(source, guard, signal) {
  if (!source?.crossOrigin) return;
  if (typeof fetch !== "function") {
    throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.crossOriginBlocked);
  }
  try {
    // HEAD verifies an exposed CORS response without downloading or decoding the
    // historical video. A 4xx/405 response is still proof that the browser was
    // allowed to observe the response; an opaque/no-ACAO response is not.
    const response = await guard.race(fetch(source.uri, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
      cache: "force-cache",
      signal,
    }));
    if (!response || response.type === "opaque") {
      throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.crossOriginBlocked);
    }
  } catch (error) {
    if (isCancellation(error)) throw error;
    throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.crossOriginBlocked);
  }
}

function assertCanvasReadable(operation) {
  try {
    return operation();
  } catch (error) {
    if (error?.name === "SecurityError" || /taint|cross[- ]origin|insecure/i.test(String(error?.message || ""))) {
      throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.crossOriginBlocked);
    }
    throw error;
  }
}

function waitForMedia(video, successEvent, guard, ready) {
  if (ready?.()) return Promise.resolve();
  let cleanup = () => {};
  const event = new Promise((resolve, reject) => {
    const onSuccess = () => resolve();
    const onError = () => reject(new VideoPosterError(VIDEO_POSTER_ERROR_CODES.loadFailed));
    video.addEventListener(successEvent, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
    cleanup = () => {
      video.removeEventListener(successEvent, onSuccess);
      video.removeEventListener("error", onError);
    };
  });
  return guard.race(event).finally(cleanup);
}

async function seekVideo(video, timeMs, guard) {
  const seconds = Math.max(0.001, timeMs / 1_000);
  if (Math.abs(video.currentTime - seconds) > 0.005 || video.readyState < 2) {
    let cleanup = () => {};
    const seeked = new Promise((resolve, reject) => {
      const onSeeked = () => resolve();
      const onError = () => reject(new VideoPosterError(VIDEO_POSTER_ERROR_CODES.frameFailed));
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      try { video.currentTime = seconds; }
      catch (error) { reject(videoPosterError(error, VIDEO_POSTER_ERROR_CODES.frameFailed)); }
    });
    try {
      await guard.race(seeked);
    } finally {
      cleanup();
    }
  }
  // Give the compositor a turn after `seeked`; without this, Safari can expose
  // the old decoded frame to drawImage even though currentTime already changed.
  const painted = new Promise((resolve) => {
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 16);
    schedule(() => schedule(resolve));
  });
  await guard.race(painted);
}

function scoreCurrentFrame(video, canvas, context) {
  const width = 32;
  const height = Math.max(1, Math.round(width * (video.videoHeight / video.videoWidth)));
  canvas.width = width;
  canvas.height = height;
  assertCanvasReadable(() => context.drawImage(video, 0, 0, width, height));
  return videoPosterFrameProfile(assertCanvasReadable(() => context.getImageData(0, 0, width, height)).data);
}

function encodeJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new VideoPosterError(VIDEO_POSTER_ERROR_CODES.encodeFailed));
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob || !blob.size) reject(new VideoPosterError(VIDEO_POSTER_ERROR_CODES.encodeFailed));
      else resolve(blob);
    }, "image/jpeg", quality);
  });
}

/**
 * Generate a bounded JPEG cover from the local File/Blob returned by
 * expo-image-picker on web. The returned object URL belongs to the caller until
 * releaseVideoPosterAsset is called after upload or cancellation.
 */
export async function generateVideoPosterAsset(videoAsset, options = {}) {
  if (typeof document === "undefined" || typeof URL === "undefined" || !validVideoAsset(videoAsset)) {
    throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.sourceInvalid);
  }
  const normalized = normalizeVideoPosterOptions(videoAsset, options);
  const guard = createOperationGuard(normalized.signal, normalized.timeoutMs);
  let source = null;
  let video = null;
  let scoringCanvas = null;
  let outputCanvas = null;
  let posterUri = null;

  try {
    guard.assertActive();
    source = localVideoSource(videoAsset);
    await assertRemotePosterCors(source, guard, normalized.signal);
    video = document.createElement("video");
    if (source.crossOrigin) video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.style.position = "fixed";
    video.style.left = "-10000px";
    video.style.top = "-10000px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.pointerEvents = "none";
    video.src = source.uri;
    document.body?.appendChild(video);
    video.load();
    try {
      await waitForMedia(video, "loadedmetadata", guard, () => video.readyState >= 1 && video.videoWidth > 0);
    } catch (error) {
      throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.loadFailed);
    }
    if (!video.videoWidth || !video.videoHeight) {
      throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.loadFailed);
    }

    const actualDurationMs = Number.isFinite(video.duration) && video.duration > 0
      ? Math.round(video.duration * 1_000)
      : normalized.durationMs;
    const candidates = videoPosterCandidateTimes({
      durationMs: actualDurationMs,
      timeMs: normalized.timeMs,
      explicitTime: normalized.explicitTime,
    });
    scoringCanvas = document.createElement("canvas");
    const scoringContext = scoringCanvas.getContext("2d", { willReadFrequently: true });
    if (!scoringContext) throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.frameFailed);

    let best = null;
    let lastFrameError = null;
    for (const candidate of candidates) {
      guard.assertActive();
      let candidateGuard = guard;
      if (source.crossOrigin) {
        const remainingMs = guard.remainingMs();
        const outputReserveMs = Math.min(
          REMOTE_POSTER_OUTPUT_RESERVE_MS,
          Math.max(750, Math.floor(remainingMs * 0.35)),
        );
        const availableScoringMs = remainingMs - outputReserveMs;
        if (availableScoringMs <= 0) {
          if (best) break;
          throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.timeout);
        }
        candidateGuard = createOperationGuard(
          normalized.signal,
          Math.min(REMOTE_POSTER_SEEK_BUDGET_MS, availableScoringMs),
        );
      }
      try {
        await seekVideo(video, candidate, candidateGuard);
        const profile = scoreCurrentFrame(video, scoringCanvas, scoringContext);
        if ((normalized.explicitTime || videoPosterFrameIsUsable(profile)) && (!best || profile.score > best.profile.score)) {
          best = { timeMs: candidate, profile };
        }
        // Remote legacy clips can require a fresh byte-range request for every
        // seek. A strong frame can be committed immediately, while local/blob
        // Studio assets still score all candidates and keep their best cover.
        if (source.crossOrigin && videoPosterFrameIsStrong(profile)) break;
      } catch (error) {
        if (error?.code === VIDEO_POSTER_ERROR_CODES.aborted) throw error;
        if (source.crossOrigin && error?.code === VIDEO_POSTER_ERROR_CODES.timeout && best) break;
        if (isCancellation(error)) throw error;
        lastFrameError = error;
      }
    }
    if (!best) {
      if (!normalized.explicitTime && !lastFrameError) {
        throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.lowQuality);
      }
      throw videoPosterError(lastFrameError, VIDEO_POSTER_ERROR_CODES.frameFailed);
    }
    if (!normalized.explicitTime && !videoPosterFrameIsUsable(best.profile)) {
      throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.lowQuality);
    }

    try {
      await seekVideo(video, best.timeMs, guard);
      const size = boundedPosterSize(video.videoWidth, video.videoHeight, normalized.maxDimension);
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = size.width;
      outputCanvas.height = size.height;
      const context = outputCanvas.getContext("2d", { alpha: false });
      if (!context) throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.frameFailed);
      context.fillStyle = "#000";
      context.fillRect(0, 0, size.width, size.height);
      assertCanvasReadable(() => context.drawImage(video, 0, 0, size.width, size.height));
    } catch (error) {
      throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.frameFailed);
    }

    let blob;
    try {
      blob = await guard.race(encodeJpeg(outputCanvas, normalized.quality));
    } catch (error) {
      throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.encodeFailed);
    }
    guard.assertActive();
    const fileName = videoPosterFileName(videoAsset);
    const file = typeof globalThis.File === "function"
      ? new globalThis.File([blob], fileName, { type: "image/jpeg", lastModified: Date.now() })
      : blob;
    posterUri = URL.createObjectURL(file);
    ownedPosterUris.add(posterUri);
    return {
      asset: {
        type: "image",
        uri: posterUri,
        file,
        fileName,
        mimeType: "image/jpeg",
        fileSize: blob.size,
        width: outputCanvas.width,
        height: outputCanvas.height,
        duration: null,
        assetId: null,
      },
      timeMs: best.timeMs,
      durationMs: actualDurationMs,
    };
  } catch (error) {
    if (posterUri && ownedPosterUris.delete(posterUri)) URL.revokeObjectURL(posterUri);
    throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.encodeFailed);
  } finally {
    try { video?.pause?.(); } catch {}
    try {
      video?.removeAttribute?.("src");
      video?.load?.();
      video?.remove?.();
    } catch {}
    if (source?.internal) {
      try { URL.revokeObjectURL(source.uri); } catch {}
    }
    if (scoringCanvas) { scoringCanvas.width = 0; scoringCanvas.height = 0; }
    // The returned dimensions have already been copied into the asset above.
    // Clearing after return releases the potentially multi-megabyte backing store.
    if (outputCanvas) { outputCanvas.width = 0; outputCanvas.height = 0; }
  }
}

export function releaseVideoPosterAsset(asset) {
  const uri = typeof asset?.uri === "string" ? asset.uri : "";
  if (!ownedPosterUris.delete(uri)) return false;
  try { URL.revokeObjectURL(uri); } catch {}
  return true;
}
