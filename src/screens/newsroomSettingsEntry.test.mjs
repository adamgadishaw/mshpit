import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { journeyMenuModel } from "../domain/menuJourney.mjs";
import { assertNewsroomEntryIsolation, newsroomSettingsCases, verifyNewsroomMenuAccess } from "../../scripts/verify-news-category-browser.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./SettingsScreen.jsx", import.meta.url), "utf8");
const component = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find(node => node.type === "ExportDefaultDeclaration").declaration;
const compiled = require("@babel/core").transformSync(`${source.slice(component.start, component.end)}\nmodule.exports = SettingsScreen;`, {
  babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
function walk(value) {
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(walk)];
}
const appNodes = walk(parse(app, { sourceType: "module", plugins: ["jsx"] }).program);
const settingsProps = appNodes.find(node => node.type === "JSXOpeningElement" && node.name.name === "SettingsScreen").attributes;
const entry = settingsProps.find(node => node.name?.name === "onOpenNewsroom")?.value.expression;
function fixture(role) {
  let session = role ? { id: "settings-fixture", role, ageBand: "18_plus", handle: "fixture", emailVerified: true } : null;
  const module = { exports: {} }, frames = [];
  const jsx = (type, props) => ({ type, props });
  const tags = Object.fromEntries(["View", "Text", "ScrollView", "Pressable", "Row", "Toggle", "SheetHeader", "Icon", "Avatar", "ThemeSwatch", "CredentialForm", "CredentialInput", "CredentialLabel", "AccountPasswordForm", "AccountSwitcher", "AuthScreen"].map(tag => [tag, tag]));
  new vm.Script(compiled).runInNewContext({
    module, exports: module.exports, require: () => ({ jsx, jsxs: jsx }), ...tags,
    useStore: () => ({ session, blockedUsers: () => [], mutedUsers: () => [] }),
    useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
    useRef: current => ({ current }), useEffect: () => {},
    isMod: role => role === "moderator" || role === "admin",
    profileManagementAction: () => ({ destination: "profile", title: "Manage profile" }),
    visibleThemeChoices: () => [], THEMES: [], themeKey: "stage", styles: {}, colors: {}, versionLabel: "fixture",
  });
  assert.ok(entry, "App must wire the Settings callback");
  const onOpenNewsroom = vm.runInNewContext(`(${app.slice(entry.start, entry.end)})`, { go: frame => frames.push(JSON.parse(JSON.stringify(frame))) });
  return {
    frames,
    render: callback => module.exports({ onOpenNewsroom: callback === false ? undefined : onOpenNewsroom, onClose() {} }),
    switchRole: role => { session = role ? { ...session, role } : null; },
  };
}
const newsroomRows = tree => walk(tree).filter(node => node.type === "Row" && node.props?.label === "Newsroom");

test("Menu role assertions wait for both authentication and the lazy account Menu, including absent entries", async () => {
  for (const role of ["admin", "editor", "moderator", "fan"]) {
    let accountReady, menuReady, profileReady, menuMounted = false, profileMounted = false;
    const account = new Promise(resolve => { accountReady = resolve; });
    const menu = new Promise(resolve => { menuReady = () => { menuMounted = true; resolve(); }; });
    const profile = new Promise(resolve => { profileReady = () => { profileMounted = true; resolve(); }; });
    const events = [];
    const allowed = role === "admin" || role === "editor";
    const page = { getByRole: (kind, { name, exact }) => {
      assert.equal(exact, true);
      if (kind === "heading" && name === "Menu") return { waitFor: () => { events.push("wait-menu"); return menu; } };
      if (kind === "button" && name === "View Fixture Member's public profile") return { waitFor: () => { events.push("wait-account"); return profile; } };
      if (kind === "button" && name === "Settings. Appearance, privacy, data, and account controls") return { waitFor: async () => {
        assert.ok(menuMounted && profileMounted); events.push("settings-ready");
      } };
      assert.equal(kind, "button"); assert.equal(name, "Newsroom. Write stories and run live coverage");
      return {
        count: async () => { assert.ok(menuMounted && profileMounted, "An unmounted Menu cannot prove a denied role"); events.push("count"); return allowed ? 1 : 0; },
        scrollIntoViewIfNeeded: async () => { events.push("scroll"); },
        isVisible: async () => { assert.equal(events.at(-1), "scroll"); return true; },
      };
    } };
    const checked = verifyNewsroomMenuAccess(page, { role, name: "Fixture Member" }, account);
    await Promise.resolve(); assert.deepEqual(events, [], "No role assertion before the authenticated response");
    accountReady(); await Promise.resolve(); assert.deepEqual(events, ["wait-menu"]);
    menuReady(); await Promise.resolve(); assert.deepEqual(events, ["wait-menu", "wait-account"]);
    profileReady(); await checked;
    assert.deepEqual(events, ["wait-menu", "wait-account", "settings-ready", "count", ...(allowed ? ["scroll"] : [])]);
  }
});

test("real Settings opens the existing standalone Newsroom for admins and editors while preserving Menu access", () => {
  for (const role of ["admin", "editor"]) {
    const f = fixture(role), rows = newsroomRows(f.render());
    assert.equal(rows.length, 1);
    rows[0].props.onPress();
    assert.deepEqual(f.frames, [{ newsroom: true }], "No private AdminScreen destination is mounted");
    assert.ok(journeyMenuModel({ session: { role } }).account.some(item => item.key === "newsroom"));
    assert.equal(newsroomRows(f.render(false)).length, 0, "No dead shortcut without its navigation callback");
  }
});

test("real Settings masks the Newsroom shortcut immediately for moderator, member, artist and signed-out sessions", () => {
  const f = fixture("admin");
  assert.equal(newsroomRows(f.render()).length, 1);
  for (const role of ["moderator", "fan", "artist", null]) {
    f.switchRole(role);
    assert.equal(newsroomRows(f.render()).length, 0, String(role));
    assert.ok(!journeyMenuModel({ session: role ? { role } : null }).account.some(item => item.key === "newsroom"));
  }
  assert.deepEqual(f.frames, []);
});

test("cloud entry cases cover each role at both widths and reject private overview reads or writes", () => {
  assert.deepEqual(newsroomSettingsCases, [390, 1280].flatMap(width => ["admin", "editor", "moderator", "fan"].map(role => ({ width, role }))));
  const call = (path, phase = "newsroom-entry", method = "GET") => ({ path, phase, method, expectedAccount: "settings-fixture" });
  for (const role of ["admin", "editor", "moderator", "fan"]) {
    const bootstrap = role === "admin" ? [call("/api/admin/moderation", "bootstrap"), call("/api/admin/artist-requests", "bootstrap")]
      : role === "moderator" ? [call("/api/admin/moderation", "bootstrap")] : [];
    const entry = role === "admin" || role === "editor" ? [call("/api/moderation/news-desk/editor")] : [];
    const verify = calls => assertNewsroomEntryIsolation(calls, role, "settings-fixture");
    assert.doesNotThrow(() => verify([...bootstrap, ...entry]));
    for (const path of ["/api/admin/moderation", "/api/admin/members", "/api/admin/health", "/api/admin/errors", "/api/moderation/artist-death-watch"]) {
      assert.throws(() => verify([...bootstrap, ...entry, call(path)]), /private moderation overview/);
    }
    assert.throws(() => verify([...bootstrap, call("/api/moderation/news-desk/editor", "newsroom-entry", "POST")]), /perform writes/);
    assert.throws(() => verify([...bootstrap, call("/api/admin/members", "bootstrap")]), /sign-in reads/);
    if (!entry.length) assert.throws(() => verify([...bootstrap, call("/api/moderation/news-desk/editor")]), /private moderation overview/);
    else for (const expectedAccount of [undefined, "other-account"]) {
      assert.throws(() => verify([...bootstrap, { ...entry[0], expectedAccount }]), /bind the active account/);
    }
  }
});
