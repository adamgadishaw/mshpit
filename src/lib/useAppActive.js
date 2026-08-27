import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { appActivityIsActive } from "./appActivity.mjs";

let webPageSuspended = false;

const readSnapshot = () => (
  !webPageSuspended
  && appActivityIsActive({
    platform: Platform.OS,
    appState: AppState.currentState,
    visibilityState: Platform.OS === "web" && typeof document !== "undefined"
      ? document.visibilityState
      : null,
  })
);

const readServerSnapshot = () => true;

const subscribe = (notify) => {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") webPageSuspended = false;
      notify();
    };
    const onPageHide = () => {
      webPageSuspended = true;
      notify();
    };
    const onPageShow = () => {
      webPageSuspended = false;
      notify();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    // Safari can freeze a back-forward-cache page without delivering another
    // visibility transition. Explicit page lifecycle events guarantee one
    // inactive -> active edge and therefore one bounded restart.
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onPageShow);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
      }
    };
  }

  const subscription = AppState.addEventListener("change", notify);
  return () => subscription.remove();
};

// One cross-platform source of truth for nonessential polling and timers.
// Screens stay mounted while background work pauses, preserving their UI and
// allowing exactly one effect restart when the tab/app becomes active again.
export default function useAppActive() {
  return useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
}
