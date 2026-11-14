// Legacy failed rows have no deliveryState. Keep their existing recovery while
// newer rows distinguish a definite refusal from a lost acknowledgement.
export function chatDeliveryPresentation(message = {}) {
  if (!message.failed) return null;
  const unconfirmed = message.deliveryUncertain === true || message.deliveryState === "unconfirmed";
  const labels = {
    unconfirmed: "Not confirmed",
    retry_later: "Try again later",
    rejected: "Couldn’t send",
    auth_required: "Sign in to send",
  };
  return {
    label: labels[message.deliveryState] || "Not sent",
    retryable: message.retryable !== false,
    detail: message.deliveryMessage || (unconfirmed ? "This message may already have arrived." : ""),
    dismissText: unconfirmed ? "dismiss" : "cancel",
    dismissLabel: unconfirmed ? "Remove pending message" : "Cancel failed message",
    dismissHint: unconfirmed ? "Removes this pending entry from this device. It does not delete a message that already arrived." : undefined,
  };
}

export function chatDeliverySnippetPrefix(message = {}) {
  const state = chatDeliveryPresentation(message);
  return state ? `${state.label}: ` : "";
}
