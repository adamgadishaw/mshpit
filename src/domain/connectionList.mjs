export const connectionScope = ({ accountId, userId, kind, query = "", filter = "all", blockedIds = [], epoch = 0 }) => JSON.stringify([accountId || null, userId, kind, query.trim(), filter, [...blockedIds].sort(), epoch]);
export const emptyConnectionList = (scope) => createLoadState({ scope, status: "loading", data: EMPTY_CONNECTIONS });
export const visibleConnectionList = (state, scope) => projectLoadState(state, scope, EMPTY_CONNECTIONS);
export function mergeConnectionRows(previous, incoming) {
  return [...new Map([...previous, ...incoming].filter((row) => row?.id).map((row) => [row.id, row])).values()];
}
export function connectionFailure(state, scope, error) {
  const denied = [401, 403, 404].includes(Number(error?.status));
  return rejectLoadState(state, { scope, error, emptyData: EMPTY_CONNECTIONS, retainData: !denied });
}
import { createLoadState, projectLoadState, rejectLoadState } from "./loadState.mjs";
export const EMPTY_CONNECTIONS = Object.freeze({ rows: [], nextCursor: null });
