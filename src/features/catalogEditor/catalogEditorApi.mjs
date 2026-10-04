const ROOT = "/api/admin/catalog-editor";
export function createCatalogEditorApi({ accountId, apiCall }) {
  if (!accountId || typeof apiCall !== "function") throw new TypeError("Catalog editing requires a signed-in administrator.");
  const request = (path, options = {}) => apiCall(path, { expectedAccountId: accountId, silent: true, context: "Catalog editor", ...options });
  return {
    list: ({ type, query = "", cursor = "", missingOnly = true, signal }) => request(`${ROOT}/${type}?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}&missing=${missingOnly}`, { signal }),
    read: ({ type, key, signal }) => request(`${ROOT}/${type}/${encodeURIComponent(key)}`, { signal }),
    prepare: (entries, signal) => request(`${ROOT}/prepare`, { method: "POST", body: { entries }, signal }),
    save: (draft, idempotencyKey, signal) => request(`${ROOT}/save`, { method: "POST", body: { draft, idempotencyKey }, signal }),
  };
}

export function catalogDraftFromText(entity, { summary, sourceLines, reason, hidden = false }) {
  return { type: entity.type, key: entity.key, expectedRevision: entity.revision, expectedHash: entity.expectedHash,
    summary, sources: sourceLines.split(/\r?\n/u).filter(line => line.trim()).map(line => {
      const separator = line.indexOf("|");
      return { label: separator < 0 ? "" : line.slice(0, separator).trim(), url: separator < 0 ? line.trim() : line.slice(separator + 1).trim() };
    }), reason, hidden };
}

export function addCatalogBatchDraft(batch, draft) {
  const next = batch.filter(entry => entry.type !== draft.type || entry.key !== draft.key);
  if (next.length >= 10) throw new Error("Review and save this batch before adding more pages.");
  return [...next, draft];
}
