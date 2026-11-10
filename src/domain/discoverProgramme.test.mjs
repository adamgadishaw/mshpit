import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createBrowseReturnStore } from "./iosBrowseReturn.mjs";
import { createIOSFeedReturnStore } from "./iosFeedReturn.mjs";
import { DISCOVER_PROGRAMME_SECTIONS, discoverProgrammeKey, discoverProgrammeKeyboardTarget, restoredDiscoverProgramme } from "./discoverProgramme.mjs";

test("Discover keeps all six destinations without inventing routes or changing area", () => {
  // Festivals sit beside shows: multi-day events are never mixed into show lists.
  assert.deepEqual(DISCOVER_PROGRAMME_SECTIONS.map(({ key }) => key), ["shows", "festivals", "artists", "venues", "cities", "photos"]);
  for (const { key } of DISCOVER_PROGRAMME_SECTIONS) assert.equal(discoverProgrammeKey(key), key);
  for (const key of [null, undefined, "", "admin", {}, "__proto__"]) assert.equal(discoverProgrammeKey(key), "shows");
});

test("Discover keyboard navigation wraps and supports Home and End", () => {
  assert.equal(discoverProgrammeKeyboardTarget("shows", "ArrowLeft"), "photos");
  assert.equal(discoverProgrammeKeyboardTarget("photos", "ArrowRight"), "shows");
  assert.equal(discoverProgrammeKeyboardTarget("artists", "ArrowRight"), "venues");
  assert.equal(discoverProgrammeKeyboardTarget("shows", "ArrowRight"), "festivals");
  assert.equal(discoverProgrammeKeyboardTarget("venues", "Home"), "shows");
  assert.equal(discoverProgrammeKeyboardTarget("cities", "End"), "photos");
  for (const key of ["Tab", "Enter", "Escape", "a"]) assert.equal(discoverProgrammeKeyboardTarget("shows", key), null);
});

test("Discover restores its in-app destination while explicit directory links keep priority", () => {
  for (const { key } of DISCOVER_PROGRAMME_SECTIONS) assert.equal(restoredDiscoverProgramme(undefined, key), key);
  assert.equal(restoredDiscoverProgramme("artists", "venues"), "artists");
  assert.equal(restoredDiscoverProgramme("shows", "venues"), "shows");
  assert.equal(restoredDiscoverProgramme(undefined, "invalid"), "shows");
  assert.equal(restoredDiscoverProgramme("invalid", "venues"), "shows");
  const app = read("../../App.js");
  assert.match(app, /rememberedProgramme=\{rememberedDiscoverProgramme\}/);
  assert.match(app, /onProgrammeChange=\{\(programme\) => setDiscoverDestination/);
  assert.match(app, /discoverDestination\.accountId === \(session\?\.id \|\| null\)/);
  const opening = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement" && node.name.name === "DiscoverScreen") opening.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value?.type) visit(value);
  };
  visit(parse(app, { sourceType: "module", plugins: ["jsx"] }));
  assert.equal(opening.length, 1);
  const key = opening[0].attributes.find((a) => a.name?.name === "key").value.expression;
  const keyFor = new Function("discoverReturn", "session", "pager = false", `return (${app.slice(key.start, key.end)});`);
  assert.equal(keyFor(null, { id: "A" }), "A"); assert.equal(keyFor(null, null), "guest");
  const store = createBrowseReturnStore(); store.account("A");
  const a = store.lease("discover"); const before = keyFor(a, { id: "A" });
  assert.equal(keyFor(store.lease("discover"), { id: "A" }), before, "detail return retains the same key");
  store.account("B"); assert.notEqual(keyFor(store.lease("discover"), { id: "B" }), before);
  store.account("A"); const returned = keyFor(store.lease("discover"), { id: "A" }); assert.notEqual(returned, before);
  store.reset("discover"); assert.notEqual(keyFor(store.lease("discover"), { id: "A" }), returned, "new directory intent remounts");
  for (const lease of [null, a, store.lease("discover")]) assert.equal(keyFor(lease, { id: "A" }, true), undefined,
    "pager owns the stable surface key across destination promotion and lease reset");
  const mainPagers = [], shells = [];
  const collect = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement") {
      if (node.name.name === "NativeTabRail" && node.attributes.some(a => a.name?.name === "page")) mainPagers.push(node);
      if (node.name.name === "NativeFeedMediaLayer") shells.push(node);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(collect); else if (value?.type) collect(value);
  };
  collect(parse(app, { sourceType: "module", plugins: ["jsx"] }));
  assert.equal(mainPagers.length, 0, "Root main navigation is tap-only; Discover is not a horizontal Feed destination");
  assert.match(app, /const nativeTabPage = tabScreens;/);
  assert.equal(shells.length, 1);
  const shellKey = shells[0].attributes.find(a => a.name?.name === "key").value.expression;
  const ownerKey = new Function("session", "chatAuthEpoch", "Platform", `return (${app.slice(shellKey.start, shellKey.end)});`);
  const iosKey = (session, epoch) => ownerKey(session, epoch, { OS: "ios" });
  assert.notEqual(iosKey({ id: "A" }, 1), iosKey({ id: "B" }, 1), "shared shell retires local Feed pages across accounts");
  assert.notEqual(iosKey({ id: "A" }, 1), iosKey({ id: "A" }, 2), "same-account reauthentication retires local Feed pages");
  assert.notEqual(iosKey(null, 1), iosKey({ id: "A" }, 1));

  // Exercise the actual local selector key with the production Feed return
  // lease, rather than retaining the superseded Root main-pager key contract.
  const local = read("../screens/FeedScreen.ios.jsx");
  const localOpening = [];
  const walkLocal = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement") localOpening.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walkLocal); else if (value?.type) walkLocal(value);
  };
  walkLocal(parse(local, { sourceType: "module", plugins: ["jsx"] }));
  const localKey = localOpening.find(node => node.name.name === "Owner").attributes.find(a => a.name?.name === "key").value.expression;
  const keyForFeed = new Function("props", `return (${local.slice(localKey.start, localKey.end)});`);
  const feedStore = createIOSFeedReturnStore(), base = {};
  const feedKey = (accountId, epoch) => keyForFeed({ accountId, feedReturn: feedStore.reconcile(accountId, epoch, base) });
  const feedA = feedKey("A", 1);
  assert.equal(feedKey("A", 1), feedA, "same Feed lifetime keeps its selected filter and current pane");
  assert.notEqual(feedKey("B", 1), feedA);
  const feedAAgain = feedKey("A", 1); assert.notEqual(feedAAgain, feedA);
  assert.notEqual(feedKey("A", 2), feedAAgain, "actual Feed return epoch changes the local owner key");
  const localPager = localOpening.filter(node => node.name.name === "NativeFeedFilterPager");
  assert.equal(localPager.length, 0, "the side menu owns filter selection; Feed no longer intercepts horizontal tab swipes");
  assert.equal(localOpening.filter(node => node.name.name === "FeedPane").length, 1,
    "visited filters share the retained pane renderer, including the active filter");

});

test("a departed render cannot overwrite the URL just restored by browser Back", () => {
  const app = read("../../App.js");
  const effect = app.slice(app.indexOf("if (!web || browserHistoryRef.current?.path !== window.location.pathname) return;"));
  const guard = effect.indexOf("navigationRef.current.stack !== stack");
  const canonical = effect.indexOf("const canonical = nav.routeLoading");
  assert.ok(guard >= 0 && guard < canonical, "Canonical writes must fence out departed render state.");
  assert.match(effect.slice(0, canonical), /navigationRef\.current\.tab !== tab/);
  assert.match(effect.slice(0, canonical), /navigationRef\.current\.landing !== landing/);
});

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
test("Discover renders only the selected destination and keeps filter state independent", () => {
  const source = read("../screens/DiscoverScreen.jsx");
  const body = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
    .find((n) => n.type === "ExportDefaultDeclaration").declaration.body.body;
  const state = body.flatMap((n) => n.declarations || []).find((n) => n.id.elements?.[0]?.name === "programme");
  assert.equal(state.init.callee.name, "useState");
  const initializer = state.init.arguments[0];
  const initialize = new Function("initialBrowse", "initialProgramme", "rememberedProgramme", "restoredDiscoverProgramme",
    `return (${source.slice(initializer.start, initializer.end)})();`);
  assert.equal(initialize(null, "shows", "venues", restoredDiscoverProgramme), "shows");
  assert.equal(initialize(null, undefined, "venues", restoredDiscoverProgramme), "venues");
  assert.equal(initialize({ programme: "artists" }, "shows", "venues", restoredDiscoverProgramme), "artists", "return restores the intervening choice in this navigation lease");
  assert.match(source, /const rememberProgramme = useLatestCallback\(onProgrammeChange\)/);
  assert.match(source, /rememberProgramme\(programme\)/);
  const effect = body.find((n) => n.expression?.callee?.name === "useEffect"
    && source.slice(n.start, n.end).includes("initialProgrammeRef.current =" )).expression.arguments[0];
  const run = new Function("initialBrowse", "initialProgramme", "initialProgrammeRef", "setProgramme", "discoverProgrammeKey",
    `return (${source.slice(effect.start, effect.end)})();`);
  const changes = [], ref = { current: "shows" };
  run({ programme: "artists" }, "shows", ref, (v) => changes.push(v), discoverProgrammeKey);
  assert.deepEqual(changes, [], "same directory return must not overwrite the saved choice");
  run({ programme: "artists" }, "venues", ref, (v) => changes.push(v), discoverProgrammeKey);
  assert.deepEqual(changes, ["venues"], "a newer explicit intent wins");
  assert.match(source, /const \[areaExpanded, setAreaExpanded\] = useState\(false\)/);
  assert.match(source, /const \[dateExpanded, setDateExpanded\] = useState\(false\)/);
  for (const { key } of DISCOVER_PROGRAMME_SECTIONS) {
    assert.ok(source.includes(`programme === "${key}" && <View nativeID="discover-panel-${key}"`), `${key} has an owned conditional panel`);
  }
  assert.match(source, /<DiscoverProgrammeNav selected=\{programme\} onSelect=\{\(value\) => setProgramme\(discoverProgrammeKey\(value\)\)\}/);
  assert.match(source, /\{areaExpanded && <View style=\{styles.controlsCard\}/);
  assert.match(source, /\{dateExpanded && <View style=\{styles.rangeOptions\}/);
  assert.ok(source.indexOf("<DiscoverProgrammeNav") < source.indexOf('<View style={styles.controlsCard}'));
});

test("Discover tabs retain accessible relationships, keyboard focus, and touch targets", () => {
  const source = read("../components/discover/DiscoverProgrammeNav.jsx");
  assert.match(source, /accessibilityRole="tablist"/);
  assert.match(source, /accessibilityRole="tab"/);
  assert.match(source, /accessibilityState=\{\{ selected: active \}\}/);
  assert.match(source, /tabIndex: active \? 0 : -1/);
  assert.match(source, /"aria-selected": active/);
  assert.match(source, /"aria-controls": `discover-panel-\$\{section.key\}`/);
  assert.match(source, /tabs.current\[next\]\?\.focus\?\.\(\)/);
  assert.match(source, /minHeight: 52/);
  assert.match(source, /minHeight: 58/);
});

test("city discovery has an awaited pull refresh, visible errors, retry and an empty state", () => {
  const source = read("../features/cities/CityDiscoveryTiles.jsx");
  const screen = read("../screens/DiscoverScreen.jsx");
  assert.match(source, /registerRefresh\?\.\(resource.refresh\)/);
  assert.match(source, /return \(\) => registerRefresh\?\.\(null\)/);
  assert.match(source, /accessibilityRole="alert"/);
  assert.match(source, /onPress=\{resource.reload\}/);
  assert.match(source, /copy.noCities/);
  assert.match(screen, /cityRefreshRef.current\(\{ signal: controller.signal \}\)/);
  assert.match(screen, /\[accountId, programme, rangeScopeKey\]/, "changing destination cancels the owned refresh");
  assert.match(screen, /areaDisclosureRef.current\?\.focus\?\.\(\)/);
  assert.match(screen, /dateDisclosureRef.current\?\.focus\?\.\(\)/);
  for (const { key } of DISCOVER_PROGRAMME_SECTIONS) assert.ok(screen.includes(`tabPanelAccessibilityProps(Platform.OS, "discover-tab-${key}")`));
});
