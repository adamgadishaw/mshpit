import { readFileSync } from "node:fs";
import { providerVenuePhotoCatalogKey } from "./venuePhotoCatalogIdentity.js";

const BINDING_SOURCE = new URL("../src/seed/catalog.venue-photo-bindings.json", import.meta.url);
let cachedBindings;

function clean(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/gu, " ");
}

function validBindingMap(input) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return Object.freeze(result);
  for (const [rawProviderKey, rawCatalogKey] of Object.entries(input)) {
    const providerKey = clean(rawProviderKey);
    const catalogKey = clean(rawCatalogKey);
    const match = /^provider:([^:]+):(.+)$/u.exec(providerKey);
    if (!match || providerVenuePhotoCatalogKey(match[1], match[2]) !== providerKey || !catalogKey) continue;
    result[providerKey] = catalogKey;
  }
  return Object.freeze(result);
}

export function venuePhotoProviderBindings() {
  if (cachedBindings !== undefined) return cachedBindings;
  try {
    cachedBindings = validBindingMap(JSON.parse(readFileSync(BINDING_SOURCE, "utf8")));
  } catch {
    cachedBindings = Object.freeze({});
  }
  return cachedBindings;
}

export function venuePhotoCatalogBindingForProviderKey(providerKey, bindings = null) {
  const source = bindings && typeof bindings === "object" && !Array.isArray(bindings)
    ? validBindingMap(bindings)
    : venuePhotoProviderBindings();
  return source[clean(providerKey)] || null;
}

export function venuePhotoCatalogBinding(source, providerVenueId, bindings = null) {
  const providerKey = providerVenuePhotoCatalogKey(source, providerVenueId);
  return providerKey ? venuePhotoCatalogBindingForProviderKey(providerKey, bindings) : null;
}
