import { readSensitiveLinkToken } from "./sensitiveLinkTokens.mjs";

// Only authentication links gain warm navigation support. Reject ambiguous
// capabilities rather than retaining an older form or selecting one silently.
export function authLinkIntent(location) {
  const query = new URLSearchParams(location?.search || "");
  const fragment = new URLSearchParams(String(location?.hash || "").replace(/^#\??/, ""));
  const count = key => query.getAll(key).length + fragment.getAll(key).length;
  if (!count("reset") && !count("verify")) return null;
  if (["reset", "verify", "unsubscribe", "ownerApproval"].reduce((n, key) => n + count(key), 0) !== 1) return { kind: "invalid" };
  const kind = count("reset") ? "reset" : "verify";
  const token = readSensitiveLinkToken(location, kind);
  return token ? { kind, token } : { kind: "invalid" };
}
