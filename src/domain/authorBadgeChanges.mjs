// Delivers confirmed public-author changes only to currently mounted caches.
// No user snapshot is retained across account switches or module consumers.
const listeners = new Set();
export function subscribeAuthorBadgeChanges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function publishAuthorBadgeChange({ accountId, user }) {
  if (!user?.id) return;
  const event = { accountId: accountId || null, user };
  for (const listener of listeners) listener(event);
}
