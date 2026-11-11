import { api } from "../../../lib/api";

export function writeDMRequestAcceptance(otherId, { expectedAccountId } = {}) {
  return api(`/api/dms/${encodeURIComponent(otherId)}/accept`, {
    method: "POST",
    context: "Accepting this message request",
    silent: true,
    expectedAccountId,
  });
}
