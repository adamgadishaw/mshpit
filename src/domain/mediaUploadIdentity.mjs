export function stableMediaUploadToken(value, prefix) {
  const input = String(value || "media");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const readable = input.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 70) || "media";
  return `${prefix}:${readable}:${(hash >>> 0).toString(36)}`.slice(0, 120);
}

export function mediaSourceClientAssetId({ localId, fileSize, contentType, name } = {}) {
  return stableMediaUploadToken(`${localId}:${fileSize}:${contentType}:${name}`, "studio-asset");
}
