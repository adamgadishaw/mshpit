import {
  ATTENDANCE_VISIBILITIES,
  CROWD_SCOPES,
  normalizeAttendanceMutation,
  normalizeAttendanceSnapshot,
  normalizeAttendanceState,
  normalizeStableShowId,
} from "../../domain/showAttendance.mjs";
import { normalizeLoungeMeta } from "../../domain/showSocial.mjs";
import { normalizeShowDocument } from "../../domain/showDocument.mjs";

const expectedAccountId = (value) => value == null || value === "" ? null : String(value);

function requiredConcertKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) throw new TypeError("Show social requests require a concert identity");
  return key;
}

function requiredCrowdScope(value) {
  const scope = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!CROWD_SCOPES.includes(scope)) throw new TypeError("Show Crowd scope is invalid");
  return scope;
}

function requiredApiCall(services) {
  if (typeof services?.apiCall !== "function") throw new TypeError("Show social transport is unavailable");
  return services.apiCall;
}

function requiredStableShowId(value) {
  const showId = normalizeStableShowId(value);
  if (!showId) throw new TypeError("Typed attendance requires a stable Show identity");
  return showId;
}

function requiredAccountId(value) {
  const accountId = expectedAccountId(value);
  if (!accountId) throw new TypeError("Typed attendance requires an authenticated account");
  return accountId;
}

const optionalText = (value) => typeof value === "string" && value.trim() ? value.trim() : undefined;

export async function readShowCrowdAttendance({
  concertKey,
  scope = "everyone",
  accountId = null,
  signal,
} = {}, services = {}) {
  const key = requiredConcertKey(concertKey);
  const requestedScope = requiredCrowdScope(scope);
  const payload = await requiredApiCall(services)(
    `/api/going/${encodeURIComponent(key)}/attendees?scope=${encodeURIComponent(requestedScope)}`,
    {
      signal,
      silent: true,
      context: "Loading show attendees",
      expectedAccountId: expectedAccountId(accountId),
    },
  );
  return normalizeAttendanceSnapshot(payload);
}

export async function readShowDocument({
  concertKey,
  accountId = null,
  signal,
} = {}, services = {}) {
  const key = requiredConcertKey(concertKey);
  const payload = await requiredApiCall(services)(`/api/shows/${encodeURIComponent(key)}`, {
    signal,
    silent: true,
    context: "Loading show details",
    expectedAccountId: expectedAccountId(accountId),
  });
  return normalizeShowDocument(payload);
}

export async function writeShowAttendance(options = {}, services = {}) {
  const { showId, state, visibility, show = null, accountId } = options;
  const id = requiredStableShowId(showId);
  const actorId = requiredAccountId(accountId);
  if (!Object.prototype.hasOwnProperty.call(options, "state")) {
    throw new TypeError("Typed attendance requires an explicit state or removal");
  }
  const nextState = state == null ? null : normalizeAttendanceState(state);
  if (state != null && !nextState) throw new TypeError("Typed attendance state is invalid");
  const hasVisibility = visibility !== undefined;
  const nextVisibility = hasVisibility && typeof visibility === "string"
    ? visibility.trim().toLowerCase()
    : null;
  if (hasVisibility && !ATTENDANCE_VISIBILITIES.includes(nextVisibility)) {
    throw new TypeError("Typed attendance visibility is invalid");
  }
  const body = {
    key: id,
    state: nextState,
    ...(hasVisibility ? { visibility: nextVisibility } : {}),
    artist: optionalText(show?.artist),
    artistKey: optionalText(show?.artistKey),
    venue: optionalText(show?.venue),
    venueKey: optionalText(show?.venueKey),
    city: optionalText(show?.city),
    date: optionalText(show?.localDate || show?.date),
    tour: optionalText(show?.tour),
  };
  const payload = await requiredApiCall(services)("/api/going", {
    method: "POST",
    body,
    silent: true,
    context: "Updating show attendance",
    expectedAccountId: actorId,
  });
  const result = normalizeAttendanceMutation(payload, id);
  if (!result) throw new TypeError("The typed attendance response was invalid");
  return result;
}

export async function readShowLoungeMeta({ concertKey, accountId = null, signal } = {}, services = {}) {
  const key = requiredConcertKey(concertKey);
  const payload = await requiredApiCall(services)(`/api/lounges/${encodeURIComponent(key)}/meta`, {
    signal,
    silent: true,
    context: "Loading concert-lounge details",
    expectedAccountId: expectedAccountId(accountId),
  });
  return normalizeLoungeMeta(payload);
}
