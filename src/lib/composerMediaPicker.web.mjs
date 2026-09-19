import { MEDIA_POST_MAX_ATTACHMENTS } from "../domain/mediaUploadPolicy.mjs";

// Only URLs created by this picker may be revoked. Other components can own
// blob URLs too; never revoke an arbitrary draft or caller-provided URL.
const ownedUrls = new Map();
export function releaseComposerPickerAsset(asset) {
  const uri = asset?.uri;
  const revoke = ownedUrls.get(uri);
  if (!revoke) return false;
  ownedUrls.delete(uri);
  revoke();
  return true;
}

// Expo's web picker eagerly decodes every selected image/video in parallel,
// before resolving, and metadata events have no deadline on Safari. Metadata
// is optional here: select File handles instantly, then let the existing
// sequential, byte-sniffed upload pipeline verify dimensions and duration.
export function launchComposerMediaLibrary(options = {}, { signal, document: doc = globalThis.document, urlApi = globalThis.URL } = {}) {
  if (!doc?.body || signal?.aborted) return Promise.resolve({ canceled: true, assets: null });
  const limit = Math.max(1, Math.min(MEDIA_POST_MAX_ATTACHMENTS, Math.floor(Number(options.selectionLimit) || 1)));
  const input = doc.createElement("input");
  input.type = "file";
  input.accept = "image/*,video/mp4,video/quicktime,video/x-m4v,video/*";
  input.multiple = options.allowsMultipleSelection === true;
  input.style.display = "none";
  input.setAttribute("data-testid", "composer-file-input");
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      input.removeEventListener("change", changed);
      input.removeEventListener("cancel", canceled);
      signal?.removeEventListener("abort", canceled);
      input.remove();
    };
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(result);
    };
    const canceled = () => finish({ canceled: true, assets: null });
    const changed = () => {
      if (settled || signal?.aborted) { canceled(); return; }
      const assets = [];
      try {
        const count = Math.min(input.files?.length || 0, input.multiple ? limit : 1);
        for (let index = 0; index < count; index += 1) {
          const file = input.files[index];
          if (!file) continue;
          const uri = urlApi.createObjectURL(file);
          ownedUrls.set(uri, () => urlApi.revokeObjectURL(uri));
          assets.push({ uri, file, fileName: file.name, fileSize: file.size,
            mimeType: file.type, width: 0, height: 0,
            type: /^video\//i.test(file.type) || /\.(?:mp4|m4v|mov|webm)$/i.test(file.name) ? "video" : "image" });
        }
        finish({ canceled: assets.length === 0, assets: assets.length ? assets : null,
          omittedCount: Math.max(0, (input.files?.length || 0) - count) });
      } catch (error) {
        assets.forEach(releaseComposerPickerAsset);
        finish(null, error);
      }
    };
    input.addEventListener("change", changed);
    input.addEventListener("cancel", canceled);
    signal?.addEventListener("abort", canceled, { once: true });
    try {
      doc.body.appendChild(input);
      // No await precedes this real click: Safari requires the originating
      // user activation to open Photos. Do not replace it with a lazy import.
      input.click();
    } catch (error) { finish(null, error); }
  });
}
