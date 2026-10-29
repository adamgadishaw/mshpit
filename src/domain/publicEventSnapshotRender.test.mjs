import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { formatDate } from "./dates.mjs";
import { normalizePublicEventSnapshot, publicEventArtistIdentityPending } from "./publicEventSnapshot.mjs";
import { showLifecycleView, showPresentationModel } from "./showDocument.mjs";
import { readShowDocument } from "../features/showSocial/showSocialApi.mjs";
import { readPublicEventSnapshot } from "../features/showSocial/publicEventSnapshotApi.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../screens/ShowScreen.jsx", import.meta.url), "utf8");
const panel = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find((node) => node.type === "FunctionDeclaration" && node.id.name === "PublicEventSnapshotPanel");
const compiled = require("@babel/core").transformSync(`${source.slice(panel.start, panel.end)}\nmodule.exports = PublicEventSnapshotPanel;`, {
  babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

function fixture() {
  const module = { exports: {} }, tickets = [];
  const jsx = (type, props) => ({ type, props });
  new vm.Script(compiled).runInNewContext({
    module, exports: module.exports,
    require: () => ({ jsx, jsxs: jsx }),
    View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", Icon: "Icon",
    CatalogText: "CatalogText",
    styles: {}, colors: {}, formatDate, showLifecycleView,
    openTicketLink: (url) => tickets.push(url),
  });
  return { render: module.exports, tickets };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}

test("artist provider outage keeps event details usable and exposes a separate cooldown-aware artist retry", () => {
  const f = fixture(); const opened = []; let detailsRetries = 0, artistRetries = 0;
  const event = { id: "tm_provider_outage", name: "Les Solidarités", artist: "Les Solidarités", venue: "Fixture Venue",
    date: "2026-10-20", ticketUrl: "https://www.ticketmaster.ca/event/fixture" };
  const error = Object.assign(new Error("Provider down"), { serverCode: "PROVIDER_UNAVAILABLE", status: 502 });
  const render = (overrides = {}) => f.render({ event, status: "ready", artistStatus: "unavailable", artistError: error,
    artistRetryDisabled: true, onRetry: () => detailsRetries++, onRetryArtist: () => artistRetries++,
    onOpenVenue: (venue) => opened.push(venue), ...overrides });
  const tree = render();
  assert.match(text(tree), /Artist information is temporarily unavailable/);
  assert.doesNotMatch(text(tree), /Artist profile not linked|event name is not always an artist/);
  assert.match(text(tree), /Les Solidarités.*Fixture Venue.*2026 · 10 · 20/);
  const artistRetry = nodes(tree).find(node => node.props?.accessibilityLabel === "Retry checking artist availability");
  assert.ok(artistRetry);
  assert.equal(artistRetry.props.disabled, true);
  assert.equal(artistRetry.props.accessibilityState.disabled, true);
  assert.match(text(artistRetry), /Try again later/);
  const detailsRetry = nodes(tree).find(node => node.props?.accessibilityLabel === "Refresh event details");
  assert.equal(detailsRetry.props.disabled, false, "artist cooldown must not prevent refreshing public details");
  detailsRetry.props.onPress();
  assert.equal(detailsRetries, 1); assert.equal(artistRetries, 0);
  nodes(tree).find(node => node.props?.accessibilityLabel === "Open Fixture Venue's venue page").props.onPress();
  nodes(tree).find(node => node.props?.accessibilityLabel === "Get tickets for Les Solidarités at Fixture Venue").props.onPress();
  assert.equal(opened.length, 1); assert.deepEqual(f.tickets, [event.ticketUrl]);
  assert.doesNotMatch(text(tree), /See this artist|Lounge|Log \/ review|I'm going/);
  const cooledDown = render({ artistRetryDisabled: false });
  assert.equal(artistRetries, 0, "rendering an enabled retry never starts a request");
  const enabled = nodes(cooledDown).find(node => node.props?.accessibilityLabel === "Retry checking artist availability");
  assert.equal(enabled.props.disabled, false);
  enabled.props.onPress();
  assert.equal(artistRetries, 1); assert.equal(detailsRetries, 1);
});

test("artist checking, confirmed miss and pending identity remain distinct on public events", () => {
  const f = fixture(); const event = { id: "event", name: "Event", venue: "Venue", date: "2026-10-20" };
  const props = { event, status: "ready", onRetry: () => {}, onRetryArtist: () => {} };
  const checking = f.render({ ...props, artistStatus: "checking" });
  assert.match(text(checking), /Checking artist availability/);
  const busy = nodes(checking).find(node => node.props?.accessibilityLabel === "Retry checking artist availability");
  assert.equal(busy.props.disabled, true); assert.equal(busy.props.accessibilityState.busy, true);
  const missing = f.render({ ...props, artistStatus: "unavailable", artistMissing: true });
  assert.match(text(missing), /Artist profile not linked yet/);
  assert.doesNotMatch(text(missing), /temporarily unavailable/);
  const pending = f.render({ ...props, artistIdentityPending: true, artistStatus: "unavailable", artistError: new Error("Old lookup") });
  assert.match(text(pending), /Artist profile not linked yet/);
  assert.doesNotMatch(text(pending), /temporarily unavailable/);
  assert.equal(nodes(pending).some(node => node.props?.accessibilityLabel === "Retry checking artist availability"), false,
    "pending identity can only be rechecked through the event's authoritative snapshot");
  const refreshing = f.render({ ...props, status: "refreshing", artistStatus: "unavailable", artistError: new Error("Check failed") });
  assert.equal(nodes(refreshing).find(node => node.props?.accessibilityLabel === "Refresh event details").props.disabled, true);
  assert.equal(nodes(refreshing).find(node => node.props?.accessibilityLabel === "Retry checking artist availability").props.disabled, false);
  const retained = f.render({ ...props, status: "error", artistStatus: "unavailable", artistError: new Error("Check failed") });
  assert.match(text(retained), /Showing the event details already loaded/);
  assert.match(text(retained), /Artist information is temporarily unavailable/);
});

test("a failed or missing public snapshot cannot remove the independent artist recovery action", () => {
  const f = fixture(); let details = 0, artist = 0;
  for (const status of ["loading", "ready", "error"]) {
    const props = { event: null, status, artistStatus: "unavailable", artistError: new Error("Provider unavailable"),
      onRetry: () => details++, onRetryArtist: () => artist++ };
    const coolingDown = f.render({ ...props, artistRetryDisabled: true });
    assert.match(text(coolingDown), /Artist information is temporarily unavailable/);
    assert.equal(nodes(coolingDown).find(node => node.props?.accessibilityLabel === "Retry checking artist availability").props.disabled, true);
    const available = f.render({ ...props, artistRetryDisabled: false });
    const retry = nodes(available).find(node => node.props?.accessibilityLabel === "Retry checking artist availability");
    assert.equal(retry.props.disabled, false);
    retry.props.onPress();
    assert.equal(details, 0);
  }
  assert.equal(artist, 3);
});

test("ShowScreen wires event refresh and artist recovery independently with the actual failure state", () => {
  const component = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
    .find(node => node.type === "ExportDefaultDeclaration").declaration;
  const descendants = (node) => !node || typeof node !== "object" ? []
    : [node, ...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(descendants) : descendants(value))];
  const opening = descendants(component).find(node => node.type === "JSXOpeningElement" && node.name?.name === "PublicEventSnapshotPanel");
  const declarations = component.body.body.filter(node => node.type === "VariableDeclaration").flatMap(node => node.declarations);
  const combined = declarations.find(node => node.id.name === "retryPublicEvent");
  let details = 0, artist = 0;
  const error = new Error("Provider unavailable");
  const context = { publicEventSnapshot: {}, publicEventResource: { status: "ready" }, artistIdentityPending: false,
    artistIdentityStatus: "unavailable", artistIdentityRetryDisabled: true, artistIdentityMissing: false, artistIdentityError: error,
    profileGateState: "unavailable", memorialResource: { error: null }, onOpenVenue: () => {},
    reloadPublicEvent: () => details++, retryProfileStatus: () => artist++, PublicEventSnapshotPanel: "Panel" };
  if (combined) context.retryPublicEvent = new vm.Script(`(${source.slice(combined.init.start, combined.init.end)})`).runInNewContext(context);
  const evaluate = (attribute) => {
    const expression = opening.attributes.find(node => node.name?.name === attribute)?.value?.expression;
    assert.ok(expression, `The public event panel receives ${attribute}`);
    return new vm.Script(`(${source.slice(expression.start, expression.end)})`).runInNewContext(context);
  };
  evaluate("onRetry")();
  assert.equal(details, 1); assert.equal(artist, 0, "event-only refresh must not consume an artist retry");
  evaluate("onRetryArtist")();
  assert.equal(artist, 1); assert.equal(details, 1);
  assert.equal(evaluate("artistStatus"), "unavailable");
  assert.equal(evaluate("artistError"), error);
  assert.equal(evaluate("artistMissing"), false);
  assert.equal(evaluate("artistRetryDisabled"), true);
  context.artistIdentityStatus = "ready";
  context.artistIdentityError = null;
  context.memorialResource.error = new Error("Status check unavailable");
  assert.equal(evaluate("artistError"), context.memorialResource.error);
  assert.equal(evaluate("artistRetryDisabled"), false, "an old lookup cooldown must not block the separate memorial check");
});

test("canonical 404 plus a fresh cancelled resolver snapshot keeps accessible details without tickets or availability notice", async () => {
  const entity = { id: "tm_cancelled_fixture", kind: "event", path: "/event/tm_cancelled_fixture", publicEventSnapshot: true,
    name: "Fixture Cancelled Artist", artist: "Fixture Cancelled Artist", venue: "Fixture Venue", date: "2026-10-05",
    artistIdentityPending: true, eventStatus: "CANCELED", soldOut: true, ticketUrl: "https://www.ticketmaster.ca/event/fixture" };
  const calls = [];
  const apiCall = async (path) => {
    calls.push(path);
    if (path.startsWith("/api/shows/")) throw Object.assign(new Error("Not found"), { status: 404 });
    assert.equal(path, "/api/resolve?path=%2Fevent%2Ftm_cancelled_fixture");
    return { entity };
  };
  await assert.rejects(readShowDocument({ concertKey: "fixture cancelled artist|fixture venue|2026-10-05" }, { apiCall }), error => error.status === 404);
  const event = await readPublicEventSnapshot({ eventId: entity.id }, { apiCall });
  const f = fixture(), opened = [];
  for (const status of ["ready", "refreshing", "error"]) {
    const tree = f.render({ event, status, artistIdentityPending: false, artistStatus: "unavailable", artistError: new Error("Provider unavailable"),
      onRetryArtist: () => assert.fail("Cancelled events cannot retry artist availability"), onOpenVenue: value => opened.push(value) });
    assert.match(text(tree), /THIS SHOW WAS CANCELLED/);
    assert.match(text(tree), /Fixture Cancelled Artist.*Fixture Venue.*2026 · 10 · 05/);
    assert.doesNotMatch(text(tree), /Get tickets|SOLD OUT|This show is available|available tickets|Artist profile not linked|Upcoming|until showtime/);
    assert.equal(nodes(tree).some(node => node.props?.accessibilityRole === "link"), false);
    assert.equal(nodes(tree).some(node => node.props?.accessibilityLabel === "Retry checking artist availability"), false);
    const context = nodes(tree).find(node => node.type === "CatalogText");
    assert.equal(context.props.type, "event");
    assert.equal(context.props.entityKey, event.id, "cancellation does not hide this event's sourced catalog context");
    nodes(tree).find(node => node.props?.accessibilityLabel === "Open Fixture Venue's venue page").props.onPress();
  }
  assert.equal(opened.length, 3);
  assert.deepEqual(f.tickets, []);
  assert.equal(calls.length, 2, "no retry loop or write follows either read");

  const component = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
    .find(node => node.type === "ExportDefaultDeclaration").declaration;
  const expression = component.body.body.filter(node => node.type === "VariableDeclaration").flatMap(node => node.declarations)
    .find(node => node.id.name === "lifecycleView").init;
  const view = new vm.Script(`(${source.slice(expression.start, expression.end)})`).runInNewContext({
    showLifecycleView, trustedShow: null, norm: entity, overall: null,
    showDateMs: () => Date.parse("2026-10-05T20:00:00Z"), eventIdentitySnapshot: event,
  });
  assert.equal(view.trusted, false);
  assert.equal(view.lifecycle, "cancelled", "the real screen expression passes the validated snapshot into lifecycle resolution");
  const presentation = showPresentationModel(view);
  assert.equal(presentation.allowGoing, false);
  assert.equal(presentation.showCountdown, false);
});

test("real fallback renders Club 1BD date/venue without inventing an artist link or unlocking social actions", () => {
  const f = fixture(); const opened = [];
  const event = normalizePublicEventSnapshot({ id: "tm_club", kind: "event", path: "/event/tm_club", publicEventSnapshot: true,
    name: "Club 1BD Toronto", artist: "Club 1BD Toronto", venue: "REBEL", date: "2026-08-29", city: "Toronto, Canada",
    source: "ticketmaster", providerVenueId: "rebel-id", review: "Never render this", overall: 5,
  }, "tm_club");
  const tree = f.render({ event, status: "ready", onOpenVenue: (value) => opened.push(value) });
  assert.match(text(tree), /Club 1BD Toronto/);
  assert.match(text(tree), /REBEL/);
  assert.match(text(tree), /2026 · 08 · 29/);
  assert.doesNotMatch(text(tree), /Never render this|See this artist|Lounge|Log \/ review|I'm going|community score/);
  const venue = nodes(tree).find((node) => node.props?.accessibilityLabel === "Open REBEL's venue page");
  venue.props.onPress();
  assert.equal(opened[0].name, "REBEL");
  assert.equal(opened[0].providerVenueId, "rebel-id");
  assert.equal(f.tickets.length, 0);
  const context = nodes(tree).find(node => node.type === "CatalogText");
  assert.equal(context.props.type, "event"); assert.equal(context.props.entityKey, "tm_club");
});

test("real fallback distinguishes loading, network failure, unavailable listing and retained content", () => {
  const f = fixture(); let retries = 0;
  assert.match(text(f.render({ event: null, status: "loading" })), /Loading event details/);
  const failed = f.render({ event: null, status: "error", onRetry: () => retries++ });
  assert.match(text(failed), /Event details could not load/);
  nodes(failed).find((node) => node.props?.accessibilityLabel === "Retry loading event details").props.onPress();
  assert.equal(retries, 1);
  assert.match(text(f.render({ event: null, status: "ready" })), /This event is not available/);
  assert.doesNotMatch(text(failed), /archive|artist's status/);
});

test("pending artist identity keeps public show details and venue/ticket links usable without a namesake profile link", () => {
  const f = fixture(); const opened = []; let retries = 0;
  const event = normalizePublicEventSnapshot({ id: "tm_pending", kind: "event", path: "/event/tm_pending", publicEventSnapshot: true,
    name: "Namesake Live", artist: "Namesake", venue: "Fixture Venue", date: "2026-10-03", city: "Toronto",
    artistIdentityPending: true, ticketUrl: "https://www.ticketmaster.ca/event/fixture", source: "ticketmaster", providerVenueId: "room-id",
  }, "tm_pending");
  const tree = f.render({ event, artistIdentityPending: true, status: "ready", onOpenVenue: (venue) => opened.push(venue), onRetry: () => retries++ });
  assert.match(text(tree), /Artist profile not linked yet/);
  assert.match(text(tree), /Namesake Live.*Fixture Venue.*2026 · 10 · 03/);
  assert.doesNotMatch(text(tree), /temporarily unavailable|could not be opened/);
  nodes(tree).find(node => node.props?.accessibilityLabel === "Open Fixture Venue's venue page").props.onPress();
  nodes(tree).find(node => node.props?.accessibilityLabel === "Get tickets for Namesake Live at Fixture Venue").props.onPress();
  nodes(tree).find(node => node.props?.accessibilityLabel === "Refresh event details").props.onPress();
  assert.equal(opened[0].providerVenueId, "room-id");
  assert.deepEqual(f.tickets, [event.ticketUrl]);
  assert.equal(retries, 1);
  const context = nodes(tree).find(node => node.type === "CatalogText");
  assert.equal(context.props.type, "event"); assert.equal(context.props.entityKey, "tm_pending");
  assert.equal(nodes(tree).some(node => /Open Namesake's profile/.test(node.props?.accessibilityLabel || "")), false);
  assert.match(source, /enabled: !artistIdentityPending/);
  assert.match(source, /const showPageAllowed = !artistIdentityPending && artistIdentityStatus === "ready"/);
});

test("ShowScreen never promotes navigation markers into permission or changes existing artist action gates", () => {
  assert.match(source, /usePublicEventSnapshot\(\{ eventId: publicEventId, accountId \}\)/);
  assert.match(source, /readablePublicEventSnapshot\(publicEventResource, \{ eventId: publicEventId, accountId, legacyMode \}\)/);
  assert.match(source, /publicEventId && !legacyMode \? <PublicEventSnapshotPanel/);
  assert.match(source, /event=\{publicEventSnapshot\}/);
  assert.doesNotMatch(source, /log\.publicEventSnapshot/);
  assert.match(source, /const liveActionsAvailable = memorialAvailability === "living"/);
  assert.match(source, /enabled: showPageAllowed && !!archiveShowKey/);
  assert.match(source, /presentation\.showPostEvent && liveActionsAvailable/);
});

test("a trusted pending Show restricts artist identity even without a public event snapshot and nulls stale navigation keys", () => {
  const component = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
    .find((node) => node.type === "ExportDefaultDeclaration").declaration;
  const declarations = component.body.body.filter((node) => node.type === "VariableDeclaration").flatMap((node) => node.declarations);
  const pendingNode = declarations.find((node) => node.id.name === "artistIdentityPending").init;
  const keyNode = declarations.find((node) => node.id.name === "norm").init.properties.find((node) => node.key?.name === "artistKey").value;
  const evaluate = (node, context) => new vm.Script(`(${source.slice(node.start, node.end)})`).runInNewContext(context);
  const context = { trustedShow: { artistIdentityPending: true, artistKey: null }, log: { artistKey: "wrong-namesake" },
    eventIdentitySnapshot: null, publicEventResource: { status: "error" }, publicEventArtistIdentityPending };
  const pending = evaluate(pendingNode, context);
  assert.equal(pending, true, "stable Show links cannot bypass the server restriction when the event lookup is unavailable");
  assert.equal(evaluate(keyNode, { ...context, artistIdentityPending: pending }), null,
    "a server-null restricted artist key must not fall through to the navigation key");
  assert.equal(evaluate(pendingNode, { ...context, publicEventResource: { status: "ready" }, eventIdentitySnapshot: { artistIdentityPending: false } }), true,
    "a fresh event confirmation cannot override a still-restricted trusted Show");
  assert.equal(evaluate(pendingNode, { ...context, trustedShow: { artistIdentityPending: false }, log: { artistIdentityPending: true } }), true,
    "only a fresh explicit event confirmation can clear the conservative navigation restriction");
  assert.equal(evaluate(pendingNode, { ...context, trustedShow: { artistIdentityPending: false }, log: { artistIdentityPending: true },
    publicEventResource: { status: "ready" }, eventIdentitySnapshot: { artistIdentityPending: false } }), false);
});

test('plural product snapshots render in full and compact navigation recovers their eventName', () => {
  const component = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration;
  const norm = component.body.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).find(n => n.id.name === 'norm').init;
  const value = norm.properties.find(n => n.key?.name === 'eventName').value;
  const eventNameFor = new Function('eventIdentitySnapshot', 'log', `return (${source.slice(value.start, value.end)});`);
  for (const title of ['Metallica - Suite Reservations', 'Metallica - Hotel Packages', 'Metallica - Seat Upgrades']) {
    const entity = { id: 'compact', kind: 'event', path: '/event/compact', publicEventSnapshot: true, artist: 'Metallica', venue: 'Fixture Venue', date: '2036-06-14', eventName: title };
    const snapshot = normalizePublicEventSnapshot(entity, 'compact');
    assert.equal(eventNameFor(snapshot, { artist: 'Metallica' }), title);
    assert.match(text(fixture().render({ event: snapshot, status: 'ready', artistIdentityPending: true })), new RegExp(title));
  }
});

test('new navigation generations remount ShowScreen rather than relabel its prior ready hook resource', () => {
  const app = readFileSync(new URL('../../App.js', import.meta.url), 'utf8');
  let screen;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement' && node.name?.name === 'ShowScreen') screen = node;
    for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value); }
  };
  walk(parse(app, { sourceType: 'module', plugins: ['jsx'] }).program);
  assert.equal(screen.attributes.find(n => n.name?.name === 'key')?.value?.expression?.name, 'publicEventGeneration');
  assert.equal(screen.attributes.find(n => n.name?.name === 'onPublicEventResource')?.value?.expression?.name, 'reportPublicEventResource');
  assert.match(app, /frame !== nav/);
  assert.match(app, /generation: publicEventVisitRef\.current\.generation \+ 1/);
  assert.match(app, /setPublicEventTrailResource\(\{ generation: publicEventGeneration, resource \}\)/);
  assert.match(app, /publicEventTrailForVisit\(publicEventTrailResource, publicEventGeneration\)/);
});
