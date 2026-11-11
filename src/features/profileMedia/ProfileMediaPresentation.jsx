// iOS presentation and retry ownership never enter the Android/web bundle.
const INERT = Object.freeze({ retryValue: null });
export function useProfileMediaPresentation() { return INERT; }
export function ProfileMediaRetryBoundary({ children }) { return children; }
export function ProfileBannerCover() { return null; }
export function ProfileGallery() { return null; }
