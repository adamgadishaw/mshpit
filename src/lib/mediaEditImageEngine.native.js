import { File, Paths } from "expo-file-system";
import {
  BlendMode,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
} from "@shopify/react-native-skia";
import { effectiveAdjustments, mediaEditFingerprint } from "../domain/mediaEdit.mjs";
import { buildMediaColorMatrix, mediaAdjustmentsAreIdentity } from "./mediaEditColor.mjs";
import { createMediaEditCapabilities } from "./mediaEditCapabilities.mjs";
import { editedPhotoFileName, preferredPhotoFormat, renderPhotoGeometry } from "./mediaEditImageGeometry";

export const mediaEditImageCapabilities = createMediaEditCapabilities({
  platform: "native",
  imageGeometry: true,
  imageRaster: true,
});

const TONAL_RANGE_EFFECT = Skia.RuntimeEffect.Make(`
  uniform shader image;
  uniform float highlights;
  uniform float shadows;
  half4 main(float2 xy) {
    half4 color = image.eval(xy);
    float luminance = dot(color.rgb, half3(0.2126, 0.7152, 0.0722));
    float shadowMask = (1.0 - luminance) * (1.0 - luminance);
    float highlightMask = luminance * luminance;
    float delta = shadows * shadowMask * 0.45 + highlights * highlightMask * 0.35;
    color.rgb = clamp(color.rgb + half3(delta), 0.0, 1.0);
    return color;
  }
`);

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function imageFormat(format) {
  return format === "png" ? ImageFormat.PNG : format === "webp" ? ImageFormat.WEBP : ImageFormat.JPEG;
}

function extension(format) {
  return format === "png" ? "png" : format === "webp" ? "webp" : "jpg";
}

function mimeType(format) {
  return format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
}

function cacheFileRelease(uri) {
  let released = false;
  return () => {
    if (released) return false;
    released = true;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
      return true;
    } catch {
      return false;
    }
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Photo processing was cancelled.");
  error.name = "AbortError";
  throw error;
}

function drawSpatialEffects(canvas, width, height, adjustments) {
  const rect = Skia.XYWHRect(0, 0, width, height);
  if (adjustments.vignette > 0.0001) {
    const paint = Skia.Paint();
    const shader = Skia.Shader.MakeRadialGradient(
      Skia.Point(width / 2, height / 2),
      Math.hypot(width, height) / 2,
      [Skia.Color("rgba(0,0,0,0)"), Skia.Color("rgba(0,0,0,0)"), Skia.Color(`rgba(0,0,0,${adjustments.vignette})`)],
      [0, 0.42, 1],
      TileMode.Clamp,
    );
    paint.setShader(shader);
    canvas.drawRect(rect, paint);
    shader.dispose();
    paint.dispose();
  }
  if (adjustments.grain > 0.0001) {
    const paint = Skia.Paint();
    const shader = Skia.Shader.MakeFractalNoise(0.32, 0.32, 1, 41, width, height);
    paint.setShader(shader);
    paint.setBlendMode(BlendMode.SoftLight);
    paint.setAlphaf(Math.min(0.3, adjustments.grain * 0.72));
    canvas.drawRect(rect, paint);
    shader.dispose();
    paint.dispose();
  }
}

function makeNativeImageFilter(adjustments) {
  let tonalBuilder = null;
  let tonalFilter = null;
  let sharpenFilter = null;
  const needsTonal = Math.abs(adjustments.highlights) > 0.0001 || Math.abs(adjustments.shadows) > 0.0001;
  if (needsTonal) {
    if (!TONAL_RANGE_EFFECT) throw new Error("Skia could not compile PIT Studio's tonal-range renderer.");
    tonalBuilder = Skia.RuntimeShaderBuilder(TONAL_RANGE_EFFECT);
    tonalBuilder.setUniform("highlights", [adjustments.highlights]);
    tonalBuilder.setUniform("shadows", [adjustments.shadows]);
    tonalFilter = Skia.ImageFilter.MakeRuntimeShader(tonalBuilder, "image");
  }
  if (adjustments.sharpen > 0.0001) {
    const strength = Math.min(0.75, adjustments.sharpen * 1.5);
    sharpenFilter = Skia.ImageFilter.MakeMatrixConvolution(
      3,
      3,
      [0, -strength, 0, -strength, 1 + strength * 4, -strength, 0, -strength, 0],
      1,
      0,
      1,
      1,
      TileMode.Clamp,
      false,
      tonalFilter,
    );
  }
  return {
    filter: sharpenFilter || tonalFilter,
    dispose() {
      sharpenFilter?.dispose?.();
      tonalFilter?.dispose?.();
      tonalBuilder?.dispose?.();
    },
  };
}

export async function exportEditedImage(asset, options = {}) {
  throwIfAborted(options.signal);
  const format = preferredPhotoFormat(asset, options.format);
  const geometry = await renderPhotoGeometry(asset, { ...options, format });
  if (options.signal?.aborted) {
    cacheFileRelease(geometry.uri)();
    throwIfAborted(options.signal);
  }
  const adjustments = effectiveAdjustments(geometry.plan.edit);
  if (mediaAdjustmentsAreIdentity(adjustments)) {
    const cached = new File(geometry.uri);
    const release = cacheFileRelease(geometry.uri);
    return {
      type: "image",
      uri: geometry.uri,
      fileName: editedPhotoFileName(asset, format),
      width: geometry.width,
      height: geometry.height,
      mimeType: mimeType(format),
      fileSize: cached.size || 0,
      duration: null,
      assetId: null,
      format,
      recipe: geometry.plan.edit,
      engine: "expo-image-manipulator",
      release,
      dispose: release,
    };
  }

  let data;
  let source;
  let surface;
  let snapshot;
  let paint;
  let colorFilter;
  let imageFilter;
  try {
    data = await Skia.Data.fromURI(geometry.uri);
    source = Skia.Image.MakeImageFromEncoded(data);
    if (!source) throw new Error("Skia could not decode the prepared photo.");
    surface = Skia.Surface.MakeOffscreen(geometry.width, geometry.height, { colorSpace: "srgb" });
    if (!surface) throw new Error("Skia could not allocate an offscreen photo surface.");

    paint = Skia.Paint();
    paint.setAntiAlias(true);
    colorFilter = Skia.ColorFilter.MakeMatrix(buildMediaColorMatrix(adjustments));
    paint.setColorFilter(colorFilter);
    imageFilter = makeNativeImageFilter(adjustments);
    if (imageFilter.filter) paint.setImageFilter(imageFilter.filter);
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color("transparent"));
    canvas.drawImageRectOptions(
      source,
      Skia.XYWHRect(0, 0, source.width(), source.height()),
      Skia.XYWHRect(0, 0, geometry.width, geometry.height),
      FilterMode.Linear,
      MipmapMode.None,
      paint,
    );
    drawSpatialEffects(canvas, geometry.width, geometry.height, adjustments);
    surface.flush();
    snapshot = surface.makeImageSnapshot();
    const bytes = snapshot.encodeToBytes(imageFormat(format), format === "png" ? 100 : Math.round((Number(options.quality) || 0.92) * 100));
    if (!bytes?.byteLength) throw new Error("Skia produced an empty photo export.");
    throwIfAborted(options.signal);

    const fingerprint = hashText(`${asset.id || asset.uri}:${mediaEditFingerprint(geometry.plan.edit)}`);
    const output = new File(Paths.cache, `pit-studio-${fingerprint}-${Date.now()}.${extension(format)}`);
    output.create({ overwrite: true, intermediates: true });
    output.write(bytes);
    const release = cacheFileRelease(output.uri);
    return {
      type: "image",
      uri: output.uri,
      fileName: editedPhotoFileName(asset, format),
      width: geometry.width,
      height: geometry.height,
      fileSize: bytes.byteLength,
      mimeType: mimeType(format),
      duration: null,
      assetId: null,
      format,
      recipe: geometry.plan.edit,
      engine: "expo-image-manipulator+skia-2.6.2",
      release,
      dispose: release,
    };
  } finally {
    imageFilter?.dispose?.();
    colorFilter?.dispose?.();
    paint?.dispose?.();
    snapshot?.dispose?.();
    surface?.dispose?.();
    source?.dispose?.();
    data?.dispose?.();
    try {
      const prepared = new File(geometry.uri);
      if (prepared.exists) prepared.delete();
    } catch {}
  }
}
