import { effectiveAdjustments, mediaEditFingerprint } from "../domain/mediaEdit.mjs";
import {
  buildMediaColorMatrix,
  deterministicGrain,
  mediaAdjustmentsAreIdentity,
  vignetteFactor,
} from "./mediaEditColor.mjs";
import { createMediaEditCapabilities } from "./mediaEditCapabilities.mjs";
import { editedPhotoFileName, preferredPhotoFormat, renderPhotoGeometry } from "./mediaEditImageGeometry";
import { createWebMediaArtifact } from "./mediaEditWebArtifact.mjs";

const hasCanvas = typeof document !== "undefined" && typeof document.createElement === "function";
const WEB_PHOTO_MAX_EDGE = 1600;

export const mediaEditImageCapabilities = createMediaEditCapabilities({
  platform: "web",
  imageGeometry: hasCanvas,
  imageRaster: hasCanvas,
});

function loadImage(uri) {
  return new Promise((resolve, reject) => {
    const image = new globalThis.Image();
    if (/^https?:/i.test(uri)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The browser could not decode this photo. Check the source CORS policy."));
    image.src = uri;
  });
}

function outputMime(format) {
  return format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the edited photo.")),
    type,
    quality,
  ));
}

function aborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Photo processing was cancelled.");
  error.name = "AbortError";
  throw error;
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

async function renderPixels(context, width, height, adjustments, signal) {
  const frame = context.getImageData(0, 0, width, height);
  const pixels = frame.data;
  const matrix = buildMediaColorMatrix(adjustments);
  const grainStrength = Math.max(0, Number(adjustments.grain) || 0) * 0.22;
  const shadows = Math.max(-0.5, Math.min(0.5, Number(adjustments.shadows) || 0));
  const highlights = Math.max(-0.5, Math.min(0.5, Number(adjustments.highlights) || 0));
  const clampUnit = (value) => Math.max(0, Math.min(1, value));
  for (let y = 0; y < height; y += 1) {
    if (y > 0 && y % 64 === 0) {
      aborted(signal);
      await yieldToBrowser();
    }
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] / 255;
      const green = pixels[offset + 1] / 255;
      const blue = pixels[offset + 2] / 255;
      const alpha = pixels[offset + 3] / 255;
      const transformedRed = clampUnit(matrix[0] * red + matrix[1] * green + matrix[2] * blue + matrix[3] * alpha + matrix[4]);
      const transformedGreen = clampUnit(matrix[5] * red + matrix[6] * green + matrix[7] * blue + matrix[8] * alpha + matrix[9]);
      const transformedBlue = clampUnit(matrix[10] * red + matrix[11] * green + matrix[12] * blue + matrix[13] * alpha + matrix[14]);
      const luminance = transformedRed * 0.2126 + transformedGreen * 0.7152 + transformedBlue * 0.0722;
      const tonalDelta = shadows * (1 - luminance) * (1 - luminance) * 0.45
        + highlights * luminance * luminance * 0.35;
      const edge = vignetteFactor(x, y, width, height, adjustments.vignette);
      const noise = deterministicGrain(x, y) * grainStrength * 255;
      pixels[offset] = Math.max(0, Math.min(255, Math.round(clampUnit(transformedRed + tonalDelta) * 255 * edge + noise)));
      pixels[offset + 1] = Math.max(0, Math.min(255, Math.round(clampUnit(transformedGreen + tonalDelta) * 255 * edge + noise)));
      pixels[offset + 2] = Math.max(0, Math.min(255, Math.round(clampUnit(transformedBlue + tonalDelta) * 255 * edge + noise)));
      pixels[offset + 3] = Math.round(clampUnit(matrix[15] * red + matrix[16] * green + matrix[17] * blue + matrix[18] * alpha + matrix[19]) * 255);
    }
  }
  if (adjustments.sharpen > 0.0001) {
    const source = new Uint8ClampedArray(pixels);
    const strength = Math.min(0.75, adjustments.sharpen * 1.5);
    for (let y = 1; y < height - 1; y += 1) {
      if (y > 1 && y % 48 === 0) {
        aborted(signal);
        await yieldToBrowser();
      }
      for (let x = 1; x < width - 1; x += 1) {
        const center = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const sharpened = source[center + channel] * (1 + strength * 4)
            - strength * source[center - 4 + channel]
            - strength * source[center + 4 + channel]
            - strength * source[center - width * 4 + channel]
            - strength * source[center + width * 4 + channel];
          pixels[center + channel] = Math.max(0, Math.min(255, Math.round(sharpened)));
        }
      }
    }
  }
  context.putImageData(frame, 0, 0);
}

export async function exportEditedImage(asset, options = {}) {
  if (!hasCanvas) throw new Error("This browser does not expose a Canvas 2D renderer.");
  aborted(options.signal);
  const format = preferredPhotoFormat(asset, options.format);
  const geometry = await renderPhotoGeometry(asset, { ...options, maxEdge: options.maxEdge || WEB_PHOTO_MAX_EDGE, format });
  const canvas = document.createElement("canvas");
  try {
    const image = await loadImage(geometry.uri);
    aborted(options.signal);
    canvas.width = geometry.width;
    canvas.height = geometry.height;
    const context = canvas.getContext("2d", { alpha: format === "png", willReadFrequently: true });
    if (!context) throw new Error("This browser could not start a Canvas 2D photo renderer.");
    context.drawImage(image, 0, 0, geometry.width, geometry.height);
    const adjustments = effectiveAdjustments(geometry.plan.edit);
    if (!mediaAdjustmentsAreIdentity(adjustments)) await renderPixels(context, geometry.width, geometry.height, adjustments, options.signal);

    aborted(options.signal);
    const type = outputMime(format);
    const blob = await canvasBlob(canvas, type, format === "png" ? undefined : Number(options.quality) || 0.92);
    aborted(options.signal);
    const artifact = createWebMediaArtifact(blob, { fileName: editedPhotoFileName(asset, format), mimeType: type });
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      URL.revokeObjectURL(artifact.uri);
      return true;
    };
    return {
      type: "image",
      uri: artifact.uri,
      file: artifact.file,
      fileName: artifact.fileName,
      width: geometry.width,
      height: geometry.height,
      fileSize: artifact.fileSize,
      mimeType: type,
      duration: null,
      assetId: null,
      format,
      recipe: geometry.plan.edit,
      fingerprint: mediaEditFingerprint(geometry.plan.edit),
      engine: "expo-image-manipulator+canvas2d",
      release,
      dispose: release,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    if (/^blob:/i.test(String(geometry.uri || ""))) {
      try { URL.revokeObjectURL(geometry.uri); } catch {}
    }
  }
}
