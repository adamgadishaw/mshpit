import * as ImagePicker from "expo-image-picker";

// Native SDK 57 already returns passthrough originals and owns its system UI.
// Account/unmount fencing in the composer discards any late native result.
export function launchComposerMediaLibrary(options) {
  return ImagePicker.launchImageLibraryAsync(options);
}
