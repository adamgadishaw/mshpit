import { useEffect } from "react";
import { Platform } from "react-native";
import { captureAppError } from "../lib/diagnostics";
import { reportClientCrash } from "../lib/clientCrashReporter";

function safelyCapture(error, { code, context, kind, source }) {
  if (error?.name === "AbortError") return;
  try {
    captureAppError(error instanceof Error ? error : new Error(context), {
      code,
      context,
      source,
      toast: false,
    });
    void reportClientCrash({ kind });
  } catch {
    // A monitor must never become a second crash.
  }
}

export default function RuntimeErrorMonitor() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;

    const onRuntimeError = (event) => {
      // Image/script resource failures are availability signals, not app
      // crashes. They retain their normal browser behaviour and stay out of
      // this high-severity ledger.
      if (event?.target && event.target !== window) return;
      safelyCapture(event?.error, {
        code: "PIT-APP-002",
        context: "Running the current screen",
        kind: "runtime",
        source: "window-error",
      });
    };
    const onUnhandledRejection = (event) => {
      safelyCapture(event?.reason, {
        code: "PIT-APP-003",
        context: "Finishing background app work",
        kind: "promise",
        source: "unhandled-rejection",
      });
    };

    window.addEventListener("error", onRuntimeError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onRuntimeError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
