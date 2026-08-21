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
  const next = [...current.filter((entry) => entry?.id !== item.id), item];
  return next.length > bounded ? next.slice(-bounded) : next;
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

export function confirmedChatMessage(item, serverId) {
  if (!item || !serverId) return null;
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
    ...message
  } = item;
  return { ...message, id: serverId, pending: false, failed: false, server: true };
}
