const ROOT = "/api/admin/catalog-editor";
export function catalogExactSelection(type, input) {
  if (!["artist", "venue", "event"].includes(type)) throw new Error("Choose Artists, Venues or Events before opening a catalog key.");
  if (typeof input !== "string" || !input.trim() || input.trim().length > 450 || /[\u0000-\u001f\u007f]/u.test(input)) {
    throw new Error("Enter an exact catalog key between 1 and 450 characters.");
  }
  const key = input.trim();
  if ([".", ".."].includes(key) || /^https?:\/\//iu.test(key) || /^\/(?:artist|venue|event)\//u.test(key)) {
    throw new Error("Enter the catalog key, not a public page URL.");
  }
  if (type === "venue") {
    const separator = key.indexOf(":");
    if (separator < 1 || separator === key.length - 1 || /\s/u.test(key)) {
      throw new Error("A venue key must include its source and exact provider ID, separated by a colon.");
    }
  }
  return { type, key };
}

export function createCatalogEditorApi({ accountId, apiCall }) {
  if (!accountId || typeof apiCall !== "function") throw new TypeError("Catalog editing requires a signed-in administrator.");
  const request = (path, options = {}) => apiCall(path, { expectedAccountId: accountId, silent: true, context: "Catalog editor", ...options });
  return {
    list: ({ type, query = "", cursor = "", missingOnly = true, signal }) => request(`${ROOT}/${type}?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}&missing=${missingOnly}`, { signal }),
    read: ({ type, key, signal }) => request(`${ROOT}/${type}/${encodeURIComponent(key)}`, { signal }),
    plan: ({ type, query = "", cursor = "", signal }) => request(`${ROOT}/${type}?completion=true&q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`, { signal }),
    completion: ({ type, key, signal }) => request(`${ROOT}/${type}/${encodeURIComponent(key)}?completion=true`, { signal }),
    publicText: ({ type, key, signal }) => request(`/api/catalog-text/${type}/${encodeURIComponent(key)}`, { signal, cache: "no-store" }),
    prepare: (entries, signal) => request(`${ROOT}/prepare`, { method: "POST", body: { entries }, signal }),
    save: (draft, idempotencyKey, signal) => request(`${ROOT}/save`, { method: "POST", body: { draft, idempotencyKey }, signal }),
  };
}

export function catalogDraftFromText(entity, { summary, sourceLines, reason, hidden = false }) {
  return { type: entity.type, key: entity.key, expectedRevision: entity.revision, expectedHash: entity.expectedHash,
    summary, sources: sourceLines.split(/\r?\n/u).filter(line => line.trim()).map(line => {
      const separator = line.indexOf("|");
      return { label: separator < 0 ? "" : line.slice(0, separator).trim(), url: separator < 0 ? line.trim() : line.slice(separator + 1).trim() };
    }), reason, hidden, ...(entity.completion ? { completionHash: entity.completion.hash } : {}) };
}

export function addCatalogBatchDraft(batch, draft) {
  const next = batch.filter(entry => entry.type !== draft.type || entry.key !== draft.key);
  if (next.length >= 10) throw new Error("Review and save this batch before adding more pages.");
  return [...next, draft];
}
