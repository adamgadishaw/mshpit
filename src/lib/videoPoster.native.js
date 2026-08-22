import { File as ExpoFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Skia } from "@shopify/react-native-skia";
import { createVideoPlayer } from "expo-video";
import {
  createVideoPosterWorkTracker,
  markVideoPosterPermitUntil,
} from "./videoPosterScheduler.mjs";
import {
  VIDEO_POSTER_ERROR_CODES,
  VideoPosterError,
  boundedPosterSize,
  normalizeVideoPosterOptions,
  videoPosterCandidateTimes,
  videoPosterError,
  videoPosterFileName,
  videoPosterFrameIsUsable,
  videoPosterFrameProfile,
} from "../domain/videoPoster.mjs";

const ownedPosterUris = new Set();

const releaseShared = (value) => {
  try { value?.release?.(); } catch {}
};

const deleteGeneratedFile = (uri) => {
  try {
    const file = new ExpoFile(uri);
    if (file.exists) file.delete();
  } catch {}
};

const isCancellation = (error) => error?.code === VIDEO_POSTER_ERROR_CODES.aborted
  || error?.code === VIDEO_POSTER_ERROR_CODES.timeout;

function createOperationGuard(signal, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const cancellation = () => {
    if (signal?.aborted) return new VideoPosterError(VIDEO_POSTER_ERROR_CODES.aborted);
    if (Date.now() >= deadline) return new VideoPosterError(VIDEO_POSTER_ERROR_CODES.timeout);
    return null;
  };
  const assertActive = () => {
    const error = cancellation();
    if (error) throw error;
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
      const remaining = Math.max(1, deadline - Date.now());
      const timer = setTimeout(
        () => finish(reject, new VideoPosterError(VIDEO_POSTER_ERROR_CODES.timeout)),
        remaining,
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

async function waitForPlayer(player, guard) {
  if (player.status === "readyToPlay") return;
  if (player.status === "error") throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.loadFailed);
  let subscription;
  const readiness = new Promise((resolve, reject) => {
    const inspect = ({ status, error } = {}) => {
      const current = status || player.status;
      if (current === "readyToPlay") resolve();
      else if (current === "error" || error) reject(videoPosterError(error, VIDEO_POSTER_ERROR_CODES.loadFailed));
    };
    subscription = player.addListener("statusChange", inspect);
    inspect();
  });
  try {
    await guard.race(readiness);
  } finally {
    subscription?.remove?.();
  }
}

function deferredCleanup(operation, onResolve, resources, workTracker) {
  const cleanup = Promise.resolve(operation)
    .then((value) => onResolve?.(value), () => {})
    .finally(() => resources.forEach(releaseShared));
  workTracker?.hold(cleanup);
}

function validVideoAsset(asset) {
  if (!asset || typeof asset !== "object" || typeof asset.uri !== "string" || !asset.uri.trim()) return false;
  const mime = String(asset.mimeType || "").toLowerCase();
  const name = String(asset.fileName || asset.uri);
  return asset.type === "video" || mime.startsWith("video/") || /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i.test(name);
}

// expo-video returns a native SharedRef rather than raw pixels. For automatic
// covers, make a tiny temporary raster from each candidate and score its actual
// luminance/detail. This keeps the durable cover away from black frame-zero and
// blown-white lighting cues instead of assuming that the one-second frame is
// representative. The final cover is generated again at full poster quality.
async function scoreNativeThumbnail(thumbnail) {
  let context = null;
  let rendered = null;
  let tempUri = null;
  let data = null;
  let image = null;
  try {
    const width = 32;
    const height = Math.max(1, Math.round(width * (Number(thumbnail?.height) || 1) / Math.max(1, Number(thumbnail?.width) || 1)));
    context = ImageManipulator.manipulate(thumbnail);
    context.resize({ width, height });
    rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.72, format: SaveFormat.JPEG });
    tempUri = saved?.uri || null;
    if (!tempUri) throw new Error("Thumbnail scoring did not produce an image.");
    const file = new ExpoFile(tempUri);
    const bytes = await file.bytes();
    data = Skia.Data.fromBytes(bytes);
    image = Skia.Image.MakeImageFromEncoded(data);
    const pixels = image?.readPixels?.();
    if (!pixels?.length) throw new Error("Thumbnail scoring could not read pixels.");
    return videoPosterFrameProfile(pixels);
  } finally {
    image?.dispose?.();
    data?.dispose?.();
    rendered?.release?.();
    context?.release?.();
    if (tempUri) deleteGeneratedFile(tempUri);
  }
}

/**
 * Generate a bounded JPEG cover for a newly selected native video.
 *
 * The returned `asset` intentionally matches the subset of Expo's
 * ImagePickerAsset consumed by uploadMediaAsset. Call releaseVideoPosterAsset
 * after upload (or cancellation) to remove the generated cache file.
 */
async function generateVideoPosterAssetOperation(videoAsset, options, workTracker) {
  if (!validVideoAsset(videoAsset)) {
    throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.sourceInvalid);
  }
  const normalized = normalizeVideoPosterOptions(videoAsset, options);
  const guard = createOperationGuard(normalized.signal, normalized.timeoutMs);
  let player = null;
  let thumbnails = [];
  let context = null;
  let rendered = null;
  let outputUri = null;

  try {
    guard.assertActive();
    try {
      player = createVideoPlayer({ uri: videoAsset.uri, useCaching: false });
      player.muted = true;
      await waitForPlayer(player, guard);
    } catch (error) {
      throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.loadFailed);
    }

    const durationMs = Number.isFinite(Number(player.duration)) && player.duration > 0
      ? Math.round(player.duration * 1_000)
      : normalized.durationMs;
    const candidateTimes = videoPosterCandidateTimes({
      durationMs,
      timeMs: normalized.timeMs,
      explicitTime: normalized.explicitTime,
    });
    let requestedTimeMs = candidateTimes[0];

    if (!normalized.explicitTime && candidateTimes.length) {
      const scoringGeneration = player.generateThumbnailsAsync(
        candidateTimes.map((time) => time / 1_000),
        { maxWidth: 192, maxHeight: 192 },
      );
      let scoringThumbnails = [];
      let scoringResolved = false;
      try {
        scoringThumbnails = await guard.race(scoringGeneration);
        scoringResolved = true;
        let best = null;
        for (let index = 0; index < scoringThumbnails.length; index += 1) {
          guard.assertActive();
          const thumbnail = scoringThumbnails[index];
          try {
            // The tiny scorer owns the thumbnail until its cleanup completes.
            // Check cancellation immediately before and after it instead of
            // releasing a SharedRef while ImageManipulator is still reading it.
            const profile = await scoreNativeThumbnail(thumbnail);
            guard.assertActive();
            const actualSeconds = Number(thumbnail.actualTime ?? thumbnail.requestedTime);
            const actualTimeMs = Number.isFinite(actualSeconds) && actualSeconds >= 0
              ? Math.round(actualSeconds * 1_000)
              : candidateTimes[index];
            if (videoPosterFrameIsUsable(profile) && (!best || profile.score > best.profile.score)) {
              best = { profile, timeMs: actualTimeMs };
            }
          } catch (error) {
            if (isCancellation(error)) throw error;
          }
        }
        if (!best) throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.lowQuality);
        if (!videoPosterFrameIsUsable(best.profile)) {
          throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.lowQuality);
        }
        requestedTimeMs = best.timeMs;
      } catch (error) {
        if (isCancellation(error) && !scoringResolved) {
          const heldPlayer = player;
          player = null;
          deferredCleanup(scoringGeneration, (values) => values?.forEach?.(releaseShared), [heldPlayer], workTracker);
        }
        throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.frameFailed);
      } finally {
        scoringThumbnails.forEach(releaseShared);
      }
    }

    const generation = player.generateThumbnailsAsync(
      [requestedTimeMs / 1_000],
      { maxWidth: normalized.maxDimension, maxHeight: normalized.maxDimension },
    );
    try {
      thumbnails = await guard.race(generation);
    } catch (error) {
      if (isCancellation(error)) {
        const heldPlayer = player;
        player = null;
        deferredCleanup(generation, (values) => values?.forEach?.(releaseShared), [heldPlayer], workTracker);
      }
      throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.frameFailed);
    }
    const thumbnail = thumbnails?.[0];
    if (!thumbnail) throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.frameFailed);

    const targetSize = boundedPosterSize(thumbnail.width, thumbnail.height, normalized.maxDimension);
    try {
      context = ImageManipulator.manipulate(thumbnail);
      if (targetSize.width !== thumbnail.width || targetSize.height !== thumbnail.height) {
        context.resize(targetSize);
      }
    } catch (error) {
      throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.encodeFailed);
    }

    const rendering = context.renderAsync();
    try {
      rendered = await guard.race(rendering);
    } catch (error) {
      if (isCancellation(error)) {
        const held = [context, ...thumbnails, player];
        context = null;
        thumbnails = [];
        player = null;
        deferredCleanup(rendering, releaseShared, held, workTracker);
      }
      throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.encodeFailed);
    }

    const saving = rendered.saveAsync({
      compress: normalized.quality,
      format: SaveFormat.JPEG,
    });
    let result;
    try {
      result = await guard.race(saving);
    } catch (error) {
      if (isCancellation(error)) {
        const held = [rendered, context, ...thumbnails, player];
        rendered = null;
        context = null;
        thumbnails = [];
        player = null;
        deferredCleanup(saving, (lateResult) => deleteGeneratedFile(lateResult?.uri), held, workTracker);
      }
      throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.encodeFailed);
    }

    outputUri = result?.uri || null;
    const outputFile = outputUri ? new ExpoFile(outputUri) : null;
    const fileSize = Number(outputFile?.size);
    if (!outputUri || !outputFile?.exists || !Number.isSafeInteger(fileSize) || fileSize < 1) {
      throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.encodeFailed);
    }
    guard.assertActive();
    ownedPosterUris.add(outputUri);

    const actualSeconds = Number(thumbnail.actualTime ?? thumbnail.requestedTime);
    const actualTimeMs = Number.isFinite(actualSeconds) && actualSeconds >= 0
      ? Math.round(actualSeconds * 1_000)
      : requestedTimeMs;
    return {
      asset: {
        type: "image",
        uri: outputUri,
        fileName: videoPosterFileName(videoAsset),
        mimeType: "image/jpeg",
        fileSize,
        width: Math.max(1, Math.round(Number(result.width) || targetSize.width)),
        height: Math.max(1, Math.round(Number(result.height) || targetSize.height)),
        duration: null,
        assetId: null,
      },
      timeMs: actualTimeMs,
      durationMs,
    };
  } catch (error) {
    if (outputUri && !ownedPosterUris.has(outputUri)) deleteGeneratedFile(outputUri);
    throw videoPosterError(error, VIDEO_POSTER_ERROR_CODES.encodeFailed);
  } finally {
    releaseShared(rendered);
    releaseShared(context);
    thumbnails?.forEach?.(releaseShared);
    releaseShared(player);
  }
}

export function generateVideoPosterAsset(videoAsset, options = {}) {
  const workTracker = createVideoPosterWorkTracker();
  const result = generateVideoPosterAssetOperation(videoAsset, options, workTracker);
  void result.then(
    () => workTracker.finish(),
    () => workTracker.finish(),
  );
  return markVideoPosterPermitUntil(result, workTracker.settled);
}

export function releaseVideoPosterAsset(asset) {
  const uri = typeof asset?.uri === "string" ? asset.uri : "";
  if (!ownedPosterUris.delete(uri)) return false;
  deleteGeneratedFile(uri);
  return true;
}
