import { createArtistMemorialRepository } from "../artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "../artistMemorials/artistMemorialService.js";
import { createProfileSearchIndexingPolicy } from "../../profileSearchIndexing.js";
import { createPublicDocumentRepository } from "./publicDocumentRepository.js";
import { createPublicVenueReviewService } from "./publicVenueReviews.js";
import { createPublicCollectionDocumentService } from "./publicCollectionDocuments.js";
import { createPublicDocumentProjector } from "./publicDocumentProjection.js";
import { decodeArchiveShowKey } from "../artistArchive/artistArchiveKeys.js";
import {
  renderPublicDocument,
  renderPublicDocumentHead,
  renderPublicDocumentMain,
  renderPublicDocumentShell,
} from "./publicDocumentRenderer.js";

/**
 * Feature-owned entry point for no-JavaScript public SEO documents.
 *
 * Integration intentionally takes already-resolved identities. The existing
 * public URL resolver owns ambiguous vanity-route precedence; this layer owns
 * only privacy-safe reads, public projection and HTML rendering.
 */
export function createPublicDocumentService({ database, origin, paths, artistMemorialService = null } = {}) {
  const repository = createPublicDocumentRepository(database, {
    venueReviews: createPublicVenueReviewService(database),
  });
  const projector = createPublicDocumentProjector({ database, origin, paths });
  const collections = createPublicCollectionDocumentService({ database, origin });
  const profileSearchIndexing = createProfileSearchIndexingPolicy(database);
  const memorials = artistMemorialService || createArtistMemorialService({
    repository: createArtistMemorialRepository(database),
  });

  const service = {
    homeDocument(options = {}) {
      return projector.home(repository.readHome(options), options);
    },

    discoverDocument(options = {}) {
      return projector.discover(repository.readDiscover(options), options);
    },

    searchDocument(options = {}) {
      return projector.search(options);
    },

    artistDocument(options = {}) {
      const raw = repository.readArtist(options);
      if (!raw) return null;
      const requestedAt = Number(options.at);
      const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
      const memorialDetail = memorials.readPublicWithMetadata({
        artistKey: raw.artist.norm,
        artistMbid: raw.artist.mbid,
        at,
      });
      return projector.artist({
        ...raw,
        memorial: memorialDetail?.memorial || null,
        memorialUpdatedAt: memorialDetail?.updatedAt ?? null,
      }, options);
    },

    memberDocument(options = {}) {
      if (!profileSearchIndexing.allows(options)) return null;
      const raw = repository.readMember(options);
      return raw ? projector.member(raw, options) : null;
    },

    postDocument(options = {}) {
      const raw = repository.readPost(options);
      return raw ? projector.post(raw, options) : null;
    },

    eventDocument(options = {}) {
      const raw = repository.readEvent(options);
      return raw ? projector.event(raw, options) : null;
    },

    concertDocument(options = {}) {
      const decoded = decodeArchiveShowKey(options.showKey);
      if (!decoded) return null;
      const raw = repository.readConcert(decoded);
      return raw ? projector.concert(raw, options) : null;
    },

    venueDocument(options = {}) {
      const raw = repository.readVenue(options);
      return raw ? projector.venue(raw, options) : null;
    },

    cityVenuesDocument(options = {}) {
      return collections.cityVenuesDocument(options);
    },

    cityConcertsDocument(options = {}) {
      return collections.cityConcertsDocument(options);
    },

    artistConcertsDocument(options = {}) {
      return collections.artistConcertsDocument(options);
    },

    directoryDocument(options = {}) {
      const raw = repository.readDirectory({ ...options, limit: 12 });
      return raw ? projector.directory(raw, options) : null;
    },

    documentFor(request = {}) {
      if (request.kind === "home") return service.homeDocument(request);
      if (request.kind === "discover") return service.discoverDocument(request);
      if (request.kind === "search") return service.searchDocument(request);
      if (request.kind === "artist") return service.artistDocument(request);
      if (request.kind === "member" || request.kind === "profile") return service.memberDocument(request);
      if (request.kind === "post" || request.kind === "show") return service.postDocument(request);
      if (request.kind === "event") return service.eventDocument(request);
      if (request.kind === "concert") return service.concertDocument(request);
      if (request.kind === "venue") return service.venueDocument(request);
      if (request.kind === "city-venues") return service.cityVenuesDocument(request);
      if (request.kind === "city-concerts") return service.cityConcertsDocument(request);
      if (request.kind === "artist-concerts") return service.artistConcertsDocument(request);
      if (request.kind === "directory") return service.directoryDocument(request);
      return null;
    },

    render(document) {
      return renderPublicDocument(document);
    },

    renderFor(request = {}) {
      const document = service.documentFor(request);
      return document ? renderPublicDocument(document) : null;
    },
  };

  return Object.freeze(service);
}

export {
  createPublicDocumentRepository,
  createPublicDocumentProjector,
  renderPublicDocument,
  renderPublicDocumentHead,
  renderPublicDocumentMain,
  renderPublicDocumentShell,
};
