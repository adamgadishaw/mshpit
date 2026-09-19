export function artistSetupFailure(result) {
  const failure = result?.error;
  const message = typeof failure === "string" ? failure
    : failure?.userMessage || failure?.message || result?.userMessage || result?.message;
  const code = result?.code || failure?.code;
  return {
    message: typeof message === "string" && message.trim() ? message.trim() : "That change did not save. Your details are still here; please try again.",
    existingPage: code === "ARTIST_PAGE_EXISTS",
  };
}

export function artistVerificationNotice(status, ownsPage = false, held = false) {
  if (status === "verified") return { locked: true, button: "ARTIST IDENTITY VERIFIED", message: "Your artist identity has been verified by Mshpit." };
  if (status === "pending") return { locked: true, button: "REVIEW PENDING", message: held ? "Your official evidence is being reviewed. The identity hold remains until a moderator explicitly releases it." : ownsPage
    ? "Your artist check is being reviewed. You can keep updating your page, posting media, and adding concerts while you wait."
    : "Your artist claim is being reviewed. Creating another copy will not grant access to the existing page." };
  if (status === "rejected") return { locked: false, message: "Your previous request was not approved. Add new official evidence to request another review." };
  if (status === "expired") return { locked: false, message: "The previous Story challenge expired before review. Generate a fresh code and submit the new live Story. Your written details stay here." };
  if (held) return { locked: false, message: "Your artist page is saved but on identity-review hold. Submit official evidence to resolve the possible identity conflict." };
  return { locked: false, message: ownsPage ? "Your page is active. Request the artist check when you are ready; free page tools do not require that check." : "Existing artist pages need an approved ownership claim before you can manage them." };
}
