import { profileImageContract } from "../domain/profileImagePolicy.mjs";

function aborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Photo processing was cancelled.");
  error.name = "AbortError";
  throw error;
}

function centerCrop(width, height, targetWidth, targetHeight) {
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = width / height;
  if (sourceRatio > targetRatio) {
    const cropWidth = height * targetRatio;
    return { x: (width - cropWidth) / 2, y: 0, width: cropWidth, height };
  }
  const cropHeight = width / targetRatio;
  return { x: 0, y: (height - cropHeight) / 2, width, height: cropHeight };
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob?.size ? resolve(blob) : reject(new Error("The browser could not encode this profile photo.")),
    "image/jpeg",
    0.86,
  ));
}

export async function normalizeProfileImageAsset(asset, purpose, { signal } = {}) {
  const contract = profileImageContract(purpose);
  if (!contract || typeof document === "undefined" || typeof createImageBitmap !== "function") return asset;
  const source = asset?.file || (asset?.uri ? await (await fetch(asset.uri, { signal })).blob() : null);
  if (!source) return asset;
  aborted(signal);
  let bitmap;
  try {
    try { bitmap = await createImageBitmap(source, { imageOrientation: "from-image" }); }
    catch { bitmap = await createImageBitmap(source); }
    aborted(signal);
    const crop = centerCrop(bitmap.width, bitmap.height, contract.outputWidth, contract.outputHeight);
    const canvas = document.createElement("canvas");
    canvas.width = contract.outputWidth;
    canvas.height = contract.outputHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser could not start the profile photo renderer.");
    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      contract.outputWidth,
      contract.outputHeight,
    );
    const blob = await canvasBlob(canvas);
    aborted(signal);
    const fileName = `pit-${purpose}-camera.jpg`;
    const file = typeof globalThis.File === "function"
      ? new globalThis.File([blob], fileName, { type: "image/jpeg", lastModified: Date.now() })
      : blob;
    const outputUri = URL.createObjectURL(file);
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      URL.revokeObjectURL(outputUri);
      return true;
    };
    return {
      ...asset,
      type: "image",
      uri: outputUri,
      file,
      fileName,
      mimeType: "image/jpeg",
      fileSize: file.size,
      width: contract.outputWidth,
      height: contract.outputHeight,
      release,
      dispose: release,
    };
  } finally {
    bitmap?.close?.();
  }
}
