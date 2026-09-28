import { beginLoadState, createLoadState, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";
import { SEARCH_GROWTH_MODES } from "./searchGrowthApi.mjs";

export const searchGrowthScope = ({ accountId, role, emailVerified } = {}) => role === "admin" && emailVerified === true && accountId ? JSON.stringify([accountId, role, emailVerified]) : null;
export const emptySearchGrowthState = (scope = null) => ({
  resource: createLoadState({ scope }), pendingMode: null, confirmed: false, notice: "", errorMessage: "",
});
const denied = (error) => [401, 403].includes(Number(error?.status ?? error?.statusCode))
  || ["ACCOUNT_CHANGED", "AUTH_REQUIRED", "UNAUTHORIZED", "FORBIDDEN"].includes(error?.serverCode || error?.code);

// One controller per mount/account generation. Disposal prevents A -> B -> A
// from accepting the first A's request, even if its transport ignores abort.
export function createSearchGrowthController({ accountId, scope, read, change, onState, normalizeError, initialState }) {
  if (typeof normalizeError !== "function") throw new TypeError("Search Growth needs the canonical error adapter.");
  let state = initialState ? { ...initialState, pendingMode: null, confirmed: false } : emptySearchGrowthState(scope);
  let active = true, operation = null;
  const publish = (patch) => {
    if (!active) return;
    state = { ...state, ...patch };
    onState(state);
  };
  const owns = (current) => active && operation === current && !current.signal.aborted;
  const fail = (error, writing) => {
    const appError = normalizeError(error);
    const inaccessible = denied(error);
    publish({
      resource: rejectLoadState(state.resource, { scope, error: appError, retainData: !inaccessible }),
      pendingMode: null, confirmed: false, notice: "",
      errorMessage: inaccessible ? "Administrator access is no longer confirmed. Refresh after access is restored."
        : writing ? "The mode change could not be confirmed. Refresh status before retrying; the server may already have saved it."
          : "Search Growth could not refresh. Any previous figures are a saved snapshot. Try again.",
    });
    return commandFailure(appError);
  };
  return {
    async refresh() {
      if (!active || operation) return;
      const current = new AbortController(); operation = current;
      publish({ resource: beginLoadState(state.resource, { scope }), confirmed: false, errorMessage: "", notice: "" });
      try {
        const data = await read({ accountId, signal: current.signal });
        if (!owns(current)) return;
        publish({ resource: resolveLoadState({ scope, data }), confirmed: true });
        return commandSuccess(data);
      } catch (error) {
        if (owns(current)) return fail(error, false);
      } finally { if (operation === current) operation = null; }
    },
    async setMode(mode) {
      if (!active || operation || !state.confirmed || !state.resource.data || !SEARCH_GROWTH_MODES.includes(mode) || mode === state.resource.data.mode) return;
      const expectedMode = state.resource.data.mode;
      const current = new AbortController(); operation = current;
      publish({ pendingMode: mode, errorMessage: "", notice: "" });
      try {
        const data = await change({ accountId, mode, expectedMode, signal: current.signal });
        if (!owns(current)) return;
        publish({ resource: resolveLoadState({ scope, data }), pendingMode: null, confirmed: true,
          notice: mode === "paused" ? "Pause saved. Work already running may finish its current step."
            : "Mode saved. The scheduled worker will use it when due, within existing limits. No run was started by this button." });
        return commandSuccess(data);
      } catch (error) {
        if (owns(current)) return fail(error, true);
      } finally { if (operation === current) operation = null; }
    },
    dispose() { active = false; operation?.abort(); operation = null; },
  };
}
export function growthNumber(value, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "Unavailable";
}
export function growthPercent(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? (value * 100).toFixed(2) + "%" : "Unavailable";
}
export function growthTime(value) {
  if (value == null || value === 0) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}
export function growthWindow(value) {
  const dates = [value?.startDate, value?.endDate];
  return dates.every(date => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? dates.join(" to ") : "Not recorded";
}
export const growthModeLabel = mode => ({ paused: "Paused", monitor: "Monitor only", prioritize: "Prioritize pages" })[mode] || "Unconfirmed";
export function growthConnectionLabel(data) {
  if (!data?.configured) return "Google access not configured";
  return ({ connected: "Google access verified", awaiting_import: "Google access configured; awaiting the first report",
    disabled: "Google access configured; worker disabled", ready: "Google access configured; not yet verified",
    error: "Google access needs attention", unavailable: "Google access needs attention" })[data?.connection?.state] || "Google access not yet verified";
}
export function visibleGrowthOpportunities(data) {
  return (Array.isArray(data?.opportunities) ? data.opportunities : [])
    .filter(row => typeof row?.path === "string" && row.path.startsWith("/") && !row.path.startsWith("//")
      && row.path.length <= 500 && !/[\u0000-\u001f\u007f]/u.test(row.path)).slice(0, 10);
}
