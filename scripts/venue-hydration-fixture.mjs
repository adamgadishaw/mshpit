import assert from "node:assert/strict";

// Public identity/address, entirely synthetic events/text. Never reads live data.
export const venueHydrationPath = "/venue/ticketmaster-rz7hnezaeot";
export const venueHydrationAlias = "/venue/lees-palace";
export const venueHydrationIdentity = { source: "ticketmaster", providerVenueId: "rZ7HnEZaeot" };
export const venueHydrationText = "Fixture published venue description for Lee's Palace, loaded with its exact provider identity.";
export function venueHydrationSnapshot(after = null) {
  assert.ok(after === null || after === "fixture-next", "Unexpected venue fixture page");
  return { path: venueHydrationPath, after, hasMore: !after, nextCursor: after ? null : "fixture-next",
    venue: { name: "Lee's Palace", ...venueHydrationIdentity, place: "Toronto, Ontario, Canada",
      address: { streetAddress: "529 Bloor Street West", addressLocality: "Toronto", addressRegion: "ON", postalCode: "M5S 1Y5", addressCountry: "CA" },
      coord: { lat: 43.665249, lng: -79.409447 }, capacity: null },
    events: Array.from({ length: after ? 2 : 8 }, (_, index) => {
      const number = index + (after ? 9 : 1);
      return { id: `venue-hydration-${number}`, name: `Hydration concert ${number}`, artist: `Fixture Band ${number}`,
        venue: "Lee's Palace", ...venueHydrationIdentity, place: "Toronto, Ontario, Canada",
        date: `${new Date().getUTCFullYear() + 1}-11-${String(number).padStart(2, "0")}`, eventKind: "concert", statusLabel: "scheduled" };
    }) };
}

export function venueHydrationResponse(pathname, { resolvedPath, after = null } = {}) {
  if (pathname === "/api/resolve" && [venueHydrationAlias, venueHydrationPath].includes(resolvedPath)) return {
    entity: { kind: "venue", name: "Lee's Palace", city: "Toronto", ...venueHydrationIdentity, path: venueHydrationPath },
  };
  if (pathname === "/api/venue-snapshot") {
    assert.equal(resolvedPath, venueHydrationPath, "The client must retain canonical provider identity");
    return venueHydrationSnapshot(after);
  }
  const decoded = decodeURIComponent(pathname);
  if (decoded.toLowerCase() === "/api/venues/lee's palace/photos") return { photos: [], fanPhotos: [], state: "ready" };
  if (decoded === "/api/catalog-text/venue/ticketmaster:rZ7HnEZaeot") return {
    text: { summary: venueHydrationText, sources: [{ label: "Fixture source", url: "https://example.test/venue" }] },
  };
  return null;
}
