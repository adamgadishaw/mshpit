import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { profileImageContract } from "../domain/profileImagePolicy.mjs";

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Photo processing was cancelled.");
  error.name = "AbortError";
  throw error;
}

function removeCacheFile(uri) {
  if (!uri) return false;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
    return true;
  } catch {
    return false;
  }
}

function centerCrop(width, height, targetWidth, targetHeight) {
  const sourceWidth = Math.max(1, Math.round(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 1));
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceRatio > targetRatio) cropWidth = Math.max(1, Math.round(sourceHeight * targetRatio));
  else if (sourceRatio < targetRatio) cropHeight = Math.max(1, Math.round(sourceWidth / targetRatio));
  return {
    originX: Math.max(0, Math.floor((sourceWidth - cropWidth) / 2)),
    originY: Math.max(0, Math.floor((sourceHeight - cropHeight) / 2)),
    width: cropWidth,
    height: cropHeight,
  };
}

export async function normalizeProfileImageAsset(asset, purpose, { signal } = {}) {
  const contract = profileImageContract(purpose);
  if (!contract || !asset?.uri) return asset;
  abortIfNeeded(signal);

  const decodeContext = ImageManipulator.manipulate(asset.uri);
  let decodedRef;
  let decoded;
  try {
    decodedRef = await decodeContext.renderAsync();
    abortIfNeeded(signal);
    decoded = await decodedRef.saveAsync({ compress: 0.92, format: SaveFormat.JPEG });
  } finally {
    decodedRef?.release?.();
    decodeContext.release?.();
  }

  const crop = centerCrop(
    decoded?.width || asset.width,
    decoded?.height || asset.height,
    contract.outputWidth,
    contract.outputHeight,
  );
  let outputContext;
  let outputRef;
  let output;
  try {
    outputContext = ImageManipulator.manipulate(decoded.uri);
    outputContext.crop(crop);
    outputContext.resize({ width: contract.outputWidth, height: contract.outputHeight });
    outputRef = await outputContext.renderAsync();
    abortIfNeeded(signal);
    output = await outputRef.saveAsync({ compress: 0.86, format: SaveFormat.JPEG });
  } finally {
    outputRef?.release?.();
    outputContext?.release?.();
    removeCacheFile(decoded?.uri);
  }

  try {
    const outputFile = new File(output.uri);
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      return removeCacheFile(output.uri);
    };
    return {
      ...asset,
      type: "image",
      uri: output.uri,
      fileName: `pit-${purpose}-camera.jpg`,
      mimeType: "image/jpeg",
      fileSize: Number(outputFile.size) || 0,
      width: contract.outputWidth,
      height: contract.outputHeight,
      release,
      dispose: release,
    };
  } catch (error) {
    removeCacheFile(output?.uri);
    throw error;
  }
}
