// Android/web retain their original image and refresh behavior.
const INERT = Object.freeze({ value: null, isCurrent: () => true, accept: () => {} });
export function FeedImageRetryProvider({ children }) { return children; }
export function useFeedImageRetry() { return INERT; }
export function useFeedImageRetryPulse() { return null; }
