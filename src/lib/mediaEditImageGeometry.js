import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { buildPhotoTransformPlan } from "../domain/mediaEdit.mjs";

export function preferredPhotoFormat(asset = {}, requestedFormat) {
  if (requestedFormat === "png" || requestedFormat === "jpeg" || requestedFormat === "webp") return requestedFormat;
  return asset.mimeType === "image/png" ? "png" : "jpeg";
}

export function editedPhotoFileName(asset = {}, format = "jpeg") {
  const extension = format === "png" ? "png" : format === "webp" ? "webp" : "jpg";
  const supplied = String(asset.fileName || "pit-photo").split(/[\\/]/).pop();
  const stem = supplied.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9._ -]+/gi, " ").trim() || "pit-photo";
  return `${stem.slice(0, 150)}-pit-edit.${extension}`;
}

function expoFormat(format) {
  if (format === "png") return SaveFormat.PNG;
  if (format === "webp") return SaveFormat.WEBP;
  return SaveFormat.JPEG;
}

export async function renderPhotoGeometry(asset, options = {}) {
  if (!asset?.uri) throw new Error("PIT Studio needs a readable image URI before it can render.");
  const plan = buildPhotoTransformPlan({
    width: asset.width,
    height: asset.height,
    edit: asset.edit,
    maxEdge: options.maxEdge,
  });
  const format = preferredPhotoFormat(asset, options.format);
  const context = ImageManipulator.manipulate(asset.uri);
  let imageRef;
  try {
    for (const action of plan.actions) {
      if (action.rotate !== undefined) context.rotate(action.rotate);
      else if (action.flip) context.flip(action.flip);
      else if (action.crop) context.crop(action.crop);
      else if (action.resize) context.resize(action.resize);
    }
    imageRef = await context.renderAsync();
    const result = await imageRef.saveAsync({
      compress: format === "png" ? 1 : Math.min(1, Math.max(0.4, Number(options.quality) || 0.92)),
      format: expoFormat(format),
    });
    return { ...result, format, plan };
  } finally {
    imageRef?.release?.();
    context.release?.();
  }
}
