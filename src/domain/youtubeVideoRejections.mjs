const MAX_REJECTIONS = 100;
const REJECTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const identityText = (value) => String(value || "")
  .normalize("NFKC")
  .toLocaleLowerCase("en-US")
  .trim()
  .replace(/\s+/g, " ");

export const youtubeVideoRejectionSource = (source) => {
  const provider = identityText(source?.provider);
  const sourceId = String(source?.sourceId ?? "").trim();
  if (provider === "deezer" && /^\d{1,20}$/.test(sourceId)) return { provider, sourceId };
  if (provider === "spotify" && /^[A-Za-z0-9]{1,64}$/.test(sourceId)) return { provider, sourceId };
  return null;
};

const sourceAndTime = (sourceOrAt, at) => typeof sourceOrAt === "number"
  ? { source: null, at: sourceOrAt }
  : { source: youtubeVideoRejectionSource(sourceOrAt), at };

export function youtubeVideoRejectionStorageKey(accountId) {
  return `pit.youtubeRejected.v1.${encodeURIComponent(String(accountId || "guest"))}`;
}

export function youtubeVideoRejectionKey(title, artist, videoId, source = null) {
  const base = [identityText(artist), identityText(title), String(videoId || "").trim()];
  const scoped = youtubeVideoRejectionSource(source);
  return JSON.stringify(scoped ? [...base, scoped.provider, scoped.sourceId] : base);
}

export function activeYouTubeVideoRejections(value, at = Date.now()) {
  if (!Array.isArray(value)) return [];
  const latest = new Map();
  for (const entry of value) {
    const key = typeof entry?.key === "string" ? entry.key : "";
    const expiresAt = Number(entry?.expiresAt);
    if (!key || !Number.isFinite(expiresAt) || expiresAt <= at) continue;
    latest.set(key, { key, expiresAt: Math.min(expiresAt, at + REJECTION_TTL_MS) });
  }
  return [...latest.values()]
    .sort((left, right) => right.expiresAt - left.expiresAt)
    .slice(0, MAX_REJECTIONS);
}

export function withYouTubeVideoRejection(value, title, artist, videoId, sourceOrAt = null, at = Date.now()) {
  const scoped = sourceAndTime(sourceOrAt, at);
  const key = youtubeVideoRejectionKey(title, artist, videoId, scoped.source);
  if (!title || !/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ""))) return activeYouTubeVideoRejections(value, scoped.at);
  return [
    { key, expiresAt: scoped.at + REJECTION_TTL_MS },
    ...activeYouTubeVideoRejections(value, scoped.at).filter((entry) => entry.key !== key),
  ].slice(0, MAX_REJECTIONS);
}

export function youtubeVideoWasRejected(value, title, artist, videoId, sourceOrAt = null, at = Date.now()) {
  const scoped = sourceAndTime(sourceOrAt, at);
  const key = youtubeVideoRejectionKey(title, artist, videoId, scoped.source);
  return activeYouTubeVideoRejections(value, scoped.at).some((entry) => entry.key === key);
}

export function youtubeRejectedVideoIds(value, title, artist, sourceOrAt = null, at = Date.now()) {
  const scoped = sourceAndTime(sourceOrAt, at);
  const wantedArtist = identityText(artist);
  const wantedTitle = identityText(title);
  const wantedSource = scoped.source;
  const ids = [];
  for (const entry of activeYouTubeVideoRejections(value, scoped.at)) {
    try {
      const [storedArtist, storedTitle, videoId, provider, sourceId] = JSON.parse(entry.key);
      const sameSource = wantedSource
        ? provider === wantedSource.provider && sourceId === wantedSource.sourceId
        : provider == null && sourceId == null;
      if (sameSource && storedArtist === wantedArtist && storedTitle === wantedTitle && /^[A-Za-z0-9_-]{11}$/.test(videoId)) ids.push(videoId);
    } catch {}
  }
  return [...new Set(ids)].slice(0, 5);
}
