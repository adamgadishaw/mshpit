import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { arenaVenues } from "../src/domain/majorVenueFacts.mjs";
import { independentMapPoint } from "../src/domain/independentMapCoordinates.mjs";
import { mapCoordinate } from "../src/domain/mapCoordinates.mjs";

export const AUDITED_IMPORT_COMMIT = "ef8b51757dc019b393ee7c1af2a7adc88db4e005";
export const AUDITED_IMPORT_TUPLE_SHA256 = "cd36d0e37bd68c76a5753923099a57f900daf85c4e9498d03d54d165af982f75";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "public/mshpit-maplibre/venue-catalogue.json");
const tupleFields = (key, row) => [key, row.name ?? null, row.place ?? null, row.lat ?? null, row.lng ?? null, row.capacity ?? null, row.major ?? null];
const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const usable = (value) => {
  const point = mapCoordinate(value);
  return point && Math.abs(point.lat) <= 85 && !(point.lat === 0 && point.lng === 0) ? point : null;
};
const sameImportTuple = (a, b) => a && b && ["name", "place", "lat", "lng"].every((field) => a[field] === b[field]);
const normalized = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("en").trim().replace(/\s+/gu, " ");
// These exact historical name-only rows came from the committed photo-ingest
// article bindings. Official address text establishes locality only; coordinates
// come separately from the independently checked registry, never a geocoder.
const reviewedNameOnlyIdentities = {
  "the orpheum theatre": { name: "Orpheum Theatre", article: "Orpheum Theatre (Los Angeles)",
    place: "Los Angeles, California, United States", sourceUrl: "https://laorpheum.com/directions/", address: "842 S. Broadway, Los Angeles, CA 90014" },
  "the wiltern": { name: "The Wiltern", article: "The Wiltern",
    place: "Los Angeles, California, United States", sourceUrl: "https://www.wiltern.com/visit", address: "3790 Wilshire Blvd, Los Angeles, CA 90010" },
  "webster hall": { name: "Webster Hall", article: "Webster Hall",
    place: "New York, New York, United States", sourceUrl: "https://www.websterhall.com/", address: "125 E. 11th St., New York, NY 10003" },
  "the roxy theatre": { name: "The Roxy Theatre", article: "The Roxy Theatre",
    place: "West Hollywood, California, United States", sourceUrl: "https://www.theroxy.com/venue-info/", address: "9009 West Sunset Blvd., West Hollywood, CA 90069" },
};
const sameQualifiedIdentity = (current, imported) => {
  if (normalized(current.name) !== normalized(imported.name)) return false;
  const parts = (value) => String(value || "").split(",").map(normalized).filter(Boolean);
  const a = parts(current.place), b = parts(imported.place);
  return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a.at(-1) === b.at(-1)
    && (a.length === 2 || b.length === 2 || a.slice(1, -1).join(",") === b.slice(1, -1).join(","));
};

export function importTupleHash(venues) {
  return sha256(Object.keys(venues).sort().map((key) => tupleFields(key, venues[key])));
}

export function readCatalogueProjectionInputs() {
  // Keep the original public tuples reproducible in shallow build checkouts.
  // The fixed tuple hash below still prevents new or edited source assertions.
  const snapshot = JSON.parse(readFileSync(resolve(ROOT, "scripts/fixtures/maplibre-import-tuples.json"), "utf8"));
  if (snapshot.sourceCommit !== AUDITED_IMPORT_COMMIT || snapshot.tupleSha256 !== AUDITED_IMPORT_TUPLE_SHA256) {
    throw new Error("The pinned import source changed; coordinate lineage needs a new review.");
  }
  const core = JSON.parse(readFileSync(resolve(ROOT, "src/seed/catalog.core.json"), "utf8"));
  // This bounded, isolated evaluation reads only the existing literal anchor
  // object. Do not import the app module or execute its runtime/side effects.
  const source = readFileSync(resolve(ROOT, "src/seed/catalog.js"), "utf8");
  const literal = source.match(/const baseVenues = (\{[\s\S]*?\n\});/u)?.[1];
  if (!literal) throw new Error("The catalogue anchor literal changed; review the projection reader.");
  const baseVenues = runInNewContext(`(${literal})`, Object.create(null), { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } });
  return { core, snapshot, curated: { ...arenaVenues, ...baseVenues } };
}

/** Public venue facts only; the fixed historical snapshot defines eligibility. */
export function buildMapLibreVenueCatalogue({ core, snapshot, curated }) {
  if (importTupleHash(snapshot.venues || {}) !== AUDITED_IMPORT_TUPLE_SHA256) {
    throw new Error("The audited import tuple hash changed; coordinate lineage needs a new review.");
  }
  const merged = { ...(core.venues || {}) };
  for (const [key, anchor] of Object.entries(curated || {})) {
    const generated = merged[key] || {};
    merged[key] = { ...generated, name: anchor.name, place: anchor.place ?? generated.place,
      lat: anchor.lat ?? generated.lat, lng: anchor.lng ?? generated.lng,
      capacity: anchor.capacity ?? generated.capacity ?? null, major: !!(anchor.major || generated.major) };
  }
  const venues = Object.keys(merged).sort().map((key) => {
    const current = merged[key], imported = snapshot.venues[key], coreRow = core.venues?.[key];
    const row = { id: key, key, name: current.name || key, place: current.place || "",
      lat: current.lat ?? null, lng: current.lng ?? null, capacity: current.capacity ?? null, major: !!current.major };
    const identity = reviewedNameOnlyIdentities[key];
    if (identity && sameImportTuple(coreRow, imported) && sameImportTuple(current, imported)
      && imported.name === identity.name && !imported.place && imported.lat == null && imported.lng == null) {
      row.place = identity.place;
      row.identityProvenance = { basis: "official-venue-address", sourceUrl: identity.sourceUrl,
        address: identity.address, checkedAt: "2026-10-21", ingestionSource: "scripts/ingest-famous-venue-photos.mjs",
        ingestionArticle: identity.article, importCommit: AUDITED_IMPORT_COMMIT };
    }
    const currentPoint = usable(row);
    row.coordinateEligibility = currentPoint ? "uncertain" : ((row.lat == null && row.lng == null) ? "missing" : "invalid");
    // Original MB ingestion always wrote capacity:null and no major marker.
    // The initial 44 sync-anchors rows and three authored base rooms differ.
    // Neither new records nor edited imported tuples acquire this permission.
    if (imported && !imported.major && imported.capacity == null && usable(imported)
      && sameImportTuple(coreRow, imported) && sameQualifiedIdentity(row, imported)) {
      row.coordinateEligibility = "eligible";
      row.mapCoordinate = usable(imported);
      row.coordinateIdentityPlaces = [...new Set([row.place, imported.place])];
      row.coordinateProvenance = { source: "MusicBrainz", basis: "ingestion-batch", perRecordVerified: false,
        sourceUrl: "https://musicbrainz.org/doc/Place", license: "CC0",
        licenseUrl: "https://musicbrainz.org/doc/About/Data_License",
        importCommit: AUDITED_IMPORT_COMMIT, importKey: key, importTupleSha256: AUDITED_IMPORT_TUPLE_SHA256,
        ingestedAt: snapshot.ingestedAt, auditedAt: "2026-10-21", coordinateEncoding: "imported-decimal", locationPrecision: "venue" };
    }
    // Batch metadata is not a per-record MB URL assertion. Registry matching
    // checks the original identity before replacing the batch provenance.
    const verified = independentMapPoint({ ...row, coordinateProvenance: undefined });
    if (verified) {
      row.coordinateEligibility = "eligible";
      row.mapCoordinate = verified.coord;
      row.coordinateIdentityPlaces = [row.place];
      row.coordinateProvenance = { ...verified.coordinateProvenance, basis: "individually-verified", perRecordVerified: true };
    }
    return row;
  });
  const count = (status) => venues.filter((row) => row.coordinateEligibility === status).length;
  return { version: 1,
    generatedFrom: { catalogue: "src/seed/catalog.core.json + src/seed/catalog.js anchors + src/domain/majorVenueFacts.mjs",
      sourceSnapshotCommit: AUDITED_IMPORT_COMMIT, sourceSnapshotIngestedAt: snapshot.ingestedAt,
      sourceSnapshotTupleSha256: AUDITED_IMPORT_TUPLE_SHA256,
      projectedVenueTupleSha256: sha256(venues.map((row) => [row.id, row.name, row.place, row.lat, row.lng, row.coordinateEligibility, row.mapCoordinate ?? null])) },
    counts: { total: venues.length, withCatalogueCoordinates: venues.filter(usable).length,
      eligible: count("eligible"), missing: count("missing"), invalid: count("invalid"), uncertain: count("uncertain"),
      ingestionBatch: venues.filter((row) => row.coordinateProvenance?.basis === "ingestion-batch").length,
      individuallyVerified: venues.filter((row) => row.coordinateProvenance?.basis === "individually-verified").length,
      coordinateOverrides: venues.filter((row) => row.mapCoordinate && (row.mapCoordinate.lat !== row.lat || row.mapCoordinate.lng !== row.lng)).length },
    venues };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projection = buildMapLibreVenueCatalogue(readCatalogueProjectionInputs());
  const content = `${JSON.stringify(projection)}\n`;
  if (process.argv.includes("--check")) {
    if (!existsSync(OUTPUT) || readFileSync(OUTPUT, "utf8").replace(/\r\n/gu, "\n") !== content) {
      console.error("MapLibre catalogue projection is stale. Run node scripts/build-maplibre-venue-catalogue.mjs");
      process.exitCode = 1;
    }
  } else writeFileSync(OUTPUT, content);
  console.log(JSON.stringify(projection.counts));
}
