import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { profileImageContract, profileImageCropRectangle } from "../domain/profileImagePolicy.mjs";
import { profileCropPlan } from "../domain/profileCrop.mjs";

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Photo processing was cancelled.");
  error.name = "AbortError";
  throw error;
}
function removeCacheFile(uri) {
  if (!uri) return false;
  try { const file = new File(uri); if (file.exists) file.delete(); return true; }
  catch { return false; }
}

// Keep the orientation-corrected native pixels in memory. The previous native
// path saved JPEG twice (92%, then 86%) before the server's security re-encode.
// iOS uses just one high-quality encode, after the user-approved crop/resize.
export async function normalizeProfileImageAsset(asset, purpose, { signal } = {}) {
  const contract = profileImageContract(purpose);
  if (!contract || !asset?.uri) return asset;
  abortIfNeeded(signal);
  let decodeContext, decoded, context, rendered, output;
  try {
    if (asset.profileImageRef) decoded = asset.profileImageRef;
    else {
      decodeContext = ImageManipulator.manipulate(asset.uri);
      decoded = await decodeContext.renderAsync();
    }
    abortIfNeeded(signal);
    const selection = asset.profileCrop || profileCropPlan({ imageWidth: decoded.width, imageHeight: decoded.height,
      frameWidth: contract.outputWidth, frameHeight: contract.outputHeight }).selection;
    const rect = profileImageCropRectangle(selection, decoded.width, decoded.height, purpose);
    context = ImageManipulator.manipulate(decoded);
    context.crop({ originX: rect.x, originY: rect.y, width: rect.width, height: rect.height });
    context.resize({ width: contract.outputWidth, height: contract.outputHeight });
    rendered = await context.renderAsync();
    abortIfNeeded(signal);
    output = await rendered.saveAsync({ compress: 0.96, format: SaveFormat.JPEG });
    abortIfNeeded(signal);
    const outputFile = new File(output.uri);
    let released = false;
    const release = () => { if (released) return false; released = true; return removeCacheFile(output.uri); };
    // Do not carry a native image reference into the transport layer.
    const { profileImageRef: _imageRef, ...original } = asset;
    return { ...original, type: "image", uri: output.uri, fileName: `pit-${purpose}-camera.jpg`, mimeType: "image/jpeg",
      fileSize: Number(outputFile.size) || 0, width: contract.outputWidth, height: contract.outputHeight, release, dispose: release };
  } catch (error) {
    removeCacheFile(output?.uri);
    throw error;
  } finally {
    rendered?.release?.(); context?.release?.();
    if (!asset.profileImageRef) decoded?.release?.();
    decodeContext?.release?.();
  }
}
