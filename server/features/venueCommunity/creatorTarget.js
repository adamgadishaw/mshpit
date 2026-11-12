// A trusted catalogue resolver, never a client-supplied name/owner. Reads do
// not provision rows; the shared creator follow transaction may persist the
// validated target as owner-null when a member chooses to follow it.
export function canonicalVenueCreatorTarget(readSnapshot, key) {
  if (typeof key !== 'string' || !/^\/venue\/[a-z0-9-]{1,193}$/.test(key)) return null;
  const snapshot = readSnapshot(key);
  const venue = snapshot?.venue;
  if (snapshot?.path !== key || !venue?.source || !venue.providerVenueId
    || typeof venue.name !== 'string' || !venue.name.trim() || venue.name.length > 200
    || /[\p{Cc}\p{Cf}]/u.test(venue.name)) return null;
  return { entityType: 'venue', entityKey: key, name: venue.name };
}
