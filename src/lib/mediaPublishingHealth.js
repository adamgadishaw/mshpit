import {
  MEDIA_PUBLISHING_HEALTH_PATH,
  mediaPublishingCapabilitiesFromHealth,
} from "../domain/mediaPublishingCapabilities.mjs";

// Keep capability negotiation behind a service boundary so screens consume a
// stable product result instead of learning the health endpoint contract.
export async function loadMediaPublishingCapabilities({
  signal,
  apiCall,
} = {}) {
  if (typeof apiCall !== "function") {
    throw new TypeError("A PIT API adapter is required to load media publishing capability.");
  }
  const health = await apiCall(MEDIA_PUBLISHING_HEALTH_PATH, {
    context: "Checking media publishing availability",
    silent: true,
    signal,
    skipIdentityCheck: true,
  });
  return mediaPublishingCapabilitiesFromHealth(health);
}
