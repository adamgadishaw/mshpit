let queueEntrySequence = 0;

function cleanQueueEntryId(value) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function createQueueEntryId() {
  queueEntrySequence += 1;
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.random().toString(36).slice(2, 12);
  return `queue_${Date.now().toString(36)}_${random}_${queueEntrySequence.toString(36)}`;
}

// Queue identity belongs to an occurrence, not a recording or array position.
// Fresh queues always receive fresh IDs; restored queues preserve valid unique
// IDs and upgrade legacy rows that predate occurrence-aware playback.
export function playerQueueWithEntryIds(list, { preserveExisting = false, createId = createQueueEntryId } = {}) {
  if (!Array.isArray(list)) return [];
  const used = new Set();
  return list.map((track, index) => {
    if (!track || typeof track !== "object") return track;
    let queueEntryId = preserveExisting ? cleanQueueEntryId(track.queueEntryId) : "";
    if (!queueEntryId || used.has(queueEntryId)) queueEntryId = cleanQueueEntryId(createId());
    if (!queueEntryId || used.has(queueEntryId)) queueEntryId = `${createQueueEntryId()}_${index.toString(36)}`;
    used.add(queueEntryId);
    return { ...track, queueEntryId };
  });
}

export function restoreOwnedPlayerState(envelope, accountId) {
  if (!accountId || envelope?.ownerId !== accountId) return null;
  const state = envelope.state ?? null;
  if (!state || !Array.isArray(state.list)) return state;
  return { ...state, list: playerQueueWithEntryIds(state.list, { preserveExisting: true }) };
}

export function ownedPlayerEnvelope(accountId, state) {
  if (!accountId) return null;
  return { ownerId: accountId, state: state ?? null };
}

export function ownedPlayerPositionEnvelope(accountId, key, ms) {
  const boundedKey = typeof key === "string" ? key.trim().slice(0, 240) : "";
  const boundedMs = Math.max(0, Math.min(86_400_000, Number(ms) || 0));
  if (!accountId || !boundedKey || boundedMs <= 0) return null;
  return { ownerId: accountId, position: { key: boundedKey, ms: boundedMs } };
}

export function restoreOwnedPlayerPosition(envelope, accountId) {
  if (!accountId || envelope?.ownerId !== accountId) return null;
  const key = typeof envelope?.position?.key === "string" ? envelope.position.key.trim().slice(0, 240) : "";
  const ms = Math.max(0, Math.min(86_400_000, Number(envelope?.position?.ms) || 0));
  return key && ms > 0 ? { key, ms } : null;
}
