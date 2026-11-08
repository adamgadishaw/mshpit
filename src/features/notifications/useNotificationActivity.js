import { useEffect, useRef, useSyncExternalStore } from "react";
import useAppActive from "../../lib/useAppActive";
import { AppError } from "../../lib/diagnostics";
import { save } from "../../lib/persist";
import { isLoadCancellation } from "../../domain/loadState.mjs";
import { createNotificationActivity } from "./notificationActivityState.mjs";
import { fetchNotificationPage, writeNotificationReads } from "./notificationsApi";

export default function useNotificationActivity({ getIdentity, getHiddenActorIds = () => [], demo = false, seed = [] }) {
  const identity = useRef({ getIdentity, getHiddenActorIds }); identity.current = { getIdentity, getHiddenActorIds };
  const ref = useRef(null);
  if (!ref.current) ref.current = createNotificationActivity({
    getIdentity: () => identity.current.getIdentity(), getHiddenActorIds: () => identity.current.getHiddenActorIds(), demo, seed,
    fetchPage: fetchNotificationPage, writeReads: writeNotificationReads,
    makeError: (message, code = "PIT-API-001") => new AppError(message, { code, context: "Loading activity", source: "notifications", retryable: true }),
    normalizeError: error => error instanceof AppError ? error : new AppError("Activity could not be loaded. Check your connection and try again.", { code: "PIT-NET-001", cause: error, source: "notifications", retryable: true }),
  });
  const controller = ref.current;
  const scope = controller.scope();
  const resource = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const active = useAppActive();
  useEffect(() => {
    controller.mount();
    // Retire the legacy device-global plaintext cache; never save bodies.
    if (!demo) save("pit.notifications", []);
    return () => controller.unmount();
  }, [controller, demo]);
  useEffect(() => {
    const current = identity.current.getIdentity();
    if (!active || !current.accountId || !current.ready) return undefined;
    const load = () => controller.load({ expectedScope: scope, summary: controller.getSnapshot().updatedAt != null }).catch(error => {
      // Initial/page failures already live in the scoped resource. A failed
      // optional badge poll retains the last confirmed count, never clears it.
      if (isLoadCancellation(error)) return;
    });
    void load();
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(timer);
  }, [active, scope, controller]);
  return {
    notifications: resource.data.rows,
    notificationActivity: resource,
    setNotifications: (update, { refreshSummary = false } = {}) => {
      controller.setRows(update, scope);
      if (refreshSummary) void controller.load({ expectedScope: scope, summary: true }).catch(error => {
        // Confirmed privacy changes remain locally scrubbed if the optional
        // count reconciliation is offline; the active-app poll retries later.
        if (isLoadCancellation(error)) return;
      });
    },
    refreshNotifications: options => controller.load({ ...options, expectedScope: scope }),
    loadMoreNotifications: options => controller.load({ ...options, expectedScope: scope, more: true }),
    markNotificationsRead: options => controller.markRead({ ...options, expectedScope: scope }),
  };
}
