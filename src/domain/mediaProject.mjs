import { MEDIA_POST_MAX_ATTACHMENTS } from "./mediaUploadPolicy.mjs";
import { defaultMediaEdit, mediaDraftAssetFromPicker, normalizeMediaDraftAsset } from "./mediaEdit.mjs";
import { isPersistableMediaDraftUri } from "./mediaDraftStaging.mjs";
import { mediaDisplayItems, mediaDisplayKind } from "./postMediaDisplay.mjs";

export const MEDIA_PROJECT_VERSION = 1;
export const MEDIA_PROJECT_MAX_ASSETS = MEDIA_POST_MAX_ATTACHMENTS;

const STATUSES = new Set(["selected", "editing", "rendering", "uploading", "finalizing", "ready", "failed"]);
const TRANSITIONS = Object.freeze({
  selected: new Set(["editing", "rendering", "uploading", "failed"]),
  editing: new Set(["selected", "rendering", "failed"]),
  rendering: new Set(["uploading", "failed"]),
  uploading: new Set(["finalizing", "ready", "failed"]),
  finalizing: new Set(["ready", "failed"]),
  ready: new Set(["editing", "failed"]),
  failed: new Set(["selected", "editing", "rendering", "uploading", "finalizing"]),
});

const remoteUrl = (value) => typeof value === "string" && /^https:\/\/[^\s]+$/i.test(value) ? value.slice(0, 2_000) : null;
const cleanId = (value) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,240}$/.test(value) ? value : null;
const progress = (value) => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));

export function normalizeMediaProjectAsset(value = {}, index = 0) {
  const base = normalizeMediaDraftAsset(value);
  const durableLocalUri = isPersistableMediaDraftUri(value.durableLocalUri || value.uri)
    ? String(value.durableLocalUri || value.uri)
    : null;
  const sourceUrl = remoteUrl(value.sourceUrl || value.uploadedUrl || (remoteUrl(base.uri) ? base.uri : null));
  const status = STATUSES.has(value.status) ? value.status : (sourceUrl ? "ready" : "selected");
  const assetId = cleanId(value.assetId);
  const localId = cleanId(value.id) || assetId || `media_${index + 1}`;
  const posterUrl = remoteUrl(value.posterUrl || (remoteUrl(base.posterUri) ? base.posterUri : null));
  return {
    ...base,
    uri: durableLocalUri || base.uri,
    id: localId,
    assetId,
    sourceUrl,
    posterUrl,
    status,
    progress: status === "ready" ? 1 : progress(value.progress),
    errorCode: status === "failed" && typeof value.errorCode === "string"
      ? value.errorCode.replace(/[^A-Z0-9_-]/gi, "").toUpperCase().slice(0, 48)
      : null,
    durableLocalUri,
    draftManaged: !!durableLocalUri,
    // Browser ImagePicker supplies the selected File separately from its blob
    // URL. Keep it only in live project memory; serializableMediaProject below
    // intentionally omits it so local bytes/path metadata never reach drafts,
    // analytics, the PIT JSON API, or device persistence.
    runtimeFile: value.runtimeFile && typeof value.runtimeFile.size === "number"
      ? value.runtimeFile
      : (value.file && typeof value.file.size === "number" ? value.file : null),
  };
}

export function normalizeMediaProject(value = {}) {
  const raw = Array.isArray(value) ? value : (Array.isArray(value.assets) ? value.assets : []);
  const assets = [];
  const ids = new Set();
  for (let index = 0; index < raw.length && assets.length < MEDIA_PROJECT_MAX_ASSETS; index += 1) {
    const normalized = normalizeMediaProjectAsset(raw[index], index);
    let id = normalized.id;
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${normalized.id.slice(0, 226)}:${suffix}`;
    ids.add(id);
    assets.push(id === normalized.id ? normalized : { ...normalized, id });
  }
  return { version: MEDIA_PROJECT_VERSION, assets };
}

function publishablePickerAsset(asset, { allowLivePhotoVideo = true } = {}) {
  if (asset?.type !== "livePhoto" || !allowLivePhotoVideo || !asset?.pairedVideoAsset?.uri) {
    // A Live Photo without a usable motion pair remains a normal still image.
    return asset?.type === "livePhoto" ? { ...asset, type: "image" } : asset;
  }
  const motion = asset.pairedVideoAsset;
  return {
    ...motion,
    type: "video",
    // Keep the unaltered still only as transient preview metadata. The video
    // verifier remains authoritative for the durable public poster.
    posterUri: asset.uri || null,
    posterTimeMs: 0,
  };
}

// Post media is published exactly as selected. This explicitly discards any
// stale Studio recipe that may survive in an older recoverable draft while
// preserving accessibility copy and the server-verified video poster flow.
// The source bytes still go through normal upload and verifier admission.
export function originalMediaProjectAsset(value = {}, index = 0) {
  const asset = normalizeMediaProjectAsset(value, index);
  return normalizeMediaProjectAsset({
    ...asset,
    edit: defaultMediaEdit(asset.kind, { durationMs: asset.durationMs }),
  }, index);
}

export function mediaProjectFromPicker(assets, nonce = Date.now().toString(36), options = {}) {
  const selected = (Array.isArray(assets) ? assets : [])
    .slice(0, MEDIA_PROJECT_MAX_ASSETS)
    .map((asset, index) => {
      const publishable = publishablePickerAsset(asset, options);
      return {
        ...mediaDraftAssetFromPicker(publishable, index),
        id: `local:${nonce}:${index + 1}`,
        runtimeFile: publishable?.file || null,
        status: "selected",
        progress: 0,
      };
    });
  return normalizeMediaProject(selected);
}

export function mediaProjectFromLegacyUrls(urls) {
  return normalizeMediaProject((Array.isArray(urls) ? urls : []).map((url, index) => ({
    id: `legacy:${index + 1}`,
    uri: url,
    sourceUrl: url,
    kind: /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(String(url)) ? "video" : "image",
    status: "ready",
  })));
}

// A post can carry a canonical legacy `photos` order plus only the descriptors
// that enrich some of those URLs (for example, a durable poster for one
// historical video). Treat the descriptor list as metadata, never as proof that
// it is the complete edit project; otherwise opening and saving an old mixed-
// media post can silently delete every unenriched image.
export function mediaProjectFromPost(post) {
  const items = mediaDisplayItems(post || {});
  const stableAssetIds = new Set((Array.isArray(post?.mediaAssetIds) ? post.mediaAssetIds : [])
    .filter((id) => typeof id === "string" && id));
  return normalizeMediaProject({
    assets: items.map((asset, index) => ({
      id: `server:${asset.id || index + 1}`,
      // Presentation-only legacy descriptors deliberately have IDs so cards
      // can reconcile them, but only the explicit server asset-id projection
      // authorizes a composer to send an ID back as a stable attachment.
      assetId: stableAssetIds.has(asset.id) ? asset.id : null,
      kind: mediaDisplayKind(asset),
      // Owners receive the immutable source for re-editing. The public URL is
      // kept separately so post payload reconciliation never leaks/replaces it.
      uri: asset.sourceUrl || asset.url || asset.uri,
      sourceUrl: asset.url || asset.uri,
      posterUri: asset.posterUrl || asset.posterUri || null,
      posterUrl: asset.posterUrl || asset.posterUri || null,
      posterTimeMs: asset.posterTimeMs,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      mimeType: asset.mimeType,
      edit: asset.editRecipe,
      altText: asset.altText,
      status: "ready",
    })),
  });
}

export function patchMediaProjectAsset(project, assetId, patch) {
  const current = normalizeMediaProject(project);
  const index = current.assets.findIndex((asset) => asset.id === assetId || asset.assetId === assetId);
  if (index < 0 || !patch || typeof patch !== "object" || Array.isArray(patch)) return current;
  const assets = current.assets.slice();
  const next = normalizeMediaProjectAsset({ ...assets[index], ...patch, id: assets[index].id }, index);
  assets[index] = { ...next, id: assets[index].id };
  return { ...current, assets };
}

export function transitionMediaProjectAsset(project, assetId, nextStatus, patch = {}) {
  const current = normalizeMediaProject(project);
  const asset = current.assets.find((item) => item.id === assetId || item.assetId === assetId);
  if (!asset || !STATUSES.has(nextStatus) || asset.status === nextStatus) return current;
  if (!TRANSITIONS[asset.status]?.has(nextStatus)) return current;
  return patchMediaProjectAsset(current, asset.id, {
    ...patch,
    status: nextStatus,
    progress: nextStatus === "ready" ? 1 : patch.progress,
    errorCode: nextStatus === "failed" ? patch.errorCode : null,
  });
}

function sameMediaProjectAsset(left, right) {
  if (!left || !right) return false;
  const leftIds = new Set([left.id, left.assetId].filter(Boolean));
  if ([right.id, right.assetId].some((value) => value && leftIds.has(value))) return true;
  return !!left.sourceUrl && left.sourceUrl === right.sourceUrl;
}

// Apply PIT Studio replacements in the order the editor returned. Existing
// selected items keep their occupied slots (so editing a subset cannot jump in
// front of untouched attachments), while newly selected items append in editor
// order. This same model drives the compatibility URL array sent to the server.
export function reconcileMediaProjectSelection(project, selection, replacements = []) {
  const current = normalizeMediaProject(project).assets;
  const selected = normalizeMediaProject({ assets: Array.isArray(selection) ? selection : [] }).assets;
  const ready = normalizeMediaProject({ assets: Array.isArray(replacements) ? replacements : [] }).assets;
  const resolved = selected.map((selectedAsset, index) => {
    const existing = current.find((asset) => sameMediaProjectAsset(asset, selectedAsset));
    const replacement = ready.find((asset) => sameMediaProjectAsset(asset, selectedAsset)
      || (existing && sameMediaProjectAsset(asset, existing)));
    return normalizeMediaProjectAsset({
      ...(existing || {}),
      ...selectedAsset,
      ...(replacement || {}),
      id: existing?.id || replacement?.id || selectedAsset.id,
    }, index);
  });

  let selectedIndex = 0;
  const assets = current.map((asset) => {
    if (!selected.some((candidate) => sameMediaProjectAsset(asset, candidate))) return asset;
    const replacement = resolved[selectedIndex];
    selectedIndex += 1;
    return replacement || asset;
  });
  assets.push(...resolved.slice(selectedIndex));
  return normalizeMediaProject({ assets });
}
export function removeMediaProjectAsset(project, assetId) {
  const current = normalizeMediaProject(project);
  return { ...current, assets: current.assets.filter((asset) => asset.id !== assetId && asset.assetId !== assetId) };
}

export function moveMediaProjectAsset(project, assetId, toIndex) {
  const current = normalizeMediaProject(project);
  const from = current.assets.findIndex((asset) => asset.id === assetId || asset.assetId === assetId);
  if (from < 0) return current;
  const destination = Math.min(current.assets.length - 1, Math.max(0, Math.trunc(Number(toIndex) || 0)));
  if (from === destination) return current;
  const assets = current.assets.slice();
  const [asset] = assets.splice(from, 1);
  assets.splice(destination, 0, asset);
  return { ...current, assets };
}

// Composer persistence may retain durable server descriptors and native files
// explicitly copied into PIT's account/project-scoped document directory. Raw
// picker/content/blob paths never cross this boundary.
export function serializableMediaProject(project) {
  const current = normalizeMediaProject(project);
  return {
    version: current.version,
    assets: current.assets
      .filter((asset) => asset.sourceUrl || asset.durableLocalUri)
      .map((asset) => ({
        id: asset.id,
        assetId: asset.assetId,
        kind: asset.kind,
        sourceUrl: asset.sourceUrl,
        ...(asset.durableLocalUri ? { uri: asset.durableLocalUri, durableLocalUri: asset.durableLocalUri } : {}),
        posterUrl: asset.posterUrl,
        posterTimeMs: asset.posterTimeMs,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        edit: asset.edit,
        altText: asset.altText,
        // A stable source can still be in an explicit pre-publish re-edit. Keep
        // that state so process-death recovery reopens Studio instead of quietly
        // posting the previous rendition.
        status: asset.status,
        errorCode: asset.errorCode,
      })),
  };
}

export function mediaProjectReady(project) {
  const assets = normalizeMediaProject(project).assets;
  return assets.length > 0 && assets.every((asset) => asset.status === "ready" && !!asset.sourceUrl);
}

export function mediaProjectPublishedMedia(project) {
  return normalizeMediaProject(project).assets
    .filter((asset) => asset.status === "ready" && asset.sourceUrl)
    .map((asset, position) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      url: asset.sourceUrl,
      posterUrl: asset.posterUrl,
      posterTimeMs: asset.kind === "video" ? asset.posterTimeMs : 0,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      edit: asset.edit,
      altText: asset.altText,
      position,
    }));
}

// Stable media can be sent to the server only when it accounts for the entire
// legacy photos projection in the same order. Returning null (rather than an
// empty array) keeps old URL-only edits on their compatibility path and avoids
// accidentally detaching a mixed/partially migrated post.
export function mediaAssetIdsMatchingPhotos(project, photos) {
  const published = mediaProjectPublishedMedia(project);
  const urls = Array.isArray(photos) ? photos.filter((item) => typeof item === "string") : [];
  if (published.length !== urls.length || published.some((item, index) => item.url !== urls[index] || !item.assetId)) return null;
  return published.map((item) => item.assetId);
}

// A pre-stable draft or historical post may already contain URL-only media.
// New attachments must stay on that compatibility path until the entire post
// can be represented by stable IDs; otherwise the stable objects would be
// published as loose URLs and later collected as unattached orphans.
export function mediaProjectRequiresLegacyUpload(project, photos) {
  const urls = Array.isArray(photos) ? photos.filter((item) => typeof item === "string") : [];
  return urls.length > 0 && mediaAssetIdsMatchingPhotos(project, urls) === null;
}
