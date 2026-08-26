import assert from "node:assert/strict";
import test from "node:test";

import { slugify, parsePath, artistPath, venuePath, postPath, showPath, profilePath, eventPath, concertPath, isReservedSlug } from "./urls.mjs";

test("slugs are readable and stable for real band names", () => {
  assert.equal(slugify("Turnstile"), "turnstile");
  assert.equal(slugify("Guns N' Roses"), "guns-n-roses");
  assert.equal(slugify("AC/DC"), "ac-dc");
  assert.equal(slugify("Sigur Rós"), "sigur-ros");
  assert.equal(slugify("Florence + the Machine"), "florence-the-machine");
  assert.equal(slugify("Simon & Garfunkel"), "simon-and-garfunkel");
  assert.equal(slugify("!!!"), "");
});

test("canonical public identities have collision-free namespaces", () => {
  assert.equal(artistPath("Billy Talent"), "/artist/billy-talent");
  assert.equal(profilePath("@superfingerbusiness_"), "/u/superfingerbusiness_");
  assert.equal(postPath("p_abc123"), "/post/p_abc123");
  assert.equal(showPath("p_abc123"), "/post/p_abc123", "legacy helper emits the canonical post URL");
  assert.equal(venuePath("The Fillmore"), "/venue/the-fillmore");
  assert.equal(venuePath({ name: "The Fillmore", source: "ticketmaster", providerVenueId: "KovZpZA6tFlA" }), "/venue/ticketmaster-kovzpza6tfla");
  assert.equal(eventPath("tm_G5di/Z"), "/event/tm_G5di%2FZ");
  assert.equal(concertPath("show.opaque_key"), "/concert/show.opaque_key");
});

test("a stored artist slug wins over a mutable or colliding display name", () => {
  assert.equal(artistPath("Beyoncé Renamed", "beyonce"), "/artist/beyonce");
  assert.equal(artistPath({ name: "Beyonce", publicSlug: "beyonce-2f9465f6a1" }), "/artist/beyonce-2f9465f6a1");
  assert.equal(artistPath({ name: "Ignored", public_slug: "guns-n-roses" }), "/artist/guns-n-roses");
});

test("a root slug is ambiguous and defers to the resolver", () => {
  // One namespace shared by handles, artists and venues: parsing must not guess.
  assert.deepEqual(parsePath("/turnstile"), { type: "entity", value: "turnstile" });
  assert.deepEqual(parsePath("/the-fillmore"), { type: "entity", value: "the-fillmore" });
});

test("the app's own screens cannot be taken over by a band name", () => {
  for (const reserved of ["/search", "/discover", "/artists", "/events", "/admin", "/settings", "/api", "/robots.txt", "/account-deletion"]) {
    assert.equal(parsePath(reserved), null, `${reserved} must stay the app's`);
  }
  assert.equal(isReservedSlug("Search"), true, "reserved matching is case-insensitive");
});

test("explicit and legacy forms keep working", () => {
  assert.deepEqual(parsePath("/artist/Turnstile"), { type: "artist", value: "Turnstile" });
  assert.deepEqual(parsePath("/venue/The%20Fillmore"), { type: "venue", value: "The Fillmore" });
  assert.deepEqual(parsePath("/u/andrew"), { type: "profile", value: "andrew" });
  assert.deepEqual(parsePath("/post/p_1"), { type: "show", value: "p_1" });
  assert.deepEqual(parsePath("/show/p_1"), { type: "show", value: "p_1" });
  assert.deepEqual(parsePath("/event/tm_G5di%2FZ"), { type: "event", value: "tm_G5di/Z" });
  assert.deepEqual(parsePath("/concert/show.opaque_key"), { type: "concert", value: "show.opaque_key" });
});

test("query strings, fragments and the root resolve sanely", () => {
  assert.deepEqual(parsePath("/turnstile?ref=x"), { type: "entity", value: "turnstile" });
  assert.deepEqual(parsePath("/turnstile#reviews"), { type: "entity", value: "turnstile" });
  assert.equal(parsePath("/"), null);
  assert.equal(parsePath(""), null);
  assert.equal(parsePath(undefined), null);
});

test("unknown nested paths are not entities", () => {
  assert.equal(parsePath("/turnstile/extra"), null);
  assert.equal(parsePath("/_expo/static/js/app.js"), null);
  assert.equal(parsePath("/artist/%E0%A4%A"), null, "malformed URL encoding fails closed");
});

test("a name that collides with an app route still gets a working URL", () => {
  // Real data hit this: a band called "Artist" produced "/artist", which
  // parsePath rejects, so the sitemap carried a dead link.
  // The prefix is the entity type, not the slug: a band called "Search" lives
  // at /artist/search, which is what keeps the search screen at /search.
  for (const [name, expected] of [["Artist", "/artist/artist"], ["Search", "/artist/search"], ["Settings", "/artist/settings"]]) {
    const path = artistPath(name);
    assert.equal(path, expected);
    assert.ok(parsePath(path), `${path} must resolve`);
  }
});

test("every built path parses back to something, so no dead sitemap links", () => {
  const names = ["Turnstile", "Artist", "Search", "AC/DC", "Sigur Rós", "Simon & Garfunkel", "Show", "You"];
  for (const name of names) {
    for (const build of [artistPath, venuePath]) {
      const path = build(name);
      if (path === null) continue;     // unslugifiable names are skipped, not linked
      assert.ok(parsePath(path), `${name} built ${path}, which does not resolve`);
    }
  }
  assert.ok(parsePath(profilePath("@you")), "a handle matching a route must still resolve");
  assert.equal(artistPath("!!!"), null, "a name with no slug yields no URL at all");
});
