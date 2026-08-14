const ownerKey = (value) => value == null || value === "" ? null : String(value);

// Drafts written before account scoping did not carry an owner. Production now
// starts with identity locked until /api/me validates the HttpOnly cookie, so an
// ownerless draft must never be interpreted as a guest draft during that gap.
// The sentinel keeps it invisible until the one-time migration can prove that
// the legacy persisted account and the authoritative server account match.
export const QUARANTINED_LEGACY_DRAFT_OWNER = "__pit_legacy_draft_unclaimed__";

export function migrateLegacyDrafts(value, currentAccountId) {
  if (!Array.isArray(value)) return [];
  const ownerId = ownerKey(currentAccountId);
  return value
    .filter((draft) => draft && typeof draft === "object" && !Array.isArray(draft))
    .map((draft) => Object.prototype.hasOwnProperty.call(draft, "ownerId") && ownerKey(draft.ownerId)
      ? { ...draft, ownerId: ownerKey(draft.ownerId) }
      // Legacy drafts predate account scoping. The persisted session restored
      // alongside them is the only recovery identity available. During a
      // production identity lock, quarantine rather than assigning them to the
      // guest account and exposing a previous user's review or photos.
      : { ...draft, ownerId: ownerId || QUARANTINED_LEGACY_DRAFT_OWNER });
}

export function resolveQuarantinedLegacyDrafts(value, currentAccountId, legacyAccountId) {
  const accountId = ownerKey(currentAccountId);
  const expectedAccountId = ownerKey(legacyAccountId);
  const all = Array.isArray(value) ? value : [];
  const ownershipMatches = !!accountId && accountId === expectedAccountId;
  return all.flatMap((draft) => {
    if (ownerKey(draft?.ownerId) !== QUARANTINED_LEGACY_DRAFT_OWNER) return [draft];
    // A mismatch (including a guest or a missing legacy identity) provides no
    // safe basis to expose authored content. Drop it instead of letting another
    // account claim it later.
    return ownershipMatches ? [{ ...draft, ownerId: accountId }] : [];
  });
}

export function draftsForAccount(value, accountId) {
  const ownerId = ownerKey(accountId);
  if (!ownerId) return [];
  return (Array.isArray(value) ? value : []).filter((draft) => ownerKey(draft?.ownerId) === ownerId);
}

export function upsertAccountDraft(value, draft, accountId, limit = 30) {
  const ownerId = ownerKey(accountId);
  const all = Array.isArray(value) ? value : [];
  if (!ownerId) return all;
  const mine = all.filter((item) => ownerKey(item?.ownerId) === ownerId && item?.id !== draft.id);
  const others = all.filter((item) => ownerKey(item?.ownerId) !== ownerId);
  return [{ ...draft, ownerId }, ...mine].slice(0, Math.max(1, limit)).concat(others);
}

export function deleteAccountDraft(value, draftId, accountId) {
  const ownerId = ownerKey(accountId);
  return (Array.isArray(value) ? value : []).filter((draft) =>
    draft?.id !== draftId || ownerKey(draft?.ownerId) !== ownerId);
}
