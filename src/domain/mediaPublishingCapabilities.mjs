const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

export const DEFAULT_MEDIA_PUBLISHING_CAPABILITIES = Object.freeze({
  photos: true,
  videos: false,
  sourceTypes: Object.freeze([]),
});

const VIDEO_SOURCE_TYPES = Object.freeze(["video/mp4", "video/quicktime"]);

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
  const advertisedTypes = Array.isArray(advertised?.sourceTypes)
    ? advertised.sourceTypes.filter((type, index, all) => VIDEO_SOURCE_TYPES.includes(type) && all.indexOf(type) === index)
    : ["video/mp4"];
  const videos = advertised?.videos === true
    && advertised?.pipeline === VIDEO_PUBLISHING_PIPELINE_VERSION
    && advertisedTypes[0] === "video/mp4";
  return {
    photos: advertised?.photos !== false,
    videos,
    sourceTypes: videos ? advertisedTypes : [],
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

export function mediaPublishingSourceRequestAllowed(body, env = {}) {
  const contentType = typeof body?.contentType === "string"
    ? body.contentType.split(";", 1)[0].trim().toLowerCase()
    : "";
  if (!contentType.startsWith("video/")) return true;
  return mediaPublishingCapabilitiesForRuntime(env).videos;
}
