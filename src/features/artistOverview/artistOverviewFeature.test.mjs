import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createArtistOverviewController } from "./artistOverviewController.mjs";
import { artistOverviewFromResponse, artistOverviewLocation, artistOverviewRequest } from "./artistOverviewRequest.mjs";
import { artistOverviewText } from "../../domain/artistOverviewCopy.mjs";
import { formatAttendanceTicketTime } from "../../domain/attendanceTicket.mjs";

function asError(error) { return error?.name === "AppError" ? error : Object.assign(new Error("Could not load"), { name: "AppError", code: "PIT-API-001", retryable: true }); }
const event = (id, changes = {}) => ({ id, artist: "Example", venue: "The Hall", date: "2026-10-01", ...changes });
function page(ids = ["one"], nextCursor = null, changes = {}) {
  return { artist: { key: "example", name: "Example" }, reputation: { ratingCount: 12, reviewCount: 15, showCount: 5, avgRating: 4.5, average: 4.5 }, schedule: { items: ids.map((id) => event(id)), total: 20, nextCursor, hasMore: !!nextCursor, legacy: false, coverage: { status: "fresh" } }, ...changes };
}
function setup(options = {}) {
  const calls = [];
  const read = (args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject }));
  const controller = createArtistOverviewController({ accountId: "a", artistKey: "example", read, asError, ...options });
  return { controller, calls };
}

test("artist live requests are worldwide by default, bounded and account-bound", () => {
  const request = artistOverviewRequest({ artistKey: "a/b?c", accountId: "a", limit: 500 });
  assert.equal(request.path, "/api/artists/a%2Fb%3Fc/live-summary?limit=50");
  assert.equal(request.expectedAccountId, "a");
  assert.equal(artistOverviewRequest({ artistKey: "alpha" }).expectedAccountId, null);
  const filtered = artistOverviewRequest({ artistKey: "alpha", countryCode: "France", city: " Paris ", after: "opaque+/=" });
  assert.match(filtered.path, /countryCode=FR/);
  assert.match(filtered.path, /city=Paris/);
  assert.match(filtered.path, /after=opaque%2B%2F%3D/);
  assert.match(artistOverviewRequest({ artistKey: "alpha", publicPreview: true }).path, /publicPreview=1/);
  for (const options of [{}, { artistKey: "alpha", after: "" }, { artistKey: "alpha", city: "\nToronto" }, { artistKey: "alpha", countryCode: "not-a-country" }]) assert.throws(() => artistOverviewRequest(options));
  assert.deepEqual(artistOverviewLocation({}), { city: "", countryCode: "" });
});

test("summary validates protocol fields without converting a missing score to zero", () => {
  assert.equal(artistOverviewFromResponse(page()).reputation.average, 4.5);
  const empty = page([], null, { reputation: { ratingCount: 0, reviewCount: 0, showCount: 0, avgRating: null } });
  assert.equal(artistOverviewFromResponse(empty).reputation.average, null);
  for (const payload of [{}, { ...page(), schedule: null }, page([], null, { reputation: {} }), { ...page(), schedule: { ...page().schedule, hasMore: true } }, page([1])]) assert.throws(() => artistOverviewFromResponse(payload));
  const legacy = page(["should-not-render"], "next");
  legacy.schedule.legacy = true;
  assert.deepEqual(artistOverviewFromResponse(legacy).schedule.items, []);
  assert.equal(artistOverviewFromResponse(legacy).schedule.nextCursor, null);
});

test("initial load, real cursor pagination and duplicate load-more clicks", async () => {
  const { controller, calls } = setup();
  const initial = controller.reload();
  assert.equal(controller.getSnapshot().resource.status, "loading");
  calls[0].resolve(page(["one", "two"], "cursor-1")); await initial;
  const more = controller.loadMore(); const duplicate = controller.loadMore();
  assert.equal(calls.length, 2); assert.equal(calls[1].args.after, "cursor-1");
  assert.equal(controller.getSnapshot().loadingMore, true);
  calls[1].resolve(page(["two", "three"])); await more; await duplicate;
  assert.deepEqual(controller.getSnapshot().resource.data.schedule.items.map((row) => row.id), ["one", "two", "three"]);
  assert.equal(controller.getSnapshot().loadingMore, false);
  await controller.loadMore(); assert.equal(calls.length, 2);
});

test("refresh failure retains successful schedule and rejects for the refresh coordinator", async () => {
  const { controller, calls } = setup(); const initial = controller.reload();
  calls[0].resolve(page()); await initial;
  const refresh = controller.refresh();
  assert.equal(controller.getSnapshot().resource.status, "refreshing");
  const rejection = assert.rejects(refresh, /Could not load/);
  calls[1].reject(new Error("database temporarily busy")); await rejection;
  assert.equal(controller.getSnapshot().resource.status, "error");
  assert.equal(controller.getSnapshot().resource.data.schedule.items[0].id, "one");
  assert.equal(controller.getSnapshot().resource.error.code, "PIT-API-001");
});

test("page failure keeps current rows and cursor and supports explicit retry", async () => {
  const { controller, calls } = setup(); const initial = controller.reload();
  calls[0].resolve(page(["one"], "cursor")); await initial;
  const more = controller.loadMore(); calls[1].reject(new Error("offline"));
  assert.equal((await more).ok, false);
  assert.equal(controller.getSnapshot().resource.status, "ready");
  assert.equal(controller.getSnapshot().resource.data.schedule.nextCursor, "cursor");
  assert.equal(controller.getSnapshot().moreError.code, "PIT-API-001");
  const retry = controller.loadMore(); assert.equal(calls[2].args.after, "cursor");
  calls[2].resolve(page(["two"])); await retry;
  assert.equal(controller.getSnapshot().moreError, null);
});

test("changing location clears rows immediately but preserves authoritative reputation", async () => {
  const { controller, calls } = setup(); const initial = controller.reload();
  calls[0].resolve(page(["toronto"], "cursor")); await initial;
  const more = controller.loadMore();
  const filter = controller.setLocation({ countryCode: "France", city: "Paris" });
  assert.equal(calls[1].args.signal.aborted, true);
  assert.equal(controller.getSnapshot().resource.data.schedule, null);
  assert.equal(controller.getSnapshot().resource.data.reputation.average, 4.5);
  assert.notEqual(controller.getSnapshot().resource.updatedAt, null);
  assert.equal(calls[2].args.after, null);
  assert.equal(calls[2].args.countryCode, "FR");
  calls[1].resolve(page(["late-old-location"])); await more;
  assert.equal(controller.getSnapshot().resource.data.schedule, null);
  calls[2].resolve(page(["paris"])); await filter;
  assert.equal(controller.getSnapshot().resource.data.schedule.items[0].id, "paris");
});

test("disposed identity cannot publish stale account-specific responses", async () => {
  const a = setup(); const pending = a.controller.reload(); a.controller.dispose();
  const b = setup({ accountId: "b", artistKey: "another" });
  assert.equal(b.controller.getSnapshot().resource.data, null);
  assert.equal(a.calls[0].args.signal.aborted, true);
  a.calls[0].resolve(page(["old-account"])); await pending;
  assert.equal(b.controller.getSnapshot().resource.data, null);
  assert.equal(a.controller.getSnapshot().resource.data, null);
});

test("refresh supersedes a pending page and late page data cannot reappear", async () => {
  const { controller, calls } = setup(); const first = controller.reload();
  calls[0].resolve(page(["one"], "cursor")); await first;
  const more = controller.loadMore(); const refresh = controller.refresh();
  assert.equal(calls[1].args.signal.aborted, true);
  calls[2].resolve(page(["fresh"])); await refresh;
  calls[1].resolve(page(["old-more"])); await more;
  assert.deepEqual(controller.getSnapshot().resource.data.schedule.items.map((row) => row.id), ["fresh"]);
});

test("caller cancellation restores settled rows and records no failure", async () => {
  const { controller, calls } = setup(); const first = controller.reload(); calls[0].resolve(page()); await first;
  const signal = new AbortController(); const refresh = controller.refresh({ signal: signal.signal });
  const rejection = assert.rejects(refresh, { name: "AbortError" }); signal.abort();
  assert.equal(calls[1].args.signal.aborted, true); calls[1].reject(new Error("aborted")); await rejection;
  assert.equal(controller.getSnapshot().resource.status, "ready");
  assert.equal(controller.getSnapshot().resource.error, null);
});

test("disabled/legacy resources never load more and lifecycle replay can restart safely", async () => {
  const disabled = setup({ enabled: false }); await disabled.controller.reload(); assert.equal(disabled.calls.length, 0);
  const { controller, calls } = setup(); const first = controller.reload(); controller.dispose(); controller.resume();
  const replay = controller.reload(); calls[0].resolve(page(["late"])); await first;
  const legacy = page([], null); legacy.schedule.legacy = true; calls[1].resolve(legacy); await replay;
  await controller.loadMore(); assert.equal(calls.length, 2);
  assert.deepEqual(controller.getSnapshot().resource.data.schedule.items, []);
});

test("nonadvancing pagination cursor is a retryable failure instead of a endless button", async () => {
  const { controller, calls } = setup(); const first = controller.reload(); calls[0].resolve(page(["one"], "same")); await first;
  const more = controller.loadMore(); calls[1].resolve(page(["two"], "same"));
  assert.equal((await more).ok, false);
  assert.deepEqual(controller.getSnapshot().resource.data.schedule.items.map((row) => row.id), ["one"]);
});

test("managed copy overrides interpolate without code changes", () => {
  assert.equal(artistOverviewText({ title: "Next on stage" }, "title"), "Next on stage");
  assert.equal(artistOverviewText(null, "shownCount", { shown: 3, total: 16 }), "3 of 16 listed dates");
});

test("component preserves semantic links, compact bounds and explicit network states", () => {
  const component = readFileSync(new URL("../../components/artist/ArtistUpcomingShows.jsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("./useArtistOverview.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("./services/artistOverviewApi.mjs", import.meta.url), "utf8");
  assert.match(component, /rows\.slice\(0, 3\)/);
  assert.match(component, /onPress=\{controller\.loadMore\}/);
  assert.match(component, /onOpenShow\(event\)/);
  assert.match(component, /href=\{eventPath\(event\)\}/);
  assert.match(component, /openTicketLink\(ticketUrl/);
  assert.match(component, /coverage\?\.status === "disabled"/);
  assert.match(component, /minHeight: 44/);
  assert.match(component, /text\(failureCopy\)/);
  assert.match(component, /hasSchedule \? "stale" : "failed"/);
  assert.doesNotMatch(component, /\bfetch\s*\(|from .*Store/);
  assert.match(hook, /useSyncExternalStore/);
  assert.match(hook, /\[artistKey, accountId, enabled, pageSize, publicPreview\]/);
  assert.match(service, /signal: options\.signal, expectedAccountId: request\.expectedAccountId/);
});

test("show clock preserves provider-local timestamps and uses venue timezone for absolute timestamps", () => {
  assert.equal(formatAttendanceTicketTime("2026-09-07T19:30:00"), "7:30 PM");
  assert.equal(formatAttendanceTicketTime("19:30:00"), "7:30 PM");
  assert.equal(formatAttendanceTicketTime("2026-09-07T23:30:00Z", { timeZone: "America/Toronto" }), "7:30 PM");
});
