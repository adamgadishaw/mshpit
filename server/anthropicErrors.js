// A short, log-safe description of a failed Anthropic API call: the HTTP
// status, the error type and the start of Anthropic's own message, which names
// what was wrong ("credit balance", an unknown parameter or beta). The request
// content is never included, and anything shaped like a key is masked.
export function anthropicErrorSummary(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  // The SDK keeps the response body on `error.error`; raw fetch callers attach
  // the body's `error` object as `anthropicError`.
  const body = error?.anthropicError || error?.error?.error || null;
  const type = typeof body?.type === "string" ? body.type.replace(/[^a-z_]/gu, "").slice(0, 40) : "";
  const detail = typeof body?.message === "string" ? body.message
    .replace(/sk-ant-[A-Za-z0-9_-]+/gu, "[key]")
    .replace(/[^\p{L}\p{N} .,:;'()/[\]=_-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180) : "";
  return [status ? `status=${status}` : "", type ? `type=${type}` : "", detail ? `detail="${detail}"` : ""].filter(Boolean).join(" ");
}
