import { api } from "../../lib/api";
export const readSourceCredits = ({ accountId, postId = "", edition = "", signal }) => api(`/api/moderation/source-credits?post=${encodeURIComponent(postId)}&edition=${encodeURIComponent(edition)}`, { expectedAccountId: accountId, signal, cache: "no-store", silent: true });
export const saveSourceCredit = ({ accountId, source }) => api("/api/moderation/source-credits", { method: "PUT", body: source, expectedAccountId: accountId, silent: true });

export const saveSourceEdition = ({ accountId, edition }) => api("/api/moderation/source-editions", { method: "PUT", body: edition, expectedAccountId: accountId, silent: true });
