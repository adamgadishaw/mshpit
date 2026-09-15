export function providerRetryAfterMs(response, at = Date.now()) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - at;
  return Number.isFinite(delay) ? Math.max(0, Math.min(60 * 60_000, Math.ceil(delay))) : null;
}

// Failed bodies must not hold sockets open or replace the real provider error.
export function discardProviderResponse(response) {
  try { Promise.resolve(response?.body?.cancel?.()).catch(() => undefined); }
  catch { /* architecture: allow-empty-catch -- disposal of an already closed response must not mask the actual provider failure */ }
}
