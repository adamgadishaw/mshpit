import assert from "node:assert/strict";
import test from "node:test";
import { publicFramePath } from "./publicFrameNavigation.mjs";
import { publicBrowserDestination } from "./publicBrowserDestination.mjs";
import { mainTabForPath, MAIN_TAB_PATHS, serverDocumentNavigationPath } from "./browserNavigation.mjs";

test("root and all tabs round-trip with account gates", async () => {
  assert.equal((await publicBrowserDestination("/")).landing, true);
  const memberHome = await publicBrowserDestination("/", { accountId: "a" });
  assert.equal(memberHome.path, "/");
  assert.equal(memberHome.landing, true);
  assert.equal(memberHome.accountId, "a", "Intro does not sign out the member");
  const feed = await publicBrowserDestination("/feed", { accountId: "a" });
  assert.equal(feed.path, "/feed");
  assert.equal(feed.landing, false);
  for (const [tab, path] of Object.entries(MAIN_TAB_PATHS)) {
    assert.equal(mainTabForPath(path), tab);
    assert.equal((await publicBrowserDestination(path, { accountId: "a" })).tab, tab);
    const guest = await publicBrowserDestination(path);
    if (["feed", "you"].includes(tab)) {
      assert.equal(guest.path, "/login");
      assert.equal(guest.stack.at(-1).auth, true);
    } else assert.equal(guest.tab, tab);
  }
});

test("confirmed members leave public authentication URLs without repeating login", async () => {
  for (const path of ["/login", "/signup"]) {
    const member = await publicBrowserDestination(path, { accountId: "member", resolveEntity: () => assert.fail("auth routes need no provider lookup") });
    assert.equal(member.path, "/feed");
    assert.equal(member.tab, "feed");
    assert.deepEqual(member.stack, [{}]);
    assert.equal(member.accountId, "member");
    const guest = await publicBrowserDestination(path);
    assert.equal(guest.path, path);
    assert.equal(guest.stack.at(-1).auth, true, "unknown or expired sessions still require authentication");
  }
});
test("server-owned collections never silently hydrate a different page", async () => {
  for (const path of ["/concerts", "/events/page/2", "/artists/page/3", "/venues/us/davis", "/concerts/ca/toronto/page/2", "/artist/sports/concerts/page/2"]) {
    assert.equal(serverDocumentNavigationPath(path), path);
    const result = await publicBrowserDestination(path, { resolveEntity: () => assert.fail("must not fetch wrong entity") });
    assert.equal(result.stack.at(-1).routeError, path, "missing SSR yields an explicit unavailable screen");
    assert.equal(result.landing, false);
  }
  for (const path of ["/events", "/artists", "/venues", "/cities", "/city/us/davis", "/artist/sports/concerts"]) assert.equal(serverDocumentNavigationPath(path), null);
});
test("public route types hydrate exactly and pass abort signals", async () => {
  const controller = new AbortController();
  const options = (entity) => ({ signal: controller.signal, resolveEntity: async (_path, { signal }) => {
    assert.equal(signal, controller.signal); return entity;
  } });
  const artist = await publicBrowserDestination("/old-band", options({ kind: "artist", name: "Band", path: "/artist/band" }));
  assert.equal(artist.path, "/artist/band");
  assert.equal(artist.stack.at(-1).artistPublicSlug, "band");
  const event = await publicBrowserDestination("/event/x", options({ kind: "event", id: "x", artist: "Club night", path: "/event/x" }));
  assert.equal(event.stack.at(-1).openLog.id, "x");
  const post = await publicBrowserDestination("/post/p", { ...options({ kind: "show", id: "p", path: "/post/p" }), readPost: async (_id, { signal }) => {
    assert.equal(signal, controller.signal); return { id: "p", kind: "status" };
  } });
  assert.equal(post.stack.at(-1).post.id, "p");
});
test("late canceled lookups cannot become navigation destinations", async () => {
  const controller = new AbortController();
  let finish;
  const promise = publicBrowserDestination("/event/x", { signal: controller.signal, resolveEntity: () => new Promise(resolve => { finish = resolve; }) });
  controller.abort(); finish({ kind: "event", id: "x" });
  assert.equal(await promise, null);
});
test("missing public entities and unsupported paths never become landing", async () => {
  for (const path of ["/event/missing", "/nonexistent/nested"]) {
    const result = await publicBrowserDestination(path, { resolveEntity: async () => null });
    assert.equal(result.landing, false);
    assert.equal(result.stack.at(-1).routeError, path);
  }
});

test("matching public presentation hint keeps a concert's post discussion after a fresh account-scoped read", async () => {
  const controller = new AbortController();
  const freshPost = { id: "p", kind: "review", artist: "Band", venue: "Hall", review: "Current server content" };
  let reads = 0;
  const result = await publicBrowserDestination("/post/p", {
    accountId: "new-member", signal: controller.signal,
    publicFrameHint: { postId: "p", post: { id: "p", review: "Old guest payload must not return" } },
    resolveEntity: async () => ({ kind: "show", id: "p", path: "/post/p" }),
    readPost: async (id, { signal }) => { reads += 1; assert.equal(id, "p"); assert.equal(signal, controller.signal); return freshPost; },
  });
  assert.equal(reads, 1);
  assert.equal(result.accountId, "new-member");
  assert.equal(result.stack.at(-1).post, freshPost);
  assert.equal(result.stack.at(-1).openLog, undefined);
  assert.equal(JSON.stringify(result).includes("Old guest payload"), false);
});

test("post routes open the fresh review without relying on a presentation hint", async () => {
  const freshPost = { id: "p", kind: "review", artist: "Band", venue: "Hall" };
  for (const hint of [null, "p", ["p"], { postId: "other" }, { postId: 1 }, { postId: "" }, { postId: "p".repeat(201) }]) {
    let reads = 0;
    const result = await publicBrowserDestination("/post/p", {
      publicFrameHint: hint,
      resolveEntity: async () => ({ kind: "show", id: "p", path: "/post/p" }),
      readPost: async () => { reads += 1; return freshPost; },
    });
    assert.equal(reads, 1);
    assert.equal(result.stack.at(-1).post, freshPost);
  }
});

test("post hints cannot bypass missing records or cancellation during the fresh content read", async () => {
  const options = { publicFrameHint: { postId: "p" }, resolveEntity: async () => ({ kind: "show", id: "p", path: "/post/p" }) };
  const missing = await publicBrowserDestination("/post/p", { ...options, readPost: async () => null });
  assert.equal(missing.stack.at(-1).routeError, "/post/p");
  const controller = new AbortController();
  const canceled = await publicBrowserDestination("/post/p", { ...options, signal: controller.signal, readPost: async () => {
    controller.abort(); return { id: "p", kind: "review", venue: "Hall" };
  } });
  assert.equal(canceled, null);
});


test("archive-linked review permalinks retain post identity for guests and members", async () => {
  // Public API shape of the reported review; synthetic identity and content.
  const post = { id: "p_archive_review", userId: "fixture-author", kind: "review",
    artist: "Hollowfest / Nessfest", venue: "The Woods", city: "Perth, Ontario, Canada", date: "2026-10-16",
    archiveShowKey: "show.WyJob2xsb3dmZXN0IC8gbmVzc2Zlc3QiLCJ0aGUgd29vZHMiLCIiLCIyMDI2LTEwLTE2Il0" };
  for (const accountId of [null, "member"]) for (const kind of ["review", "status", undefined]) {
    const record = { ...post, kind };
    const result = await publicBrowserDestination("/post/p_archive_review", { accountId,
      resolveEntity: async () => ({ kind: "show", id: post.id, path: "/post/p_archive_review" }),
      readPost: async () => record });
    assert.deepEqual(result.stack.at(-1), { post: record });
    assert.equal(result.path, "/post/p_archive_review");
    assert.equal(publicFramePath(result.stack.at(-1)), result.path);
    assert.equal(result.accountId, accountId);
  }
});

test("genuine canonical concerts and events still open performance frames", async () => {
  for (const [kind, path, entity] of [["concert", "/concert/show.fixture", { archiveShowKey: "show.fixture" }],
    ["event", "/event/event-fixture", { id: "event-fixture" }]]) {
    const result = await publicBrowserDestination(path, {
      resolveEntity: async () => ({ kind, path, ...entity }),
      readPost: () => assert.fail("performance routes must not read a post") });
    assert.equal(result.stack.at(-1).openLog.performanceEvent, true);
    assert.equal(publicFramePath(result.stack.at(-1)), path);
  }
});
