import { canonicalArtistIdentity } from "../../domain/canonicalArtistIdentity.mjs";
import { topRatedShowNavigation } from "../../domain/topRatedShows.mjs";
import { readArtistEventArchive } from "./services/artistEventApi.mjs";

export async function resolveRankedShow(row, { accountId, signal, remoteArtistMeta, resolveArtist }) {
  let identity = canonicalArtistIdentity({ artistName: row.artist, artistKey: row.artistKey, catalogArtist: remoteArtistMeta?.(row.artist) });
  if (!identity.artistKey) {
    const artist = await resolveArtist(row.artist, { signal, throwOnError: true, scope: "stored" });
    if (signal.aborted) return null;
    identity = canonicalArtistIdentity({ artistName: row.artist, catalogArtist: artist });
  }
  if (!identity.artistKey) return null;
  const archive = await readArtistEventArchive({ accountId, signal, artistKey: identity.artistKey, name: identity.artistName });
  return signal.aborted ? null : topRatedShowNavigation(row, archive);
}
