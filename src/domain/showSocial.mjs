const finiteCount = (value) => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  return Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : null;
};
const text = (value) => typeof value === "string" ? value.trim() : "";

export function showSocialIdentity(concertKey, accountId) {
  return JSON.stringify([text(concertKey), accountId == null ? "guest" : String(accountId)]);
}

export function isCurrentShowSocialRead(read, concertKey, accountId) {
  return !!read && read.identity === showSocialIdentity(concertKey, accountId);
}

export function normalizeShowAttendees(rows, limit = 200) {
  const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(200, Math.trunc(Number(limit)))) : 200;
  if (!maximum) return [];
  const attendees = [];
  const seen = new Set();
  for (const candidate of Array.isArray(rows) ? rows : []) {
    const id = text(candidate?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    attendees.push({
      ...candidate,
      id,
      name: text(candidate?.name) || text(candidate?.handle) || "Pit member",
      handle: text(candidate?.handle) || null,
    });
    if (attendees.length >= maximum) break;
  }
  return attendees;
}

export function normalizeLoungeMeta(payload) {
  const attendeeCount = finiteCount(payload?.attendeeCount);
  const messageCount = finiteCount(payload?.messageCount);
  const status = payload?.status === "closed" ? "closed" : "open";
  const cutoffAt = finiteCount(payload?.cutoffAt);
  const cutoffSource = payload?.cutoffSource === "doors_open" || payload?.cutoffSource === "show_start"
    ? payload.cutoffSource
    : null;
  const fanClubArtist = text(payload?.fanClubArtist) || null;
  if (attendeeCount == null && messageCount == null && !payload?.status) return null;
  return {
    attendeeCount,
    messageCount,
    status,
    timingKnown: payload?.timingKnown === true,
    cutoffAt,
    cutoffSource,
    fanClubArtist,
  };
}

export function showSocialView({
  read,
  concertKey,
  accountId,
  localAttendees = [],
  localMessageCount = 0,
  viewer = null,
  viewerGoing = false,
} = {}) {
  const current = isCurrentShowSocialRead(read, concertKey, accountId) ? read : null;
  const source = current && Array.isArray(current.attendees) ? current.attendees : localAttendees;
  let attendees = normalizeShowAttendees(source);

  // The server owns everybody else's attendance. The current account's local
  // optimistic toggle is reconciled while its write is in flight so the button
  // and attendee strip never contradict each other.
  const viewerId = text(viewer?.id);
  if (viewerId) {
    attendees = attendees.filter((attendee) => attendee.id !== viewerId);
    if (viewerGoing) attendees = normalizeShowAttendees([viewer, ...attendees]);
  }

  const authoritativeMessageCount = finiteCount(current?.loungeMeta?.messageCount);
  const loungeMeta = current?.loungeMeta || null;
  return {
    attendees,
    messageCount: authoritativeMessageCount ?? finiteCount(localMessageCount) ?? 0,
    loungeStatus: loungeMeta?.status === "closed" ? "closed" : "open",
    loungeCutoffAt: finiteCount(loungeMeta?.cutoffAt),
    loungeCutoffSource: loungeMeta?.cutoffSource || null,
    fanClubArtist: text(loungeMeta?.fanClubArtist) || null,
    loading: current?.status === "loading",
    authoritative: !!current && current.status === "ready",
  };
}
