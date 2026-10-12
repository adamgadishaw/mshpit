// Retry the original verified URL once; never rewrite it or send it to a proxy.
export const initialNewsPhotoAttempt = () => ({ attempt: 0, retried: false, failed: false });
export function failNewsPhotoAttempt(state, attempt) {
  if (state.attempt !== attempt || state.failed) return state;
  return state.retried ? { ...state, failed: true }
    : { attempt: state.attempt + 1, retried: true, failed: false };
}
export const retryNewsPhotoAttempt = (state) => ({ attempt: state.attempt + 1, retried: false, failed: false });
