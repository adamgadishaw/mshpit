import Storage from "expo-sqlite/kv-store";
import { AUTH_INTENT_KEY } from "../domain/authTransitions.mjs";
import { AppError, captureAppError } from "./diagnostics";

// Read SQLite itself, never persist.load(): failed writes intentionally remain
// visible in that adapter's memory fallback, which cannot survive process death.
// Only a pending/signed-in auth transition calls this; optional cache writes and
// explicit logout keep their existing behavior. No credential is stored here.
export function confirmAuthIntent(intent, phase) {
  try {
    const stored = JSON.parse(Storage.getItemSync(AUTH_INTENT_KEY));
    if (!intent || !["pending", "signed-in"].includes(phase) || intent.phase !== phase
      || !Number.isSafeInteger(intent.order) || intent.order < 0
      || stored?.revision !== intent.revision || stored?.phase !== intent.phase
      || stored?.order !== intent.order) throw new Error("Authentication intent was not persisted");
  } catch (cause) {
    const error = new AppError(undefined, {
      code: "PIT-STORE-004", source: "device-storage", context: "Saving sign-in on this device", cause,
    });
    // Fixed operation state only: signup can distinguish a request that was
    // never sent from an account that may already have been created.
    error.authIntentPhase = phase;
    throw captureAppError(error, { toast: false });
  }
}
