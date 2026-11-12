export const CHAT_OUTBOX_LIMIT = 100;

const safePart = (value, fallback) => {
  const cleaned = String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
  return cleaned || fallback;
};

// One token identifies one logical send. It is deliberately short enough for
// the server's bounded validation and opaque enough to safely retry a request
// whose response was lost without creating a second message row.
export function createChatClientMutationId(kind = "chat", now = Date.now(), random = Math.random()) {
  const prefix = safePart(kind, "chat");
  const stamp = Math.max(0, Number(now) || 0).toString(36);
  const entropy = Math.max(0, Math.min(0.9999999999999999, Number(random) || 0))
    .toString(36)
    .slice(2, 14)
    .padEnd(8, "0");
  return `${prefix}_${stamp}_${entropy}`.slice(0, 100);
}

export function chatOutboxMessageId(clientMutationId) {
  return `pending_${clientMutationId}`;
}

export function withChatOutboxItem(items, item, max = CHAT_OUTBOX_LIMIT) {
  const current = Array.isArray(items) ? items : [];
  if (!item?.id || !item?.ownerId || !item?.kind || !item?.channelKey) return current;
  const bounded = Math.max(1, Math.min(CHAT_OUTBOX_LIMIT, Math.floor(Number(max) || CHAT_OUTBOX_LIMIT)));
  if (current.some((entry) => entry?.id === item.id)) {
    return current.map((entry) => entry?.id === item.id ? item : entry);
  }
  // Admission must never silently discard an earlier unsent message.
  return current.length >= bounded ? current : [...current, item];
}

// A failed request does not necessarily mean that the server rejected the send.
// Keep uncertainty across retries: a later permission/conflict error cannot
// establish whether an earlier timed-out attempt already committed.
export function chatDeliveryFailure(error, { previouslyUnconfirmed = false, now = Date.now() } = {}) {
  const status = Number(error?.status) || 0;
  const transportFailure = ["PIT-NET-001", "PIT-NET-002", "PIT-API-001"].includes(error?.code);
  const identityChanged = error?.serverCode === "IDENTITY_CHANGED";
  const authRequired = status === 401 || identityChanged;
  const temporaryRejection = !transportFailure && (status === 429 || status === 425 || error?.serverCode === "IDENTITY_BARRIER_BUSY");
  const rejected = !transportFailure && status >= 400 && status < 500
    && ![408, 409, 425, 429].includes(status);
  const deliveryUncertain = previouslyUnconfirmed || identityChanged
    || (!rejected && !temporaryRejection);
  const retryable = !authRequired && !rejected && status !== 409;
  const deliveryState = authRequired ? "auth_required" : deliveryUncertain ? "unconfirmed"
    : temporaryRejection ? "retry_later" : "rejected";
  const deliveryMessage = authRequired
    ? `${deliveryUncertain ? "Delivery unconfirmed." : "Message not sent."} Sign in again before trying to send.`
    : deliveryUncertain
      ? `Delivery unconfirmed. ${retryable ? "Retry safely using the same message." : "Refresh this conversation before taking further action."}`
      : temporaryRejection ? "Message not sent yet. Please wait before retrying."
        : "Message not sent. This message cannot be sent as it is.";
  const retryAt = retryable && Number.isFinite(error?.retryAt) && error.retryAt > now ? error.retryAt : null;
  return { status: "failed", pending: false, failed: true, deliveryState, deliveryUncertain, retryable, deliveryMessage, retryAt };
}

export function updateChatOutboxItem(items, id, patch) {
  const current = Array.isArray(items) ? items : [];
  let found = false;
  const next = current.map((item) => {
    if (item?.id !== id) return item;
    found = true;
    return { ...item, ...(typeof patch === "function" ? patch(item) : patch) };
  });
  return found ? next : current;
}

export function withoutChatOutboxItem(items, id) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.id !== id);
}

export function chatOutboxFor(items, { ownerId, kind, channelKey }) {
  if (!ownerId || !kind || !channelKey) return [];
  return (Array.isArray(items) ? items : []).filter((item) => (
    item?.ownerId === ownerId && item?.kind === kind && item?.channelKey === channelKey
  ));
}

export function confirmedChatMessage(item, acknowledgement) {
  const serverId = typeof acknowledgement === "string" ? acknowledgement : acknowledgement?.id;
  if (!item || typeof serverId !== "string" || !serverId.trim()) return null;
  const {
    ownerId: _ownerId,
    kind: _kind,
    channelKey: _channelKey,
    target: _target,
    endpoint: _endpoint,
    context: _context,
    clientMutationId: _clientMutationId,
    authEpoch: _authEpoch,
    status: _status,
    deliveryState: _deliveryState,
    deliveryUncertain: _deliveryUncertain,
    deliveryMessage: _deliveryMessage,
    retryable: _retryable,
    retryAt: _retryAt,
    ...message
  } = item;
  const createdAt = acknowledgement?.createdAt;
  return { ...message, id: serverId, ...(Number.isFinite(createdAt) && createdAt >= 0 ? { at: createdAt } : {}), pending: false, failed: false, server: true };
}
