import { Linking } from "react-native";
import { captureAppError } from "../../lib/diagnostics";

export function openCitySource(url) {
  if (!url) return;
  void Linking.openURL(url).catch((error) => {
    captureAppError(error, { context: "Opening a city source", source: "app", toast: true });
  });
}
