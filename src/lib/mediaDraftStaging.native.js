import { Directory, File, Paths } from "expo-file-system";
import { isPersistableMediaDraftUri, mediaDraftFileName, safeMediaDraftSegment } from "../domain/mediaDraftStaging.mjs";
import { mediaSourceSizeAllowed } from "../domain/mediaEdit.mjs";
import { resolveMediaMimeType } from "../domain/mediaMime.mjs";
import {
  MEDIA_PHOTO_SOURCE_MAX_BYTES,
  MEDIA_VIDEO_SOURCE_MAX_BYTES,
  mediaUploadLimitLabel,
} from "../domain/mediaUploadPolicy.mjs";

const mediaSizeError = (asset) => asset?.kind === "video"
  ? `That clip is over PIT's ${mediaUploadLimitLabel(MEDIA_VIDEO_SOURCE_MAX_BYTES)} limit. Export a smaller MP4 first.`
  : `That photo is over PIT's ${mediaUploadLimitLabel(MEDIA_PHOTO_SOURCE_MAX_BYTES)} limit. Export a smaller copy first.`;


const STUDIO_ROOT_NAME = "pit-studio";
const normalizedUri = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
const studioRoot = () => new Directory(Paths.document, STUDIO_ROOT_NAME);

function detectedMediaType(input, asset) {
  let handle;
  try {
    handle = input.open();
    const bytes = handle.readBytes(96);
    return resolveMediaMimeType({
      bytes,
      declaredType: asset?.mimeType,
      fileName: asset?.fileName || asset?.uri,
    });
  } catch {
    return resolveMediaMimeType({ declaredType: asset?.mimeType, fileName: asset?.fileName || asset?.uri });
  } finally {
    try { handle?.close?.(); } catch { /* architecture: allow-empty-catch -- source sniffing already completed and handle cleanup is best-effort */ }
  }
}

function isInsideDirectory(uri, directory) {
  const child = normalizedUri(uri);
  const parent = normalizedUri(directory?.uri);
  return !!child && !!parent && (child === parent || child.startsWith(`${parent}/`));
}

function isManagedDraftUri(uri) {
  return isPersistableMediaDraftUri(uri) && isInsideDirectory(uri, studioRoot());
}

export async function stageMediaDraftAssets(assets, { ownerId, projectId } = {}) {
  const source = Array.isArray(assets) ? assets : [];
  if (!source.length) return [];
  const owner = safeMediaDraftSegment(ownerId, "guest");
  const project = safeMediaDraftSegment(projectId, "draft");
  const directory = new Directory(Paths.document, STUDIO_ROOT_NAME, owner, project);
  directory.create({ idempotent: true, intermediates: true });
  const copied = [];
  try {
    const staged = [];
    for (let index = 0; index < source.length; index += 1) {
      const asset = source[index];
      if (isManagedDraftUri(asset?.durableLocalUri || asset?.uri)) {
        const existing = new File(asset.durableLocalUri || asset.uri);
        if (existing.exists) {
          staged.push({ ...asset, uri: existing.uri, durableLocalUri: existing.uri, draftManaged: true, runtimeFile: null });
          continue;
        }
      }
      if (!asset?.uri) throw new Error("The selected media did not include a local file.");
      const input = new File(asset.uri);
      if (!input.exists || !Number.isFinite(Number(input.size)) || Number(input.size) < 1) {
        throw new Error("The selected media could not be copied into the PIT draft.");
      }
      if (!mediaSourceSizeAllowed(asset, input.size)) {
        throw new Error(mediaSizeError(asset));
      }
      const detectedMimeType = detectedMediaType(input, asset);
      const outputName = mediaDraftFileName(asset, index, { detectedMimeType });
      const output = new File(directory, outputName);
      await input.copy(output, { overwrite: true });
      copied.push(output);
      if (!mediaSourceSizeAllowed(asset, output.size)) {
        throw new Error(mediaSizeError(asset));
      }
      staged.push({
        ...asset,
        uri: output.uri,
        durableLocalUri: output.uri,
        draftManaged: true,
        runtimeFile: null,
        fileName: outputName,
        mimeType: detectedMimeType || asset.mimeType || null,
        fileSize: Number(output.size) || asset.fileSize || 0,
      });
    }
    return staged;
  } catch (error) {
    for (const file of copied) {
      try { if (file.exists) file.delete(); } catch { /* architecture: allow-empty-catch -- preserve the staging failure if best-effort cleanup also fails */ }
    }
    throw error;
  }
}

export async function recoverMediaDraftAssets(assets) {
  return (Array.isArray(assets) ? assets : []).filter((asset) => {
    if (asset?.sourceUrl) return true;
    const uri = asset?.durableLocalUri || asset?.uri;
    if (!isManagedDraftUri(uri)) return false;
    try { return new File(uri).exists; } catch { return false; }
  });
}

export async function releaseMediaDraftAsset(asset) {
  const uri = typeof asset === "string" ? asset : (asset?.durableLocalUri || asset?.uri);
  if (!isManagedDraftUri(uri)) return false;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
    return true;
  } catch {
    return false;
  }
}

export async function releaseMediaDraftAssets(assets) {
  await Promise.all((Array.isArray(assets) ? assets : []).map((asset) => releaseMediaDraftAsset(asset)));
}

export async function deleteMediaDraftsForOwner(ownerId) {
  if (!ownerId) return false;
  const owner = safeMediaDraftSegment(ownerId, "");
  if (!owner) return false;
  const directory = new Directory(Paths.document, STUDIO_ROOT_NAME, owner);
  if (!isInsideDirectory(directory.uri, studioRoot()) || normalizedUri(directory.uri) === normalizedUri(studioRoot().uri)) return false;
  try {
    if (directory.exists) directory.delete();
    return true;
  } catch {
    return false;
  }
}
