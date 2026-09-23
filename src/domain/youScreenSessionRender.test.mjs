import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import * as concertMemories from "./concertMemories.mjs";
import * as concertMemoryGallery from "./concertMemoryGallery.mjs";
import * as dates from "./dates.mjs";
import * as artistWorkspace from "./artistAccountIdentity.mjs";
import * as profileTimeline from "./profileTimeline.mjs";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const filename = new URL("../screens/YouScreen.jsx", import.meta.url);
const compiled = transformSync(readFileSync(filename, "utf8"), {
  filename: filename.pathname, babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const accountA = { id: "account-a", name: "Account A", handle: "accounta", role: "fan" };
const accountB = { id: "account-b", name: "Account B", handle: "accountb", role: "fan" };
const privateLog = {
  id: "private-review-a", userId: accountA.id, kind: "review", artist: "Private artist A",
  artistKey: "private-artist-a", venue: "Memory Hall", date: "2020-01-01",
  archiveShowKey: "archive-show-a", photos: [],
};

function fixture() {
  let session, stateIndex = 0, refIndex = 0;
  const states = [], refs = [], archiveCalls = [];
  const rowsFor = (id) => id === accountA.id ? [privateLog] : [];
  const jsx = (type, props) => ({ type, props });
  const unexpectedAction = () => assert.fail("Rendering must not perform a refresh or external action");
  const dependencies = {
    react: {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (update) => { states[index] = typeof update === "function" ? update(states[index]) : update; }];
      },
      useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
      useMemo: (compute) => compute(),
      // Do not flush effects: identity isolation must hold in the first render.
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable",
      StyleSheet: { create: (value) => value, absoluteFill: {}, absoluteFillObject: {} },
      Platform: { OS: "web" }, Animated: {}, Easing: {}, Share: { share: unexpectedAction },
    },
    "../theme": { colors: {}, radius: {}, shadow: {}, mono: "mono", displayFont: "display", space: (value) => value * 4 },
    "../components/Icon": "Icon",
    "../components/Avatar": "Avatar",
    "../components/SmartImage": "SmartImage",
    "../components/ConcertMemoryModal": "ConcertMemoryModal",
    "../lib/lazyWithRetry": { lazyWithRetry: () => "ProfileScreen" },
    "../components/VinylRefreshBoundary": "VinylRefreshBoundary",
    "../components/Badge": { BadgeRow: "BadgeRow" },
    "../features/artistRecommendations/ArtistRecommendationsRail": "ArtistRecommendationsRail",
    "../store": {
      useStore: () => ({
        session, logsByUser: rowsFor, unreadNotifications: () => 0, inboxUnread: () => 0,
        genreOfArtist: () => "", userBadges: () => [], userPoints: () => 0,
        loadRewards: unexpectedAction, loadInboxThreads: unexpectedAction, refreshNotifications: unexpectedAction,
      }),
      isStaff: (role) => role === "admin" || role === "moderator",
      isMod: (role) => role === "admin" || role === "moderator",
    },
    "../domain/dates.mjs": dates,
    "../domain/concertMemories.mjs": concertMemories,
    "../domain/concertMemoryGallery.mjs": concertMemoryGallery,
    "../domain/artistAccountIdentity.mjs": artistWorkspace,
    "../domain/profileTimeline.mjs": profileTimeline,
    "../features/profileHistory/useProfileHistory": {
      useProfileHistory: ({ accountId }) => ({ posts: rowsFor(accountId), status: "ready", complete: true, retry: unexpectedAction }),
    },
    "../features/artistEvents/useArtistEventArchive": {
      useArtistEventReviews: (options) => {
        archiveCalls.push(options);
        return { resource: { status: "idle", data: { reviews: [] } } };
      },
    },
    "../features/artistRecommendations/useArtistRecommendations": {
      useArtistRecommendations: () => ({ resource: { status: "ready", data: [] }, retry: unexpectedAction, refresh: unexpectedAction }),
    },
  };
  const module = { exports: {} };
  new vm.Script(compiled, { filename: filename.pathname }).runInNewContext({
    module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error("Unexpected test import: " + name);
    },
  });
  return {
    render(nextSession, props = {}) {
      session = nextSession;
      stateIndex = 0;
      refIndex = 0;
      archiveCalls.length = 0;
      const tree = module.exports.default(props);
      assert.equal(archiveCalls.length, 1);
      return { tree, archive: archiveCalls[0] };
    },
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function renderedText(tree) {
  if (Array.isArray(tree)) return tree.map(renderedText).join(" ");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? renderedText(tree.props?.children) : String(tree);
}
function assertNoSelectedMemory({ tree, archive }) {
  assert.equal(archive.enabled, false);
  assert.equal(archive.name, null);
  assert.equal(archive.artistKey, null);
  assert.equal(archive.showKey, null);
  for (const modal of nodes(tree).filter((node) => node.type === "ConcertMemoryModal")) assert.equal(modal.props.memory, null);
}

for (const session of [null, undefined]) {
  test(`YouScreen renders the logged-out dashboard with an initial ${String(session)} session`, () => {
    const rendered = fixture().render(session);
    assert.match(renderedText(rendered.tree), /You're logged out/);
    assert.match(renderedText(rendered.tree), /LOG IN \/ SIGN UP/);
    assertNoSelectedMemory(rendered);
  });
}
test("a signed-in dashboard starts without a selected memory or archive request", () => {
  const rendered = fixture().render(accountA);
  assert.ok(nodes(rendered.tree).some((node) => node.type === "ProfileScreen" && node.props.userId === accountA.id));
  assertNoSelectedMemory(rendered);
});

test("the You tab renders the member's own profile with owner tools instead of a second profile card", () => {
  const f = fixture();
  const opened = [];
  const props = {
    onInbox: () => opened.push("inbox"),
    onActivity: () => opened.push("activity"),
    onCalendar: () => opened.push("calendar"),
    onSettings: () => opened.push("settings"),
    onManageProfile: () => opened.push("manage"),
    profile: { onOpenShow: () => opened.push("show") },
  };
  const { tree } = f.render(accountA, props);
  const profiles = nodes(tree).filter((node) => node.type === "ProfileScreen");
  assert.equal(profiles.length, 1);
  const [profile] = profiles;
  assert.equal(profile.props.userId, accountA.id);
  assert.equal(profile.props.asTab, true);
  assert.equal(profile.props.onOpenShow, props.profile.onOpenShow, "profile navigation is passed through unchanged");
  assert.deepEqual(Array.from(profile.props.ownerTools, (tool) => tool.label), ["Inbox", "Activity", "Calendar", "Settings"]);
  assert.deepEqual(opened, [], "rendering must not navigate");
  for (const tool of profile.props.ownerTools) tool.onPress();
  profile.props.onManageProfile();
  assert.deepEqual(opened, ["inbox", "activity", "calendar", "settings", "manage"]);
  assert.doesNotMatch(renderedText(tree), /View public profile|TOOLS|Near you/);
  for (const session of [null, undefined]) {
    assert.equal(nodes(f.render(session, props).tree).some((node) => node.type === "ProfileScreen"), false);
  }
});
for (const [label, nextSessions] of [["logout then account switch", [null, accountB]], ["direct account switch", [accountB]]]) {
  test(`a selected memory stays private during ${label}, before effects run`, () => {
    const f = fixture();
    const initial = f.render(accountA);
    const open = nodes(initial.tree).find((node) => node.props?.accessibilityLabel === `Open memory for ${privateLog.artist}`);
    assert.ok(open, "the real dashboard must offer the account's memory action");
    open.props.onPress();
    const selected = f.render(accountA);
    const modal = nodes(selected.tree).find((node) => node.type === "ConcertMemoryModal");
    assert.equal(modal.props.memory.log, privateLog);
    assert.equal(selected.archive.enabled, true);
    assert.equal(selected.archive.accountId, accountA.id);
    assert.equal(selected.archive.showKey, privateLog.archiveShowKey);
    for (const session of nextSessions) {
      const rendered = f.render(session);
      assertNoSelectedMemory(rendered);
      assert.ok(!renderedText(rendered.tree).includes(privateLog.artist));
      assert.equal(rendered.archive.accountId, session?.id || null);
    }
  });
}
