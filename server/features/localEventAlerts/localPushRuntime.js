import { createLocalPushDelivery } from "./localPushDelivery.js";
import { createExpoPushTransport } from "./expoPushTransport.js";
import { startLocalAlertRuntime } from "./localAlertRuntime.js";

export function localPushConfigured(env = process.env) {
  return env.LOCAL_EVENT_ALERTS_ENABLED === "1" && env.LOCAL_EVENT_PUSH_ENABLED === "1" && !!env.EXPO_PUSH_ACCESS_TOKEN?.trim();
}

// Default-off, same scheduler and shutdown owner as inbox delivery. Provider IO
// happens after the synchronous SQLite transaction has closed. Tests inject the
// transport; importing this module performs no requests or timer registration.
export function startLocalAlertDelivery({ runtime, db, alerts, now, env = process.env, transport, ...timers }) {
  const push = localPushConfigured(env) ? createLocalPushDelivery({ db, alerts, now, enabled: true,
    transport: transport || createExpoPushTransport({ fetchImpl: globalThis.fetch, accessToken: env.EXPO_PUSH_ACCESS_TOKEN }) }) : null;
  const job = startLocalAlertRuntime({ activate: runtime.activate, async tick() {
    const inbox = runtime.tick();
    return { inbox, push: await push?.run() };
  } }, { enabled: env.LOCAL_EVENT_ALERTS_ENABLED === "1", ...timers });
  return { trigger: job.trigger, async stop() { await job.stop(); await push?.stop(); } };
}
