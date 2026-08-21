const rowsOf = (payload) => Array.isArray(payload?.albums) ? payload.albums : [];

// Converts provider/cache transport details into the states the artist page can
// honestly claim. In particular, an outage is never presented as "no releases"
// and a policy-bounded cached catalogue is explicitly marked stale.
export function discographyPresentation(payload, { status = "idle", error = "" } = {}) {
  const albums = rowsOf(payload);
  const hasRows = albums.length > 0;
  const stale = payload?.stale === true || payload?.status === "stale";
  const failed = status === "error" || !!String(error || "").trim();

  if (failed && !hasRows) {
    return { state: "error", albums, message: String(error || "The discography could not be loaded.") };
  }
  if ((status === "loading" || status === "idle") && !hasRows) {
    return { state: "loading", albums, message: "Loading releases..." };
  }
  if (stale || (failed && hasRows)) {
    return { state: "stale", albums, message: failed ? "Could not refresh. Showing the last loaded catalogue." : "Showing a cached catalogue while the music source recovers." };
  }
  if (!hasRows) {
    return { state: "empty", albums, message: payload?.status === "not_found" ? "No matching releases were found for this artist." : "No releases are available for this artist yet." };
  }
  return { state: "ready", albums, message: "" };
}

export function discographyIdentityCopy(payload, artistName, presentation) {
  const matched = String(payload?.artist?.name || "").trim();
  if (matched) return `Matched to ${matched}`;
  if (presentation?.state === "error") return `${artistName}'s catalogue is unavailable`;
  if (presentation?.state === "empty") return `No catalogue match for ${artistName}`;
  return `Finding ${artistName}'s releases`;
}
