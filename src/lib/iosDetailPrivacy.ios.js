import { createIOSDetailPrivacyEpoch } from "../domain/iosDetailPrivacyEpoch.mjs";

const epoch = createIOSDetailPrivacyEpoch();
export const getIOSDetailPrivacySnapshot = epoch.getSnapshot;
export const subscribeIOSDetailPrivacy = epoch.subscribe;
export const invalidateIOSDetailPrivacy = epoch.invalidate;
