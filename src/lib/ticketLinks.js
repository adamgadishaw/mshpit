import { Alert, Linking } from "react-native";
import { followTicketLink } from "../domain/ticketLinks.mjs";

function confirmTicketDestination({ hostname }) {
  const title = "Open external ticket site?";
  const detail = `You're leaving PIT for:\n\n${hostname}\n\nCheck the address before continuing. PIT does not handle the purchase.`;
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return Promise.resolve(window.confirm(`${title}\n\n${detail}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, detail, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Continue", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

export async function openTicketLink(value, { onFailure } = {}) {
  const result = await followTicketLink(value, {
    confirmDestination: confirmTicketDestination,
    openUrl: (url) => Linking.openURL(url),
  });
  if ((result.status === "failed" || result.status === "rejected") && typeof onFailure === "function") {
    onFailure(result);
  }
  return result;
}
