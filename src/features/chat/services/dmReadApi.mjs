import { api } from "../../../lib/api";

export function fetchDirectMessageSummaries({ signal, expectedAccountId } = {}) {
  return api("/api/me/threads?summary=1", {
    signal,
    silent: true,
    context: "Loading conversation summaries",
    expectedAccountId,
  });
}

export function writeDirectMessageRead(otherId, { messageId, signal, expectedAccountId } = {}) {
  return api(`/api/dms/${encodeURIComponent(otherId)}/read-through`, {
    method: "POST",
    body: { messageId },
    context: "Marking this conversation as read",
    silent: true,
    signal,
    expectedAccountId,
  });
}
