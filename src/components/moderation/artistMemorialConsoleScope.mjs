export function normalizeArtistMemorialConsoleScope(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function artistMemorialConsoleOwnsScope(ownerScope, currentScope) {
  const current = normalizeArtistMemorialConsoleScope(currentScope);
  return current != null && normalizeArtistMemorialConsoleScope(ownerScope) === current;
}

export function artistMemorialConsoleOperationOwned({ operationScope, operationId, currentScope, currentOperationId }) {
  return artistMemorialConsoleOwnsScope(operationScope, currentScope)
    && Number.isSafeInteger(operationId)
    && operationId === currentOperationId;
}
