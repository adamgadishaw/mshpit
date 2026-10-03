import { ApiError } from "../../errors.js";
import { publicArtistPhoto } from "../../artistPhotoCatalog.js";
import { publicVenuePhotoPool } from "../../venuePhotoCatalog.js";
import { licensedVenuePhoto } from "../../../src/domain/venuePhotoProvenance.mjs";
import { payloadDigest } from "../mediaApi/mediaApiPolicy.js";

// Resolve only existing rights-reviewed delivery assets. No fetch, upload,
// provider search, or user-supplied delivery URL crosses this adapter.
export function catalogPhotoOptions(snapshot, { artistPhoto = publicArtistPhoto, venuePhotos = publicVenuePhotoPool } = {}) {
  const identity = snapshot.identity;
  const photos = snapshot.type === "artist"
    ? [artistPhoto(snapshot.key, { artistMbid: identity.mbid })]
    : snapshot.type === "venue" && identity.providerCount === 1 && identity.source && identity.providerId
      ? venuePhotos(identity.name, { source: identity.source, providerVenueId: identity.providerId, limit: 3 }) : [];
  return photos.slice(0, 3).map(licensedVenuePhoto).filter(Boolean).flatMap(photo => {
    const uri = new URL(photo.uri), source = new URL(photo.sourcePage);
    if (uri.port || uri.search || uri.hash || !/^\/(artists|venues)\/licensed\/[a-z0-9-]+\/[a-f0-9]{48}\.webp$/u.test(uri.pathname)
      || source.hostname !== "commons.wikimedia.org" || source.port || source.search
      || !source.pathname.startsWith("/wiki/File:") || !photo.modificationNotice) return [];
    const asset = { ...photo, label: `${snapshot.type === "venue" ? "Venue" : "Artist"} photograph: ${identity.name}` };
    return [{ ...asset, assetHash: payloadDigest({ identityHash: snapshot.identityHash, asset }) }];
  });
}

export function resolveCatalogAttachments(snapshot, references, options) {
  if (!Array.isArray(references) || references.length > 3 || (snapshot.type === "event" && references.length)) {
    throw new ApiError(400, "Choose existing licensed artist or venue photographs.", "VALIDATION_FAILED");
  }
  const available = catalogPhotoOptions(snapshot, options), seen = new Set();
  return references.map(ref => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)
      || Object.keys(ref).some(key => !["sourcePage", "assetHash"].includes(key))
      || seen.has(ref.assetHash)) throw new ApiError(400, "Choose distinct licensed photographs.", "VALIDATION_FAILED");
    seen.add(ref.assetHash);
    const photo = available.find(asset => asset.assetHash === ref.assetHash && asset.sourcePage === ref.sourcePage);
    if (!photo) throw new ApiError(409, "The licensed photograph or its identity changed. Review it again.", "CONFLICT");
    return photo;
  });
}

export function publicCatalogAttachments(snapshot, options) {
  const current = catalogPhotoOptions(snapshot, options);
  return (Array.isArray(snapshot.findings?.attachments) ? snapshot.findings.attachments : []).slice(0, 3)
    .flatMap(saved => current.filter(photo => photo.assetHash === saved?.assetHash && photo.sourcePage === saved?.sourcePage));
}
