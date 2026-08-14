const messageTime = (message) => Number.isFinite(message?.at) ? message.at : 0;

export function mergeChatMessages(existing, incoming, removedIds = [], max = 600) {
  const removed = new Set(Array.isArray(removedIds) ? removedIds : []);
  const byId = new Map();
  for (const message of (Array.isArray(existing) ? existing : [])) {
    if (message?.id && !removed.has(message.id)) byId.set(message.id, message);
  }
  for (const message of (Array.isArray(incoming) ? incoming : [])) {
    if (message?.id && !removed.has(message.id)) byId.set(message.id, { ...byId.get(message.id), ...message });
  }
  const ordered = [...byId.values()].sort((left, right) => (
    messageTime(left) - messageTime(right) || String(left.id).localeCompare(String(right.id))
  ));
  const limit = Math.max(1, Number.isFinite(Number(max)) ? Math.floor(Number(max)) : 600);
  return ordered.length > limit ? ordered.slice(-limit) : ordered;
}

export function reconcileRemovedDirectMessages(threadMap, accountId, removedIds, max = 750) {
  if (!threadMap || typeof threadMap !== "object" || !accountId || !Array.isArray(removedIds) || !removedIds.length) {
    return threadMap;
  }
  const next = { ...threadMap };
  for (const [key, messages] of Object.entries(threadMap)) {
    if (!key.split("__").includes(accountId)) continue;
    const live = mergeChatMessages(messages, [], removedIds, max);
    if (live.length) next[key] = live;
    else delete next[key];
  }
  return next;
}
