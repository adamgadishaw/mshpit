import { createLoadState, beginLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { commandSuccess, commandFailure } from "../../domain/commandResult.mjs";

export function createLocalAlertSettingsController({ api, toAppError, onChange = () => {} }) {
  let scope = null, accountId = null, epoch = null, request = null;
  let state = createLoadState();
  const publish = value => { state = value; onChange(); };
  function setAccount(id, nextEpoch) {
    if (id === accountId && nextEpoch === epoch) return;
    request?.abort(); request = null;
    accountId = id; epoch = nextEpoch; scope = {};
    state = createLoadState({ scope, status: id ? "loading" : "idle" });
  }
  async function run(body) {
    if (!accountId || request) return commandFailure(toAppError(new Error("A notification settings request is already pending or signed out.")));
    const claim = scope, controller = new AbortController(); request = controller;
    publish(beginLoadState(state, { scope: claim }));
    try {
      const options = { accountId, signal: controller.signal, body };
      const result = body ? await api.setPreferences(options) : await api.preferences(options);
      if (scope !== claim || controller.signal.aborted) return commandFailure(toAppError(new Error("Notification settings request cancelled.")));
      const data = body ? { ...state.data, ...result } : result;
      publish(resolveLoadState({ scope: claim, data }));
      return commandSuccess(data);
    } catch (error) {
      if (scope !== claim || isLoadCancellation(error, controller.signal)) return commandFailure(toAppError(error));
      const failure = toAppError(error);
      publish(rejectLoadState(state, { scope: claim, error: failure }));
      return commandFailure(failure);
    } finally { if (request === controller) request = null; }
  }
  return { setAccount, snapshot: () => state, load: () => run(), save: preferences => run(preferences),
    commands: () => {
      const owner = scope;
      const scoped = body => owner === scope && accountId ? run(body) : Promise.resolve(commandFailure(toAppError(new Error("Notification settings request cancelled."))));
      return { load: () => scoped(), save: preferences => scoped(preferences) };
    },
    stop: () => { request?.abort(); request = null; scope = {}; } };
}
