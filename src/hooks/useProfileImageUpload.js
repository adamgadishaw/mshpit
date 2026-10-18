// Native keeps its existing system picker and upload behavior. The interactive
// browser preview is resolved only by the .web implementation.
const uploadProfileImage = (asset, _purpose, { signal, upload }) => upload(asset, { signal });
export function useProfileImageUpload() {
  return { uploadProfileImage, imageCropDialog: null };
}
