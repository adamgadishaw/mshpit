import { canonicalVenueKey } from "../../../src/domain/venueIdentity.mjs";
import { readCatalogEntity } from "../catalogApi/catalogApiInventory.js";
import { publicCatalogResearch } from "./catalogResearchFindings.js";
import { publicCatalogAttachments } from "./catalogPhotoAttachments.js";
import { isIndexableMusicEventRecord } from "../seo/publicEntityPolicy.js";

// JSON and crawlable HTML share this read-only projection. An unbound old result
// is absent content; reads never adopt a changed identity or start research.
export function readPublicCatalogResearch(database, { type, key, city = null, country = null,
  providerId = null, at = Date.now(), photoOptions } = {}) {
  try {
    let entityKey = key;
    if (type === "venue" && !String(key || "").includes("|")) {
      const venue = canonicalVenueKey(key);
      if (!venue) return null;
      const rows = database.prepare(`SELECT entity_key FROM catalog_research
        WHERE entity_type='venue' AND status='found' AND entity_key>=? AND entity_key<? LIMIT 21`)
        .all(`${venue}|`, `${venue}}`);
      const matches = rows.filter(row => {
        const [, rowCity, rowCountry] = row.entity_key.split("|");
        return (!city || rowCity === city.trim().toLowerCase()) && (!country || rowCountry === country.trim().toLowerCase());
      });
      if (rows.length > 20 || matches.length !== 1) return null;
      entityKey = matches[0].entity_key;
    }
    if (type === "event") {
      const row = database.prepare("SELECT * FROM tour_dates WHERE id=?").get(entityKey);
      if (!row || !isIndexableMusicEventRecord(row)) return null;
    }
    const snapshot = readCatalogEntity(database, { type, key: entityKey, at });
    if (!snapshot?.eligible || !snapshot.findings) return null;
    if (providerId && snapshot.identity.providerId !== providerId) return null;
    const binding = snapshot.findings.provenance?.identityHash || snapshot.findings.identityHash;
    if (binding !== snapshot.identityHash) return null;
    const row = type === "event"
      ? database.prepare("SELECT updated_at researched_at FROM catalog_event_enrichment WHERE event_id=? AND hidden=0").get(entityKey)
      : database.prepare("SELECT researched_at FROM catalog_research WHERE entity_type=? AND entity_key=? AND status='found'").get(type, entityKey);
    if (!row) return null;
    const view = publicCatalogResearch(type, snapshot.findings, { researchedAt: row.researched_at });
    return view ? { ...view, revision: snapshot.revision, attachments: publicCatalogAttachments(snapshot, photoOptions) } : null;
  } catch (error) {
    if (/no such (?:table|column)/iu.test(String(error?.message))) return null;
    throw error;
  }
}
