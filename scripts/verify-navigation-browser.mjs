#!/usr/bin/env node

// Real exported app, isolated loopback documents, synthetic accounts only.
// No application server, database, production API, or user's browser session.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = 12_000;
export const navigationUser = Object.freeze({
  id: "navigation-fixture-user", name: "Navigation Fixture", handle: "navigationfixture",
  email: "navigation@example.test", role: "fan", emailVerified: true, onboardingVersion: 1,
  avatarUri: null, banner: null, initials: "NF", genres: ["Rock"], favoriteArtists: [],
  home: { city: "Toronto, Ontario, Canada", lat: 43.6532, lng: -79.3832 },
  profileAudience: "everyone", analyticsOptOut: true, ageBand: "18_plus", termsVersion: "2026-09-02",
});
export const postPath = "/post/p_navigation_fixture";
export const eventPath = "/event/tm_navigation_fixture";
export const artistPath = "/artist/fixture-artist";
export const navigationArtist = Object.freeze({
  name: "Fixture Artist", key: "fixture-artist", publicSlug: "fixture-artist",
  mbid: "12345678-1234-4234-8234-123456789abc", country: "Canada",
  bio: "Fixture Artist is a Canadian band. This biography is a licensed navigation fixture excerpt.",
  bioSource: Object.freeze({ provider: "wikipedia", url: "https://en.wikipedia.org/wiki/Fixture_Artist",
    revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123456789", license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", modified: true,
    mbid: "12345678-1234-4234-8234-123456789abc", wikidataId: "Q123", retrievedAt: 1787659200000 }),
});
export const serverCollectionPaths = Object.freeze([
  "/concerts", "/events/page/2", "/artists/page/2", "/venues/us/davis", "/artist/fixture-artist/concerts/page/2",
]);
export const clientCollectionPaths = Object.freeze(["/artists", "/events", "/venues"]);
export const navigationCases = Object.freeze([
  ...[390, 1280].flatMap(width => [
    ...[postPath, eventPath].map(path => ({ name: `deep-link-${width < 620 ? "home" : "intro"}-${path.startsWith("/post") ? "post" : "event"}-${width}`, kind: "deep-link", path, width })),
    { name: `delayed-resolution-${width}`, kind: "delayed", path: postPath, width },
    { name: `guest-tabs-${width}`, kind: "guest-tabs", width },
    { name: `artist-lookup-recovery-${width}`, kind: "artist-lookup-recovery", width },
    { name: `member-tabs-${width}`, kind: "member-tabs", member: true, width },
    { name: `home-link-${width}`, kind: "home", path: postPath, width },
    { name: `home-link-member-${width}`, kind: "home", path: postPath, member: true, width },
    { name: `signed-in-root-${width}`, kind: "signed-in-root", path: postPath, member: true, width },
    { name: `account-boundary-history-${width}`, kind: "account-boundary", member: true, width },
    { name: `collection-no-server-document-${width}`, kind: "missing-document", path: "/events/page/3", width },
    ...clientCollectionPaths.map(path => ({ name: `client-collection-${path.slice(1)}-${width}`, kind: "client-document", path, width })),
    ...serverCollectionPaths.map((path, index) => ({ name: `server-collection-${index + 1}-${width}`, kind: "server-document", path, width })),
  ]),
  { name: "artist-biography-attribution-1280", kind: "artist-attribution", path: artistPath, width: 1280 },
]);

export function injectCollectionFixture(html, path) {
  if (!serverCollectionPaths.includes(path)) return html;
  const next = serverCollectionPaths[(serverCollectionPaths.indexOf(path) + 1) % serverCollectionPaths.length];
  const document = `<main class="seo-document"><h1>Navigation fixture collection: ${path}</h1><p>This is a complete server-rendered collection, not a fabricated client page.</p><a href="${next}">Next fixture collection</a><a href="/">Fixture home</a></main>`;
  assert.match(html, /<div id="root">/, "The generated Expo document needs its expected root.");
  return html.replace('<div id="root">', '<div id="root">' + document);
}

export function fixtureApiResponse(pathname, { member = false, method = "GET", resolvedPath = postPath, artistBioMode = "imported" } = {}) {
  if (pathname === "/api/client-errors" && method === "POST") return { ok: true };
  assert.equal(method, "GET", `Navigation must not mutate data: ${method} ${pathname}`);
  if (pathname === "/api/me") return { user: member ? navigationUser : null };
  if (pathname === "/api/page-head") {
    assert.match(resolvedPath, /^\/[a-zA-Z0-9_/-]*$/, "Fixture metadata paths must be inert local paths.");
    const privatePage = ["/feed", "/you", "/login", "/signup"].includes(resolvedPath);
    return { path: resolvedPath, head: `<title>Navigation fixture ${resolvedPath}</title><meta name="robots" content="${privatePage ? "noindex,nofollow" : "index,follow"}">${privatePage ? "" : `<link rel="canonical" href="${resolvedPath}">`}` };
  }
  if (pathname === "/api/resolve") {
    if (resolvedPath === artistPath) return { entity: { kind: "artist", name: navigationArtist.name, path: artistPath } };
    if (resolvedPath === eventPath) return { entity: { kind: "event", id: "tm_navigation_fixture", path: eventPath, publicEventSnapshot: true, name: "Fixture Artist Live",
      artist: "Fixture Artist", artistKey: "fixture-artist", venue: "Fixture Venue", city: "Toronto", date: "2026-10-01" } };
    assert.equal(resolvedPath, postPath, "The fixture must not resolve an unrelated URL as a post.");
    return { entity: { kind: "show", id: "p_navigation_fixture", path: postPath } };
  }
  if (pathname === "/api/posts/p_navigation_fixture") return { post: {
    id: "p_navigation_fixture", userId: "public-fixture-author",
    user: { id: "public-fixture-author", name: "Public Fixture Author", handle: "publicfixture", role: "fan" },
    kind: "status", experienceType: "live", artist: "Fixture Artist", artistKey: "fixture-artist",
    venue: "Fixture Venue", city: "Toronto", date: "2026-09-01", at: 1788264000000,
    text: "Navigation fixture concert memory.", review: "Navigation fixture concert memory.", likes: 3, comments: 0, photos: [],
  } };
  if (pathname === "/api/posts/p_navigation_fixture/comments") return { comments: [] };
  if (pathname === "/api/media/reactions") return { reactions: {} };
  if (pathname === "/api/discovery/sidebar") return { upcomingEvents: [], suggestedUsers: [], topArtists: [], trendingVenues: [], popularLounges: [], landingMedia: [], catalogTotals: { artists: 40, venues: 80 } };
  if (pathname === "/api/tourdates") return { tourDates: [] };
  if (pathname === "/api/discover/overview") return { artists: [], venues: [], events: [], genres: [], countries: [] };
  if (pathname === "/api/discover/chart") return { rows: [], source: "fixture" };
  if (pathname === "/api/artists") return { artists: [] };
  if (pathname === "/api/artists/resolve") return { artist: navigationArtist };
  if (pathname === "/api/artists/photos") return { photos: [] };
  if (["/api/artists/fixture%20artist/profile", "/api/artists/fixture-artist/profile"].includes(pathname)) {
    assert.ok(["imported", "replacement", "cleared"].includes(artistBioMode), "Unknown artist biography fixture mode.");
    return { profile: artistBioMode === "imported" ? null : { bioStaffCurated: true,
      bio: artistBioMode === "cleared" ? null : "Staff replacement biography fixture." }, posts: [], legacyProfile: false };
  }
  if (["/api/artists/fixture%20artist/live-summary", "/api/artists/fixture-artist/live-summary"].includes(pathname)) return {
    artist: { key: navigationArtist.key, name: navigationArtist.name },
    reputation: { avgRating: null, ratingCount: 0, reviewCount: 0, showCount: 0 },
    schedule: { items: [], total: 0, hasMore: false, nextCursor: null, legacy: false, coverage: { status: "fresh" } },
  };
  if (pathname === "/api/fanclubs") return { clubs: [] };
  if (pathname === "/api/venues") return { venues: [] };
  if (pathname === "/api/cities") return { cities: [] };
  if (["/api/artists/fixture-artist/memorial", "/api/artists/fixture%20artist/memorial"].includes(pathname)) return { memorial: null };
  if (pathname === "/api/venues/fixture%20venue/photos") return { photos: [], state: "ready" };
  if (pathname.startsWith("/api/shows/")) return { show: null };
  if (pathname.startsWith("/api/going/") && pathname.endsWith("/attendees")) return { attendees: [], total: 0, scope: "everyone" };
  if (pathname.startsWith("/api/lounges/") && pathname.endsWith("/meta")) return { status: "open", messages: 0 };
  if (pathname.startsWith("/api/feed")) { assert.ok(member, "Guests must never request the private feed."); return { posts: [], hasMore: false, hiddenPostIds: [] }; }
  const privateFixtures = {
    "/api/me/blocked": { users: [] }, "/api/me/muted": { users: [] }, "/api/me/notifications": { notifications: [] },
    "/api/me/threads": { threads: [] }, "/api/me/following": { following: [] }, "/api/me/fanclubs": { fanClubs: [] },
    "/api/me/going": { going: [] }, "/api/me/artist-recommendations": { artists: [] },
    "/api/users/navigation-fixture-user/posts": { posts: [], hasMore: false },
  };
  if (Object.hasOwn(privateFixtures, pathname)) { assert.ok(member, `Guest private read: ${pathname}`); return privateFixtures[pathname]; }
  throw new Error(`Missing navigation fixture: ${method} ${pathname}`);
}

function loadChromium() {
  if (process.env.PIT_PLAYWRIGHT_MODULE) return require(process.env.PIT_PLAYWRIGHT_MODULE).chromium;
  for (const name of ["playwright", "playwright-core"]) {
    try { return require(name).chromium; } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  }
  throw new Error("Set PIT_PLAYWRIGHT_MODULE to a separately installed Playwright module.");
}

async function localBuildServer() {
  const directory = resolve(root, process.env.PIT_NAVIGATION_BROWSER_DIST || "dist");
  const files = new Map();
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.set(path, readFileSync(path));
    }
  }
  visit(directory);
  const html = files.get(join(directory, "index.html"))?.toString();
  assert.ok(html, "Run npm run build:web first; dist/index.html is missing.");
  const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (!["GET", "HEAD"].includes(request.method) || url.pathname.startsWith("/api/")) return void response.writeHead(405).end();
    let path;
    try { path = resolve(directory, `.${decodeURIComponent(url.pathname)}`); } catch { return void response.writeHead(400).end(); }
    if (!path.startsWith(directory + sep) || !files.has(path)) path = join(directory, "index.html");
    response.setHeader("content-type", mime[extname(path)] || "application/octet-stream");
    response.setHeader("cache-control", "no-store");
    const body = path === join(directory, "index.html") ? injectCollectionFixture(html, url.pathname) : files.get(path);
    response.end(request.method === "HEAD" ? undefined : body);
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { server, origin: `http://127.0.0.1:${server.address().port}`, entry: html.match(/index-[a-f0-9]+\.js/)?.[0] || "unknown" };
}

async function waitFor(check, message) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(done => setTimeout(done, 25));
  }
}

async function assertPath(page, expected) {
  await page.waitForURL(url => url.pathname === expected, { timeout: timeoutMs });
  assert.equal(new URL(page.url()).pathname, expected);
}

async function assertPageIdentity(page, path) {
  const privateTitles = { "/feed": "Your feed", "/you": "Your profile", "/login": "Log in", "/signup": "Create an account" };
  const expectedTitle = privateTitles[path] ? `${privateTitles[path]} | Mshpit` : `Navigation fixture ${path}`;
  await page.waitForFunction(expected => document.title === expected, expectedTitle);
  const identity = await page.evaluate(() => ({ canonical: document.querySelector('link[rel="canonical"]')?.href || null,
    robots: document.querySelector('meta[name="robots"]')?.content || null }));
  const privatePage = ["/feed", "/you", "/login", "/signup"].includes(path);
  assert.equal(identity.canonical, privatePage ? null : new URL(path, page.url()).href, "Visible page and canonical disagree.");
  if (privatePage) assert.match(identity.robots || "", /\bnoindex\b/);
  else assert.equal(identity.robots, "index,follow");
}

const landing = page => page.getByRole("link", { name: "Find concerts", exact: true }).waitFor();
const login = page => page.getByRole("heading", { name: "Good to see you.", exact: true });
async function intro(page, width) {
  const desktopIntro = page.getByRole("button", { name: "Back to intro", exact: true });
  if (width >= 620) return desktopIntro.click();
  // Nested mobile screens have a Home breadcrumb, not desktop's Intro control.
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
}

async function visiblePage(page, path) {
  if (path === postPath) return page.getByText("Navigation fixture concert memory.", { exact: true }).last().waitFor();
  if (path === eventPath) return page.getByRole("button", { name: "Open Fixture Venue's venue page", exact: true }).first().waitFor();
  if (path === "/") return landing(page);
  if (path === "/search") return page.getByLabel("Search Mshpit", { exact: true }).waitFor();
  if (path === "/discover") return page.getByRole("heading", { name: "Discover", exact: true }).waitFor();
  if (path === "/feed") return page.getByText("Your life's musical journey", { exact: true }).waitFor();
  if (path === "/you") return page.getByText(navigationUser.name, { exact: true }).first().waitFor();
  if (path === "/artists") return page.getByText("Find the artists fans are talking about", { exact: true }).waitFor();
  if (path === "/events") return page.getByText("Upcoming concerts around the world", { exact: true }).waitFor();
  if (path === "/venues") return page.getByRole("heading", { name: "Find venues", exact: true }).waitFor();
  throw new Error(`No visible marker for ${path}`);
}

async function runCase(browser, origin, item) {
  const context = await browser.newContext({ viewport: { width: item.width, height: 844 }, isMobile: item.width < 620, hasTouch: item.width < 620, serviceWorkers: "block" });
  const state = { member: !!item.member, artistBioMode: "imported", calls: [], pageErrors: [], consoleErrors: [], reports: [], routeErrors: [], releaseResolve: null, resolveReleased: false, releaseLookup: null, lookupAttempts: 0, expectedLookupErrors: 0, snapshots: [] };
  await context.addInitScript(({ user, origin }) => {
    // The context script also runs in a new tab's opaque about:blank document.
    // Do not access storage there (or in any non-fixture document).
    if (location.origin !== origin) return;
    if (localStorage.getItem("navigation.fixture.initialized")) return;
    localStorage.setItem("navigation.fixture.initialized", "1");
    localStorage.setItem("pit_theme", "stage");
    if (user) {
      localStorage.setItem("pit.session", JSON.stringify(user));
      localStorage.setItem("pit.users", JSON.stringify([user]));
    }
  }, { user: item.member ? navigationUser : null, origin });
  context.on("page", page => {
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    page.on("pageerror", error => state.pageErrors.push(error.message));
    page.on("console", message => {
      if (message.type() !== "error") return;
      // A deliberately injected HTTP 502 is expected browser network feedback,
      // not an uncaught application failure. Match its exact endpoint and code;
      // every other console error still fails the case.
      if (item.kind === "artist-lookup-recovery"
        && message.location().url.startsWith(origin + "/api/artists/resolve?")
        && /Failed to load resource:.*502/.test(message.text())) state.expectedLookupErrors += 1;
      else state.consoleErrors.push(message.text());
    });
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    try {
      // Origin is checked before pathname: an external API can never inherit a fixture.
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith("/api/")) return await route.continue();
      state.calls.push({ path: url.pathname, method: request.method(), query: url.search });
      if (url.pathname === "/api/client-errors") state.reports.push(request.postDataJSON());
      if (item.kind === "artist-lookup-recovery" && url.pathname === "/api/analytics/guest-search") {
        assert.equal(request.method(), "POST");
        const payload = request.postDataJSON();
        assert.deepEqual(Object.keys(payload).sort(), ["kind", "outcome", "resultBucket"],
          "Guest search analytics must not carry the search text or an account identity.");
        return await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      if (item.kind === "artist-lookup-recovery" && url.pathname === "/api/artists/resolve") {
        assert.equal(request.method(), "GET");
        assert.equal(url.searchParams.get("name"), navigationArtist.name);
        state.lookupAttempts += 1;
        if (state.lookupAttempts === 1) {
          await new Promise(done => { state.releaseLookup = done; });
          state.releaseLookup = null;
          return await route.fulfill({ status: 502, contentType: "application/json", headers: { "Retry-After": "30" },
            body: JSON.stringify({ error: "Artist provider is temporarily unavailable.", code: "PROVIDER_UNAVAILABLE",
              retryable: true, requestId: "navigation-provider-outage-fixture" }) });
        }
      }
      if (item.kind === "delayed" && url.pathname === "/api/resolve" && !state.resolveReleased) {
        await new Promise(done => { state.releaseResolve = done; });
        state.resolveReleased = true;
      }
      const body = fixtureApiResponse(url.pathname, { member: state.member, method: request.method(), resolvedPath: url.searchParams.get("path") || undefined, artistBioMode: state.artistBioMode });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    } catch (error) {
      if (item.kind === "delayed" && url.pathname === "/api/resolve" && state.resolveReleased && /closed|disposed|handled|aborted|canceled|cancelled/i.test(error.message)) return;
      state.routeErrors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage();
  const snapshot = async label => state.snapshots.push({ label, ...await page.evaluate(() => ({ path: location.pathname, historyLength: history.length, title: document.title })) });
  const openTab = async label => { await page.getByRole("tab", { name: label, exact: true }).click(); };
  let failure = null;
  try {
    const start = item.path || (item.member ? "/feed" : "/search");
    // Mobile's pending route has no desktop Intro control. Give browser Back a
    // genuine previous local document, instead of navigating to about:blank.
    if (item.kind === "delayed" && item.width < 620) {
      await page.goto(origin + "/", { waitUntil: "networkidle" }); await landing(page);
    }
    await page.goto(origin + start, { waitUntil: item.kind === "delayed" ? "domcontentloaded" : "networkidle", timeout: timeoutMs });
    if (item.kind === "deep-link") {
      await visiblePage(page, start); await assertPath(page, start); await assertPageIdentity(page, start); await snapshot("entry");
      await intro(page, item.width); await landing(page); await assertPath(page, "/"); await assertPageIdentity(page, "/"); await snapshot("intro");
      await page.reload({ waitUntil: "networkidle" }); await landing(page); await assertPath(page, "/"); await snapshot("intro reload");
      await page.goBack({ waitUntil: "networkidle" }); await assertPath(page, start);
      await visiblePage(page, start); await assertPath(page, start); await assertPageIdentity(page, start); await snapshot("back deep link");
      await page.goForward({ waitUntil: "networkidle" });
      await landing(page); await assertPath(page, "/"); await assertPageIdentity(page, "/"); await snapshot("forward intro");
    } else if (item.kind === "delayed") {
      await waitFor(() => !!state.releaseResolve, "The initial public resolver was not held.");
      if (item.width < 620) await page.goBack({ waitUntil: "domcontentloaded" });
      else await intro(page, item.width);
      await landing(page); await assertPath(page, "/");
      const before = state.calls.filter(call => call.path === "/api/posts/p_navigation_fixture").length;
      state.releaseResolve(); state.releaseResolve = null;
      await waitFor(() => state.resolveReleased, "Held resolver did not settle.");
      await page.waitForTimeout(500);
      await landing(page); await assertPath(page, "/");
      assert.equal(await page.getByText("Navigation fixture concert memory.", { exact: true }).count(), 0, "A stale resolver replaced the newer Intro destination.");
      assert.equal(state.calls.filter(call => call.path === "/api/posts/p_navigation_fixture").length, before, "A canceled navigation continued its dependent post fetch.");
      await page.reload({ waitUntil: "networkidle" }); await landing(page); await assertPath(page, "/");
    } else if (item.kind === "artist-lookup-recovery") {
      await visiblePage(page, "/search");
      const field = page.getByLabel("Search Mshpit", { exact: true });
      await field.fill(navigationArtist.name);
      await page.getByText(`No matches for ${navigationArtist.name.toLowerCase()}.`, { exact: true }).first().waitFor();
      const label = `Search the full artist directory for ${navigationArtist.name}`;
      const lookup = page.getByRole("button", { name: label, exact: true });
      await lookup.click();
      await waitFor(() => !!state.releaseLookup, "The interactive artist lookup did not reach the fixture.");
      assert.equal(await lookup.isDisabled(), true, "Repeated submission must be disabled while lookup is pending.");
      await lookup.getByRole("progressbar").waitFor();
      assert.equal(await field.inputValue(), navigationArtist.name);
      state.releaseLookup();
      const error = page.getByText("Artist information is temporarily unavailable. Your search is still here; try again shortly or choose an artist already in the results.", { exact: true });
      await error.waitFor();
      await page.waitForFunction(name => {
        const action = [...document.querySelectorAll('[role="button"]')].find(node => node.getAttribute("aria-label") === name);
        return action && action.getAttribute("aria-busy") !== "true" && action.getAttribute("aria-disabled") !== "true";
      }, label);
      assert.equal(await lookup.isEnabled(), true, "Provider failure must release the action for an explicit retry.");
      assert.equal(await lookup.getByRole("progressbar").count(), 0, "Provider failure must remove the pending spinner.");
      assert.equal(await field.inputValue(), navigationArtist.name, "Failure must retain the original query.");
      assert.equal(await page.getByText(`Mshpit could not find an artist named ${navigationArtist.name}.`, { exact: true }).count(), 0,
        "An upstream outage must not be presented as a missing artist.");
      await assertPath(page, "/search");
      assert.equal(state.lookupAttempts, 1, "The app must not automatically amplify the provider failure with retries.");
      await snapshot("provider unavailable with retained query");
      await lookup.click();
      await page.getByRole("tab", { name: "About artist page section", exact: true }).waitFor();
      await assertPath(page, artistPath);
      await assertPageIdentity(page, artistPath);
      assert.equal(state.lookupAttempts, 2, "One explicit retry should recover without duplicate lookup work.");
      assert.equal(await error.count(), 0);
      assert.equal(state.expectedLookupErrors, 1, "Only the intentionally injected failed response may appear as a browser network error.");
      await snapshot("explicit retry opens resolved artist");
    } else if (item.kind === "guest-tabs") {
      await visiblePage(page, "/search"); await assertPath(page, "/search");
      await openTab("Discover"); await visiblePage(page, "/discover"); await assertPath(page, "/discover");
      await page.goBack({ waitUntil: "networkidle" }); await visiblePage(page, "/search"); await assertPath(page, "/search");
      await page.goForward({ waitUntil: "networkidle" }); await visiblePage(page, "/discover"); await assertPath(page, "/discover");
      for (const tab of ["Feed", "You"]) {
        await openTab(tab); await login(page).waitFor();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await login(page).waitFor({ state: "hidden" }); await visiblePage(page, "/discover"); await assertPath(page, "/discover");
      }
      await page.reload({ waitUntil: "networkidle" }); await visiblePage(page, "/discover"); await assertPath(page, "/discover");
    } else if (item.kind === "member-tabs") {
      await visiblePage(page, "/feed"); await assertPath(page, "/feed");
      for (const [tab, path] of [["Search", "/search"], ["Discover", "/discover"], ["You", "/you"]]) {
        await openTab(tab); await visiblePage(page, path); await assertPath(page, path);
      }
      await page.reload({ waitUntil: "networkidle" }); await visiblePage(page, "/you"); await assertPath(page, "/you"); await assertPageIdentity(page, "/you");
      for (const path of ["/discover", "/search", "/feed"]) {
        await page.goBack({ waitUntil: "networkidle" }); await visiblePage(page, path); await assertPath(page, path);
      }
      for (const path of ["/search", "/discover", "/you"]) {
        await page.goForward({ waitUntil: "networkidle" }); await visiblePage(page, path); await assertPath(page, path);
      }
    } else if (item.kind === "home") {
      await visiblePage(page, start);
      const home = page.getByRole("link", { name: item.width >= 620 ? "Pit home" : "Home", exact: true }).first();
      assert.equal(await home.getAttribute("href"), "/");
      const popupPromise = context.waitForEvent("page");
      await home.click({ button: "middle" });
      const popup = await popupPromise;
      await landing(popup); await assertPath(popup, "/");
      assert.equal(await login(popup).count(), 0, "Opening Home in another tab unexpectedly required sign-in.");
      await popup.close();
      await home.click(); await landing(page); await assertPath(page, "/");
      assert.equal(await login(page).count(), 0, "Ordinary Home differed from the same link opened in a new tab.");
    } else if (item.kind === "signed-in-root") {
      await visiblePage(page, start);
      // The desktop Intro button is guest-only; members reach the same welcome
      // document through the brand Home link without ending their session.
      await page.getByRole("link", { name: item.width >= 620 ? "Pit home" : "Home", exact: true }).first().click();
      await landing(page); await assertPath(page, "/"); await assertPageIdentity(page, "/");
      await page.reload({ waitUntil: "networkidle" }); await landing(page); await assertPath(page, "/");
      await page.goBack({ waitUntil: "networkidle" }); await visiblePage(page, start); await assertPath(page, start);
      await page.goForward({ waitUntil: "networkidle" }); await landing(page); await assertPath(page, "/");
      assert.ok(state.member, "Intro must not sign the account out.");
    } else if (item.kind === "account-boundary") {
      await visiblePage(page, "/feed"); await openTab("You"); await visiblePage(page, "/you"); await assertPath(page, "/you");
      await page.waitForLoadState("networkidle");
      state.member = false;
      await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "pit.auth.epoch.v1", newValue: JSON.stringify({ at: Date.now() }) })));
      await landing(page); await assertPath(page, "/");
      await page.evaluate(name => {
        window.navigationPrivateFlash = false;
        const check = () => { if (document.body?.innerText.includes(name)) window.navigationPrivateFlash = true; };
        new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
        check();
      }, navigationUser.name);
      await page.goBack({ waitUntil: "networkidle" }); await login(page).waitFor(); await assertPath(page, "/login");
      await page.goForward({ waitUntil: "networkidle" }); await landing(page); await assertPath(page, "/");
      assert.equal(await page.evaluate(() => window.navigationPrivateFlash), false, "Back/Forward briefly restored the signed-out account's private UI.");
      await page.reload({ waitUntil: "networkidle" }); await landing(page); await assertPath(page, "/");
      assert.equal(await page.getByText(navigationUser.name, { exact: true }).count(), 0);
    } else if (item.kind === "server-document") {
      const heading = page.getByRole("heading", { name: `Navigation fixture collection: ${start}`, exact: true });
      // Fail before locator visibility retries: the real boot watchdog must
      // never spend thirty seconds hiding an otherwise complete SSR page.
      const assertReleasedBoot = async () => assert.equal(await page.locator("html").getAttribute("data-mshpit-web-boot"), null, "A complete server collection stayed behind the web boot visibility guard.");
      await assertReleasedBoot();
      await heading.waitFor(); await assertPath(page, start);
      assert.equal(await page.locator("#root > .seo-document").count(), 1, "Client mounting erased the server collection.");
      const next = await page.getByRole("link", { name: "Next fixture collection", exact: true }).getAttribute("href");
      await page.getByRole("link", { name: "Next fixture collection", exact: true }).click();
      await page.waitForLoadState("networkidle"); await assertReleasedBoot();
      await page.getByRole("heading", { name: `Navigation fixture collection: ${next}`, exact: true }).waitFor(); await assertPath(page, next);
      await page.goBack({ waitUntil: "networkidle" }); await assertReleasedBoot(); await heading.waitFor(); await assertPath(page, start);
      await page.reload({ waitUntil: "networkidle" }); await assertReleasedBoot(); await heading.waitFor(); await assertPath(page, start);
      assert.deepEqual(state.calls, [], "A preserved server-only document mounted the application or fetched account data.");
    } else if (item.kind === "client-document") {
      await visiblePage(page, start); await assertPath(page, start);
      assert.equal(await page.getByTestId("public-route-error").count(), 0);
      await page.reload({ waitUntil: "networkidle" }); await visiblePage(page, start); await assertPath(page, start);
      if (item.width < 620 && start === "/venues") {
        await page.getByRole("button", { name: "Go back", exact: true }).click(); await landing(page); await assertPath(page, "/");
      } else {
        await intro(page, item.width); await landing(page); await assertPath(page, "/");
        await page.goBack({ waitUntil: "networkidle" }); await visiblePage(page, start); await assertPath(page, start);
      }
    } else if (item.kind === "artist-attribution") {
      for (const mode of ["imported", "replacement", "cleared"]) {
        state.artistBioMode = mode;
        if (mode !== "imported") await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("tab", { name: "About artist page section", exact: true }).click();
        await assertPath(page, artistPath);
        await assertPageIdentity(page, artistPath);
        if (mode === "imported") {
          await page.getByText(navigationArtist.bio, { exact: true }).last().waitFor();
          await page.getByText("Edited excerpt from Wikipedia.", { exact: true }).last().waitFor();
          for (const [label, href] of [["Wikipedia contributors", navigationArtist.bioSource.url],
            ["Source revision", navigationArtist.bioSource.revisionUrl], ["CC BY-SA 4.0", navigationArtist.bioSource.licenseUrl]]) {
            const citation = page.getByRole("link", { name: label, exact: true }).last();
            await citation.scrollIntoViewIfNeeded(); await citation.waitFor({ state: "visible" });
            assert.equal(await citation.getAttribute("href"), href, `${label} must retain its real source URL.`);
          }
        } else {
          if (mode === "replacement") await page.getByText("Staff replacement biography fixture.", { exact: true }).last().waitFor();
          assert.equal(await page.getByText(navigationArtist.bio, { exact: true }).count(), 0, "A staff override must not refill the imported biography.");
          for (const label of ["Wikipedia contributors", "Source revision", "CC BY-SA 4.0"]) {
            assert.equal(await page.getByRole("link", { name: label, exact: true }).count(), 0, "An overridden or cleared biography must not inherit the import citation.");
          }
          assert.equal(await page.getByText("Edited excerpt from Wikipedia.", { exact: true }).count(), 0);
        }
        await snapshot(`biography ${mode}`);
      }
    } else if (item.kind === "missing-document") {
      await page.getByTestId("public-route-error").waitFor();
      await assertPath(page, start);
      assert.equal(await page.getByRole("link", { name: "Find concerts", exact: true }).count(), 0, "Unsupported collection falsely became the landing page.");
      assert.equal(await page.locator("#root > .seo-document").count(), 0);
    }
    await page.waitForTimeout(100);
    assert.deepEqual(state.routeErrors, [], "Every API request must have an explicit safe fixture.");
    assert.deepEqual(state.pageErrors, [], "Navigation produced an uncaught runtime error.");
    assert.deepEqual(state.reports, [], "Navigation emitted a client crash report.");
    assert.deepEqual(state.consoleErrors, [], "Navigation emitted a browser console error.");
  } catch (error) {
    failure = error.message;
    await snapshot("failure").catch(() => {});
  } finally {
    state.releaseResolve?.();
    state.releaseLookup?.();
    await context.close();
  }
  return { name: item.name, passed: !failure, ...(failure ? { failure, ...state, releaseResolve: undefined, releaseLookup: undefined } : {}) };
}

export async function main() {
  if (process.argv.includes("--list")) { console.log(navigationCases.map(item => item.name).join("\n")); return; }
  const filter = process.argv[2] || "";
  const selected = navigationCases.filter(item => item.name.includes(filter));
  assert.ok(selected.length, `No navigation browser cases match ${JSON.stringify(filter)}.`);
  const { server, origin, entry } = await localBuildServer();
  let browser;
  try {
    browser = await loadChromium().launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    console.log(JSON.stringify({ build: entry, cases: selected.length, network: "loopback static fixtures only; every API mocked" }));
    const results = [];
    for (const item of selected) { const started = Date.now(); const result = await runCase(browser, origin, item); results.push(result); console.log(JSON.stringify({ ...result, durationMs: Date.now() - started })); }
    const failed = results.filter(item => !item.passed).length;
    console.log(JSON.stringify({ total: results.length, passed: results.length - failed, failed }));
    if (failed) process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
