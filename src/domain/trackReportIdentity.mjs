const text = (value) => String(value ?? "").trim();

export function trackReportDescriptor(track, fallbackArtist = "") {
  const title = text(track?.title);
  const artist = text(track?.artist) || text(fallbackArtist);
  const provider = text(track?.provider).toLowerCase();
  const sourceId = text(track?.sourceId);
  return {
    title,
    artist,
    provider: provider && sourceId ? provider : null,
    sourceId: provider && sourceId ? sourceId : null,
  };
}

export function trackReportIdentityKey(track, fallbackArtist = "") {
  const descriptor = trackReportDescriptor(track, fallbackArtist);
  return JSON.stringify([
    descriptor.provider || "",
    descriptor.sourceId || "",
    descriptor.artist,
    descriptor.title,
  ]);
}
