import { createLocalPushController } from "./localPushController.mjs";
import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";
import { isLoadCancellation } from "../../domain/loadState.mjs";

// All SDK calls are injected. Construction, guest startup and settings reads
// cannot prompt, mint a push token or register a device.
export function createNativePushRuntime({ api, notifications, installationStorage, platform, projectId, enabled, toAppError }) {
  let accountId = null, authEpoch = null, epoch = 0, request = new AbortController();
  let preparing = false, preparation = null, refresh = null, started = false, muted = false;
  let onOpenEvent = () => {}, onActivity = () => {}, subscriptions = [], lastTap = null, lifetime = 0;
  const listeners = new Set();
  const capable = !!enabled && ["ios", "android"].includes(platform) && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId || "");
  let state;
  const publish = () => { state = { ...controller.getState(), capable }; if (!muted) for (const listener of listeners) listener(); };
  const controller = createLocalPushController({ api, notifications: capable ? notifications : null, installationStorage, platform, projectId,
    toAppError, onChange: publish, onOpenEvent: (id, event) => {
      if (!event || event.id !== id) throw new TypeError("This show update is no longer available.");
      onOpenEvent(event);
    } });
  publish();
  const failure = error => commandFailure(toAppError(error));
  const capture = () => {
    const mine = epoch, signal = request.signal, id = accountId;
    return { accountId: id, signal, assertCurrent() {
      signal.throwIfAborted(); if (!id || mine !== epoch || preparing) throw new DOMException("Notification scope changed", "AbortError");
    } };
  };
  function invalidate() { request.abort(); request = new AbortController(); epoch++; refresh = null; }
  function setAccount(id, nextEpoch) {
    if (id === accountId && nextEpoch === authEpoch) return;
    invalidate(); accountId = id || null; authEpoch = nextEpoch; preparing = false; preparation = null;
    muted = true; controller.setAccount(accountId, authEpoch); muted = false;
  }
  async function reconcile(explicit = false) {
    if (!accountId || preparing || !capable) return commandSuccess({ enabled: false, reason: "native-configuration-required" });
    const context = capture();
    try {
      const result = await api.preferences(context); context.assertCurrent();
      const saved = await installationStorage.readExisting(); context.assertCurrent();
      const wanted = result.preferences?.datesPush || result.preferences?.salesPush;
      if (!wanted) {
        if (saved?.binding?.accountId === accountId) return await controller.disableDevice();
        return commandSuccess({ enabled: false, reason: "choose-alerts" });
      }
      if (!explicit && saved?.binding?.accountId !== accountId) return commandSuccess({ enabled: false });
      return await controller.enableDevice({ requestPermission: explicit });
    } catch (error) {
      if (!isLoadCancellation(error, context.signal)) {
        state = { ...state, status: "error", error: toAppError(error) }; for (const listener of listeners) listener();
      }
      return failure(error);
    }
  }
  function refreshDevice() {
    if (!refresh) {
      const task = reconcile(); refresh = task;
      void task.finally(() => { if (refresh === task) { refresh = null; if (lastTap) void response(lastTap); } });
    }
    return refresh;
  }
  async function enableDevice() { invalidate(); return reconcile(true); }
  async function disableDevice() {
    invalidate();
    try { return await controller.disableDevice(); } catch (error) { return failure(error); }
  }
  async function response(value) {
    if (!accountId || preparing) return;
    const context = capture();
    try {
      if (refresh) { await refresh; context.assertCurrent(); }
      const result = await controller.openResponse(value); context.assertCurrent();
      if (result.ok && result.value.opened) { lastTap = null; onActivity(); }
      else if (!result.ok) { state = { ...state, status: "error", error: result.error }; for (const listener of listeners) listener(); }
    } catch (error) { if (!isLoadCancellation(error, context.signal)) { state = { ...state, status: "error", error: toAppError(error) }; for (const listener of listeners) listener(); } }
  }
  async function receive(value) {
    const context = capture(), data = value?.request?.content?.data;
    if (!accountId || preparing || data?.kind !== "local_event_alert") return;
    try {
      const saved = await installationStorage.readExisting(); context.assertCurrent();
      if (saved?.binding?.accountId !== accountId || saved.installationId !== data.installationId || saved.binding.generation !== data.generation) return;
      // Activity refresh uses its own current visibility/preferences policy.
      onActivity();
    } catch (error) { if (!isLoadCancellation(error, context.signal)) { state = { ...state, status: "error", error: toAppError(error) }; for (const listener of listeners) listener(); } }
  }
  function prepare() {
    if (preparation) return preparation;
    if (!accountId || !capable) return Promise.resolve(commandSuccess({ enabled: false }));
    preparing = true; invalidate();
    preparation = controller.prepareAccountChange().catch(failure);
    return preparation;
  }
  return {
    setAccount, snapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    enableDevice, disableDevice, refreshDevice,
    commands() {
      const id = accountId, version = authEpoch, lifetime = epoch;
      const valid = () => id && id === accountId && version === authEpoch && lifetime === epoch;
      return { enableDevice: () => valid() ? enableDevice() : Promise.resolve(failure(new Error("Notification account changed."))),
        disableDevice: () => valid() ? disableDevice() : Promise.resolve(failure(new Error("Notification account changed."))),
        refreshDevice: () => valid() ? refreshDevice() : Promise.resolve(failure(new Error("Notification account changed."))) };
    },
    prepare, cancelPreparation() { preparing = false; preparation = null; controller.cancelAccountChange(); },
    reset() { setAccount(null, (authEpoch || 0) + 1); for (const listener of listeners) listener(); },
    updateCallbacks(value) { onOpenEvent = value.onOpenEvent; onActivity = value.onActivity; },
    activate() { publish(); if (lastTap) void response(lastTap); return refreshDevice(); },
    start() {
      if (started || !capable) return;
      started = true;
      subscriptions = [notifications.addPushTokenListener(() => { void refreshDevice(); }),
        notifications.addNotificationReceivedListener(value => { void receive(value); }),
        notifications.addNotificationResponseReceivedListener(value => { lastTap = value; void response(value); })];
      // Keep the platform's last response for crash recovery; the controller
      // deduplicates it for this scope and validates ownership on every restart.
      const startEpoch = ++lifetime;
      void notifications.getLastNotificationResponseAsync().then(value => {
        if (started && startEpoch === lifetime && value) { lastTap = value; void response(value); }
      }, error => { if (started && startEpoch === lifetime) { state = { ...state, status: "error", error: toAppError(error) }; for (const listener of listeners) listener(); } });
    },
    stop() { started = false; lifetime++; for (const subscription of subscriptions) subscription.remove(); subscriptions = []; lastTap = null; setAccount(null, (authEpoch || 0) + 1); },
  };
}
