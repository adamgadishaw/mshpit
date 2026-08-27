export const ATTENDANCE_STATES = Object.freeze(["interested", "going", "here", "went"]);
export const ATTENDANCE_VISIBILITIES = Object.freeze(["members", "followers", "private"]);
export const CROWD_SCOPES = Object.freeze(["everyone", "following", "friends"]);
const STABLE_SHOW_ID_PATTERN = /^show_[a-f0-9]{64}$/u;

const finiteCount = (value) => {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
};

const optionalTimestamp = (value) => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
};

const showIdFrom = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

export function normalizeAttendanceState(value) {
  const state = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ATTENDANCE_STATES.includes(state) ? state : null;
}

export function normalizeStableShowId(value) {
  if (typeof value !== "string") return null;
  const id = value.normalize("NFKC").trim();
  return STABLE_SHOW_ID_PATTERN.test(id) ? id : null;
}

export function isAttendeeState(value) {
  return value === "going" || value === "here" || value === "went";
}

export function normalizeAttendanceVisibility(value, fallback = "members") {
  const visibility = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ATTENDANCE_VISIBILITIES.includes(visibility)) return visibility;
  return ATTENDANCE_VISIBILITIES.includes(fallback) ? fallback : "members";
}

export function normalizeViewerAttendance(payload) {
  const source = payload?.viewerAttendance && typeof payload.viewerAttendance === "object"
    ? payload.viewerAttendance
    : payload?.attendance && typeof payload.attendance === "object"
      ? payload.attendance
      : null;
  const state = normalizeAttendanceState(source?.state);
  const showId = showIdFrom(source?.showId, payload?.showId, payload?.show?.id);
  if (state) {
    return {
      state,
      visibility: normalizeAttendanceVisibility(source?.visibility),
      verified: source?.verified === true,
      showId,
      checkedInAt: optionalTimestamp(source?.checkedInAt),
    };
  }
  // Old servers expose only this boolean. Treat it as the historical Going
  // state so new clients remain safe during a rolling deployment.
  return payload?.viewerGoing === true ? {
    state: "going",
    visibility: "members",
    verified: false,
    showId,
    checkedInAt: null,
  } : null;
}

export function normalizeAttendanceSnapshot(payload) {
  const attendees = (Array.isArray(payload?.attendees) ? payload.attendees : []).map((attendee) => ({
    ...attendee,
    state: normalizeAttendanceState(attendee?.state) || "going",
    verifiedAttendance: attendee?.verifiedAttendance === true,
  }));
  const numeric = Number(payload?.total);
  const total = Number.isSafeInteger(numeric) && numeric >= 0
    ? Math.max(numeric, attendees.length)
    : attendees.length;
  const viewerAttendance = normalizeViewerAttendance(payload);
  const requestedScope = typeof payload?.scope === "string" ? payload.scope.toLowerCase() : "everyone";
  const scope = CROWD_SCOPES.includes(requestedScope) ? requestedScope : "everyone";
  const rawCounts = payload?.stateCounts && typeof payload.stateCounts === "object" ? payload.stateCounts : {};
  const stateCounts = Object.fromEntries(ATTENDANCE_STATES.map((state) => [state, finiteCount(rawCounts[state])]));
  return {
    attendees,
    total,
    viewerGoing: typeof payload?.viewerGoing === "boolean"
      ? payload.viewerGoing
      : ["going", "here", "went"].includes(viewerAttendance?.state),
    viewerAttendance,
    stateCounts,
    verifiedAttendeeCount: finiteCount(payload?.verifiedAttendeeCount),
    scope,
    showId: showIdFrom(payload?.showId, payload?.show?.id, viewerAttendance?.showId),
    nextCursor: typeof payload?.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null,
  };
}

export function normalizeAttendanceMutation(payload, expectedShowId = null) {
  const showId = normalizeStableShowId(showIdFrom(payload?.showId, payload?.show?.id));
  const expected = expectedShowId == null ? null : normalizeStableShowId(expectedShowId);
  if (!showId || (expectedShowId != null && !expected) || (expected && showId !== expected)) return null;
  const attendance = normalizeViewerAttendance(payload);
  if (attendance?.showId && attendance.showId !== showId) return null;
  const scopedAttendance = attendance ? { ...attendance, showId } : null;
  return {
    showId,
    state: scopedAttendance?.state || null,
    visibility: scopedAttendance?.visibility || null,
    going: isAttendeeState(scopedAttendance?.state),
    attendance: scopedAttendance,
  };
}

export function attendanceMutationIdentity(showId, accountId) {
  return `${String(showId || "")}\u0000${accountId == null ? "guest" : String(accountId)}`;
}

export function optimisticViewerAttendance(current, { state, visibility } = {}) {
  if (state == null) return null;
  const nextState = normalizeAttendanceState(state);
  if (!nextState) return current || null;
  const hasVisibility = visibility !== undefined;
  const nextVisibility = hasVisibility
    ? normalizeAttendanceVisibility(visibility)
    : nextState === "here" && current?.state !== "here"
      ? "private"
      : normalizeAttendanceVisibility(current?.visibility);
  return {
    state: nextState,
    visibility: nextVisibility,
    verified: current?.verified === true,
    showId: current?.showId || null,
    checkedInAt: nextState === "here" && current?.state === "here"
      ? current.checkedInAt || null
      : null,
  };
}

export function attendanceOptionsForPhase(phase) {
  if (phase === "happening") return ["going", "here"];
  if (phase === "completed") return ["went"];
  if (phase === "upcoming") return ["interested", "going"];
  return [];
}

export function attendanceControlsVisible({ showId, phase, currentAttendance, mutationPending = false } = {}) {
  if (!normalizeStableShowId(showId)) return false;
  return attendanceOptionsForPhase(phase).length > 0 || !!currentAttendance || mutationPending === true;
}

export function attendanceTotalForView({ total, serverViewerGoing, viewerGoing, visibleCount = 0 }) {
  const base = Number.isSafeInteger(total) && total >= 0 ? total : visibleCount;
  const adjusted = base + (viewerGoing ? 1 : 0) - (serverViewerGoing ? 1 : 0);
  return Math.max(0, visibleCount, adjusted);
}

export function viewerGoingForCrowd({
  scope,
  localGoing,
  mutationPending,
  authoritativeReady,
  serverViewerGoing,
}) {
  if (scope !== "everyone") return false;
  return mutationPending || !authoritativeReady
    ? localGoing === true
    : serverViewerGoing === true;
}
