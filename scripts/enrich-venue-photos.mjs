#!/usr/bin/env node
/**
 * Compatibility entry point for the recurring pipeline.
 *
 * Venue discovery is limited to relevance-checked Wikimedia Commons records.
 * The verified backfill sanitizes each still image, stores it on MSHpit's
 * controlled media host, and writes only complete attribution + mirror data.
 * No provider URL is ever published as a runtime image.
 */
import { venuePhotoMirrorConfigured } from "./lib/venue-photo-mirror.mjs";

if (!venuePhotoMirrorConfigured(process.env)) {
  throw new Error("Public media storage is not configured; venue-photo enrichment is fail-closed.");
}

await import("./backfill-verified-venue-photos.mjs");
