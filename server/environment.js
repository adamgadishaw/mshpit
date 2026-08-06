// Which deployment this process is.
//
// NODE_ENV cannot answer this. Staging must run with NODE_ENV=production or it
// stops behaving like production in the ways that matter (Secure cookies, CORS
// disabled, the data-directory guard), and then it is not a rehearsal. So the
// deployment identity is a separate, explicit variable.
//
// Default is production. An unset PIT_ENV must never turn the real site into a
// half-muted one; staging opts IN to being staging.
export function pitEnv(env = process.env) {
  const value = String(env?.PIT_ENV || "").trim().toLowerCase();
  return value || "production";
}

export function isProduction(env = process.env) {
  return pitEnv(env) === "production";
}
