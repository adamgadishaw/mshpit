const cleanText = (value, maximum) => String(value || "").trim().slice(0, maximum);

export function listeningHistoryReplayTrack(entry) {
  const title = cleanText(entry?.title, 200);
  const artist = cleanText(entry?.artist, 120);
  if (!title || !artist) return null;
  return {
    ...entry,
    kind: "track",
    title,
    artist,
    art: cleanText(entry?.art, 2048) || null,
    url: cleanText(entry?.url, 2048) || null,
    preview: cleanText(entry?.preview, 2048) || null,
    videoId: cleanText(entry?.videoId, 160) || null,
  };
}

export function listeningHistoryRowKey(entry, index = 0) {
  const playId = cleanText(entry?.playId, 200);
  if (playId) return `play:${playId}`;
  return `event:${Number(entry?.at) || 0}:${cleanText(entry?.artist, 120).toLowerCase()}:${cleanText(entry?.title, 200).toLowerCase()}:${index}`;
}

export function listeningHistoryViewState({ signedIn = false, scoped = true, status = "ready", errorMode = null, rows = [] } = {}) {
  if (!signedIn) return "signed-out";
  if (!scoped) return "loading";
  const hasRows = Array.isArray(rows) && rows.length > 0;
  if ((status === "loading" || status === "idle") && !hasRows) return "loading";
  if (status === "error" && !hasRows) return "error";
  if (!hasRows) return "empty";
  if (status === "loading") return "refreshing";
  if (status === "loading-more") return "loading-more";
  if (status === "error") return errorMode === "more" ? "page-error" : "refresh-error";
  return "ready";
}

export function listeningHistoryScopeCopy(count, hasMore) {
  const total = Math.max(0, Number(count) || 0);
  return `Showing ${total} play event${total === 1 ? "" : "s"} available in this Pit history window.${hasMore ? " Load older plays to extend it." : " This is not a lifetime listening total."}`;
}
