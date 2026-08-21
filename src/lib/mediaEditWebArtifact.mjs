export function createWebMediaArtifact(blob, options = {}, environment = {}) {
  if (!blob || !Number.isFinite(Number(blob.size)) || Number(blob.size) < 1) {
    throw new Error("PIT Studio cannot upload an empty browser rendition.");
  }
  const FileConstructor = environment.FileConstructor ?? globalThis.File;
  const createObjectURL = environment.createObjectURL ?? globalThis.URL?.createObjectURL?.bind(globalThis.URL);
  if (typeof createObjectURL !== "function") throw new Error("This browser cannot create a local rendition URL.");
  const fileName = String(options.fileName || "pit-media.jpg").slice(0, 180);
  const mimeType = String(options.mimeType || blob.type || "application/octet-stream");
  const file = typeof FileConstructor === "function"
    ? new FileConstructor([blob], fileName, { type: mimeType, lastModified: options.lastModified || Date.now() })
    : blob;
  return { file, fileName, uri: createObjectURL(file), fileSize: Number(file.size), mimeType };
}
