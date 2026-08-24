import { toIsoDate } from "./dates.mjs";
import { clean, clampRating, LIMITS } from "./validation.mjs";
import { normalizeArtistCampaign } from "./artistCampaignPost.mjs";
import { normalizeTaggedPeople, normalizeTaggedUserIds } from "./postFriendTags.mjs";

const DIMENSION_KEYS = ["performance", "setlist", "sound", "venue", "crowd", "experience"];
const EDITABLE_KEYS = new Set([
  "artist", "artistKey", "venue", "city", "date", "overall", "band", "room", "dims",
  "review", "photos", "mediaAssetIds", "photosPublic", "landingShowcase", "setlist", "tour", "tags", "taggedUserIds", "song", "playlistId", "campaign",
]);
const INVALID_STORED_VALUE = Symbol("invalid-stored-post-value");

function campaignEditIntent(value) {
  const campaign = normalizeArtistCampaign(value);
  if (!campaign) return null;
  const { artistKey: _serverOwnedArtistKey, ...intent } = campaign;
  return intent;
}

function cleanArray(value, { maxItems, maxLen }) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => clean(item, { max: maxLen }))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  const tags = [];
  for (const raw of value.slice(0, 12)) {
    const tag = clean(String(raw ?? ""), { max: 24 })
      .replace(/[^\p{L}\p{N} '&.!-]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    if (tag && !tags.some((item) => item.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    if (tags.length >= 5) break;
  }
  return tags;
}

function cleanDimensions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of DIMENSION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const number = Number(value[key]);
    if (Number.isFinite(number)) out[key] = clampRating(number);
  }
  return out;
}

function cleanSong(value) {
  if (!value?.videoId) return null;
  return {
    videoId: String(value.videoId),
    title: clean(String(value.title ?? ""), { max: 200 }) || null,
    artist: clean(String(value.artist ?? ""), { max: 120 }) || null,
  };
}

function intendedValue(key, value) {
  switch (key) {
    case "artist": return clean(value, { max: LIMITS.artist });
    case "artistKey": return clean(value, { max: 120 }) || null;
    case "venue": return clean(value, { max: LIMITS.venue });
    case "city": return clean(value, { max: LIMITS.city });
    case "date": return value ? toIsoDate(clean(value, { max: LIMITS.date })) : "";
    case "overall": return clampRating(value);
    case "band":
    case "room": return value == null ? null : clampRating(value);
    case "dims": return cleanDimensions(value);
    case "review": return clean(value, { max: LIMITS.review, newlines: true });
    case "photos": return cleanArray(value, { maxItems: 8, maxLen: 2000 });
    case "mediaAssetIds": {
      if (!Array.isArray(value)) return [];
      return value.filter((item) => typeof item === "string" && /^ma_[A-Za-z0-9_-]{8,80}$/.test(item)).slice(0, 8);
    }
    case "photosPublic":
    case "landingShowcase": return !!value;
    case "setlist": return cleanArray(value, { maxItems: 40, maxLen: 120 });
    case "tour": return clean(value, { max: 80 }) || null;
    case "tags": return cleanTags(value);
    case "taggedUserIds": return normalizeTaggedUserIds(value);
    case "song": return cleanSong(value);
    case "playlistId": return value == null || value === "" ? null : String(value);
    case "campaign": return campaignEditIntent(value);
    default: return undefined;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function storedValue(post, key) {
  const storedKey = key === "playlistId" ? "playlist" : key === "taggedUserIds" ? "taggedPeople" : key;
  if (!post || !Object.prototype.hasOwnProperty.call(post, storedKey)) return INVALID_STORED_VALUE;
  const value = post[storedKey];
  switch (key) {
    case "artist":
    case "venue":
    case "city":
    case "date":
    case "review":
      if (typeof value !== "string") return INVALID_STORED_VALUE;
      break;
    case "artistKey":
    case "tour":
      if (value !== null && value !== undefined && typeof value !== "string") return INVALID_STORED_VALUE;
      break;
    case "overall":
      if (!Number.isFinite(value)) return INVALID_STORED_VALUE;
      break;
    case "band":
    case "room":
      if (value !== null && value !== undefined && !Number.isFinite(value)) return INVALID_STORED_VALUE;
      break;
    case "dims":
      if (!isPlainObject(value) || Object.entries(value).some(([dimension, rating]) => !DIMENSION_KEYS.includes(dimension) || !Number.isFinite(rating))) {
        return INVALID_STORED_VALUE;
      }
      break;
    case "photos":
    case "mediaAssetIds":
    case "setlist":
    case "tags":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return INVALID_STORED_VALUE;
      break;
    case "photosPublic":
    case "landingShowcase":
      if (typeof value !== "boolean" && value !== 0 && value !== 1) return INVALID_STORED_VALUE;
      break;
    case "song":
      if (value !== null && value !== undefined && (!isPlainObject(value) || typeof value.videoId !== "string" || !value.videoId)) return INVALID_STORED_VALUE;
      break;
    case "playlistId":
      if (value !== null && value !== undefined && (!isPlainObject(value) || typeof value.id !== "string" || !value.id)) return INVALID_STORED_VALUE;
      return value?.id || null;
    case "campaign":
      if (value !== null && value !== undefined && !normalizeArtistCampaign(value)) return INVALID_STORED_VALUE;
      return campaignEditIntent(value);
    case "taggedUserIds": {
      if (!Array.isArray(value)) return INVALID_STORED_VALUE;
      const people = normalizeTaggedPeople(value);
      if (people.length !== value.length) return INVALID_STORED_VALUE;
      return people.map((person) => person.id);
    }
    default:
      return INVALID_STORED_VALUE;
  }
  return intendedValue(key, value);
}

function sameValue(left, right) {
  if (left === INVALID_STORED_VALUE || right === INVALID_STORED_VALUE) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

// A PATCH timeout/network failure is ambiguous: the server may have committed
// before the response vanished. Treat it as success only when a fresh canonical
// read matches every editable field that was actually sent. Anything unknown or
// different remains a failure/conflict; reconciliation never overwrites data.
export function postMatchesEditIntent(post, requestBody) {
  if (!post || !requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) return false;
  const keys = Object.keys(requestBody).filter((key) => key !== "version");
  if (!keys.length || keys.some((key) => !EDITABLE_KEYS.has(key))) return false;
  return keys.every((key) => sameValue(storedValue(post, key), intendedValue(key, requestBody[key])));
}

export function shouldReconcileEditFailure(error) {
  const status = Number(error?.status) || 0;
  return status === 0 || status === 409 || status >= 500;
}
