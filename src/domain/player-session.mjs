export function restoreOwnedPlayerState(envelope, accountId) {
  if (!accountId || envelope?.ownerId !== accountId) return null;
  return envelope.state ?? null;
}

export function ownedPlayerEnvelope(accountId, state) {
  if (!accountId) return null;
  return { ownerId: accountId, state: state ?? null };
}
