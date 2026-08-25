const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

export const DEFAULT_MEDIA_PUBLISHING_CAPABILITIES = Object.freeze({
  photos: true,
  videos: false,
});

// A boolean rollout switch is not proof that the full ingest path is ready.
// The client opts in only when health also advertises the exact contract whose
// source decoder, durable cover, and public delivery checks the composer was
// built against. Older servers and partially configured deployments fail
// closed even if their environment accidentally enables the coarse flag.
export const VIDEO_PUBLISHING_PIPELINE_VERSION = "private-derivative-v1";

// Capability negotiation is deliberately opt-in. Deployed legacy bundles keep
// requesting the unversioned health endpoint and therefore remain photo-only;
// only a client that understands this ingest contract asks the server to
// advertise it.
export const MEDIA_PUBLISHING_HEALTH_PATH =
  `/api/health?mediaPipeline=${VIDEO_PUBLISHING_PIPELINE_VERSION}`;

export const VIDEO_PUBLISHING_PREPARING_COPY =
  "Photo uploads are available. New clip publishing is being prepared. Existing clips remain viewable.";

export const PHOTO_PUBLISHING_UNAVAILABLE_COPY =
  "Photo uploads are temporarily unavailable. Video uploads are still available.";

export const MEDIA_PUBLISHING_UNAVAILABLE_COPY =
  "Photo and video uploads are temporarily unavailable. Your draft is safe; check again in a moment.";

export const VIDEO_SELECTION_BLOCKED_COPY =
  "That clip was not added because new clip publishing is being prepared. Existing clips remain viewable; you can still add photos.";

export const PHOTO_SELECTION_BLOCKED_COPY =
  "That photo was not added because photo uploads are temporarily unavailable. Your draft is safe; check again in a moment.";

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
    videos: advertised?.videos === true
      && advertised?.pipeline === VIDEO_PUBLISHING_PIPELINE_VERSION,
  };
}

export function mediaPublishingAvailabilityCopy(capabilities = DEFAULT_MEDIA_PUBLISHING_CAPABILITIES) {
  const photos = capabilities?.photos === true;
  const videos = capabilities?.videos === true;
  if (photos && videos) return "";
  if (photos) return VIDEO_PUBLISHING_PREPARING_COPY;
  if (videos) return PHOTO_PUBLISHING_UNAVAILABLE_COPY;
  return MEDIA_PUBLISHING_UNAVAILABLE_COPY;
}

export function mediaPublishingAttachmentLabel(capabilities = DEFAULT_MEDIA_PUBLISHING_CAPABILITIES) {
  const photos = capabilities?.photos === true;
  const videos = capabilities?.videos === true;
  if (photos && videos) return "Photo / video";
  if (photos) return "Photos";
  if (videos) return "Videos";
  return "Media";
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
  const photosEnabled = capabilities?.photos === true;
  const videosEnabled = capabilities?.videos === true;
  const accepted = [];
  let blockedPhotos = 0;
  let blockedVideos = 0;
  for (const asset of input) {
    if (asset?.kind === "image" && !photosEnabled) blockedPhotos += 1;
    else if (asset?.kind === "video" && !videosEnabled) blockedVideos += 1;
    else accepted.push(asset);
  }
  return { accepted, blockedPhotos, blockedVideos };
}
