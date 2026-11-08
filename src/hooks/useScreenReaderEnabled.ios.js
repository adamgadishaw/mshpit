import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { createIOSAccessibilityPreference } from "./iosAccessibilityPreference.mjs";

const preference = createIOSAccessibilityPreference({
  read: () => AccessibilityInfo.isScreenReaderEnabled(),
  listen: listener => AccessibilityInfo.addEventListener("screenReaderChanged", listener),
});

// Action speech requires known-on, unlike the conservative animation default.
// Both APIs use the same race-safe native subscription and initial lookup.
export const getConfirmedScreenReaderEnabled = preference.getConfirmedSnapshot;
export const subscribeConfirmedScreenReaderEnabled = preference.subscribeConfirmed;

export default function useScreenReaderEnabled() {
  return useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getServerSnapshot);
}
