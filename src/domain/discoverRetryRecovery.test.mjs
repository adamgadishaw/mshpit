import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
const tree = parse(source, { sourceType: "module", plugins: ["jsx"] });
let refresh, retry;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && node.id?.name === "refreshDiscover") refresh = node.init.arguments[0];
  if (node.type === "JSXOpeningElement" && node.attributes.some(a => a.name?.name === "accessibilityLabel" && a.value?.value === "Retry updating Discover")) {
    retry = node.attributes.find(a => a.name?.name === "onPress")?.value?.expression;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value?.type) visit(value);
  }
}
visit(tree);

test("the visible Discover retry clears a failed refresh and retains errors if recovery still fails", async () => {
  assert.equal(retry?.type, "Identifier");
  assert.equal(retry.name, "refreshDiscover", "retry must own the aggregate warning as well as overview data");
  let fail = true, warning = false, refreshing = false, overviewCalls = 0, dateCalls = 0;
  const bindings = {
    pullRefreshControllerRef: { current: null },
    setPullRefreshing: value => { refreshing = value; },
    setPullRefreshError: value => { warning = value; },
    eventRange: { scopeKey: "", status: "idle" }, rangeScopeKey: "worldwide", selectedRangeDays: 30,
    requestEventRange: async () => true,
    requestOverview: async options => { assert.equal(options.force, true); overviewCalls++; if (fail) throw Error("local fixture offline"); return true; },
    selectedGenre: null, requestGenre: async () => true,
    refreshTourDates: async ({ signal }) => { assert.equal(signal.aborted, false); dateCalls++; return true; },
    refreshDiscoverySidebar: async () => true,
    programme: "artists", cityRefreshRef: { current: null }, festivalRefreshRef: { current: null },
    session: null, artistRecommendations: {},
  };
  const actualRefresh = new Function(...Object.keys(bindings), "return (" + source.slice(refresh.start, refresh.end) + ");")(...Object.values(bindings));
  assert.equal(await actualRefresh(), false);
  assert.equal(warning, true);
  assert.equal(refreshing, false);
  fail = false;
  assert.equal(await actualRefresh(), true);
  assert.equal(warning, false);
  assert.equal(refreshing, false);
  assert.equal(overviewCalls, 2);
  assert.equal(dateCalls, 2);
  fail = true;
  assert.equal(await actualRefresh(), false);
  assert.equal(warning, true);
});

