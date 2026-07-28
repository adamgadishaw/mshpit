const ownerKey = (value) => value == null || value === "" ? null : String(value);

export function migrateLegacyDrafts(value, currentAccountId) {
  if (!Array.isArray(value)) return [];
  const ownerId = ownerKey(currentAccountId);
  return value
    .filter((draft) => draft && typeof draft === "object" && !Array.isArray(draft))
    .map((draft) => Object.prototype.hasOwnProperty.call(draft, "ownerId")
      ? { ...draft, ownerId: ownerKey(draft.ownerId) }
      : { ...draft, ownerId });
}

export function draftsForAccount(value, accountId) {
  const ownerId = ownerKey(accountId);
  return (Array.isArray(value) ? value : []).filter((draft) => ownerKey(draft?.ownerId) === ownerId);
}

export function upsertAccountDraft(value, draft, accountId, limit = 30) {
  const ownerId = ownerKey(accountId);
  const all = Array.isArray(value) ? value : [];
  const mine = all.filter((item) => ownerKey(item?.ownerId) === ownerId && item?.id !== draft.id);
  const others = all.filter((item) => ownerKey(item?.ownerId) !== ownerId);
  return [{ ...draft, ownerId }, ...mine].slice(0, Math.max(1, limit)).concat(others);
}

export function deleteAccountDraft(value, draftId, accountId) {
  const ownerId = ownerKey(accountId);
  return (Array.isArray(value) ? value : []).filter((draft) =>
    draft?.id !== draftId || ownerKey(draft?.ownerId) !== ownerId);
}
