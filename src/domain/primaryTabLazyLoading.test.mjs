import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const feed = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
const rails = readFileSync(new URL("../components/Rails.jsx", import.meta.url), "utf8");

test("desktop rail does not pull optional feed panels back into the startup bundle", () => {
  assert.doesNotThrow(() => parse(rails, { sourceType: "module", plugins: ["jsx"] }));
  for (const name of ["HomeShowCountdown", "NewsRailPanel"]) {
    assert.ok(rails.includes(`const ${name} = lazyWithRetry(() => import(`));
    assert.ok(!rails.includes(`import ${name} from`));
  }
  assert.match(rails, /<Suspense fallback=\{<Text[^>]*>Loading music news…<\/Text>\}><NewsRailPanel/);
  assert.match(rails, /<Suspense fallback=\{<Text[^>]*>Loading your next show…<\/Text>\}><HomeShowCountdown/);
  assert.match(rails, /<Suspense fallback=\{<Text[^>]*>Loading show suggestions…<\/Text>\}><HomeShowCountdown/);
});

test("optional feed panels keep local loading boundaries without delaying the core feed", () => {
  assert.doesNotThrow(() => parse(feed, { sourceType: "module", plugins: ["jsx"] }));
  for (const name of ["HomeShowCountdown", "LiveCoverageCard"]) {
    assert.ok(feed.includes(`const ${name} = lazyWithRetry(() => import(`));
    assert.ok(!feed.includes(`import ${name} from`));
  }
  assert.match(feed, /<Suspense fallback=\{<Text[^>]*>Loading your next show…<\/Text>\}><HomeShowCountdown/);
  assert.match(feed, /<Suspense fallback=\{<Text[^>]*>Loading show suggestions…<\/Text>\}><HomeShowCountdown/);
  assert.match(feed, /<Suspense fallback=\{<Text[^>]*>Loading live coverage…<\/Text>\}><LiveCoverageCard/);
});

test("secondary primary tabs stay out of the first bundle and warm inside the selecting gesture", () => {
  assert.doesNotThrow(() => parse(app, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(app, /import FeedScreen from "\.\/src\/screens\/FeedScreen"/);
  assert.match(app, /const SearchScreen = lazyWithRetry\(\(\) => import\("\.\/src\/screens\/SearchScreen"\), "SearchScreen"\)/);
  assert.match(app, /const YouScreen = lazyWithRetry\(\(\) => import\("\.\/src\/screens\/YouScreen"\), "YouScreen"\)/);
  assert.doesNotMatch(app, /import SearchScreen from "\.\/src\/screens\/SearchScreen"/);
  assert.doesNotMatch(app, /import YouScreen from "\.\/src\/screens\/YouScreen"/);
  assert.match(app, /if \(key === "search"\) SearchScreen\.preload\?\.\(\)/);
  assert.match(app, /if \(key === "you"\) YouScreen\.preload\?\.\(\)/);
  // Only iOS owns the intent-render callback; Android/web keep the already
  // rendered current tab. Merely creating the iOS wrapper renders no neighbor.
  const declarations = [];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator") declarations.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value?.type) visit(value);
  };
  visit(parse(app, { sourceType: "module", plugins: ["jsx"] }));
  const native = declarations.find(node => node.id.name === "nativeTabPage").init;
  assert.equal(native.type, "ConditionalExpression"); assert.equal(native.alternate.name, "tabScreens");
  const isIOS = new Function("Platform", `return (${app.slice(native.test.start, native.test.end)});`);
  assert.equal(isIOS({ OS: "ios" }), true);
  for (const OS of ["android", "web"]) assert.equal(isIOS({ OS }), false);
  const rail = native.consequent.openingElement;
  assert.equal(rail.name.name, "NativeTabRail"); assert.ok(rail.attributes.some(a => a.name?.name === "page"));
  const render = rail.attributes.find(a => a.name?.name === "renderPage").value.expression;
  assert.equal(render.type, "ArrowFunctionExpression");
  const calls = [], renderPage = new Function("renderTabScreen", `return (${app.slice(render.start, render.end)});`)((...args) => { calls.push(args); return args; });
  assert.deepEqual(calls, [], "constructing the rail cannot prepare an idle neighbor");
  for (const preview of [true, false]) assert.deepEqual(renderPage("discover", preview), ["discover", preview, true]);
  const defaults = declarations.find(node => node.id.name === "renderTabScreen").init.params;
  assert.equal(defaults[0].right.name, "activeTab");
  assert.equal(defaults[1].right.value, false); assert.equal(defaults[2].right.value, false,
    "legacy tabScreens render keeps non-pager keys by default");
  assert.match(app, /<Suspense fallback=\{<ScreenLoading \/>\}>(?:<ScreenTransition [^>]*>)?\{nativeTabPage\}(?:<\/ScreenTransition>)?<\/Suspense>/);
});
