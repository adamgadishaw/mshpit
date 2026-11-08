import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { createIOSAccessibilityPreference } from "./iosAccessibilityPreference.mjs";

const preference = createIOSAccessibilityPreference({
  read: () => AccessibilityInfo.isScreenReaderEnabled(),
  listen: listener => AccessibilityInfo.addEventListener("screenReaderChanged", listener),
});

export default function useScreenReaderEnabled() {
  return useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getServerSnapshot);
}
