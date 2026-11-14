import { Alert, Platform } from "react-native";

// App owns successful navigation, so confirm before the composer is unmounted.
export function confirmCalendarReceipt({ state }) {
  const title = state === "scheduled" ? "Show scheduled" : state === "blocked" ? "Publication needs attention" : "Schedule withdrawn";
  const message = state === "scheduled" ? "Your date is saved privately. The calendar listing, post and Activity update publish at the scheduled time."
    : state === "blocked" ? "This show could not be published. Open Show dates and refresh it before trying again."
      : "The private scheduled announcement will not be published.";
  if (Platform.OS === "web" && typeof window !== "undefined") window.alert(title + "\n\n" + message);
  else Alert.alert(title, message);
}
