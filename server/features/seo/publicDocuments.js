import { createPublicDocumentRepository } from "./publicDocumentRepository.js";
import { createPublicDocumentProjector } from "./publicDocumentProjection.js";
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
export function createPublicDocumentService({ database, origin, paths } = {}) {
  const repository = createPublicDocumentRepository(database);
  const projector = createPublicDocumentProjector({ database, origin, paths });

  const service = {
    homeDocument(options = {}) {
      return projector.home(repository.readHome(options), options);
    },

    artistDocument(options = {}) {
      const raw = repository.readArtist(options);
      return raw ? projector.artist(raw, options) : null;
    },

    memberDocument(options = {}) {
      const raw = repository.readMember(options);
      return raw ? projector.member(raw, options) : null;
    },

    postDocument(options = {}) {
      const raw = repository.readPost(options);
      return raw ? projector.post(raw, options) : null;
    },

    documentFor(request = {}) {
      if (request.kind === "home") return service.homeDocument(request);
      if (request.kind === "artist") return service.artistDocument(request);
      if (request.kind === "member" || request.kind === "profile") return service.memberDocument(request);
      if (request.kind === "post" || request.kind === "show") return service.postDocument(request);
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
