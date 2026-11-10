export function normalizeDMRequestState(value) {
  return value === "accepted" || value === "pending" || value === "none" ? value : null;
}

export function dmRequestState(messages, accountId) {
  if (!accountId) return null;
  let state = null;
  for (const message of Array.isArray(messages) ? messages : []) {
    // Only confirmed authored messages prove that this account chose to engage.
    // A failed or queued send must not silently accept an incoming request.
    if (message?.from === accountId && message.server === true && !message.pending && !message.failed) return "accepted";
    if (message?.requestStateOwnerId !== accountId) continue;
    const candidate = normalizeDMRequestState(message.requestState);
    if (candidate === "accepted") return candidate;
    if (candidate) state = candidate;
  }
  return state;
}

export function applyDMRequestState(messages, accountId, requestState) {
  const rows = Array.isArray(messages) ? messages : [];
  const state = normalizeDMRequestState(requestState);
  if (!accountId || !state) return rows;
  // Acceptance is monotonic. An inbox GET already in flight when Accept commits
  // must not move the conversation back into Requests on its later arrival.
  const next = dmRequestState(rows, accountId) === "accepted" ? "accepted" : state;
  return rows.map(message => ({ ...message, requestState: next, requestStateOwnerId: accountId }));
}

export function dmInboxBucket({ messages, accountId, following = false, demo = false }) {
  const state = dmRequestState(messages, accountId);
  if (state) return state === "accepted" ? "main" : "requests";
  // Compatibility with an older server is conservative. Following is the old
  // viewer's own consent signal; no inbound message alone promotes a thread.
  const demoSent = demo && (messages || []).some(message => message.from === accountId);
  return following || demoSent ? "main" : "requests";
}
