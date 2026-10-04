import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { eventDateMeta, optionalDistanceKm, splitVenuePlace } from "../src/domain/venueDiscovery.mjs";
import { liveEventLineupLabel, liveEventTitle } from "../src/domain/liveDiscovery.mjs";
import { LIVE_EVENT_PHASE, liveEventPhase } from "../src/domain/eventLifecycle.mjs";
import { eventPath } from "../src/domain/urls.mjs";
import { fetchPublicVenueSnapshot } from "../src/features/venuePublic/venuePublicApi.mjs";
import { venueHydrationIdentity, venueHydrationPath, venueHydrationSnapshot } from "./venue-hydration-fixture.mjs";

// Exercise the actual card and adapter without React Native, a build or a browser.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/VenueDiscoveryCards.jsx", import.meta.url), "utf8");
const card = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "UpcomingEventCard").declaration;
const compiled = require("@babel/core").transformSync(`${source.slice(card.start, card.end)}\nmodule.exports = UpcomingEventCard;`, {
  babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const module = { exports: {} };
const jsx = (type, props) => ({ type, props });
new vm.Script(compiled).runInNewContext({
  module, exports: module.exports, require: () => ({ jsx, jsxs: jsx }),
  View: "View", Text: "Text", Pressable: "Pressable", Icon: "Icon", PublicTextLink: "PublicTextLink",
  styles: {}, colors: {}, focusRing: {},
  eventDateMeta, optionalDistanceKm, splitVenuePlace, liveEventLineupLabel, liveEventTitle,
  LIVE_EVENT_PHASE, liveEventPhase, eventPath,
});
const render = module.exports;
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

test("cold venue browser fixture renders concert artist titles and event links through the real snapshot adapter and card", async () => {
  const calls = [], opened = [];
  for (const [after, firstNumber, count] of [[null, 1, 8], ["fixture-next", 9, 2]]) {
    const snapshot = await fetchPublicVenueSnapshot({ path: venueHydrationPath, identity: venueHydrationIdentity, after }, {
      apiCall: async (path, options) => {
        calls.push(path);
        assert.equal(options.expectedAccountId, null, "This read must work for a cold guest");
        return venueHydrationSnapshot(after);
      },
      invalidResponse: () => new Error("Invalid venue fixture"),
    });
    assert.equal(snapshot.events.length, count);
    for (const [index, event] of snapshot.events.entries()) {
      const number = firstNumber + index;
      assert.equal(event.eventName, `Hydration concert ${number}`, "Keep event and artist names distinct to expose selector mistakes");
      const tree = render({ event, onOpenEvent: () => opened.push(event.id) });
      const rendered = nodes(tree);
      assert.ok(rendered.some(node => node.type === "Text" && node.props.children === `Fixture Band ${number}`));
      assert.equal(rendered.some(node => node.type === "Text" && node.props.children === event.eventName), false);
      const link = rendered.find(node => node.type === "PublicTextLink");
      assert.equal(link.props.accessibilityLabel, `Open event details for Fixture Band ${number}`);
      assert.equal(link.props.href, `/event/venue-hydration-${number}`);
      link.props.onNavigate();
    }
  }
  assert.deepEqual(calls, [
    "/api/venue-snapshot?path=%2Fvenue%2Fticketmaster-rz7hnezaeot",
    "/api/venue-snapshot?path=%2Fvenue%2Fticketmaster-rz7hnezaeot&after=fixture-next",
  ]);
  assert.deepEqual(opened, Array.from({ length: 10 }, (_, index) => `venue-hydration-${index + 1}`));
});
