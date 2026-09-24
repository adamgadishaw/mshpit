import { ensureArtistKnowledgeSchema } from "../../artistKnowledgeRefresh.js";
import { collectArtistKnowledgeStatus } from "../../artistKnowledgeStatus.js";
import { ensureCatalogKnowledgeControl, collectCatalogKnowledgeControl, readCatalogKnowledgeControl, setCatalogKnowledgeMode } from "../../catalogKnowledgeControl.js";
import { collectStorageHealth } from "../../storageHealth.js";
import { collectTourDateMaintenanceStatus } from "../../tourDateMaintenanceStatus.js";
import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { readVenuePhotoEnrichmentStatus } from "../../venuePhotoEnrichment.js";
import { readArtistPhotoSeedStatus } from "../../artistPhotoSeedStatus.js";
import { collectCatalogResearchStatus, ensureCatalogResearchSchema } from "../catalogResearch/catalogResearchService.js";

const sources = Object.freeze({
  artist: Object.freeze({ name: "Wikidata / Wikipedia", scope: "Exact artist identities; missing biography and country fields. Artists recently shown in Discover get priority alongside regular catalogue work, within the same limits. Staff edits and claimed profiles stay protected." }),
  venues: Object.freeze({ name: "Saved event facts + licensed venue photography", scope: "Verified event records supply locations and calendars. A separate bounded worker checks missing venue photos against Commons identity and licensing evidence and mirrors accepted images. It does not invent venue biographies, capacity or accessibility claims." }),
  events: Object.freeze({ name: "Ticketmaster / Bandsintown", scope: "Scheduled, bounded show-date refreshes stored locally. User-created shows stay protected." }),
  research: Object.freeze({ name: "Claude web research", scope: "Fills artist and venue pages the other sources leave empty with a short summary and facts, each linked to the page it came from. Acts and rooms with shows on file go first, inside a daily spending cap. It never edits a biography, a claimed artist page or staff facts, and staff can hide any result." }),
});

export function createCatalogMaintenanceService({ database, databasePath, env = process.env,
  now = Date.now, seoStatus = () => null }) {
  // Boot-time additive initialization, never schema changes on GET.
  ensureArtistKnowledgeSchema(database);
  ensureCatalogKnowledgeControl(database, { env, at: now() });
  ensureCatalogResearchSchema(database);
  return {
    inspectControl: () => readCatalogKnowledgeControl(database, { env, at: now() }),
    setControl: (mode) => setCatalogKnowledgeMode(database, mode, { env, at: now() }),
    collectStatus: () => {
      const at = now();
      return {
        catalog: collectCatalogKnowledgeControl(database, { env, at }),
        artistKnowledge: collectArtistKnowledgeStatus(database, { env, at }),
        artistPhotos: readArtistPhotoSeedStatus({ database, env, at }),
        venuePhotos: readVenuePhotoEnrichmentStatus(database, { env, at }),
        storage: collectStorageHealth(database, { databasePath, at }),
        sources,
        sourceRefresh: { ...collectTourDateMaintenanceStatus(database, { at }),
          enabled: backgroundJobEnabled(env, "TOURDATE_REFRESH_ENABLED"),
          configured: Boolean(env.TICKETMASTER_KEY || env.BANDSINTOWN_APP_ID) },
        seo: seoStatus(),
        research: collectCatalogResearchStatus(database, { env, at }),
      };
    },
  };
}
