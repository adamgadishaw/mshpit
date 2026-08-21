export function normalizeAttendanceSnapshot(payload) {
  const attendees = Array.isArray(payload?.attendees) ? payload.attendees : [];
  const numeric = Number(payload?.total);
  const total = Number.isSafeInteger(numeric) && numeric >= 0
    ? Math.max(numeric, attendees.length)
    : attendees.length;
  return {
    attendees,
    total,
    viewerGoing: !!payload?.viewerGoing,
    nextCursor: typeof payload?.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null,
  };
}

export function attendanceTotalForView({ total, serverViewerGoing, viewerGoing, visibleCount = 0 }) {
  const base = Number.isSafeInteger(total) && total >= 0 ? total : visibleCount;
  const adjusted = base + (viewerGoing ? 1 : 0) - (serverViewerGoing ? 1 : 0);
  return Math.max(0, visibleCount, adjusted);
}
