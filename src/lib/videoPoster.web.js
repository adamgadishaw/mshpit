import {
  VIDEO_POSTER_ERROR_CODES,
  VideoPosterError,
  boundedPosterSize,
  normalizeVideoPosterOptions,
  videoPosterCandidateTimes,
  videoPosterError,
  videoPosterFileName,
  videoPosterFrameMeetsAutoQuality,
  videoPosterFrameScore,
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
  return { assertActive, race };
}

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
  if (/^https:\/\/[^\s]+$/i.test(uri)) return { uri, internal: false, crossOrigin: true };
  throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.sourceInvalid);
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
  context.drawImage(video, 0, 0, width, height);
  return videoPosterFrameScore(context.getImageData(0, 0, width, height).data);
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
      try {
        await seekVideo(video, candidate, guard);
        const score = scoreCurrentFrame(video, scoringCanvas, scoringContext);
        if (!best || score > best.score) best = { timeMs: candidate, score };
      } catch (error) {
        if (isCancellation(error)) throw error;
        lastFrameError = error;
      }
    }
    if (!best) throw videoPosterError(lastFrameError, VIDEO_POSTER_ERROR_CODES.frameFailed);
    if (!normalized.explicitTime && !videoPosterFrameMeetsAutoQuality(best.score)) {
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
      context.drawImage(video, 0, 0, size.width, size.height);
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
