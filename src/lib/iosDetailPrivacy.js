// Retained detail panes are iOS-only. Android and web preserve their existing
// rendering and privacy behavior without an extra subscriber or Store hook.
export const getIOSDetailPrivacySnapshot = () => 0;
export const subscribeIOSDetailPrivacy = () => () => {};
export const invalidateIOSDetailPrivacy = () => 0;
