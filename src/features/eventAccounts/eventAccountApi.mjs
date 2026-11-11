import { toAppError } from "../../lib/diagnostics";
import { api } from "../../lib/api";
import { commandSuccess, commandFailure } from "../../domain/commandResult.mjs";

export async function readEventAccount({ kind, id, accountId, signal }) {
  const result = await api(`/api/event-accounts/target?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
    { expectedAccountId: accountId, signal, silent: true, context: "Loading event page access" });
  if (!result?.entity?.entityKey || typeof result.canManage !== "boolean") throw toAppError(new Error("Event page access could not be confirmed."));
  return result;
}
export async function readEventClaims({ accountId, signal, status = "pending", cursor = null }) {
  const result = await api(`/api/admin/event-claims?status=${encodeURIComponent(status)}${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`, { expectedAccountId: accountId, signal, silent: true, context: "Loading event page requests" });
  if (!Array.isArray(result?.claims)) throw toAppError(new Error("Event page requests could not be confirmed."));
  return result;
}
async function command(path, body, { accountId, signal }, context) {
  try { return commandSuccess(await api(path, { method: "POST", body, expectedAccountId: accountId, signal, silent: true, context })); }
  catch (error) { return commandFailure(toAppError(error, { context })); }
}
export const requestEventAccess = ({ kind, id, note, ...scope }) => command("/api/event-accounts/claims", { kind, id, note }, scope, "Requesting event page access");
export const reviewEventClaim = ({ id, action, evidence, ...scope }) => command(`/api/admin/event-claims/${encodeURIComponent(id)}/${action}`, evidence, scope, "Reviewing event page access");
export async function setEventFollowing({ entityKey, following, notifyUpdates, accountId, signal }) {
  try { return commandSuccess(await api(`/api/creators/event/${encodeURIComponent(entityKey)}/follow`, {
    method: "PUT", body: { following, notifyUpdates }, expectedAccountId: accountId, signal, silent: true, context: "Following event updates",
  })); } catch (error) { return commandFailure(toAppError(error, { context: "Following event updates" })); }
}
