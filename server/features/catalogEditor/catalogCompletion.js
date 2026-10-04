import { canonicalVenueKey } from "../../../src/domain/venueIdentity.mjs";
import { publicArtistPhoto } from "../../artistPhotoCatalog.js";
import { publicVenuePhotoPool } from "../../venuePhotoCatalog.js";
import { catalogDigest } from "./catalogEditorRepository.js";

const text = value => typeof value === "string" ? value.trim() : "";
const same = (a, b) => !!text(a) && text(a).normalize("NFKC").toLowerCase() === text(b).normalize("NFKC").toLowerCase();
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const table = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_HOST = /^(?:www\.)?(?:ticketmaster\.(?:com|ca|co\.uk|com\.au|ie|de|nl|es|fr|com\.mx|co\.nz|se|no|dk|fi|be|at|ch|it|pl)|livenation\.com)$/u;
function sourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && SOURCE_HOST.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

// A separate contract for the completion pilot; existing event/editor limits stay intact.
export function shortCatalogSummary(value) {
  const summary = text(value);
  if (!summary || summary.length > 700 || !/[.!?]["'”’)]?$/u.test(summary) || /[\r\n]/u.test(summary)) return false;
  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(summary)];
  return sentences.length >= 1 && sentences.length <= 2;
}

function preservedResearch(db, entity) {
  if (!table(db, "catalog_research")) return false;
  if (entity.type === "artist") return !!db.prepare("SELECT 1 FROM catalog_research WHERE entity_type='artist' AND entity_key=? AND status IN ('found','hidden') LIMIT 1").get(entity.key);
  const prefix = `${canonicalVenueKey(entity.identity.name)}|${text(entity.identity.city).slice(0, 80).toLowerCase()}|`;
  return !!db.prepare("SELECT 1 FROM catalog_research WHERE entity_type='venue' AND entity_key>=? AND entity_key<? AND status IN ('found','hidden') LIMIT 1").get(prefix, `${prefix}\uffff`);
}

function sourceEvidence(db, entity) {
  if (!table(db, "provider_profiles")) return null;
  const identity = entity.identity;
  let rows;
  if (entity.type === "artist") {
    if (!MBID.test(identity.mbid || "") || !table(db, "provider_artist_identities")) return null;
    rows = db.prepare(`SELECT p.provider_id,p.profile FROM provider_artist_identities m JOIN provider_profiles p
      ON p.provider=m.provider AND p.provider_id=m.provider_id AND p.kind='attraction'
      WHERE m.artist_key=? AND m.provider='ticketmaster' AND p.status='found'
      AND COALESCE(p.identity_status,'')<>'conflict' ORDER BY p.provider_id LIMIT 6`).all(entity.key);
  } else {
    if (identity.source !== "ticketmaster") return null;
    rows = db.prepare("SELECT provider_id,profile FROM provider_profiles WHERE provider='ticketmaster' AND kind='venue' AND provider_id=? AND status='found'").all(identity.providerId);
  }
  for (const row of rows) {
    const profile = parse(row.profile), url = sourceUrl(profile?.pageUrl);
    if (!profile || profile.id !== row.provider_id || !same(profile.name, identity.name) || !url) continue;
    let summary;
    if (entity.type === "artist") {
      if (profile.mbid !== identity.mbid || !/^[\p{L} /&-]{2,40}$/u.test(profile.genre || "") || /^(?:undefined|other|music|miscellaneous)$/iu.test(profile.genre)) continue;
      summary = `${identity.name} performs ${profile.genre} music.`;
    } else {
      if (!same(profile.address, entity.protectedFacts.address)) continue;
      summary = `${identity.name} hosts live music at ${profile.address} in ${identity.city}, ${identity.country}.`;
    }
    // Never shorten stored excerpts: only complete sentences built from identity-bound facts.
    if (shortCatalogSummary(summary)) return { summary, sources: [{ label: "Ticketmaster", url }] };
  }
  return null;
}

// Read-only. Reuses the accepted public photo catalogs; never starts an image/provider job.
export function catalogCompletion(db, entity, { artistPhoto = publicArtistPhoto, venuePhotos = publicVenuePhotoPool } = {}) {
  if (!["artist", "venue"].includes(entity.type)) return null;
  const identityKnown = entity.type === "venue" || MBID.test(entity.identity.mbid || "");
  const research = preservedResearch(db, entity);
  const protectedText = !!(entity.protectedReason || !entity.identityCurrent || entity.content?.hidden || research);
  const existingText = !!(entity.protectedFacts.biography || entity.content?.summary);
  const evidence = identityKnown && !protectedText && !existingText ? sourceEvidence(db, entity) : null;
  const profile = entity.type === "artist" ? db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(entity.key) : null;
  const raw = entity.type === "artist" ? db.prepare("SELECT * FROM artists WHERE norm=?").get(entity.key) : null;
  // A profile override takes precedence on the public artist page. Do not certify the fallback as displayed.
  const photo = identityKnown && !profile?.avatar_uri ? (entity.type === "artist"
    ? artistPhoto(entity.key, { artistMbid: entity.identity.mbid })
    : venuePhotos(entity.identity.name, { source: entity.identity.source, providerVenueId: entity.identity.providerId, limit: 1 })[0]) || null : null;
  const photoStatus = photo ? "accepted" : profile?.avatar_uri || raw?.photo ? "needs_photo_review" : "missing_photo";
  const textStatus = protectedText ? "protected" : existingText ? "existing_text" : evidence ? "draft_ready" : "needs_source";
  const fence = { expectedHash: entity.expectedHash, identityKnown, research, photo, photoStatus, textStatus, evidence };
  return { hash: catalogDigest(fence), identityStatus: identityKnown ? "confirmed" : "needs_identity",
    textStatus, photoStatus, photo, suggested: evidence,
    canDraft: identityKnown && !protectedText && !existingText,
    note: "Preview the accepted photo and verify the source before publication. Existing text and photographs are preserved." };
}
