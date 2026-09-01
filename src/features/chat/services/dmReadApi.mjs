import { api } from "../../../lib/api";

export function fetchDirectMessageSummaries({ signal, expectedAccountId } = {}) {
  return api("/api/me/threads?summary=1", {
    signal,
    silent: true,
    context: "Loading conversation summaries",
    expectedAccountId,
  });
}

export function writeDirectMessageRead(otherId, { signal } = {}) {
  return api(`/api/dms/${encodeURIComponent(otherId)}/read`, {
    method: "POST",
    context: "Marking this conversation as read",
    silent: true,
    signal,
  });
}
