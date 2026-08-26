import assert from "node:assert/strict";
import test from "node:test";
import { publicDirectoryItems, publicNavigationLinks, shouldUseSpaLinkNavigation } from "./publicNavigationLinks.mjs";

test("public navigation always exposes the durable public hubs", () => {
  assert.deepEqual(
    publicNavigationLinks({}).map(({ label, href }) => ({ label, href })),
    [
      { label: "Home", href: "/" },
      { label: "Artists", href: "/artists" },
      { label: "Events", href: "/events" },
    ],
  );
});

test("event navigation retains useful artist and venue links after hydration", () => {
  const links = publicNavigationLinks({
    openLog: {
      id: "tm/G5diZ",
      performanceEvent: true,
      artist: "Bruno Mars",
      artistPublicSlug: "bruno-mars",
      venue: "Accor Arena",
      providerVenueId: "KovZpZA6tFlA",
      source: "ticketmaster",
    },
  });

  assert.ok(links.some((link) => link.href === "/artist/bruno-mars" && link.label === "Bruno Mars"));
  assert.ok(links.some((link) => link.href === "/venue/ticketmaster-kovzpza6tfla"));
  assert.ok(links.some((link) => link.href === "/event/tm%2FG5diZ" && link.current));
});

test("post navigation links its public author, artist, venue, and canonical post", () => {
  const links = publicNavigationLinks({
    post: { id: "p_1", userId: "u_1", artist: "Sade", venue: "The O2" },
  }, {
    resolveUser: (id) => id === "u_1" ? { id, handle: "ada" } : null,
  });

  assert.ok(links.some((link) => link.href === "/u/ada"));
  assert.ok(links.some((link) => link.href === "/artist/sade"));
  assert.ok(links.some((link) => link.href === "/venue/the-o2"));
  assert.ok(links.some((link) => link.href === "/post/p_1" && link.current));
});

test("modified and non-primary clicks retain normal browser link behavior", () => {
  assert.equal(shouldUseSpaLinkNavigation({ nativeEvent: { button: 0 } }), true);
  assert.equal(shouldUseSpaLinkNavigation({ nativeEvent: { button: 0, metaKey: true } }), false);
  assert.equal(shouldUseSpaLinkNavigation({ nativeEvent: { button: 1 } }), false);
  assert.equal(shouldUseSpaLinkNavigation({ defaultPrevented: true, nativeEvent: { button: 0 } }), false);
});

test("hydrated artist directories retain several unique canonical artist anchors", () => {
  const rows = publicDirectoryItems("artists", [
    { name: "Sade", genre: "Soul" },
    { name: "Bruno Mars", publicSlug: "bruno-mars", genre: "Pop" },
    { name: "Sade", genre: "Duplicate" },
    { name: "Beyoncé", publicSlug: "beyonce", genre: "R&B" },
    { name: "Radiohead", genre: "Alternative" },
  ]);

  assert.deepEqual(rows.map(({ href }) => href), [
    "/artist/sade",
    "/artist/bruno-mars",
    "/artist/beyonce",
    "/artist/radiohead",
  ]);
  assert.ok(rows.every((row) => row.title && row.detail && row.action === "View artist"));
});

test("hydrated event directories retain several unique canonical event anchors", () => {
  const rows = publicDirectoryItems("events", [
    { id: "tm-1", artist: "Sade", venue: "The O2", place: "London", date: "2026-09-01" },
    { id: "tm-2", artist: "Bruno Mars", venue: "Accor Arena", place: "Paris", date: "2026-09-02" },
    { id: "tm-1", artist: "Duplicate" },
    { id: "tm-3", artist: "Beyoncé", venue: "Rogers Centre", place: "Toronto", date: "2026-09-03" },
    { id: "tm-4", artist: "Radiohead", venue: "Tokyo Dome", place: "Tokyo", date: "2026-09-04" },
  ]);

  assert.deepEqual(rows.map(({ href }) => href), [
    "/event/tm-1",
    "/event/tm-2",
    "/event/tm-3",
    "/event/tm-4",
  ]);
  assert.ok(rows.every((row) => row.title && row.detail && row.action === "View event"));
});
