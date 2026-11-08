const sections = new Set(["overview", "shows", "music", "community", "about"]);
export function artistReturnSnapshot(value = {}) {
  return {
    section: sections.has(value.section) ? value.section : "overview",
    scrollY: Number.isFinite(value.scrollY) ? Math.max(0, Math.min(100000, value.scrollY)) : 0,
    openAlbum: typeof value.openAlbum === "string" ? value.openAlbum.slice(0, 240) : typeof value.openAlbum === "number" && Number.isFinite(value.openAlbum) ? value.openAlbum : null,
    showAllSongs: value.showAllSongs === true, showAllReleases: value.showAllReleases === true,
  };
}
export function createIOSArtistReturnStore() {
  let account, epoch, sequence = 0;
  const entries = new Map();
  return {
    reconcile(id, authEpoch, frames) {
      if (account !== id || epoch !== authEpoch) { entries.clear(); account = id; epoch = authEpoch; }
      for (const frame of entries.keys()) if (!frames.includes(frame)) entries.delete(frame);
    },
    lease(frame, artist) {
      if (!frame || !artist) return null;
      const previous = entries.get(frame);
      if (previous?.artist === artist) return previous.lease;
      const entry = { artist, snapshot: undefined };
      const owned = () => entries.get(frame) === entry;
      entry.lease = { key: `artist-return-${++sequence}`,
        read: () => owned() ? entry.snapshot : undefined,
        save(patch) { if (owned()) entry.snapshot = artistReturnSnapshot({ ...entry.snapshot, ...patch }); },
      };
      entries.set(frame, entry);
      while (entries.size > 12) entries.delete(entries.keys().next().value);
      return entry.lease;
    },
  };
}
