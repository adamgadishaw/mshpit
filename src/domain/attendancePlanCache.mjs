import { toIsoDate } from "./dates.mjs";
import { normalizeAttendanceState } from "./showAttendance.mjs";

const text = (value) => String(value || "").trim();
const lower = (value) => text(value).toLocaleLowerCase();

const identifier = (value) => typeof value === "string" || typeof value === "number" ? text(value) : "";
const showId = (show) => identifier(show?.showId)
  || (typeof show?.id === "string" && show.id.startsWith("show_") ? show.id : "");
const exactIds = (show) => ({ show: showId(show), tour: identifier(show?.tourDateId) });
const hasExactId = (show) => Object.values(exactIds(show)).some(Boolean);

function exactRelationship(left, right) {
  const a = exactIds(left), b = exactIds(right);
  // A broad display key must never override conflicting exact performances.
  if (Object.keys(a).some((kind) => a[kind] && b[kind] && a[kind] !== b[kind])) return "different";
  if (Object.keys(a).some((kind) => a[kind] && a[kind] === b[kind])) return "same";
  return "unknown";
}

function sameNight(left, right) {
  if (lower(left?.city) && lower(right?.city) && lower(left.city) !== lower(right.city)) return false;
  const a = toIsoDate(left?.localDate || left?.date), b = toIsoDate(right?.localDate || right?.date);
  if (a && b && a !== b) return false;
  const aKey = text(left?.canonicalKey || left?.key), bKey = text(right?.canonicalKey || right?.key);
  if (aKey && aKey === bKey) return true;
  return !!a && a === b && !!lower(left?.artist) && lower(left.artist) === lower(right?.artist)
    && !!lower(left?.venue) && lower(left.venue) === lower(right?.venue);
}

function timingIdentity(show) {
  let instant = null;
  for (const value of [show?.startDateTime, show?.startsAt, show?.startAt, show?.showStartDateTime]) {
    const timestamp = typeof value === "number" ? value
      : typeof value === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? Date.parse(value) : NaN;
    if (Number.isFinite(timestamp)) { instant = timestamp; break; }
  }
  const local = [show?.startLocalTime, show?.localStartTime, show?.showStartTime, show?.startTime]
    .map((value) => text(value).match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)?$/i))
    .find((match) => match && Number(match[1]) >= (match[3] ? 1 : 0)
      && Number(match[1]) <= (match[3] ? 12 : 23));
  let clock = "";
  if (local) {
    const hour = local[3] ? Number(local[1]) % 12 + (local[3].toUpperCase() === "PM" ? 12 : 0) : Number(local[1]);
    clock = `${String(hour).padStart(2, "0")}:${local[2]}`;
  }
  return { instant, clock, zone: text(show?.eventTimezone || show?.timezone || show?.timeZone) };
}

function compatibleTiming(left, right) {
  const a = timingIdentity(left), b = timingIdentity(right);
  if (a.instant !== null && b.instant !== null) return a.instant === b.instant;
  if (a.clock && b.clock) return a.clock === b.clock && (!a.zone || !b.zone || a.zone === b.zone);
  return true;
}

function matchingRows(rows, target, context = rows) {
  return new Set(rows.filter((row) => {
    const relationship = exactRelationship(row, target);
    if (relationship === "same") return true;
    if (relationship === "different" || !sameNight(row, target) || !compatibleTiming(row, target)) return false;
    // Distinct namespaces alone are not proof of the same performance.
    if (hasExactId(row) && hasExactId(target)) return false;
    const legacy = hasExactId(row) ? target : row;
    const exact = hasExactId(row) ? row : target;
    const legacyPeers = [...context, row, target].filter((candidate) => !hasExactId(candidate)
      && sameNight(candidate, legacy)
      && (compatibleTiming(candidate, legacy) || compatibleTiming(candidate, exact)));
    // Missing timing on either side cannot choose between distinct timed
    // legacy performances. Require compatibility in both directions, including
    // when both sides are sparse and other rows reveal multiple performances.
    if (legacyPeers.some((candidate) => !compatibleTiming(candidate, legacy) || !compatibleTiming(candidate, exact))
      || legacyPeers.some((candidate, index) => legacyPeers.slice(index + 1)
        .some((other) => !compatibleTiming(candidate, other)))) return false;
    // Upgrade a legacy row only when every compatible known exact candidate
    // is this performance. Keep ambiguous data instead of deleting or
    // transferring another night's attendance/visibility.
    return [...context, target].filter((candidate) => hasExactId(candidate)
      && sameNight(candidate, legacy) && compatibleTiming(candidate, legacy))
      .every((candidate) => exactRelationship(candidate, exact) === "same");
  }));
}

const TIMING_FIELDS = [
  "eventEndDate", "eventEndDateTime", "endDate",
  "startDateTime", "showStartDateTime", "startsAt", "startAt", "startLocalTime", "localStartTime", "showStartTime", "startTime",
  "endDateTime", "endsAt", "endAt", "endLocalTime", "eventTimezone", "timezone", "timeZone",
  "doorsDateTime", "doorsLocalTime",
];
const DETAIL_FIELDS = [
  "tourDateId", "eventName", "eventKind", ...TIMING_FIELDS,
  "source", "provider", "providerEventId", "eventId", "ticketUrl", "status", "soldOut",
];

function withoutSupersededTiming(previous, incoming) {
  const previousDate = toIsoDate(previous?.localDate || previous?.date);
  const incomingDate = toIsoDate(incoming?.localDate || incoming?.date);
  const hasIncomingTiming = TIMING_FIELDS.some((field) => incoming?.[field] !== undefined);
  if (!hasIncomingTiming && !(previousDate && incomingDate && previousDate !== incomingDate)) return previous;
  // Start/end aliases, zone and doors describe one schedule. Retaining only
  // part of an older schedule can override a newly supplied local time or clear.
  const retained = { ...previous };
  for (const field of TIMING_FIELDS) delete retained[field];
  return retained;
}

// Local calendar/display metadata only. Do not copy arbitrary show payloads,
// ticket-holder details, attendance visibility, or post content into Going.
export function attendancePlanDetails(show) {
  const details = {};
  for (const field of DETAIL_FIELDS) {
    const value = show?.[field];
    if ((typeof value === "string" && value.trim()) || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))) details[field] = value;
  }
  if (showId(show)) details.showId = showId(show);
  return details;
}

export function replaceGoingPlan(rows, entry, desired, context = rows) {
  const current = Array.isArray(rows) ? rows : [];
  const matches = matchingRows(current, entry, Array.isArray(context) ? context : current);
  const next = current.filter((row) => !matches.has(row));
  if (desired) {
    const previousDetails = [...matches].reduce((details, row) => ({
      ...details, ...attendancePlanDetails(withoutSupersededTiming(row, entry)),
    }), {});
    next.push({ ...previousDetails, ...entry });
  }
  return next;
}

export function hydrateAttendanceGoingRows(goingRows, attendanceRows, previousRows = []) {
  const previous = Array.isArray(previousRows) ? previousRows : [];
  // The server snapshot owns membership. Previous rows can only donate display
  // details to an exact matching performance that still exists in that snapshot.
  const enrich = (row) => ({
    ...previous.filter((candidate) => exactRelationship(candidate, row) === "same" && sameNight(candidate, row))
      .reduce((details, candidate) => ({
        ...details, ...attendancePlanDetails(withoutSupersededTiming(candidate, row)),
      }), {}),
    ...row,
  });
  const current = (Array.isArray(goingRows) ? goingRows : []).map(enrich);
  const attendance = (Array.isArray(attendanceRows) ? attendanceRows : []).map(enrich);
  const context = [...current, ...attendance];
  return attendance.filter((row) => row?.state === "going" && hasExactId(row))
    .reduce((rows, entry) => replaceGoingPlan(rows, entry, true, context), [...current]);
}

function planningRow(show, result, previous, now) {
  const attendance = result?.attendance;
  if (!attendance) return null;
  const state = normalizeAttendanceState(attendance.state);
  if (!state || !text(result?.showId)) return null;
  const date = toIsoDate(show?.localDate || show?.date || previous?.date)
    || text(show?.localDate || show?.date || previous?.date);
  const canonicalKey = text(show?.canonicalKey || previous?.canonicalKey || show?.key || previous?.key) || null;
  return {
    ...withoutSupersededTiming(previous, show),
    ...attendancePlanDetails(show),
    showId: text(result.showId),
    tourDateId: text(show?.tourDateId || previous?.tourDateId) || null,
    key: canonicalKey,
    canonicalKey,
    artist: text(show?.artist || previous?.artist),
    artistKey: text(show?.artistKey || previous?.artistKey) || null,
    venue: text(show?.venue || previous?.venue),
    venueKey: text(show?.venueKey || previous?.venueKey) || null,
    city: text(show?.city || previous?.city),
    date,
    tour: text(show?.tour || show?.tourName || previous?.tour) || null,
    state,
    visibility: text(attendance.visibility || previous?.visibility) || "private",
    verified: attendance.verified === true,
    checkedInAt: attendance.checkedInAt ?? previous?.checkedInAt ?? null,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
}

export function reconcileAttendancePlan({ attendanceRows = [], goingRows = [], show, result, now = Date.now() } = {}) {
  if (!show || !result || !text(result.showId)) return null;
  const target = { ...show, showId: result.showId };
  const currentAttendance = Array.isArray(attendanceRows) ? attendanceRows : [];
  const currentGoing = Array.isArray(goingRows) ? goingRows : [];
  const context = [...currentAttendance, ...currentGoing];
  const matches = matchingRows(currentAttendance, target, context);
  const goingMatches = matchingRows(currentGoing, target, context);
  const previous = currentAttendance.find((row) => matches.has(row))
    || currentGoing.find((row) => goingMatches.has(row)) || null;
  // Canonical attendance owns state and privacy, but can omit display timing
  // already held by Going. Borrow only exact same-night display fields; an
  // earlier schedule or an ambiguous legacy plan cannot donate those details.
  const detailTarget = { ...previous, ...show, localDate: show?.localDate || show?.date || previous?.date };
  const previousDetails = [...goingMatches]
    .filter((row) => exactRelationship(row, previous) === "same" && sameNight(row, previous) && sameNight(row, detailTarget))
    .reduce((details, row) => ({ ...details, ...attendancePlanDetails(row) }), {});
  for (const field of Object.keys(previousDetails)) {
    if (show[field] === null) delete previousDetails[field];
  }
  const nextRow = planningRow(show, result, previous ? { ...previousDetails, ...previous } : null, now);
  const nextAttendance = currentAttendance.filter((row) => !matches.has(row));
  if (nextRow) nextAttendance.push(nextRow);

  const nextGoing = currentGoing.filter((row) => !goingMatches.has(row));
  if (nextRow?.state === "going") {
    nextGoing.push({
      ...attendancePlanDetails(nextRow),
      key: nextRow.key,
      ...(nextRow.tourDateId ? { tourDateId: nextRow.tourDateId } : {}),
      artist: nextRow.artist,
      artistKey: nextRow.artistKey,
      venue: nextRow.venue,
      venueKey: nextRow.venueKey,
      city: nextRow.city,
      date: nextRow.date,
      tour: nextRow.tour,
    });
  }
  return { attendanceRows: nextAttendance, goingRows: nextGoing };
}
