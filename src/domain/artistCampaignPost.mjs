export const ARTIST_CAMPAIGN_VERSION = 1;

const treatment = (value) => Object.freeze(value);

// These are presentation-safe values, not arbitrary styles supplied by a post.
// Keeping the palette in the allow-list lets every renderer use the same trusted
// contrast surface even when an artist chooses unpredictable background art.
export const ARTIST_CAMPAIGN_TREATMENTS = Object.freeze({
  spotlight: treatment({
    id: "spotlight",
    label: "Spotlight",
    eyebrow: "Featured artist post",
    backgroundColor: "#1B100B",
    contentSurfaceColor: "#0C0A09",
    accentColor: "#FF8C42",
    textColor: "#FFF8E8",
    mutedTextColor: "#D9C7B7",
    scrimColor: "rgba(7, 9, 15, 0.62)",
  }),
  "tour-poster": treatment({
    id: "tour-poster",
    label: "Tour poster",
    eyebrow: "On the road",
    backgroundColor: "#251909",
    contentSurfaceColor: "#100D08",
    accentColor: "#F6C453",
    textColor: "#FFF8E8",
    mutedTextColor: "#D8C7A7",
    scrimColor: "rgba(10, 8, 5, 0.64)",
  }),
  "after-dark": treatment({
    id: "after-dark",
    label: "After dark",
    eyebrow: "Artist update",
    backgroundColor: "#120D26",
    contentSurfaceColor: "#0C0A1A",
    accentColor: "#C084FC",
    textColor: "#F1ECFF",
    mutedTextColor: "#C8BDEB",
    scrimColor: "rgba(7, 5, 18, 0.66)",
  }),
});

export const DEFAULT_ARTIST_CAMPAIGN_TREATMENT = "spotlight";

const MEDIA_ASSET_ID = /^ma_[A-Za-z0-9_-]{8,80}$/;
const UNSAFE_IDENTITY_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const HAS_IDENTITY_CHARACTER = /[\p{L}\p{N}]/u;

function normalizedTreatment(value) {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ARTIST_CAMPAIGN_TREATMENTS, id) ? id : null;
}

function normalizedArtistKey(value) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || UNSAFE_IDENTITY_CHARACTER.test(value)) return null;
  const key = value.trim().replace(/\s+/gu, " ");
  if (!key || key.length > 120 || !HAS_IDENTITY_CHARACTER.test(key)) return null;
  return key;
}

function normalizedMediaAssetId(value) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const id = value.trim();
  return MEDIA_ASSET_ID.test(id) ? id : null;
}

/**
 * Canonicalize untrusted campaign metadata without making authorization
 * decisions. Unknown schemas and unsafe identities fail closed so callers do
 * not accidentally render future or malformed data as an official post.
 */
export function normalizeArtistCampaign(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.version !== ARTIST_CAMPAIGN_VERSION) return null;

  const campaignTreatment = normalizedTreatment(value.treatment);
  if (!campaignTreatment) return null;

  const artistKey = normalizedArtistKey(value.artistKey);
  const backgroundAssetId = normalizedMediaAssetId(value.backgroundAssetId);
  if (artistKey === null || backgroundAssetId === null) return null;

  return {
    version: ARTIST_CAMPAIGN_VERSION,
    treatment: campaignTreatment,
    ...(artistKey ? { artistKey } : {}),
    ...(backgroundAssetId ? { backgroundAssetId } : {}),
  };
}

function descriptorAssetId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = normalizedMediaAssetId(value.id);
  const assetId = normalizedMediaAssetId(value.assetId);
  if (id === null || assetId === null || (id && assetId && id !== assetId)) return null;
  return id || assetId || null;
}

function descriptorUri(value) {
  for (const candidate of [value?.url, value?.uri, value?.sourceUrl]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Resolve only the explicitly selected stable image. Legacy URL strings,
 * videos, unfinished assets, and lookalike IDs are deliberately ignored.
 */
export function artistCampaignBackground(campaign, media) {
  const normalized = normalizeArtistCampaign(campaign);
  if (!normalized?.backgroundAssetId || !Array.isArray(media)) return null;

  for (const descriptor of media) {
    if (descriptorAssetId(descriptor) !== normalized.backgroundAssetId) continue;
    if (String(descriptor?.kind || "").trim().toLowerCase() !== "image") return null;
    if (descriptor.status != null && String(descriptor.status).trim().toLowerCase() !== "ready") return null;
    if (!descriptorUri(descriptor)) return null;
    return descriptor;
  }
  return null;
}

/**
 * Build the trusted render contract. Missing background media falls back to
 * the selected curated treatment; an invalid campaign remains an ordinary post.
 */
export function artistCampaignPresentation(campaign, media = []) {
  const normalized = normalizeArtistCampaign(campaign);
  if (!normalized) return null;
  return {
    campaign: normalized,
    treatment: ARTIST_CAMPAIGN_TREATMENTS[normalized.treatment],
    background: artistCampaignBackground(normalized, media),
  };
}
