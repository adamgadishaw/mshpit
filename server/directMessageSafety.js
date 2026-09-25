export const DIRECT_MESSAGE_POLICIES = Object.freeze(["nobody", "people_i_follow", "mutuals"]);
export const CLASSIFIED_ACCOUNT_AGE_BANDS = Object.freeze(["13_17", "18_plus"]);
export const ACCOUNT_AGE_BANDS = Object.freeze([...CLASSIFIED_ACCOUNT_AGE_BANDS, "unknown"]);

export function directMessagePolicy(value, fallback = "mutuals") {
  return DIRECT_MESSAGE_POLICIES.includes(value) ? value : fallback;
}

export function accountAgeBand(value, fallback = "unknown") {
  return ACCOUNT_AGE_BANDS.includes(value) ? value : fallback;
}

export function isClassifiedAccountAgeBand(value) {
  return CLASSIFIED_ACCOUNT_AGE_BANDS.includes(value);
}

export function mayStartDirectMessage({ conversationExists = false, recipientPolicy = "mutuals", senderAgeBand = "unknown", recipientAgeBand = "unknown", senderFollowsRecipient = false, recipientFollowsSender = false } = {}) {
  const senderBand = accountAgeBand(senderAgeBand);
  const recipientBand = accountAgeBand(recipientAgeBand);
  // Migrated accounts must make the same coarse safety choice as new accounts
  // before initiating a new conversation. Unknown never means adult.
  if (!isClassifiedAccountAgeBand(senderBand)) {
    return { allowed: false, reason: "age_classification_required" };
  }
  const mutual = !!senderFollowsRecipient && !!recipientFollowsSender;
  // Until a migrated recipient classifies, protect them as though the stricter
  // teen rule applies. This does not reveal their age band to the sender.
  if (!isClassifiedAccountAgeBand(recipientBand)) {
    return { allowed: mutual, reason: mutual ? "mutual" : "unclassified_recipient_requires_mutual" };
  }
  // A teen may only start or receive a conversation with a mutual follow. We
  // store an age band, never a birth date, and do not disclose which check failed.
  if (senderBand === "13_17" || recipientBand === "13_17") {
    return { allowed: mutual, reason: mutual ? "mutual" : "minor_requires_mutual" };
  }
  // Existing adult conversations remain writable even if a participant later
  // closes first contact. Blocking remains the control that stops an existing
  // relationship; age safety is re-evaluated on every new message.
  if (conversationExists) return { allowed: true, reason: "existing_conversation" };
  const policy = directMessagePolicy(recipientPolicy);
  if (policy === "nobody") return { allowed: false, reason: "recipient_closed" };
  if (policy === "mutuals") return { allowed: mutual, reason: mutual ? "mutual" : "mutual_required" };
  return { allowed: !!recipientFollowsSender, reason: recipientFollowsSender ? "recipient_follows_sender" : "follow_required" };
}
