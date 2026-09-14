import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { formatDate } from "./dates.mjs";
import { normalizePublicEventSnapshot } from "./publicEventSnapshot.mjs";

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
