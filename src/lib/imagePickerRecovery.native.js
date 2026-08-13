// Only Android can destroy the activity that launched the system picker.
export const getPendingImagePickerResult = () => Promise.resolve(null);
