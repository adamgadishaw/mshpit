import { api } from "../../../lib/api";

export function writeDirectMessageRead(otherId, { signal } = {}) {
  return api(`/api/dms/${encodeURIComponent(otherId)}/read`, {
    method: "POST",
    context: "Marking this conversation as read",
    silent: true,
    signal,
  });
}
