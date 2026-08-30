import { toIsoDate } from "./dates.mjs";
import { normalizeAttendanceState } from "./showAttendance.mjs";

const text = (value) => String(value || "").trim();
const lower = (value) => text(value).toLocaleLowerCase();

function aliases(show) {
  const out = [];
  const add = (prefix, value) => {
    const cleaned = text(value);
    if (cleaned) out.push(`${prefix}:${cleaned}`);
  };
  add("show", show?.showId);
  add("show", show?.id && String(show.id).startsWith("show_") ? show.id : null);
  add("tour-date", show?.tourDateId);
  add("key", show?.canonicalKey);
  add("key", show?.key);
  const day = toIsoDate(show?.localDate || show?.date);
  if (lower(show?.artist) && lower(show?.venue) && day) {
    out.push(`night:${lower(show.artist)}|${lower(show.venue)}|${day}`);
  }
  return new Set(out);
}

function sameShow(left, right) {
  const leftAliases = aliases(left);
  return [...aliases(right)].some((alias) => leftAliases.has(alias));
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
    ...(previous || {}),
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
    visibility: text(attendance.visibility || previous?.visibility) || "members",
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
  const previous = currentAttendance.find((row) => sameShow(row, target)) || null;
  const nextRow = planningRow(show, result, previous, now);
  const nextAttendance = currentAttendance.filter((row) => !sameShow(row, target));
  if (nextRow) nextAttendance.push(nextRow);

  const nextGoing = currentGoing.filter((row) => !sameShow(row, target));
  if (nextRow?.state === "going") {
    nextGoing.push({
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
