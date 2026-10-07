import { api } from "../../lib/api";
import { loadNewsroomMedia, uploadNewsroomMedia } from "./newsroomMedia.mjs";
const services = { apiCall: api, uploadOriginal: async (options) => {
  const { uploadOriginalMediaAsset } = await import("../../lib/mediaAssetUpload.js");
  return uploadOriginalMediaAsset(options);
} };
export const uploadSelfWrittenMedia = (options) => uploadNewsroomMedia(options, services);
export const loadSelfWrittenMedia = (options) => loadNewsroomMedia(options, services);
export const uploadSelfWrittenPhoto = (options) => uploadSelfWrittenMedia({ ...options, kind: "image" });
export const loadSelfWrittenPhoto = (options) => loadSelfWrittenMedia({ ...options, kind: "image" });
