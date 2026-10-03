export const emptyCatalogMaintenanceState = () => ({
  data: null, loading: false, pendingMode: null, error: "", confirmed: false, notice: "",
});
export const catalogPilotViewAllowed = (state, role) => role === "admin" && state.active === true
  && state.confirmed === true && state.data?.localPilot?.canReview === true
  && state.data.localPilot.mode === "offline-only" && state.data.localPilot.maxRecords === 100;

const permissionError = (error) => [401, 403].includes(Number(error?.status ?? error?.statusCode))
  || ["AUTH_REQUIRED", "UNAUTHORIZED", "FORBIDDEN", "ACCOUNT_CHANGED"].includes(error?.code);

// A controller belongs to one mount/account generation, not merely an ID.
// A late response from A -> B -> A must never resurrect the first A's data.
export function createCatalogMaintenanceController({ accountId, read, change, onState }) {
  let state = emptyCatalogMaintenanceState();
  let active = true;
  let operation = null;
  const publish = (patch) => {
    if (!active) return;
    state = { ...state, ...patch };
    onState(state);
  };
  const owns = (current) => active && operation === current && !current.signal.aborted;
  const begin = () => {
    operation?.abort();
    operation = new AbortController();
    return operation;
  };
  return {
    async refresh() {
      if (!active || state.pendingMode || operation) return;
      const current = begin();
      publish({ loading: true, error: "" });
      try {
        const data = await read({ accountId, signal: current.signal });
        if (owns(current)) publish({ data, loading: false, confirmed: true, error: "" });
      } catch (error) {
        if (owns(current)) publish({
          ...(permissionError(error) ? { data: null } : {}),
          loading: false, confirmed: false,
          error: permissionError(error)
            ? "Administrator access is no longer confirmed. Sign in again or refresh after access is restored."
            : "Catalog upkeep could not refresh. Any previous figures are a saved snapshot; refresh before changing the mode.",
        });
      } finally { if (operation === current) operation = null; }
    },
    async setMode(mode) {
      if (!active || state.pendingMode || !state.confirmed || !state.data?.catalog) return;
      const current = begin();
      publish({ loading: false, pendingMode: mode, error: "", notice: "" });
      try {
        const data = await change({ accountId, mode, expectedMode: state.data.catalog.mode, signal: current.signal });
        if (owns(current)) publish({
          data, pendingMode: null, confirmed: true,
          notice: mode === "paused" ? "Pause saved. Work already in progress can finish its current step."
            : "Mode saved on the server. The scheduler will honor the next due time and safety limits.",
        });
      } catch (error) {
        if (owns(current)) publish({
          ...(permissionError(error) ? { data: null } : {}),
          pendingMode: null, confirmed: false,
          error: permissionError(error)
            ? "Administrator access is no longer confirmed. No further controls are available until status is refreshed."
            : "The mode change could not be confirmed. Refresh status before trying again; the server may already have saved it.",
        });
      } finally { if (operation === current) operation = null; }
    },
    dispose() { active = false; operation?.abort(); operation = null; },
  };
}

export function catalogCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : "Unavailable";
}
export function catalogBytes(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${(value / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB` : "Unavailable";
}
export function catalogTime(value) {
  if (value === null || value === undefined || value === 0) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}
export function catalogModeLabel(mode) {
  return ({ catch_up: "Catch-up", maintenance: "Maintenance", paused: "Paused" })[mode] || "Unconfirmed";
}

export function catalogSourceSchedulerLabel(sourceRefresh) {
  if (sourceRefresh?.enabled === false) return "Disabled";
  if (sourceRefresh?.configured === false) return "Provider configuration missing";
  if (sourceRefresh?.enabled === true && sourceRefresh?.configured === true) return "Enabled";
  return "Unverified";
}

// Why the news desk did or did not publish on its last check (codes from
// server/features/newsDesk/newsDeskStatus.js).
const NEWS_DESK_REASONS = Object.freeze({
  published: "Published a story.",
  waiting_for_slot: "Waiting for the next publishing slot.",
  day_full: "Today's publishing slots are used.",
  too_soon: "Waiting: the last story went out less than two hours ago.",
  budget: "Stopped at the news spending limit.",
  declined: "Claude turned the candidates down as not big music news.",
  no_qualifying_story: "No story is carried by enough independent outlets yet.",
  publisher_paused: "Paused: the news account needs review before anything else is published.",
  yielded_for_memory: "Skipped to leave memory for uploads; the next check runs as usual.",
  time_limit: "Stopped at the check's time limit; the next check picks up where it left off.",
});
export function newsDeskReasonText(pass) {
  if (!pass) return "No check recorded since this version started.";
  return NEWS_DESK_REASONS[pass.reason] || "Finished without a recorded reason.";
}

export const claudeMoney = (value) => (Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "Unverified");
// "$1.20 confirmed, $0.05 held, $0.00 unconfirmed"
export function claudeSpendBreakdown(entry) {
  if (!entry) return "Unverified";
  return `${claudeMoney(entry.confirmedUsd)} confirmed, ${claudeMoney(entry.heldUsd)} held, ${claudeMoney(entry.unconfirmedUsd)} unconfirmed`;
}
export const claudeSpendTotal = (entry) => (entry
  ? Number(entry.confirmedUsd || 0) + Number(entry.heldUsd || 0) + Number(entry.unconfirmedUsd || 0) : null);
