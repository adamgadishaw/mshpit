// Keep expo-image-picker out of the always-mounted web shell; LogScreen loads it
// only when somebody actually opens the composer.
export const getPendingImagePickerResult = () => Promise.resolve(null);
