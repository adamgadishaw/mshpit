import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";
import { createLoadState, beginLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";

// Native-only composition contract. notifications is expo-notifications;
// installationStorage must use secure native storage, never localStorage or a
// portable account export. getOrCreate returns a CSPRNG installation ID +
// 32-byte secret and the last acknowledged account/generation. No token cache.
// The controller holds one account scope, one request and one tap receipt;
// account/auth-epoch changes synchronously abort and discard all private state.
export function createLocalPushController({ api, notifications, installationStorage, platform, projectId, toAppError, onChange = () => {}, onOpenEvent }) {
  let scope = "guest", accountId = null, epoch = 0, abort = new AbortController();
  let state = createLoadState({ scope }), enabling = null, lastResponse = null;
  const publish = next => { state = next; onChange(state); };
  function setAccount(nextAccountId, authEpoch = 0) {
    const nextScope = `${nextAccountId || "guest"}:${authEpoch}`;
    if (scope === nextScope) return;
    abort.abort(); abort = new AbortController(); epoch++; accountId = nextAccountId || null; scope = nextScope;
    enabling = null; lastResponse = null;
    publish(createLoadState({ scope }));
  }
  const captured = () => {
    if (!accountId) throw new TypeError("Log in to enable notifications.");
    const generation = epoch, signal = abort.signal;
    return { accountId, signal, scope, assertCurrent() { signal.throwIfAborted(); if (epoch !== generation) throw new DOMException("Account changed", "AbortError"); } };
  };
  const capable = () => ["ios", "android"].includes(platform) && typeof projectId === "string" && /^[0-9a-f-]{36}$/i.test(projectId) && !!notifications;

  async function enable({ requestPermission = true } = {}) {
    const context = captured();
    publish(beginLoadState(state, { scope: context.scope, retainData: false }));
    try {
      if (!capable()) {
        const result = { enabled: false, reason: "native-configuration-required" };
        publish(resolveLoadState({ scope: context.scope, data: result }));
        return commandSuccess(result);
      }
      // Android's channel exists before the OS permission request.
      if (platform === "android") await notifications.setNotificationChannelAsync("local-shows", { name: "Local shows", importance: notifications.AndroidImportance.DEFAULT });
      context.assertCurrent();
      let permission = await notifications.getPermissionsAsync(); context.assertCurrent();
      if (permission.status !== "granted" && requestPermission) { permission = await notifications.requestPermissionsAsync(); context.assertCurrent(); }
      if (permission.status !== "granted") {
        const installation = await installationStorage.getOrCreate(); context.assertCurrent();
        if (installation.binding?.accountId === context.accountId) {
          await api.revoke({ ...context, body: { installationId: installation.installationId, secret: installation.secret } }); context.assertCurrent();
          await installationStorage.saveBinding(null, context); context.assertCurrent();
        }
        const result = { enabled: false, reason: "permission-denied" };
        publish(resolveLoadState({ scope: context.scope, data: result }));
        return commandSuccess(result);
      }
      const installation = await installationStorage.getOrCreate(); context.assertCurrent();
      const proof = { installationId: installation.installationId, secret: installation.secret };
      const binding = await api.binding({ ...context, body: proof }); context.assertCurrent();
      const token = await notifications.getExpoPushTokenAsync({ projectId }); context.assertCurrent();
      const registered = await api.register({ ...context, body: { ...proof, token: token.data, platform, permission: "granted", expectedGeneration: binding.generation } });
      context.assertCurrent();
      if (registered?.installationId !== installation.installationId || !Number.isSafeInteger(registered.generation) || registered.generation < 1 || !registered.enabled) throw new TypeError("Device registration could not be confirmed.");
      await installationStorage.saveBinding({ accountId: context.accountId, installationId: installation.installationId, generation: registered.generation }, context);
      context.assertCurrent();
      const result = { enabled: true, generation: registered.generation };
      publish(resolveLoadState({ scope: context.scope, data: result }));
      return commandSuccess(result);
    } catch (error) {
      if (isLoadCancellation(error, context.signal)) throw error;
      const appError = toAppError(error);
      publish(rejectLoadState(state, { scope: context.scope, error: appError, retainData: false }));
      return commandFailure(appError);
    }
  }
  function enableDevice(options) {
    if (enabling) return enabling;
    abort.abort(); abort = new AbortController(); epoch++;
    const task = enable(options);
    enabling = task;
    task.finally(() => { if (enabling === task) enabling = null; }).catch(error => {
      // The original promise is returned to the caller for cancellation/error
      // handling; this branch consumes only finally's duplicate rejection.
      void error;
    });
    return task;
  }
  async function disableDevice() {
    abort.abort(); abort = new AbortController(); epoch++; enabling = null;
    const context = captured();
    try {
      const installation = await installationStorage.getOrCreate(); context.assertCurrent();
      await api.revoke({ ...context, body: { installationId: installation.installationId, secret: installation.secret } }); context.assertCurrent();
      await installationStorage.saveBinding(null, context); context.assertCurrent();
      const value = { enabled: false };
      publish(resolveLoadState({ scope: context.scope, data: value }));
      return commandSuccess(value);
    } catch (error) {
      if (isLoadCancellation(error, context.signal)) throw error;
      const appError = toAppError(error);
      publish(rejectLoadState(state, { scope: context.scope, error: appError, retainData: false }));
      return commandFailure(appError);
    }
  }
  async function openResponse(response) {
    if (!accountId) return commandSuccess({ opened: false });
    const context = captured(), request = response?.notification?.request, data = request?.content?.data;
    if (!request?.identifier || lastResponse === request.identifier || data?.kind !== "local_event_alert" || typeof data.alertId !== "string" || data.alertId.length > 100) return commandSuccess({ opened: false });
    try {
      const installation = await installationStorage.getOrCreate(); context.assertCurrent();
      if (installation.binding?.accountId !== context.accountId || installation.installationId !== data.installationId || installation.binding?.generation !== data.generation) return commandSuccess({ opened: false });
      const { target } = await api.target({ ...context, alertId: data.alertId }); context.assertCurrent();
      if (!target || target.alertId !== data.alertId || typeof target.eventId !== "string" || !target.eventId.length) throw new TypeError("This show update is no longer available.");
      if (lastResponse === request.identifier) return commandSuccess({ opened: false });
      lastResponse = request.identifier;
      // Navigate by canonical tour-date identity, never provider payload URLs
      // or concert-archive keys, and never add attendance/calendar intent.
      onOpenEvent(target.eventId);
      return commandSuccess({ opened: true });
    } catch (error) {
      if (isLoadCancellation(error, context.signal)) throw error;
      return commandFailure(toAppError(error));
    }
  }
  return { setAccount, enableDevice, disableDevice, openResponse, getState: () => state, dispose: () => { setAccount(null, epoch + 1); } };
}
