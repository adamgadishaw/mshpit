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

const INDEXABLE_HTML_ROBOTS = "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

// One policy is shared by HTML metadata and HTTP headers so a staging page can
// never send contradictory crawler instructions. Unset PIT_ENV remains
// production by design; only an explicit non-production deployment opts out.
export function htmlRobotsDirective({ indexable = false, env = process.env } = {}) {
  if (!isProduction(env)) return "noindex,nofollow";
  return indexable ? INDEXABLE_HTML_ROBOTS : "noindex,follow";
}
