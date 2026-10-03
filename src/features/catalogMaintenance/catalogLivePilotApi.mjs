import { api } from "../../lib/api";

export function createCatalogLivePilotApi({ accountId, apiCall = api }) {
  if (typeof accountId !== "string" || !accountId || typeof apiCall !== "function") throw new Error("An owner session is required.");
  const call = (path, body, method = body ? "POST" : "GET") => apiCall(path, {
    method, ...(body ? { body } : {}), expectedAccountId: accountId, silent: true, context: "Catalog pilot review",
  });
  const entity = (type, key) => `/api/moderation/catalog-entities/${encodeURIComponent(type)}/${encodeURIComponent(key)}`;
  return {
    inventory: (type, cursor = null) => call(`/api/moderation/catalog-inventory/${encodeURIComponent(type)}?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
    read: (type, key) => call(entity(type, key)),
    pair: input => call("/api/moderation/catalog-grants/pairing", input),
    detail: id => call(`/api/moderation/catalog-proposals/${encodeURIComponent(id)}`),
    review: (proposal, approved) => call(`/api/moderation/catalog-proposals/${encodeURIComponent(proposal.id)}/review`, { payloadHash: proposal.payloadHash, approved }),
    correct: (page, action, changeId) => call(`${entity(page.type, page.key)}/correct`, { revision: page.revision, valueHash: page.valueHash,
      identityHash: page.identityHash, action, ...(changeId ? { changeId } : {}) }),
    revoke: id => call(`/api/moderation/catalog-grants/${encodeURIComponent(id)}`, null, "DELETE"),
  };
}
