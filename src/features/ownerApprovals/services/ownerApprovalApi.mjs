import { api } from "../../../lib/api";

// The bearer token is always sent in a POST body. It must never be placed in a
// request URL, where it could enter proxy logs, browser history, or referrers.
export function reviewOwnerApproval(token, { signal } = {}) {
  return api("/api/owner-approvals/review", {
    method: "POST",
    body: { token },
    signal,
    silent: true,
    context: "Reviewing an Owner approval request",
  });
}

export function decideOwnerApproval(token, { decision, password, signal } = {}) {
  return api("/api/owner-approvals/decide", {
    method: "POST",
    body: { token, decision, password },
    signal,
    silent: true,
    context: decision === "rejected" ? "Rejecting an Owner approval request" : "Approving an Owner request",
  });
}
