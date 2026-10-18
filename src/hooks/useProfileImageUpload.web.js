import { reportMediaPickerError } from "../lib/mediaUpload";

async function uploadProfileImage(asset, purpose, options) {
  if (options.signal?.aborted) return null;
  try {
    const { uploadWithProfileCrop } = await import("../components/ProfileImageCropFlow");
    return options.signal?.aborted ? null : await uploadWithProfileCrop(asset, purpose, options);
  } catch (error) {
    if (!options.signal?.aborted) reportMediaPickerError(error, "Opening the profile photo preview");
    throw error;
  }
}

// Shared by the two lazy profile editors; dialog code loads on selection.
export function useProfileImageUpload() {
  return { uploadProfileImage, imageCropDialog: null };
}
