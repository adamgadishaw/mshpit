// api.js preserves safe, actionable 4xx detail in message. userMessage is the
// broader diagnostics catalogue description. Never show raw server 5xx or
// browser/native exception text in a form, including thrown strings.
export function accountFormError(error, fallback = "Your changes could not be saved. Your edits are still here. Try again.") {
  const status = Number(error?.status);
  const actionableApi = error?.source === "api" && status >= 400 && status < 500;
  const message = actionableApi ? error.message || error.userMessage : error?.userMessage;
  return typeof message === "string" && message.trim() ? message.slice(0, 400) : fallback;
}
