import { createHash } from "node:crypto";

export const SHOW_ATTENDANCE_STATES = Object.freeze([
  "interested",
  "going",
  "here",
  "went",
]);

export const SHOW_ATTENDANCE_VISIBILITIES = Object.freeze([
  "members",
  "followers",
  "private",
]);

export const SHOW_CROWD_SCOPES = Object.freeze([
  "everyone",
  "following",
  "friends",
]);

const STABLE_SHOW_ID_PATTERN = /^show_[a-f0-9]{64}$/u;
const ATTENDANCE_STATE_SET = new Set(SHOW_ATTENDANCE_STATES);
const ATTENDANCE_VISIBILITY_SET = new Set(SHOW_ATTENDANCE_VISIBILITIES);
const CROWD_SCOPE_SET = new Set(SHOW_CROWD_SCOPES);

export function normalizeShowAliasKey(value) {
  if (typeof value !== "string") return null;
  const key = value.normalize("NFKC").trim().toLowerCase();
  return key && [...key].length <= 300 ? key : null;
}

export function normalizeStableShowId(value) {
  if (typeof value !== "string") return null;
  const id = value.normalize("NFKC").trim();
  return STABLE_SHOW_ID_PATTERN.test(id) ? id : null;
}

export function stableShowIdForAlias(value, aliasType = "legacy_concert_key") {
  const key = normalizeShowAliasKey(value);
  const type = typeof aliasType === "string" ? aliasType.trim().toLowerCase() : "";
  if (!key || !/^[a-z][a-z0-9_]{0,63}$/.test(type)) return null;
  return `show_${createHash("sha256").update(`mshpit-show-v1\0${type}\0${key}`, "utf8").digest("hex")}`;
}

export function normalizeAttendanceState(value) {
  if (typeof value !== "string") return null;
  const state = value.trim().toLowerCase();
  return ATTENDANCE_STATE_SET.has(state) ? state : null;
}

export function normalizeAttendanceVisibility(value) {
  if (typeof value !== "string") return null;
  const visibility = value.trim().toLowerCase();
  return ATTENDANCE_VISIBILITY_SET.has(visibility) ? visibility : null;
}

export function normalizeCrowdScope(value) {
  if (value == null || value === "") return "everyone";
  if (typeof value !== "string") return null;
  const scope = value.trim().toLowerCase();
  return CROWD_SCOPE_SET.has(scope) ? scope : null;
}

export function isAttendeeState(value) {
  return value === "going" || value === "here" || value === "went";
}

export function showCheckInAvailable(show, at = Date.now()) {
  const startAt = Number(show?.startAt);
  return !!show?.persisted
    && !!show.provider
    && !!show.providerEventId
    && !!show.timezone
    && show.lifecycle === "happening"
    && Number.isFinite(startAt)
    && startAt > 0
    && at >= startAt - 3 * 60 * 60 * 1000
    && at <= startAt + 12 * 60 * 60 * 1000;
}
