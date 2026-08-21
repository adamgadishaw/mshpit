const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

export const DEFAULT_MEDIA_PUBLISHING_CAPABILITIES = Object.freeze({
  photos: true,
  videos: false,
});

export const VIDEO_PUBLISHING_PREPARING_COPY =
  "Photo Studio is available now. New clip publishing is being prepared. Existing clips remain viewable.";

export const VIDEO_SELECTION_BLOCKED_COPY =
  "That clip was not added because new clip publishing is being prepared. Existing clips remain viewable; choose photos to edit and publish in Photo Studio.";

// The server owns this decision. Missing, empty, false, or misspelled values all
// fail closed so a client bundle can never advertise a renderer that is not
// deliberately enabled in the deployed runtime.
export function mediaPublishingCapabilitiesForRuntime(env = {}) {
  const videoFlag = String(env?.PIT_VIDEO_PUBLISHING_ENABLED ?? "").trim().toLowerCase();
  return {
    photos: true,
    videos: ENABLED_VALUES.has(videoFlag),
  };
}

// Health responses cross an untrusted network boundary. Only an exact boolean
// `true` enables video selection; truthy strings and malformed shapes stay off.
export function mediaPublishingCapabilitiesFromHealth(health) {
  const advertised = health?.capabilities?.mediaPublishing;
  return {
    photos: advertised?.photos !== false,
    videos: advertised?.videos === true,
  };
}

export function mediaPublishingSourceRequestAllowed(body, env = {}) {
  const contentType = typeof body?.contentType === "string"
    ? body.contentType.split(";", 1)[0].trim().toLowerCase()
    : "";
  if (!contentType.startsWith("video/")) return true;
  return mediaPublishingCapabilitiesForRuntime(env).videos;
}

export function mediaPublishingSelection(assets, capabilities = DEFAULT_MEDIA_PUBLISHING_CAPABILITIES) {
  const input = Array.isArray(assets) ? assets : [];
  const videosEnabled = capabilities?.videos === true;
  const accepted = [];
  let blockedVideos = 0;
  for (const asset of input) {
    if (asset?.kind === "video" && !videosEnabled) blockedVideos += 1;
    else accepted.push(asset);
  }
  return { accepted, blockedVideos };
}
