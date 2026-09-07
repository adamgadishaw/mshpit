import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppError } from "../../lib/diagnostics";
import { cleanHandle } from "../../domain/validation.mjs";
import { projectLoadState } from "../../domain/loadState.mjs";
import { createHandleAvailabilityController } from "./handleAvailabilityController.mjs";
import { readSignupHandleAvailability } from "./services/handleAvailabilityApi.mjs";

const asError = (error) => error instanceof AppError ? error : new AppError(undefined, {
  code: "PIT-API-001", cause: error, context: "Checking username", source: "signup-handle",
});
export function useSignupHandleAvailability(value, { enabled = true } = {}) {
  const controller = useMemo(() => createHandleAvailabilityController({ read: readSignupHandleAvailability, asError }), [enabled]);
  const current = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const handle = enabled ? cleanHandle(value) : "";
  useEffect(() => { controller.resume(); return controller.dispose; }, [controller]);
  useEffect(() => { controller.setHandle(handle); }, [controller, handle]);
  // Project during render: an old green check disappears before the effect
  // starts a new request, even if the previous transport ignores cancellation.
  return { resource: projectLoadState(current, handle), retry: controller.retry };
}
