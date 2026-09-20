import assert from "node:assert/strict";
import test from "node:test";
import { fixtureApiResponse, injectCollectionFixture, navigationCases, serverCollectionPaths, clientCollectionPaths, postPath, eventPath, artistPath, navigationArtist, navigationArtistCard, discoverShowArtist, discoverArtistEvent, discoverArtistEventPath } from "./verify-navigation-browser.mjs";

test("navigation fixture import is inert and scenarios cover both mobile and desktop", () => {
  assert.equal(new Set(navigationCases.map(item => item.name)).size, navigationCases.length);
  for (const width of [390, 1280]) {
    const cases = navigationCases.filter(item => item.width === width);
    for (const kind of ["deep-link", "delayed", "guest-tabs", "artist-lookup-recovery", "discover-canonical-artist", "discover-show-artist", "discover-show-artist-recovery", "discover-show-artist-conflict", "member-tabs", "home", "signed-in-root", "account-boundary", "server-document", "client-document", "missing-document"]) {
      assert.ok(cases.some(item => item.kind === kind), `${kind} is missing at ${width}px`);
    }
    assert.deepEqual(cases.filter(item => item.kind === "deep-link").map(item => item.path), [postPath, eventPath]);
    assert.deepEqual(cases.filter(item => item.kind === "server-document").map(item => item.path), serverCollectionPaths);
    assert.deepEqual(cases.filter(item => item.kind === "client-document").map(item => item.path), clientCollectionPaths);
  }
});

test("Discover show fixtures carry the real click path and distinguish provider previews from stored profiles", () => {
  const options = { discoverShow: true };
  assert.deepEqual(fixtureApiResponse("/api/tourdates", options).tourDates, [{ ...discoverArtistEvent, artistIdentityPending: false }]);
  const conflict = fixtureApiResponse("/api/tourdates", { ...options, artistIdentityPending: true }).tourDates[0];
  assert.equal(conflict.artistIdentityPending, true);
  assert.equal(conflict.artistKey, null);
  assert.equal(conflict.ticketUrl, discoverArtistEvent.ticketUrl);
  const entity = fixtureApiResponse("/api/resolve", { ...options, resolvedPath: discoverArtistEventPath }).entity;
  assert.equal(entity.kind, "event");
  assert.equal(entity.artist, discoverShowArtist.name);
  assert.equal(entity.publicEventSnapshot, true);
  assert.equal(fixtureApiResponse("/api/artists/resolve", { ...options, artistLookupTransient: true }).transient, true);
  assert.equal(fixtureApiResponse("/api/artists/resolve", options).transient, false);
  assert.equal(fixtureApiResponse("/api/artists/imran%20khan/profile", options).artist.key, discoverShowArtist.key);
  assert.throws(() => fixtureApiResponse("/api/artists/resolve", { ...options, method: "POST" }), /must not mutate/);
});

test("server collection fixture retains Expo scripts and only marks supported exact paths", () => {
  const html = '<html><body><div id="root"></div><script src="/index-fixture.js"></script></body></html>';
  for (const path of serverCollectionPaths) {
    const injected = injectCollectionFixture(html, path);
    assert.ok(injected.includes('<div id="root"><main class="seo-document">'));
    assert.ok(injected.includes(`Navigation fixture collection: ${path}`));
    assert.ok(injected.includes('<script src="/index-fixture.js"></script>'));
    assert.equal((injected.match(/class="seo-document"/g) || []).length, 1);
    assert.match(injected, /<a href="[^"]+">Next fixture collection<\/a>/);
  }
  for (const path of ["/", "/events", "/events/page/3", "/venues/us/davis/evil", '/events/page/2"<script>']) {
    assert.equal(injectCollectionFixture(html, path), html);
  }
  assert.throws(() => injectCollectionFixture("missing root", serverCollectionPaths[0]));
});

test("navigation API fixtures reject unrecognized reads and every application mutation", () => {
  for (const path of ["/api/feed", "/api/me/following", "/api/users/navigation-fixture-user/posts"]) {
    assert.throws(() => fixtureApiResponse(path), /Guest|Guests/);
    assert.doesNotThrow(() => fixtureApiResponse(path, { member: true }));
  }
  assert.throws(() => fixtureApiResponse("/api/unexpected"), /Missing navigation fixture/);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.throws(() => fixtureApiResponse("/api/posts/p_navigation_fixture", { member: true, method }), /must not mutate/);
  }
  assert.deepEqual(fixtureApiResponse("/api/client-errors", { method: "POST" }), { ok: true });
});

test("public resolver fixtures cannot silently substitute one entity for another", () => {
  assert.equal(fixtureApiResponse("/api/resolve", { resolvedPath: postPath }).entity.kind, "show");
  assert.equal(fixtureApiResponse("/api/resolve", { resolvedPath: eventPath }).entity.kind, "event");
  assert.throws(() => fixtureApiResponse("/api/resolve", { resolvedPath: "/artist/not-fixtured" }), /unrelated URL/);
  assert.equal(fixtureApiResponse("/api/posts/p_navigation_fixture").post.id, postPath.split("/").at(-1));
  assert.deepEqual(fixtureApiResponse("/api/me"), { user: null });
});

test("artist attribution browser fixture covers licensed text, staff replacement and deliberate clear", () => {
  assert.equal(navigationCases.filter(item => item.kind === "artist-attribution").length, 1);
  assert.equal(fixtureApiResponse("/api/resolve", { resolvedPath: artistPath }).entity.kind, "artist");
  assert.deepEqual(fixtureApiResponse("/api/artists/resolve"), { artist: navigationArtist });
  const path = "/api/artists/fixture%20artist/profile";
  assert.deepEqual(fixtureApiResponse(path).artist, navigationArtist);
  assert.equal(fixtureApiResponse(path).profile, null);
  assert.deepEqual(fixtureApiResponse(path, { artistBioMode: "cleared" }).profile, { bioStaffCurated: true, bio: null });
  assert.equal(fixtureApiResponse(path, { artistBioMode: "replacement" }).profile.bioStaffCurated, true);
  assert.throws(() => fixtureApiResponse(path, { artistBioMode: "arbitrary" }), /Unknown artist biography/);
});

test("canonical Discover artist fixtures require database hydration without any remote name lookup", () => {
  const options = { discoverArtist: true };
  const overview = fixtureApiResponse("/api/discover/overview", options);
  assert.deepEqual(overview.chart.rows, [navigationArtistCard]);
  assert.equal(navigationArtistCard.publicSlug, artistPath.split("/").at(-1));
  assert.equal(Object.hasOwn(navigationArtistCard, "bio"), false, "The compact card cannot conceal a missing profile fetch.");
  assert.equal(Object.hasOwn(navigationArtistCard, "bioSource"), false);
  for (const path of ["/api/artists/fixture%20artist/profile", "/api/artists/fixture-artist/profile"]) {
    assert.equal(fixtureApiResponse(path, options).artist.bio, navigationArtist.bio);
  }
  assert.throws(() => fixtureApiResponse("/api/artists/resolve", options), /must open without the remote artist resolver/);
  assert.deepEqual(fixtureApiResponse("/api/artists/resolve"), { artist: navigationArtist }, "Interactive lookup cases keep their explicit resolver fixture.");
  assert.deepEqual(navigationCases.filter(item => item.kind === "discover-canonical-artist").map(item => item.path), ["/discover", "/discover"]);
});

test("fixture page metadata is path-specific and cannot turn a private tab into a canonical public page", () => {
  const publicHead = fixtureApiResponse("/api/page-head", { resolvedPath: postPath });
  assert.equal(publicHead.path, postPath);
  assert.ok(publicHead.head.includes(`<link rel="canonical" href="${postPath}">`));
  for (const path of ["/feed", "/you", "/login", "/signup"]) {
    const privateHead = fixtureApiResponse("/api/page-head", { resolvedPath: path });
    assert.match(privateHead.head, /noindex,nofollow/);
    assert.equal(privateHead.head.includes("canonical"), false);
  }
  assert.throws(() => fixtureApiResponse("/api/page-head", { resolvedPath: '/unsafe"><script>' }), /inert local paths/);
});
