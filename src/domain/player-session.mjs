export function restoreOwnedPlayerState(envelope, accountId) {
  if (!accountId || envelope?.ownerId !== accountId) return null;
  return envelope.state ?? null;
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
