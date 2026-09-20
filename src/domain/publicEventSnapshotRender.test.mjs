import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { formatDate } from "./dates.mjs";
import { normalizePublicEventSnapshot, publicEventArtistIdentityPending } from "./publicEventSnapshot.mjs";

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
    styles: {}, colors: {}, formatDate,
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
  nodes(tree).find(node => node.props?.accessibilityLabel === "Refresh event details and artist availability").props.onPress();
  assert.equal(opened[0].providerVenueId, "room-id");
  assert.deepEqual(f.tickets, [event.ticketUrl]);
  assert.equal(retries, 1);
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
