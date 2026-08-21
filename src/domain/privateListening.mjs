export const PRIVATE_LISTENING_DURATION_MS = 6 * 60 * 60 * 1000;

export function privateListeningStorageKey(accountId) {
  return accountId ? `pit.private-listening.v1.${encodeURIComponent(String(accountId))}` : null;
}

export function normalizePrivateListeningUntil(value, at = Date.now()) {
  const until = Number(value);
  if (!Number.isSafeInteger(until) || until <= at) return 0;
  return Math.min(until, at + PRIVATE_LISTENING_DURATION_MS);
}

export function privateListeningActive(until, at = Date.now()) {
  return normalizePrivateListeningUntil(until, at) > at;
}

export function startPrivateListening(at = Date.now()) {
  return at + PRIVATE_LISTENING_DURATION_MS;
}

export function privateListeningRemainingLabel(until, at = Date.now()) {
  const remaining = normalizePrivateListeningUntil(until, at) - at;
  if (remaining <= 0) return "Off";
  const totalMinutes = Math.max(1, Math.ceil(remaining / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
}
