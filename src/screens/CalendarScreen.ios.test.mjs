import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { calendarDateLabel, calendarShowName, calendarTimeLabel } from "./calendarPresentation.mjs";
import { localCalendarIso } from "../domain/dates.mjs";

const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {}, codes = new Map();
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const text = node => node.text ?? (node.children || []).map(text).join(node.type === "Text" ? "" : " ");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const styles = value => Object.assign({}, ...(Array.isArray(value) ? value.flat(Infinity).filter(Boolean) : [value]));
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const i = parent.children.indexOf(child); if (i >= 0) parent.children.splice(i, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], scrolls: [], focus() {}, scrollTo(value) { this.scrolls.push(value); } }),
    createTextInstance: value => ({ text: value }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, value) => { node.text = value; },
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    hideInstance: noop, unhideInstance: noop, hideTextInstance: noop, unhideTextInstance: noop,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

const early = { calendarKey: "performance-early", artist: "Same Artist", venue: "Long Venue Name", city: "Fixture City", date: "2028-01-31", dayKey: "2028-01-31", going: true,
  calendarTiming: { startLocalTime: "19:00" }, ticketUrl: "https://fixture.invalid/early" };
const late = { ...early, calendarKey: "performance-late", going: false, calendarTiming: { startLocalTime: "22:00" }, ticketUrl: "https://fixture.invalid/late" };
const unknown = { calendarKey: "performance-unknown", artist: "Unknown Time", date: "2028-01-31", dayKey: "2028-01-31", venue: "Other Venue", city: "Other City" };
const later = { ...early, calendarKey: "performance-later", artist: "Later Artist", date: "2028-02-05", dayKey: "2028-02-05", going: false, interested: true };
const past = { ...early, calendarKey: "performance-past", artist: "Past Artist", date: "2027-12-30", dayKey: "2027-12-30", going: false, logged: true };
function projection(upcoming = [early, late, unknown, later], old = [past]) {
  const group = rows => Object.groupBy(rows, event => event.dayKey);
  return { upcoming, past: old, byDay: { upcoming: group(upcoming), past: group(old) } };
}

// Production screen JSX, presentation helpers, browse memory/hook and export
// ownership hook. The model projection, history, native hosts and I/O are
// synthetic boundaries; no API, calendar file, seller URL or device is touched.
function fixture({ accountId = "account-a", initialDate = "2028-01-31", initialView = "upcoming", width = 390, fontScale = 1,
  projected = projection(), history: initialHistory = {}, strict = false, delayClock = false, themeIsDark = true,
  initialAgendaLimit = 40, initialPresentation = "month" } = {}) {
  const renderer = createRenderer(), modules = new Map(), menus = [], exports = [], tickets = [], opens = [], artists = [], announcements = [];
  const refreshes = [], attendanceRefreshes = [], historyRetries = [], historyLoads = [], clocks = [], appListeners = new Set();
  let epoch = 1, routeCurrent = true, attendance = [], browse, backBlocked = false, keyboardDismissals = 0;
  const request = (list, data) => { const value = { ...deferred(), ...data }; list.push(value); return value.promise; };
  const history = { posts: [], nextCursor: null, updatedAt: 1, status: "ready", error: null, loadingMore: false,
    retry: () => request(historyRetries, {}), loadMore: () => request(historyLoads, {}), ...initialHistory };
  const serverTime = () => delayClock ? request(clocks, {}) : Promise.resolve({ now: new Date().toISOString() });
  const store = {
    upcomingEvents: () => [], goingFor: () => [],
    refreshTourDates: options => request(refreshes, { options }), refreshMyAttendance: options => request(attendanceRefreshes, { options }), serverTime,
  };
  const native = {
    ...Object.fromEntries(["View", "Text", "TextInput", "Pressable", "ScrollView", "ActivityIndicator"].map(name => [name, name])),
    StyleSheet: { create: value => value, hairlineWidth: 1 }, useWindowDimensions: () => ({ width, height: 844, fontScale }),
    AccessibilityInfo: { announceForAccessibility: value => announcements.push(value) }, Keyboard: { dismiss: () => keyboardDismissals++ },
    ActionSheetIOS: { showActionSheetWithOptions: (options, callback) => menus.push({ options, callback }) },
    AppState: { currentState: "active", addEventListener: (name, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
  };
  function imports(name, local) {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "../theme") return { colors: {}, radius: {}, font: "fixture", themeIsDark };
    if (name === "../store") return { useStore: () => ({ ...store, session: accountId ? { id: accountId } : null, chatAuthEpoch: epoch, myAttendance: attendance }) };
    if (name === "../components/ScreenHeader") return props => React.createElement("ScreenHeader", props, props.right);
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    if (name === "../features/profileHistory/useProfileHistory") return { useProfileHistory: () => history };
    if (name === "../domain/calendarShows.mjs") return { memberCalendarModel: () => projected };
    if (name === "../hooks/useIOSDetailBackBlock") return value => { backBlocked = value; };
    if (name === "../hooks/useCalendarBrowseState") return options => { browse = load("../hooks/useCalendarBrowseState.js").default({ ...options,
      initialState: { ...options.initialState, agendaLimit: initialAgendaLimit, presentation: initialPresentation } }); return browse; };
    if (name === "../hooks/useIOSCalendarExport") return load("../hooks/useIOSCalendarExport.ios.js");
    if (name === "../lib/calendarExport") return { exportCalendarEvents: (events, options) => request(exports, { events, options }) };
    if (name === "../lib/ticketLinks") return { openTicketLink: (url, options) => { tickets.push({ url, options }); return Promise.resolve(false); } };
    assert.ok(name.endsWith(".mjs"), `Unexpected dependency ${name}`);
    return local(name);
  }
  function load(path) {
    if (modules.has(path)) return modules.get(path);
    const file = new URL(path, import.meta.url);
    if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), { filename: file.pathname, babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
    }).code);
    const module = { exports: {} };
    new Function("require", "module", "exports", "setTimeout", "clearTimeout", codes.get(path))(
      name => imports(name, createRequire(file)), module, module.exports, () => 1, noop);
    modules.set(path, module.exports); return module.exports;
  }
  const Screen = load("./CalendarScreen.ios.jsx").default;
  const f = {
    menus, exports, tickets, opens, artists, announcements, refreshes, attendanceRefreshes, historyRetries, historyLoads, history, clocks,
    all: () => nodes(renderer.container), text: () => text(renderer.container), state: () => browse.state,
    find(predicate) { const node = f.all().find(predicate); assert.ok(node, "Expected rendered control"); return node; },
    button(label) { return f.find(node => node.type === "Pressable" && node.props.accessibilityLabel === label); },
    byText(value) { return f.find(node => node.type === "Pressable" && text(node) === value); },
    press(label) { f.act(() => f.button(label).props.onPress()); },
    pressText(value) { f.act(() => f.byText(value).props.onPress()); },
    more(event) { return f.button(`More actions for ${calendarShowName(event)}, ${calendarTimeLabel(event)}`); },
    showActions(event) { f.act(() => f.more(event).props.onPress()); },
    chooseMenu(title, menu = menus.at(-1)) { const index = menu.options.options.indexOf(title); assert.notEqual(index, -1, title); f.act(() => menu.callback(index)); },
    editYear(value) { f.act(() => f.find(node => node.type === "TextInput").props.onChangeText(value)); },
    openJump() { f.act(() => f.find(node => node.type === "Pressable" && node.props.accessibilityLabel?.endsWith(". Jump to month")).props.onPress()); },
    selectedDay(date) { return f.find(node => node.type === "Pressable" && node.props.accessibilityLabel?.startsWith(`${calendarDateLabel(date)},`)); },
    act: callback => renderer.act(callback),
    render() { renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(Screen, {
      initialDate, initialView, isCurrentRoute: () => routeCurrent, onOpen: event => opens.push(event), onOpenArtist: name => artists.push(name), onClose: noop,
    }))); },
    scope(id, nextEpoch = epoch) { accountId = id; epoch = nextEpoch; f.render(); },
    resize(nextWidth, nextScale) { width = nextWidth; fontScale = nextScale; f.render(); },
    replaceModel(next) { projected = next; attendance = []; f.render(); },
    cover() { routeCurrent = false; },
    appState(value) { native.AppState.currentState = value; f.act(() => appListeners.forEach(listener => listener(value))); },
    get backBlocked() { return backBlocked; }, get keyboardDismissals() { return keyboardDismissals; },
    async settle() { for (let i = 0; i < 4; i++) await Promise.resolve(); await new Promise(setImmediate); f.act(noop); },
    close() { renderer.render(null); },
  };
  f.render(); return f;
}

test("actual iOS controls preserve All shows/Month defaults and explicitly change scope/display", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  assert.equal(f.state().scope, "all"); assert.equal(f.state().presentation, "month");
  assert.equal(f.button("Month").props.accessibilityState.selected, true);
  assert.equal(f.all().filter(node => node.props?.accessibilityLabel?.startsWith("More actions for")).length, 3);
  f.press("Calendar scope: All shows. Change scope"); f.chooseMenu("Cancel");
  assert.equal(f.state().scope, "all");
  f.press("Calendar scope: All shows. Change scope"); f.chooseMenu("My plans");
  assert.equal(f.state().scope, "plans"); assert.equal(f.state().selected, "2028-01-31");
  assert.equal(f.all().filter(node => node.props?.accessibilityLabel?.startsWith("More actions for")).length, 1);
  f.press("Agenda"); assert.equal(f.state().presentation, "agenda"); assert.ok(f.more(later));
  f.press("Month"); assert.equal(f.state().selected, "2028-01-31"); assert.ok(f.more(early));
  assert.equal(f.all().some(node => node.props?.accessibilityLabel?.includes("More actions for Later Artist")), false);
});

test("Jump stages year/month until Show month, Cancel leaves selection and month intact", t => {
  const f = fixture(); t.after(f.close);
  f.openJump(); assert.equal(f.backBlocked, true); f.editYear("2029"); f.pressText("February");
  assert.equal(f.state().selected, "2028-01-31"); assert.deepEqual(f.state().cursor, { y: 2028, m: 0 });
  f.pressText("Cancel"); assert.equal(f.backBlocked, false); assert.equal(f.state().selected, "2028-01-31");
  f.openJump(); assert.equal(f.find(node => node.type === "TextInput").props.value, "2028");
  f.pressText("February"); f.pressText("Show month");
  assert.equal(f.state().selected, "2028-02-29"); assert.deepEqual(f.state().cursor, { y: 2028, m: 1 });
  assert.equal(f.backBlocked, false); assert.equal(f.all().some(node => node.type === "TextInput"), false);
  f.press("Next month"); assert.equal(f.state().selected, "2028-03-29");
});

test("Jump rejects empty, partial and out-of-range years through actual submit controls", t => {
  const f = fixture(); t.after(f.close); f.openJump();
  for (const value of ["", "20", "1899", "2101"]) {
    f.editYear(value); f.pressText("Show month");
    assert.equal(f.state().selected, "2028-01-31"); assert.ok(f.text().includes("Enter a year from 1900 to 2100."));
    assert.equal(f.announcements.at(-1), "Enter a year from 1900 to 2100.");
  }
  f.editYear("2029"); f.pressText("February");
  f.act(() => f.find(node => node.type === "TextInput").props.onSubmitEditing());
  assert.equal(f.state().selected, "2029-02-28");
});

test("selected day, period and Today handlers update actual browse state and exact show navigation", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.act(() => f.selectedDay("2028-01-30").props.onPress()); assert.equal(f.state().selected, "2028-01-30");
  f.act(() => f.selectedDay("2028-01-31").props.onPress());
  const row = f.find(node => node.type === "Pressable" && node.props.accessibilityLabel?.startsWith(`Same Artist, ${calendarTimeLabel(late)},`));
  f.act(() => row.props.onPress()); assert.equal(f.opens[0].calendarKey, late.calendarKey); assert.equal(f.opens[0].city, "Fixture City");
  f.press("Past shows"); assert.equal(f.state().view, "past"); assert.equal(f.state().selected, past.date); assert.ok(f.more(past));
  f.press("Go to today"); assert.equal(f.state().view, "upcoming"); assert.equal(f.state().selected, localCalendarIso(new Date()));
  assert.ok(f.keyboardDismissals > 0);
});

test("rows expose separate performance times, unconfirmed/unknown time, and festival continuation", t => {
  const unresolved = { ...unknown, calendarKey: "unresolved", artist: "Unresolved Time", calendarTiming: { status: "unresolved" } };
  const continuation = { ...unknown, calendarKey: "festival", artist: "Festival", date: "2028-01-30", endDate: "2028-02-02" };
  const f = fixture({ projected: projection([early, late, unknown, unresolved, continuation]) }); t.after(f.close);
  for (const event of [early, late, unknown, unresolved, continuation]) assert.ok(f.more(event));
  assert.ok(f.text().includes("Time TBA")); assert.ok(f.text().includes("Time unconfirmed")); assert.ok(f.text().includes("Continues"));
  assert.notEqual(calendarTimeLabel(early), calendarTimeLabel(late));
});

test("native action menu cancels, rejects duplicate presentation and exports the exact stable performance", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.showActions(late); f.showActions(early); assert.equal(f.menus.length, 1);
  f.chooseMenu("Cancel"); assert.equal(f.exports.length, 0); assert.equal(f.opens.length, 0);
  f.showActions(late); f.chooseMenu("Save to calendar");
  assert.equal(f.exports.length, 1); assert.equal(f.exports[0].events, late); assert.equal(f.exports[0].options.isCurrent(), true);
  assert.equal(f.more(late).props.accessibilityState.busy, true); assert.equal(f.more(early).props.accessibilityState.busy, false);
  f.replaceModel(projection([late, unknown, early, later]));
  assert.equal(f.more(late).props.accessibilityState.busy, true); assert.equal(f.more(early).props.accessibilityState.busy, false);
  f.showActions(early); const menu = f.menus.at(-1); assert.ok(menu.options.disabledButtonIndices.includes(menu.options.options.indexOf("Save to calendar")));
  f.chooseMenu("Save to calendar"); assert.equal(f.exports.length, 1);
  f.exports[0].resolve({ status: "cancelled" }); await f.settle(); assert.equal(f.more(late).props.accessibilityState.busy, false);
});

test("calendar export action includes only Going and cannot export an empty guest plan", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.press("Calendar options"); f.chooseMenu("Save my Going shows"); assert.deepEqual(f.exports[0].events, [early]);
  const guest = fixture({ accountId: null, projected: projection([late, unknown]) }); t.after(guest.close);
  guest.press("Calendar scope: All shows. Change scope"); guest.chooseMenu("My plans"); assert.equal(guest.state().scope, "all");
  guest.press("Calendar options"); guest.chooseMenu("Save my Going shows"); assert.equal(guest.exports.length, 0);
});

test("ticket failure is visible and announced; cancelled/postponed shows offer no ticket action", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.showActions(early); f.chooseMenu("View tickets at seller"); assert.equal(f.tickets[0].url, early.ticketUrl);
  f.act(() => f.tickets[0].options.onFailure());
  assert.ok(f.text().includes("Tickets could not be opened. Please try again from the show."));
  assert.equal(f.announcements.at(-1), "Tickets could not be opened. Please try again from the show.");
  for (const eventStatus of ["cancelled", "postponed"]) {
    f.replaceModel(projection([{ ...early, eventStatus }])); f.showActions(early);
    assert.equal(f.menus.at(-1).options.options.includes("View tickets at seller"), false); f.chooseMenu("Cancel");
  }
});

for (const expiration of ["account", "epoch", "cover", "unmount", "background"]) test(`pending native action callback cannot run after ${expiration}`, async t => {
  const f = fixture(); t.after(f.close); await f.settle(); f.showActions(early); const menu = f.menus.at(-1);
  if (expiration === "account") f.scope("account-b");
  else if (expiration === "epoch") f.scope("account-a", 2);
  else if (expiration === "cover") f.cover();
  else if (expiration === "unmount") f.close();
  else f.appState("background");
  for (const title of ["Open show", "Save to calendar", "Open artist", "View tickets at seller"]) f.chooseMenu(title, menu);
  assert.equal(f.opens.length, 0); assert.equal(f.exports.length, 0); assert.equal(f.artists.length, 0); assert.equal(f.tickets.length, 0);
});

test("late seller failure and export completion cannot cross account identity", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.showActions(early); f.chooseMenu("View tickets at seller"); f.showActions(early); f.chooseMenu("Save to calendar");
  f.scope("account-b"); assert.equal(f.exports[0].options.isCurrent(), false);
  f.act(() => f.tickets[0].options.onFailure()); f.exports[0].resolve({ status: "shared" }); await f.settle();
  assert.equal(f.text().includes("Tickets could not be opened"), false); assert.equal(f.text().includes("Calendar sharing closed"), false);
  assert.equal(f.more(early).props.accessibilityState.busy, false);
});

test("refresh retains loaded shows on failure and rejects completion after account replacement", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  const refresh = () => f.find(node => node.type === "VinylRefreshBoundary").props.onRefresh();
  let result; f.act(() => { result = refresh(); }); await f.settle();
  assert.ok(f.more(early)); f.refreshes[0].resolve(false); f.attendanceRefreshes[0].resolve(true); f.historyRetries[0].resolve({ status: "ready" });
  await result; await f.settle(); assert.ok(f.text().includes("Some details could not refresh.")); assert.ok(f.more(early));
  f.act(() => { result = refresh(); }); await f.settle(); f.scope("account-b");
  assert.equal(f.refreshes[1].options.signal.aborted, true);
  f.refreshes[1].resolve(false); f.attendanceRefreshes[1].resolve(true); f.historyRetries[1].resolve({ status: "ready" });
  await result; await f.settle(); assert.equal(f.text().includes("Some details could not refresh."), false);
});

test("accepting a server date different from the device does not restart a clock-refresh loop", async t => {
  const f = fixture({ delayClock: true }); t.after(f.close); await f.settle();
  assert.equal(f.clocks.length, 1);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  f.clocks[0].resolve({ now: tomorrow.toISOString() }); await f.settle();
  assert.equal(f.clocks.length, 1, "changing the accepted date must not start more server reads");
  f.press("Go to today"); assert.equal(f.state().selected, localCalendarIso(tomorrow));
});

test("manual clock refresh supersedes the initial read and foreground supersedes background work", async t => {
  const f = fixture({ delayClock: true }); t.after(f.close); await f.settle();
  let result; f.act(() => { result = f.find(node => node.type === "VinylRefreshBoundary").props.onRefresh(); }); await f.settle();
  f.refreshes[0].resolve(true); f.attendanceRefreshes[0].resolve(true); f.historyRetries[0].resolve({ status: "ready" });
  f.clocks[1].resolve({ now: "2031-03-04T12:00:00Z" }); await result; await f.settle();
  f.clocks[0].resolve({ now: "2030-01-01T12:00:00Z" }); await f.settle();
  f.press("Go to today"); assert.equal(f.state().selected, localCalendarIso(new Date("2031-03-04T12:00:00Z")));
  f.appState("background"); f.appState("active"); await f.settle();
  assert.equal(f.clocks.length, 3);
  f.appState("background"); f.appState("active"); await f.settle();
  f.clocks[3].resolve({ now: "2032-05-06T12:00:00Z" }); await f.settle();
  f.clocks[2].resolve({ now: "2030-01-01T12:00:00Z" }); await f.settle();
  f.press("Go to today"); assert.equal(f.state().selected, localCalendarIso(new Date("2032-05-06T12:00:00Z")));
});

for (const themeIsDark of [true, false]) test(`native menu follows the ${themeIsDark ? "dark" : "light"} app theme`, t => {
  const f = fixture({ themeIsDark }); t.after(f.close); f.showActions(early);
  assert.equal(f.menus.at(-1).options.userInterfaceStyle, themeIsDark ? "dark" : "light");
});

for (const retirement of ["background", "account"]) test(`retired ${retirement} menu callbacks cannot consume a newer menu`, async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.showActions(early); const old = f.menus.at(-1);
  if (retirement === "background") { f.appState("background"); f.appState("active"); }
  else f.scope("account-b");
  f.showActions(late); const fresh = f.menus.at(-1); assert.notEqual(fresh, old);
  f.chooseMenu("Open show", old); assert.equal(f.opens.length, 0);
  f.chooseMenu("Open show", fresh); assert.deepEqual(f.opens.map(event => event.calendarKey), [late.calendarKey]);
});

test("event-only name, distinct artist and sold-out status match visible and spoken row content", t => {
  const events = [{ ...early, eventName: "Winter Festival", artist: "Headliner", soldOut: true },
    { ...late, eventName: "Community Night", artist: "", soldOut: true },
    { ...unknown, eventName: "Cancelled Night", soldOut: true, eventStatus: "cancelled" }];
  const f = fixture({ projected: projection(events) }); t.after(f.close);
  for (const event of events) {
    const row = f.find(node => node.type === "Pressable" && node.props.accessibilityLabel?.startsWith(`${calendarShowName(event)}, ${calendarTimeLabel(event)},`));
    assert.equal(row.props.accessibilityLabel.includes("Sold out"), event.eventStatus !== "cancelled");
    f.showActions(event); assert.equal(f.menus.at(-1).options.title, calendarShowName(event)); f.chooseMenu("Cancel");
  }
  assert.ok(f.text().includes("Winter Festival")); assert.ok(f.text().includes("Community Night"));
});

test("cross-year agenda headings and range identify the year", t => {
  const nextYear = { ...later, calendarKey: "next-year", date: "2029-01-31", dayKey: "2029-01-31" };
  const f = fixture({ projected: projection([early, nextYear]) }); t.after(f.close); f.press("Agenda");
  const headings = f.all().filter(node => node.type === "Text" && node.props.accessibilityRole === "header").map(text);
  assert.ok(headings.includes(calendarDateLabel(early.date, { year: "numeric" })));
  assert.ok(headings.includes(calendarDateLabel(nextYear.date, { year: "numeric" })));
  assert.ok(headings.some(heading => heading.includes("2029")));
  assert.equal(headings.includes("Date unavailable"), false);
  assert.ok(f.text().includes(`From ${calendarDateLabel(early.date, { weekday: undefined, year: "numeric" })}`));
});

test("actual agenda Show more reaches performances beyond 2000 and exhausts remaining rows", t => {
  const rows = Array.from({ length: 2041 }, (_, i) => ({ ...early, calendarKey: `performance-${i}`, artist: `Artist ${i}` }));
  const f = fixture({ projected: projection(rows), initialAgendaLimit: 2000, initialPresentation: "agenda" }); t.after(f.close);
  f.pressText("Show more (41)"); f.pressText("Show more (1)");
  assert.equal(f.state().agendaLimit, 2080); assert.ok(f.more(rows.at(-1)));
  assert.equal(f.all().some(node => node.type === "Pressable" && text(node).startsWith("Show more")), false);
});

for (const expiration of ["account", "epoch", "cover", "unmount"]) test(`captured direct date and Jump controls cannot mutate after ${expiration}`, async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  const old = [f.button("Next month").props.onPress, f.button("Past shows").props.onPress, f.button("Go to today").props.onPress];
  f.openJump(); old.push(f.find(node => node.type === "TextInput").props.onChangeText.bind(null, "2099"),
    f.byText("February").props.onPress, f.byText("Show month").props.onPress);
  if (expiration === "account") f.scope("account-b");
  else if (expiration === "epoch") f.scope("account-a", 2);
  else if (expiration === "cover") f.cover();
  else f.close();
  const before = f.state(), dismissed = f.keyboardDismissals;
  f.act(() => old.forEach(callback => callback()));
  assert.deepEqual(f.state(), before); assert.equal(f.keyboardDismissals, dismissed);
});

test("older-history failure is visible and its Retry retries the failed page", async t => {
  const f = fixture({ initialView: "past", history: { nextCursor: "older-page" } }); t.after(f.close); await f.settle();
  f.pressText("Load earlier shows"); assert.equal(f.historyLoads.length, 1);
  f.historyLoads[0].resolve({ error: "fixture failure" }); await f.settle();
  assert.ok(f.text().includes("Some logged shows could not load.")); f.pressText("Retry history");
  assert.equal(f.historyLoads.length, 2); assert.equal(f.historyRetries.length, 0);
});

test("dense selected days paginate without hiding later performances", t => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ ...early, calendarKey: `performance-${i}`, artist: `Artist ${i}` }));
  const f = fixture({ projected: projection(rows) }); t.after(f.close);
  assert.equal(f.all().filter(node => node.props?.accessibilityLabel?.startsWith("More actions for")).length, 40);
  f.pressText("Show more (5)"); assert.equal(f.all().filter(node => node.props?.accessibilityLabel?.startsWith("More actions for")).length, 45);
  f.press("Agenda"); assert.equal(f.state().agendaLimit, 40); f.pressText("Show more (5)"); assert.ok(f.more(rows.at(-1)));
});

test("narrow and large-text JSX keeps explicit Month choice, minimum grid targets, wrapping rows and one vertical scroller", t => {
  const f = fixture(); t.after(f.close);
  for (const width of [320, 390, 768]) for (const scale of [1, 1.2, 2, 3.1]) {
    f.resize(width, scale); assert.equal(f.state().presentation, "month"); assert.ok(f.button("Agenda"));
    const scrolls = f.all().filter(node => node.type === "ScrollView");
    assert.equal(scrolls.filter(node => !node.props.horizontal).length, 1);
    assert.equal(scrolls[0].props.keyboardDismissMode, "interactive"); assert.equal(scrolls[0].props.automaticallyAdjustKeyboardInsets, true);
    const grid = scrolls.find(node => node.props.horizontal); const canvas = grid.children[0];
    assert.ok(styles(canvas.props.style).width / 7 >= 44);
    const day = f.selectedDay("2028-01-31"); assert.ok(styles(day.props.style({ pressed: false })).minHeight >= 44);
    const row = f.find(node => node.type === "Pressable" && node.props.accessibilityLabel?.startsWith(`Same Artist, ${calendarTimeLabel(early)},`));
    if (scale > 1.2) assert.equal(styles(row.props.style({ pressed: false })).flexDirection, "column");
    for (const node of nodes(row).filter(node => node.type === "Text")) assert.equal(node.props.numberOfLines, undefined);
  }
});
