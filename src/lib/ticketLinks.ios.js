import { Alert, Linking } from "react-native";
import { followTicketLink } from "../domain/ticketLinks.mjs";

// A native confirmation can outlive the Show that opened it. Recheck the
// captured presentation at both the prompt and external-navigation boundaries.
export async function openTicketLink(value, { onFailure, isCurrent = () => true } = {}) {
  if (!isCurrent()) return { status: "cancelled" };
  const result = await followTicketLink(value, {
    confirmDestination: ({ hostname }) => {
      if (!isCurrent()) return Promise.resolve(false);
      return new Promise((resolve) => Alert.alert("Open external ticket site?",
        `You're leaving PIT for:\n\n${hostname}\n\nCheck the address before continuing. PIT does not handle the purchase.`, [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Continue", onPress: () => resolve(isCurrent()) },
        ], { cancelable: true, onDismiss: () => resolve(false) }));
    },
    openUrl: (url) => {
      if (!isCurrent()) throw new Error("Ticket presentation retired");
      return Linking.openURL(url);
    },
  });
  if (isCurrent() && (result.status === "failed" || result.status === "rejected")) onFailure?.(result);
  return result;
}
